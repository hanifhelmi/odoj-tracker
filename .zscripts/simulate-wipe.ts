import { db } from '../src/lib/db'
await db.syncMeta.deleteMany({ where: { key: 'sheetWebAppUrl' } })
await db.localUpdate.deleteMany()
await db.localUpdate.create({ data: { harike: 19, nama: 'Taufik Rahman', status: 'Selesai', sheetSynced: false } })
console.log('[test] URL dihapus dari DB + 1 update tertunda dibuat (simulasi restart)')
await db.$disconnect()
