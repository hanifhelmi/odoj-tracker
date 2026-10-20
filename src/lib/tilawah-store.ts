// ============================================================
// Lapisan data RESILIENT untuk deploy Vercel (serverless)
//
// Di Vercel, filesystem serverless bersifat read-only/ephemeral
// sehingga SQLite tidak bisa dipakai untuk MENULIS. Karena sumber
// data sesungguhnya adalah Google Sheet (jadwal via CSV export)
// dan penulisan status langsung ke Sheet via Apps Script
// (write-through), lapisan ini membuat database menjadi OPSIONAL:
//
// - Mode DB (default, lokal/self-host): semua operasi lewat Prisma
//   seperti biasa.
// - Mode memori (Vercel / DB gagal): data hidup di memori proses.
//   Jadwal di-fetch langsung dari Google Sheet, status ditulis
//   langsung ke Google Sheet via Apps Script, sehingga tidak ada
//   data yang hilang antar instance.
//
// Setiap operasi DB dibungkus tryDb(): bila DB tidak tersedia
// (mis. readonly di serverless), otomatis lanjut ke memori proses
// dan DB di-cooldown beberapa menit agar tidak spam error.
// ============================================================

import { db } from '@/lib/db'

export interface StoreEntry {
  harike: number
  tanggal: string | null
  target: string
  nama: string
  sheetStatus: string
  sheetTimestamp: string | null
}

export interface StoreLocal {
  harike: number
  nama: string
  status: string
  sheetSynced: boolean
  updatedAt: Date
}

export interface LocalUpsert {
  harike: number
  nama: string
  status: string
}

export type LocalRestoreRow = LocalUpsert & { updatedAt?: string }

/**
 * Mode tanpa-DB: aktif otomatis di Vercel (filesystem read-only,
 * SQLite tidak dapat menulis) atau dipaksa lewat TILAWAH_NO_DB=1.
 * Set TILAWAH_FORCE_DB=1 untuk memaksa DB tetap dipakai di Vercel
 * (mis. bila nanti bermigrasi ke database eksternal).
 */
const NO_DB =
  process.env.TILAWAH_NO_DB === '1' ||
  (process.env.VERCEL === '1' && process.env.TILAWAH_FORCE_DB !== '1')

// ---- State memori (per instance serverless / per proses) ----
const mem = {
  entries: [] as StoreEntry[],
  locals: new Map<string, StoreLocal>(),
  meta: new Map<string, string>(),
}

// Bila DB gagal, jangan coba lagi selama 10 menit (hindari error berulang)
const DB_COOLDOWN_MS = 10 * 60_000
let dbDownUntil = 0

async function tryDb<T>(op: () => Promise<T>, fallback: () => T): Promise<T> {
  if (NO_DB || Date.now() < dbDownUntil) return fallback()
  try {
    return await op()
  } catch (err) {
    dbDownUntil = Date.now() + DB_COOLDOWN_MS
    console.error(
      '[store] database tidak tersedia — melanjutkan dengan memori proses:',
      err instanceof Error ? err.message : err,
    )
    return fallback()
  }
}

const localKey = (harike: number, nama: string) => `${harike}::${nama}`

// ------------------------------------------------------------
// SyncMeta (key-value)
// ------------------------------------------------------------

export function getMeta(key: string): Promise<string | null> {
  return tryDb(
    async () => (await db.syncMeta.findUnique({ where: { key } }))?.value ?? null,
    () => mem.meta.get(key) ?? null,
  )
}

export function setMeta(key: string, value: string): Promise<void> {
  return tryDb(
    async () => {
      await db.syncMeta.upsert({ where: { key }, create: { key, value }, update: { value } })
    },
    () => {
      mem.meta.set(key, value)
    },
  )
}

export function deleteMeta(key: string): Promise<void> {
  return tryDb(
    async () => {
      await db.syncMeta.deleteMany({ where: { key } })
    },
    () => {
      mem.meta.delete(key)
    },
  )
}

// ------------------------------------------------------------
// TilawahEntry — cache baris Google Sheet
// ------------------------------------------------------------

export function countEntries(): Promise<number> {
  return tryDb(
    () => db.tilawahEntry.count(),
    () => mem.entries.length,
  )
}

