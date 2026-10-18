// ============================================================
// Tilawah Tracker — Server-side logic
// Sync Google Sheet → SQLite + agregasi data dashboard
// ============================================================

import { db } from '@/lib/db'
import {
  SHEET_CSV_URL,
  SYNC_INTERVAL_MS,
  type AktivitasItem,
  type DashboardData,
  type DayEntry,
  type DayInfo,
  type DayListItem,
  type DayResponse,
  type MatrixColumn,
  type ParticipantStats,
  type SheetRow,
  type StatusTilawah,
  parseSheetCsv,
  toDayInfo,
} from '@/lib/tilawah'

// ------------------------------------------------------------
// Sinkronisasi dari Google Sheet
// ------------------------------------------------------------

export interface SyncResult {
  ok: boolean
  skipped?: boolean
  rows?: number
  at?: string
  error?: string
}

/**
 * Ambil CSV dari Google Sheet (publik) lalu replace isi tabel TilawahEntry.
 * Lokal update (LocalUpdate) tidak pernah tersentuh — status dari app selalu menang.
 */
export async function syncFromSheet(force = false): Promise<SyncResult> {
  const meta = await db.syncMeta.findUnique({ where: { key: 'lastSyncAt' } })

  if (!force && meta) {
    const age = Date.now() - new Date(meta.value).getTime()
    if (age < SYNC_INTERVAL_MS) {
      return { ok: true, skipped: true, rows: undefined, at: meta.value }
    }
  }

  let csv: string
  try {
    const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' })
    if (!res.ok) {
      return { ok: false, error: `Google Sheet merespons ${res.status}` }
    }
    csv = await res.text()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal mengambil sheet' }
  }

  const parsed: SheetRow[] = parseSheetCsv(csv)
  if (parsed.length === 0) {
    return { ok: false, error: 'Sheet kosong atau format tidak dikenali' }
  }

  const now = new Date().toISOString()
  await db.$transaction([
    db.tilawahEntry.deleteMany(),
    db.tilawahEntry.createMany({
      data: parsed.map((r) => ({
        harike: r.harike,
        tanggal: r.tanggal,
        target: r.target,
        nama: r.nama,
        sheetStatus: r.status,
        sheetTimestamp: r.timestamp,
      })),
    }),
    db.syncMeta.upsert({
      where: { key: 'lastSyncAt' },
      create: { key: 'lastSyncAt', value: now },
      update: { value: now },
    }),
  ])

  return { ok: true, rows: parsed.length, at: now }
}

/** Pastikan data tersedia (sync bila perlu) */
export async function ensureSynced(): Promise<SyncResult> {
  const count = await db.tilawahEntry.count()
  if (count === 0) return syncFromSheet(true)
  return syncFromSheet(false)
}

// ------------------------------------------------------------
// Merge sheet + local update → entri efektif
// ------------------------------------------------------------

interface EffectiveRow {
  harike: number
  tanggal: string | null
  target: string
  nama: string
  status: StatusTilawah
  updatedAt: string | null
  source: 'sheet' | 'app'
}

async function getEffectiveRows(): Promise<EffectiveRow[]> {
  const [sheet, locals] = await Promise.all([
    db.tilawahEntry.findMany({ orderBy: [{ harike: 'asc' }, { nama: 'asc' }] }),
    db.localUpdate.findMany(),
  ])

  const localMap = new Map<string, (typeof locals)[number]>()
  for (const l of locals) localMap.set(`${l.harike}::${l.nama}`, l)

  return sheet.map((s) => {
    const local = localMap.get(`${s.harike}::${s.nama}`)
    return {
      harike: s.harike,
      tanggal: s.tanggal,
      target: s.target,
      nama: s.nama,
      status: (local?.status ?? s.sheetStatus) as StatusTilawah,
      updatedAt: local ? local.updatedAt.toISOString() : s.sheetTimestamp,
      source: local ? ('app' as const) : ('sheet' as const),
    }
  })
}

