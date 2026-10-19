// Uji pemulihan update tertunda dari sheet-bridge.json (simulasi DB ter-reset)
// Pemakaian: bun .zscripts/test-restore.ts
import { restorePendingFromBridge, pushPendingToSheet } from '../src/lib/tilawah-server'
import { db } from '../src/lib/db'

await restorePendingFromBridge()

const rows = await db.localUpdate.findMany({ orderBy: { id: 'asc' } })
console.log('[test] LocalUpdate setelah restore:', JSON.stringify(rows.map((r) => ({ harike: r.harike, nama: r.nama, status: r.status, sheetSynced: r.sheetSynced }))))

const push = await pushPendingToSheet()
console.log('[test] pushPendingToSheet:', JSON.stringify(push))

const after = await db.localUpdate.findMany()
console.log('[test] pending tersisa:', after.filter((r) => !r.sheetSynced).length)
await db.$disconnect()