export async function readAllEntries(): Promise<StoreEntry[]> {
  return tryDb(
    async () => {
      const rows = await db.tilawahEntry.findMany({
        orderBy: [{ harike: 'asc' }, { nama: 'asc' }],
      })
      return rows.map((r) => ({
        harike: r.harike,
        tanggal: r.tanggal,
        target: r.target,
        nama: r.nama,
        sheetStatus: r.sheetStatus,
        sheetTimestamp: r.sheetTimestamp,
      }))
    },
    () => mem.entries.map((e) => ({ ...e })),
  )
}

export function replaceAllEntries(rows: StoreEntry[], nowIso: string): Promise<void> {
  return tryDb(
    async () => {
      await db.$transaction([
        db.tilawahEntry.deleteMany(),
        db.tilawahEntry.createMany({
          data: rows.map((r) => ({
            harike: r.harike,
            tanggal: r.tanggal,
            target: r.target,
            nama: r.nama,
            sheetStatus: r.sheetStatus,
            sheetTimestamp: r.sheetTimestamp,
          })),
        }),
        db.syncMeta.upsert({
          where: { key: 'lastSyncAt' },
          create: { key: 'lastSyncAt', value: nowIso },
          update: { value: nowIso },
        }),
      ])
    },
    () => {
      mem.entries = rows.map((r) => ({ ...r }))
      mem.meta.set('lastSyncAt', nowIso)
    },
  )
}

// ------------------------------------------------------------
// LocalUpdate — overlay status dari aplikasi
// ------------------------------------------------------------

export function readAllLocals(): Promise<StoreLocal[]> {
  return tryDb(
    async () => await db.localUpdate.findMany(),
    () =>
      [...mem.locals.values()].map((l) => ({
        ...l,
        updatedAt: new Date(l.updatedAt),
      })),
  )
}

export function readPendingLocals(): Promise<StoreLocal[]> {
  return tryDb(
    () => db.localUpdate.findMany({ where: { sheetSynced: false }, orderBy: { id: 'asc' } }),
    () =>
      [...mem.locals.values()]
        .filter((l) => !l.sheetSynced)
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .map((l) => ({ ...l, updatedAt: new Date(l.updatedAt) })),
  )
}

export function countPendingLocals(): Promise<number> {
  return tryDb(
    () => db.localUpdate.count({ where: { sheetSynced: false } }),
    () => [...mem.locals.values()].filter((l) => !l.sheetSynced).length,
  )
}

export function upsertLocals(list: LocalUpsert[]): Promise<void> {
  return tryDb(
    async () => {
      await db.$transaction(
        list.map((u) =>
          db.localUpdate.upsert({
            where: { harike_nama: { harike: u.harike, nama: u.nama } },
            create: { harike: u.harike, nama: u.nama, status: u.status, sheetSynced: false },
            update: { status: u.status, sheetSynced: false },
          }),
        ),
      )
    },
    () => {
      const now = new Date()
      for (const u of list) {
        mem.locals.set(localKey(u.harike, u.nama), {
          harike: u.harike,
          nama: u.nama,
          status: u.status,
          sheetSynced: false,
          updatedAt: now,
        })
      }
    },
  )
}

export function markLocalsSynced(keys: { harike: number; nama: string }[]): Promise<void> {
  return tryDb(
    async () => {
      await db.$transaction(
        keys.map((k) =>
          db.localUpdate.update({
            where: { harike_nama: { harike: k.harike, nama: k.nama } },
            data: { sheetSynced: true },
          }),
        ),
      )
    },
    () => {
      for (const k of keys) {
        const row = mem.locals.get(localKey(k.harike, k.nama))
        if (row) row.sheetSynced = true
      }
    },
  )
}

/**
 * Pulihkan update tertunda HANYA bila penyimpanan lokal masih kosong
 * (setelah reset / instance baru). Mengembalikan true bila memasukkan data.
 */
export function restoreLocalsIfEmpty(rows: LocalRestoreRow[]): Promise<boolean> {
  return tryDb(
    async () => {
      const count = await db.localUpdate.count()
      if (count > 0) return false
      if (rows.length === 0) return false
      await db.localUpdate.createMany({
        data: rows.map((r) => ({
          harike: r.harike,
          nama: r.nama,
          status: r.status,
          sheetSynced: false,
        })),
      })
      return true
    },
    () => {
      if (mem.locals.size > 0 || rows.length === 0) return false
      for (const r of rows) {
        mem.locals.set(localKey(r.harike, r.nama), {
          harike: r.harike,
          nama: r.nama,
          status: r.status,
          sheetSynced: false,
          updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
        })
      }
      return true
    },
  )
}
