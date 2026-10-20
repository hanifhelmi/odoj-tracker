import { NextResponse } from 'next/server'
import { getSheetSettings, pushPendingToSheet } from '@/lib/tilawah-server'

export const dynamic = 'force-dynamic'

/** Batas eksekusi function di Vercel (detik) */
export const maxDuration = 60

/** POST /api/push — kirim ulang semua perubahan yang belum terkirim ke Google Sheet */
export async function POST() {
  try {
    const push = await pushPendingToSheet()
    return NextResponse.json({ ok: push.ok, push, ...(await getSheetSettings()) })
  } catch (err) {
    console.error('[api/push]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Gagal mengirim ke Google Sheet' },
      { status: 500 },
    )
  }
}
