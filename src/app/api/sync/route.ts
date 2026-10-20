import { NextRequest, NextResponse } from 'next/server'
import { syncFromSheet } from '@/lib/tilawah-server'

export const dynamic = 'force-dynamic'

/** Batas eksekusi function di Vercel (detik) */
export const maxDuration = 60

/** POST /api/sync?force=1 — paksa sinkronisasi ulang dari Google Sheet */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1'
  const result = await syncFromSheet(force)
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 })
  }
  return NextResponse.json(result)
}
