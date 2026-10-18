// ============================================================
// Tilawah Tracker — One Day One Juz
// Tipe data & helper bersama (dipakai frontend + backend)
// ============================================================

export type StatusTilawah = 'Belum' | 'On Progress' | 'Selesai'

export const STATUS_LIST: StatusTilawah[] = ['Belum', 'On Progress', 'Selesai']

export const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1N_8Nbr4bRQafoTN6TEkS9ZY0AOON3nS7BWQ1pU_GMws/export?format=csv'

export const SHEET_WEB_URL =
  'https://docs.google.com/spreadsheets/d/1N_8Nbr4bRQafoTN6TEkS9ZY0AOON3nS7BWQ1pU_GMws/edit'

export const SYNC_INTERVAL_MS = 3 * 60 * 1000 // 3 menit

/** Satu baris jadwal dengan status efektif (sheet + overlay update dari app) */
export interface DayEntry {
  harike: number
  tanggal: string | null // ISO yyyy-MM-dd
  target: string // "1A", "1B", ...
  juz: number // 1..30
  bagian: 'A' | 'B'
  nama: string
  status: StatusTilawah
  updatedAt: string | null // ISO
  source: 'sheet' | 'app'
}

/** Info ringkas satu hari program */
export interface DayInfo {
  harike: number
  tanggal: string | null
  target: string
  juz: number
  bagian: 'A' | 'B'
}

export interface ParticipantStats {
  nama: string
  selesai: number
  onProgress: number
  belum: number
  totalHari: number
  progressPct: number // 0..100 (selesai / totalHari)
  juzSelesai: number // jumlah juz yang A & B keduanya Selesai
  statusHariIni: StatusTilawah | null // status pada hari yang bertanggal hari ini
  lastUpdate: string | null
}

export interface MatrixColumn extends DayInfo {
  statuses: Record<string, StatusTilawah>
  selesaiCount: number
}

export interface AktivitasItem {
  nama: string
  harike: number
  target: string
  status: StatusTilawah
  waktu: string
  source: 'sheet' | 'app'
}

export interface DashboardData {
  totalPeserta: number
  totalHari: number
  totalSelesai: number
  totalTarget: number
  progressKeseluruhan: number // 0..100
  hariIni: DayInfo | null // hari yang bertanggal hari ini
  selesaiHariIni: number
  posisiProgram: DayInfo | null // hari terdekat yang belum selesai semua
  sisaDiPosisi: number // jumlah peserta yang belum selesai di posisiProgram
  peserta: ParticipantStats[]
  matriks: MatrixColumn[]
  aktivitasTerakhir: AktivitasItem[]
  lastSync: string | null
}

export interface DayListItem extends DayInfo {
  selesaiCount: number
  totalPeserta: number
}

export interface DayResponse {
  date: string
  day: DayInfo | null
  entries: DayEntry[]
  suggestion: DayInfo | null
  semuaHari: DayListItem[]
}

// ------------------------------------------------------------
// Parsing tanggal dari sheet (format campur aduk)
//  - "30-Sep-2026"  → 2026-09-30
//  - "1-Oct-2026"   → 2026-10-01
//  - "10/18/2026"   → 2026-10-18 (M/D/YYYY, locale US)
//  - ""             → null
// ------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2, peb: 2, pebruari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agustus: 8, aug: 8, augst: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Normalisasi berbagai format tanggal menjadi ISO yyyy-MM-dd */
export function normalizeTanggal(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null

  // Format D-MMM-YYYY / D MMM YYYY  (30-Sep-2026)
  const dmy = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/)
  if (dmy) {
    const d = parseInt(dmy[1], 10)
    const m = MONTH_MAP[dmy[2].toLowerCase()]
    const y = parseInt(dmy[3], 10)
    if (m && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`
    return null
  }

  // Format M/D/YYYY atau M/D/YYYY H:mm
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (mdy) {
    const m = parseInt(mdy[1], 10)
    const d = parseInt(mdy[2], 10)
    const y = parseInt(mdy[3], 10)
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`
    return null
  }

  // Sudah ISO (yyyy-MM-dd ...)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  return null
}

/** Normalisasi timestamp (boleh mengandung jam) menjadi ISO string */
export function normalizeTimestamp(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  const tanggal = normalizeTanggal(s)
  if (!tanggal) return null
  const jam = s.match(/(\d{1,2}):(\d{2})(:(\d{2}))?/)
  if (jam) {
    return `${tanggal}T${pad2(parseInt(jam[1], 10))}:${jam[2]}:${jam[4] ?? '00'}`
  }
  return tanggal
}

/** Parse target "3B" → { juz: 3, bagian: 'B' } */
export function parseTarget(target: string): { juz: number; bagian: 'A' | 'B' } {
  const m = target.trim().match(/^(\d+)\s*([A-Za-z])$/)
  if (m) {
    return { juz: parseInt(m[1], 10), bagian: m[2].toUpperCase() === 'B' ? 'B' : 'A' }
  }
  return { juz: 0, bagian: 'A' }
}

export function toDayInfo(harike: number, tanggal: string | null, target: string): DayInfo {
  const { juz, bagian } = parseTarget(target)
  return { harike, tanggal, target, juz, bagian }
}

// ------------------------------------------------------------
// CSV parser sederhana (mendukung quoted field)
// ------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface SheetRow {
  harike: number
  tanggal: string | null
  target: string
  nama: string
  status: StatusTilawah
  timestamp: string | null
}

/** Parse CSV sheet menjadi baris terstruktur (header: harike,haritgl,target,nama,status,timestamp) */
export function parseSheetCsv(csv: string): SheetRow[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const idx = {
    harike: header.indexOf('harike'),
    haritgl: header.indexOf('haritgl'),
    target: header.indexOf('target'),
    nama: header.indexOf('nama'),
    status: header.indexOf('status'),
    timestamp: header.indexOf('timestamp'),
  }

  const out: SheetRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => !c.trim())) continue

    const harike = parseInt((r[idx.harike] ?? '').trim(), 10)
    const target = (r[idx.target] ?? '').trim()
    const nama = (r[idx.nama] ?? '').trim()
    if (!Number.isFinite(harike) || !target || !nama) continue

    const statusRaw = (r[idx.status] ?? '').trim()
    const status: StatusTilawah =
      statusRaw === 'Selesai' || statusRaw === 'On Progress' ? statusRaw : 'Belum'

    out.push({
      harike,
      tanggal: normalizeTanggal(r[idx.haritgl] ?? ''),
      target,
      nama,
      status,
      timestamp: normalizeTimestamp(r[idx.timestamp] ?? ''),
    })
  }
  return out
}

// ------------------------------------------------------------
// Format tampilan (Indonesia)
// ------------------------------------------------------------

const BULAN_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** yyyy-MM-dd → "18 Okt 2026" */
export function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${parseInt(m[3], 10)} ${BULAN_ID[parseInt(m[2], 10) - 1] ?? ''} ${m[1]}`
}

/** "Hari ini" untuk zona Asia/Jakarta sebagai ISO yyyy-MM-dd */
export function todayJakarta(): string {
  const now = new Date()
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return `${jakarta.getUTCFullYear()}-${pad2(jakarta.getUTCMonth() + 1)}-${pad2(jakarta.getUTCDate())}`
}

/** ISO datetime → "18 Okt 2026, 14:30" */
export function formatWaktu(iso: string | null | undefined): string {
  if (!iso) return '—'
  const tanggal = formatTanggal(iso.slice(0, 10))
  const m = iso.match(/T(\d{2}):(\d{2})/)
  return m ? `${tanggal}, ${m[1]}:${m[2]}` : tanggal
}
