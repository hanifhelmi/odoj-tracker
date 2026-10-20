import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    // Fallback aman untuk lingkungan tanpa DATABASE_URL (mis. Vercel):
    // /tmp bersifat writable di serverless. Pada deploy Vercel, lapisan
    // tilawah-store memakai mode memori sehingga DB ini nyaris tak tersentuh.
    datasourceUrl: process.env.DATABASE_URL || 'file:/tmp/tilawah-fallback.db',
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
