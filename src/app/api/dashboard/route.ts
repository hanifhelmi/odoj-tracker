import { NextRequest, NextResponse } from 'next/server'
import { buildDashboard, ensureSynced } from '@/lib/tilawah-server'

export const dynamic = 'force-dynamic'

/** Batas eksekusi function di Vercel (detik) */
export const maxDuration = 60

/** GET /api/dashboard?date=yyyy-MM-dd — data agregat dashboard */
export async function GET(req: NextRequest) {
  try {
    await ensureSynced()
    const date = req.nextUrl.searchParams.get('date')
    const data = await buildDashboard(date)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[api/dashboard]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat dashboard' },
      { status: 500 },
    )
  }
}
