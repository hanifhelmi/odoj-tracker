import { NextRequest, NextResponse } from 'next/server'
import { buildDayResponse, ensureSynced } from '@/lib/tilawah-server'

export const dynamic = 'force-dynamic'

/** Batas eksekusi function di Vercel (detik) */
export const maxDuration = 60

/**
 * GET /api/day?date=yyyy-MM-dd  atau  ?harike=6
 * Daftar peserta + status untuk satu hari program.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSynced()
    const sp = req.nextUrl.searchParams
    const date = sp.get('date')
    const harikeRaw = sp.get('harike')
    const harike = harikeRaw != null && harikeRaw !== '' ? parseInt(harikeRaw, 10) : null

    const data = await buildDayResponse({
      date,
      harike: harike != null && Number.isFinite(harike) ? harike : null,
    })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[api/day]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat data hari' },
      { status: 500 },
    )
  }
}
