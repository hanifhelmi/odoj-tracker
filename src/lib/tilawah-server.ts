// ============================================================
// Tilawah Tracker — Server-side logic
// Sync Google Sheet → SQLite/memori (via lapisan resilient) + agregasi
//
// Catatan deploy Vercel: di serverless database hanya OPSIONAL.
// Sumber data permanen adalah Google Sheet (jadwal) + Apps Script
// (penulisan status). Lihat src/lib/tilawah-store.ts.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  countEntries,
  countPendingLocals,
  deleteMeta,
  getMeta,
  markLocalsSynced,
  readAllEntries,
  readAllLocals,
  readPendingLocals,
  replaceAllEntries,
  restoreLocalsIfEmpty,
  setMeta,
  upsertLocals,
  type StoreLocal,
} from '@/lib/tilawah-store'
import {
  SHEET_CSV_URL,
  SYNC_INTERVAL_MS,
  todayJakarta,
  type AktivitasItem,
  type DashboardData,
  type DayEntry,
  type DayInfo,
  type DayListItem,
  type DayResponse,
  type MatrixColumn,
  type ParticipantStats,
  type PushResult,
  type SheetRow,
  type SheetSettings,
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
  const lastSyncAt = await getMeta('lastSyncAt')

  if (!force && lastSyncAt) {
    const age = Date.now() - new Date(lastSyncAt).getTime()
    if (age < SYNC_INTERVAL_MS) {
      return { ok: true, skipped: true, rows: undefined, at: lastSyncAt }
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
  await replaceAllEntries(
    parsed.map((r) => ({
      harike: r.harike,
      tanggal: r.tanggal,
      target: r.target,
      nama: r.nama,
      sheetStatus: r.status,
      sheetTimestamp: r.timestamp,
    })),
    now,
  )

  return { ok: true, rows: parsed.length, at: now }
}

/**
 * Pastikan data tersedia (sync bila perlu) + jalankan pemulihan koneksi/update
 * tertunda dari file tahan-reset, lalu aktifkan pengirim ulang otomatis.
 */
export async function ensureSynced(): Promise<SyncResult> {
  startAutoPushLoop()
  const count = await countEntries()
  const result = count === 0 ? await syncFromSheet(true) : await syncFromSheet(false)
  await restorePendingFromBridge()
  return result
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
  const [sheet, locals] = await Promise.all([readAllEntries(), readAllLocals()])

  const localMap = new Map<string, StoreLocal>()
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
  const lastSync = await getMeta('lastSyncAt')

  // "Hari ini" (Asia/Jakarta) — pakai param ?date bila ada, bila tidak hitung sendiri
  const todayISO = hariIniISO?.trim() || todayJakarta()

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

  // Hari yang bertanggal hari ini (haritgl == today)
  const hariIniRow = rows.find((r) => r.tanggal === todayISO)
  const hariIni = hariIniRow ? dayInfos.get(hariIniRow.harike) ?? null : null
  const selesaiHariIni = hariIniRow
    ? rows.filter((r) => r.harike === hariIniRow.harike && r.status === 'Selesai').length
    : 0

  // Posisi program = hari yang bertanggal HARI INI (match haritgl == today, Asia/Jakarta)
  let posisiProgram: DayInfo | null = hariIniRow ? dayInfos.get(hariIniRow.harike) ?? null : null

  // Fallback bila tidak ada baris bertanggal hari ini:
  // ambil hari dengan tanggal terdekat dari hari ini (prioritas tanggal terakhir <= hari ini,
  // bila tidak ada → tanggal paling awal setelah hari ini, mis. program belum mulai)
  if (!posisiProgram) {
    const dated = [...dayInfos.values()]
      .filter((d): d is DayInfo & { tanggal: string } => Boolean(d.tanggal))
      .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0))
    if (dated.length > 0) {
      let lewat: (DayInfo & { tanggal: string }) | undefined
      for (let i = dated.length - 1; i >= 0; i--) {
        if (dated[i].tanggal <= todayISO) {
          lewat = dated[i]
          break
        }
      }
      posisiProgram = lewat ?? dated[0] ?? null
    }
  }

  // Fallback terakhir (sheet tanpa tanggal sama sekali): hari paling awal yang belum semua Selesai
  if (!posisiProgram) {
    for (const h of harikeList) {
      const dayRows = rows.filter((r) => r.harike === h)
      if (dayRows.some((r) => r.status !== 'Selesai')) {
        posisiProgram = dayInfos.get(h) ?? null
        break
      }
    }
  }

  // Sisa peserta yang belum menyelesaikan target pada posisi program
  const sisaDiPosisi = posisiProgram
    ? rows.filter((r) => r.harike === posisiProgram!.harike && r.status !== 'Selesai').length
    : 0

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
    lastSync: lastSync ?? null,
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

  // Saran: prioritas hari yang bertanggal HARI INI bila masih ada yang belum selesai,
  // selain itu hari paling awal yang belum selesai semua
  const todayISO = todayJakarta()
  const todayRow = rows.find((r) => r.tanggal === todayISO)
  let suggestion: DayInfo | null = null
  if (todayRow) {
    const todayRowsAll = byDay.get(todayRow.harike) ?? []
    if (todayRowsAll.some((r) => r.status !== 'Selesai')) {
      suggestion = toDayInfo(todayRow.harike, todayRow.tanggal, todayRow.target)
    }
  }
  if (!suggestion) {
    for (const [h, dayRowsAll] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      if (dayRowsAll.some((r) => r.status !== 'Selesai')) {
        suggestion = toDayInfo(h, dayRowsAll[0]?.tanggal ?? null, dayRowsAll[0]?.target ?? '')
        break
      }
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
// Simpan update status dari app + tulis ke Google Sheet
// ------------------------------------------------------------

const WEBAPP_URL_KEY = 'sheetWebAppUrl'

// ------------------------------------------------------------
// Konfigurasi jembatan TAHAN RESET (di luar SQLite)
//
// SQLite di lingkungan sandbox dapat ter-reset saat server/sandbox
// restart — jika Web App URL hanya disimpan di DB, koneksi hilang dan
// aplikasi meminta "Hubungkan Sheet" lagi. Karena itu URL + update
// tertunda dipantarkan juga ke file sheet-bridge.json, dan dibaca
// kembali otomatis (self-heal) saat DB kehilangan datanya.
// ------------------------------------------------------------

// Di Vercel filesystem bersifat read-only (kecuali /tmp) — file jembatan
// disimpan ke /tmp agar tetap berfungsi; di lokal tetap di root proyek.
const BRIDGE_FILE =
  process.env.VERCEL === '1'
    ? path.join(os.tmpdir(), 'sheet-bridge.json')
    : path.join(process.cwd(), 'sheet-bridge.json')

interface BridgePendingUpdate {
  harike: number
  nama: string
  status: StatusTilawah
  updatedAt: string
}

interface BridgeConfig {
  version: 1
  webAppUrl: string | null
  savedAt: string | null
  pendingUpdates: BridgePendingUpdate[]
}

function readBridgeConfig(): BridgeConfig {
  const empty: BridgeConfig = { version: 1, webAppUrl: null, savedAt: null, pendingUpdates: [] }
  try {
    const raw = fs.readFileSync(BRIDGE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>
    return {
      version: 1,
      webAppUrl:
        typeof parsed.webAppUrl === 'string' && parsed.webAppUrl.trim().length > 0
          ? parsed.webAppUrl.trim()
          : null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
      pendingUpdates: Array.isArray(parsed.pendingUpdates)
        ? parsed.pendingUpdates.filter(
            (p) =>
              p &&
              Number.isFinite(p.harike) &&
              typeof p.nama === 'string' &&
              p.nama.length > 0 &&
              (p.status === 'Belum' || p.status === 'On Progress' || p.status === 'Selesai'),
          )
        : [],
    }
  } catch {
    return empty
  }
}

function writeBridgeConfig(cfg: BridgeConfig): void {
  try {
    const tmp = `${BRIDGE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
    fs.renameSync(tmp, BRIDGE_FILE)
  } catch (err) {
    console.error('[sheet-bridge] gagal menulis file konfigurasi:', err)
  }
}

/** Simpan / hapus URL koneksi pada file tahan-reset */
function persistUrlToBridge(url: string | null): void {
  const cfg = readBridgeConfig()
  writeBridgeConfig({
    ...cfg,
    webAppUrl: url,
    savedAt: url ? new Date().toISOString() : cfg.savedAt,
  })
}

/** Pantarkan daftar update tertunda (DB → file) sebagai cadangan bila DB ter-reset */
async function mirrorPendingToBridge(): Promise<void> {
  try {
    const pending = await readPendingLocals()
    const mirrored: BridgePendingUpdate[] = pending.map((p) => ({
      harike: p.harike,
      nama: p.nama,
      status: p.status as StatusTilawah,
      updatedAt: p.updatedAt.toISOString(),
    }))
    const cfg = readBridgeConfig()
    if (JSON.stringify(cfg.pendingUpdates) === JSON.stringify(mirrored)) return
    writeBridgeConfig({ ...cfg, pendingUpdates: mirrored })
  } catch (err) {
    console.error('[sheet-bridge] gagal memantarkan update tertunda:', err)
  }
}

let restorePromise: Promise<void> | null = null

/** Pulihkan update tertunda dari file bila DB kosong (setelah reset/restart) */
export function restorePendingFromBridge(): Promise<void> {
  restorePromise ??= (async () => {
    try {
      const pending = readBridgeConfig().pendingUpdates
      if (pending.length === 0) return
      const entries = await readAllEntries()
      const existing = new Set(entries.map((e) => `${e.harike}::${e.nama}`))
      const rows = pending.filter((p) => existing.has(`${p.harike}::${p.nama}`))
      if (rows.length === 0) return
      const restored = await restoreLocalsIfEmpty(
        rows.map((p) => ({
          harike: p.harike,
          nama: p.nama,
          status: p.status,
          updatedAt: p.updatedAt,
        })),
      )
      if (!restored) return // data lokal masih utuh — file hanya cadangan
      console.log(
        `[sheet-bridge] ${rows.length} update tertunda dipulihkan dari sheet-bridge.json setelah reset`,
      )
      void autoPushOnce('restore')
    } catch (err) {
      console.error('[sheet-bridge] gagal memulihkan update tertunda:', err)
    }
  })()
  return restorePromise
}

/**
 * Ambil Web App URL koneksi. Urutan sumber: DB → sheet-bridge.json → env.
 * Bila DB kehilangan datanya, URL dipulihkan otomatis (self-heal).
 */
async function getBridgeUrl(): Promise<string | null> {
  const saved = await getMeta(WEBAPP_URL_KEY)
  if (saved) return saved

  const fromFile = readBridgeConfig().webAppUrl
  const fromEnv = process.env.SHEET_WEBAPP_URL?.trim() || null
  const recovered = fromFile ?? fromEnv
  if (recovered) {
    await setMeta(WEBAPP_URL_KEY, recovered)
    console.log(
      '[sheet-bridge] koneksi Google Sheet dipulihkan otomatis dari',
      fromFile ? 'sheet-bridge.json' : 'SHEET_WEBAPP_URL',
    )
  }
  return recovered
}

/** Baca pengaturan koneksi Google Sheet (Web App URL + jumlah baris belum terkirim) */
export async function getSheetSettings(): Promise<SheetSettings> {
  startAutoPushLoop()
  await restorePendingFromBridge()
  const [url, pendingCount] = await Promise.all([getBridgeUrl(), countPendingLocals()])
  // Ada yang tertunda? Kirim ulang otomatis di latar belakang (dengan penjaga jeda)
  void autoPushOnce('settings')
  return { connected: Boolean(url), url, pendingCount }
}

/** Uji koneksi ke Web App Apps Script (GET harus mengembalikan JSON ok) */
async function testWebApp(url: string): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', cache: 'no-store' })
    const text = await res.text()
    let body: { ok?: boolean; message?: string } = {}
    try {
      body = JSON.parse(text) as { ok?: boolean }
    } catch {
      throw new Error(
        'Web App tidak mengembalikan JSON. Pastikan deployment: Execute as "Me" dan akses "Anyone".',
      )
    }
    if (!res.ok || !body.ok) {
      throw new Error('Web App merespons tidak sesuai. Pastikan kode Apps Script sesuai contoh.')
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timeout menghubungi Web App (20 detik). Periksa URL dan deployment.')
    }
    if (err instanceof Error && /fetch failed|ENOTFOUND|getaddrinfo/i.test(err.message)) {
      throw new Error('Tidak dapat menghubungi script.google.com. Periksa URL Web App.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Validasi + simpan Web App URL Apps Script (uji koneksi dengan GET, 2 kali percobaan) */
export async function saveSheetUrl(rawUrl: string): Promise<void> {
  const url = rawUrl.trim()
  if (!/^https:\/\/script\.google\.com\/.+\/exec(\?.*)?$/.test(url)) {
    throw new Error('URL tidak valid. Tempelkan Web App URL Apps Script yang berakhiran /exec')
  }

  // Google kadang lambat/gagal sesaat — coba 2 kali sebelum menyatakan gagal
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await testWebApp(url)
      lastError = null
      break
    } catch (err) {
      lastError = err
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  if (lastError) throw lastError

  await setMeta(WEBAPP_URL_KEY, url)
  // Simpan juga ke file tahan-reset agar koneksi tidak hilang saat DB/server ter-reset
  persistUrlToBridge(url)
  console.log('[sheet-bridge] koneksi Google Sheet tersimpan (DB + sheet-bridge.json)')
}

/** Hapus koneksi ke Google Sheet (DB + file tahan-reset) */
export async function clearSheetUrl(): Promise<void> {
  await deleteMeta(WEBAPP_URL_KEY)
  persistUrlToBridge(null)
}

interface AppsScriptResponse {
  ok?: boolean
  error?: string
  results?: { harike: number; nama: string; ok: boolean }[]
}

/**
 * Kirim semua LocalUpdate yang belum tersinkron (sheetSynced=false) ke
 * Google Sheet melalui Apps Script Web App.
 */
export async function pushPendingToSheet(): Promise<PushResult> {
  const url = await getBridgeUrl()
  if (!url) {
    return { ok: false, skipped: true, error: 'Google Sheet belum terhubung (Web App URL belum diisi)' }
  }

  const pending = await readPendingLocals()
  if (pending.length === 0) return { ok: true, pushed: 0 }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: pending.map((p) => ({ harike: p.harike, nama: p.nama, status: p.status })),
      }),
      signal: ctrl.signal,
      redirect: 'follow',
    })
    const text = await res.text()
    let body: AppsScriptResponse = {}
    try {
      body = JSON.parse(text) as AppsScriptResponse
    } catch {
      return { ok: false, error: `Web App merespons ${res.status} (bukan JSON). Periksa deployment.` }
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `Web App merespons ${res.status}` }
    }

    // Tandai baris yang berhasil ditulis di sheet
    const hasResults = Array.isArray(body.results) && body.results.length > 0
    const okSet = new Set<string>()
    if (hasResults) {
      for (const r of body.results!) if (r.ok) okSet.add(`${r.harike}::${r.nama}`)
    }
    const rowsToMark = hasResults
      ? pending.filter((p) => okSet.has(`${p.harike}::${p.nama}`))
      : pending

    if (rowsToMark.length > 0) {
      await markLocalsSynced(rowsToMark.map((p) => ({ harike: p.harike, nama: p.nama })))
    }

    // Perbarui cermin cadangan (baris yang masih tertunda setelah pengiriman)
    await mirrorPendingToBridge()

    const allOk = rowsToMark.length === pending.length
    return {
      ok: allOk,
      pushed: rowsToMark.length,
      error: allOk ? undefined : body.error || 'Sebagian baris tidak ditemukan di sheet',
    }
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Timeout menghubungi Google Sheet (20 detik)'
          : err.message
        : 'Gagal terhubung ke Google Sheet'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------
// Auto-push latar belakang — kirim ulang update tertunda secara
// otomatis sehingga data selalu mengalir ke Google Sheet tanpa
// perlu tekanan manual ("Kirim Ulang").
// ------------------------------------------------------------

const AUTO_PUSH_INTERVAL_MS = 60_000 // pemeriksaan tiap 1 menit
const AUTO_PUSH_MIN_GAP_MS = 45_000 // jeda minimal antar percobaan

interface AutoPushGlobal {
  __tilawahAutoPushTimer?: ReturnType<typeof setInterval>
  __tilawahAutoPushLast?: number
  __tilawahAutoPushBusy?: boolean
}

// globalThis agar aman dari double-instantiasi module (HMR/dev)
const autoPushGlobal = globalThis as unknown as AutoPushGlobal

/** Satu percobaan kirim-ulang otomatis (dengan penjaga agar tidak spam) */
export async function autoPushOnce(trigger: string): Promise<PushResult | null> {
  if (autoPushGlobal.__tilawahAutoPushBusy) return null
  const now = Date.now()
  if (
    autoPushGlobal.__tilawahAutoPushLast &&
    now - autoPushGlobal.__tilawahAutoPushLast < AUTO_PUSH_MIN_GAP_MS
  ) {
    return null
  }
  try {
    autoPushGlobal.__tilawahAutoPushBusy = true
    const url = await getBridgeUrl()
    if (!url) return null
    const pending = await countPendingLocals()
    if (pending === 0) return null

    autoPushGlobal.__tilawahAutoPushLast = now
    console.log(`[auto-push] mengirim ${pending} perubahan tertunda ke Google Sheet (${trigger})…`)
    const result = await pushPendingToSheet()
    if (result.ok) {
      console.log(`[auto-push] berhasil: ${result.pushed ?? 0} perubahan tertulis di Google Sheet`)
    } else {
      console.warn('[auto-push] gagal:', result.error)
    }
    return result
  } catch (err) {
    console.error('[auto-push] error:', err)
    return null
  } finally {
    autoPushGlobal.__tilawahAutoPushBusy = false
  }
}

/** Jalankan loop pemeriksaan otomatis (sekali per proses, aman dipanggil berulang) */
export function startAutoPushLoop(): void {
  if (autoPushGlobal.__tilawahAutoPushTimer) return
  autoPushGlobal.__tilawahAutoPushTimer = setInterval(() => {
    void autoPushOnce('interval')
  }, AUTO_PUSH_INTERVAL_MS)
  autoPushGlobal.__tilawahAutoPushTimer.unref?.()
}

export interface SaveProgressResult extends DayResponse {
  push: PushResult
}

/** Simpan update status dari app, lalu langsung tulis ke Google Sheet */
export async function saveProgress(
  updates: { harike: number; nama: string; status: StatusTilawah }[],
): Promise<SaveProgressResult> {
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

  await upsertLocals(valid)

  // Pantarkan update tertunda ke file tahan-reset SEBELUM mencoba push
  await mirrorPendingToBridge()

  // Tulis ke Google Sheet via Apps Script Web App (bila sudah terhubung)
  const push = await pushPendingToSheet()

  const harike = valid[0].harike
  const resp = await buildDayResponse({ harike })
  return { ...resp, push }
}
