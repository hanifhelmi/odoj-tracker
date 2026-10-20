import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const meta = await db.syncMeta.findMany()
console.log('SyncMeta:', JSON.stringify(meta))
console.log('TilawahEntry count:', await db.tilawahEntry.count())
const lu = await db.localUpdate.findMany()
console.log('LocalUpdate count:', lu.length, '| pending:', lu.filter(l => !l.sheetSynced).length)
if (lu.length) console.log('LocalUpdate rows:', JSON.stringify(lu.map(l => ({ harike: l.harike, nama: l.nama, status: l.status, sheetSynced: l.sheetSynced }))))
await db.$disconnect()
