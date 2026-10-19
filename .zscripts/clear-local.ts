import { db } from '../src/lib/db'
await db.localUpdate.deleteMany()
console.log('[test] semua LocalUpdate dihapus (simulasi DB reset)')
await db.$disconnect()