function toDayEntry(r: EffectiveRow): DayEntry {
  const info = toDayInfo(r.harike, r.tanggal, r.target)
  return { ...info, nama: r.nama, status: r.status, updatedAt: r.updatedAt, source: r.source }
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

export async function buildDashboard(hariIniISO: string | null): Promise<DashboardData> {
  const rows = await getEffectiveRows()
  const lastSync = await db.syncMeta.findUnique({ where: { key: 'lastSyncAt' } })

  const names = [...new Set(rows.map((r) => r.nama))].sort((a, b) =>
    a.localeCompare(b, 'id'),
  )
  const harikeList = [...new Set(rows.map((r) => r.harike))].sort((a, b) => a - b)

  // Info per hari
  const dayInfos = new Map<number, DayInfo>()
  for (const r of rows) {
    if (!dayInfos.has(r.harike)) dayInfos.set(r.harike, toDayInfo(r.harike, r.tanggal, r.target))
  }

  const totalPeserta = names.length || 1
  const totalSelesai = rows.filter((r) => r.status === 'Selesai').length
  const totalTarget = rows.length

  // Hari yang bertanggal hari ini
  const hariIniRow = hariIniISO
    ? rows.find((r) => r.tanggal === hariIniISO)
    : undefined
  const hariIni = hariIniRow ? dayInfos.get(hariIniRow.harike) ?? null : null
  const selesaiHariIni = hariIniRow
    ? rows.filter((r) => r.harike === hariIniRow.harike && r.status === 'Selesai').length
    : 0

  // Posisi program: hari paling awal yang belum semua Selesai
  let posisiProgram: DayInfo | null = null
  let sisaDiPosisi = 0
  for (const h of harikeList) {
    const dayRows = rows.filter((r) => r.harike === h)
    const belum = dayRows.filter((r) => r.status !== 'Selesai').length
    if (belum > 0) {
      posisiProgram = dayInfos.get(h) ?? null
      sisaDiPosisi = belum
      break
    }
  }

  // Statistik per peserta
  const peserta: ParticipantStats[] = names.map((nama) => {
    const mine = rows.filter((r) => r.nama === nama)
    const selesai = mine.filter((r) => r.status === 'Selesai').length
    const onProgress = mine.filter((r) => r.status === 'On Progress').length
    const belum = mine.filter((r) => r.status === 'Belum').length

    // Juz selesai = pasangan target A & B keduanya Selesai
    const juzSet = new Set<number>()
    for (const r of mine) {
      if (r.status !== 'Selesai') continue
      const m = r.target.match(/^(\d+)([A-Za-z])$/)
      if (m) juzSet.add(parseInt(m[1], 10))
    }
    const halves = new Map<number, Set<string>>()
    for (const r of mine) {
      const m = r.target.match(/^(\d+)([A-Za-z])$/)
      if (!m) continue
      const juz = parseInt(m[1], 10)
      if (!halves.has(juz)) halves.set(juz, new Set())
      if (r.status === 'Selesai') halves.get(juz)!.add(m[2].toUpperCase())
    }
    const juzSelesai = [...halves.values()].filter((s) => s.has('A') && s.has('B')).length

    const todayEntry = hariIniRow ? mine.find((r) => r.harike === hariIniRow.harike) : undefined
    const lastUpdate =
      mine
        .map((r) => r.updatedAt)
        .filter((t): t is string => Boolean(t))
        .sort()
        .pop() ?? null

    return {
      nama,
      selesai,
      onProgress,
      belum,
      totalHari: mine.length,
      progressPct: mine.length > 0 ? Math.round((selesai / mine.length) * 100) : 0,
      juzSelesai,
      statusHariIni: todayEntry?.status ?? null,
      lastUpdate,
    }
  })

  // Ranking: selesai terbanyak, lalu nama
  peserta.sort((a, b) => b.selesai - a.selesai || a.nama.localeCompare(b.nama, 'id'))

  // Matriks hari × peserta
  const matriks: MatrixColumn[] = harikeList.map((h) => {
    const dayRows = rows.filter((r) => r.harike === h)
    const statuses: Record<string, StatusTilawah> = {}
    for (const r of dayRows) statuses[r.nama] = r.status
    const info = dayInfos.get(h)!
    return {
      ...info,
      statuses,
      selesaiCount: dayRows.filter((r) => r.status === 'Selesai').length,
    }
  })

  // Aktivitas terakhir (berdasarkan updatedAt)
  const aktivitasTerakhir: AktivitasItem[] = rows
    .filter((r) => r.updatedAt)
    .sort((a, b) => (a.updatedAt! < b.updatedAt! ? 1 : a.updatedAt! > b.updatedAt! ? -1 : 0))
    .slice(0, 6)
    .map((r) => ({
      nama: r.nama,
      harike: r.harike,
      target: r.target,
      status: r.status,
      waktu: r.updatedAt!,
      source: r.source,
    }))

  return {
    totalPeserta: names.length,
    totalHari: harikeList.length,
    totalSelesai,
    totalTarget,
    progressKeseluruhan: totalTarget > 0 ? Math.round((totalSelesai / totalTarget) * 100) : 0,
    hariIni,
    selesaiHariIni,
    posisiProgram,
    sisaDiPosisi,
    peserta,
    matriks,
    aktivitasTerakhir,
    lastSync: lastSync?.value ?? null,
  }
}

// ------------------------------------------------------------
// Data per hari (halaman update progress)
// ------------------------------------------------------------

export async function buildDayResponse(params: {
  date?: string | null
  harike?: number | null
}): Promise<DayResponse> {
  const rows = await getEffectiveRows()
  const names = [...new Set(rows.map((r) => r.nama))].sort((a, b) => a.localeCompare(b, 'id'))
  const totalPeserta = names.length || 1

  // Daftar semua hari + progres
  const byDay = new Map<number, EffectiveRow[]>()
  for (const r of rows) {
    if (!byDay.has(r.harike)) byDay.set(r.harike, [])
    byDay.get(r.harike)!.push(r)
  }
  const semuaHari: DayListItem[] = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, dayRows]) => ({
      ...toDayInfo(h, dayRows[0]?.tanggal ?? null, dayRows[0]?.target ?? ''),
      selesaiCount: dayRows.filter((r) => r.status === 'Selesai').length,
      totalPeserta,
    }))

  // Cari hari: prioritas harike, lalu tanggal
  let dayRows: EffectiveRow[] | undefined
  if (params.harike != null) {
    dayRows = byDay.get(params.harike)
  } else if (params.date) {
    dayRows = rows.find((r) => r.tanggal === params.date)
      ? byDay.get(rows.find((r) => r.tanggal === params.date)!.harike)
      : undefined
  }

  // Saran: hari paling awal yang belum selesai semua
  let suggestion: DayInfo | null = null
  for (const [h, dayRowsAll] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    if (dayRowsAll.some((r) => r.status !== 'Selesai')) {
      suggestion = toDayInfo(h, dayRowsAll[0]?.tanggal ?? null, dayRowsAll[0]?.target ?? '')
      break
    }
  }

  if (!dayRows) {
    return { date: params.date ?? '', day: null, entries: [], suggestion, semuaHari }
  }

  const harike = dayRows[0].harike
  const entries = names.map(
    (nama) =>
      toDayEntry(
        dayRows!.find((r) => r.nama === nama) ?? {
          harike,
          tanggal: dayRows[0].tanggal,
          target: dayRows[0].target,
          nama,
          status: 'Belum',
          updatedAt: null,
          source: 'sheet',
        },
      ),
  )

  return {
    date: params.date ?? '',
    day: toDayInfo(harike, dayRows[0].tanggal, dayRows[0].target),
    entries,
    suggestion: null,
    semuaHari,
  }
}

// ------------------------------------------------------------
// Simpan update status dari app
// ------------------------------------------------------------

export async function saveProgress(updates: { harike: number; nama: string; status: StatusTilawah }[]) {
  const valid = updates.filter(
    (u) =>
      Number.isFinite(u.harike) &&
      typeof u.nama === 'string' &&
      u.nama.trim().length > 0 &&
      (u.status === 'Belum' || u.status === 'On Progress' || u.status === 'Selesai'),
  )
  if (valid.length === 0) {
    throw new Error('Tidak ada perubahan valid untuk disimpan')
  }

  await db.$transaction(
    valid.map((u) =>
      db.localUpdate.upsert({
        where: { harike_nama: { harike: u.harike, nama: u.nama } },
        create: { harike: u.harike, nama: u.nama, status: u.status },
        update: { status: u.status },
      }),
    ),
  )

  const harike = valid[0].harike
  const resp = await buildDayResponse({ harike })
  return resp
}
