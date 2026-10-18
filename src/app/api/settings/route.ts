import { NextRequest, NextResponse } from 'next/server'
import { clearSheetUrl, getSheetSettings, saveSheetUrl } from '@/lib/tilawah-server'

export const dynamic = 'force-dynamic'

/** GET /api/settings — status koneksi Google Sheet + jumlah baris belum terkirim */
export async function GET() {
  try {
    return NextResponse.json(await getSheetSettings())
  } catch (err) {
    console.error('[api/settings GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat pengaturan' },
      { status: 500 },
    )
  }
}

/** POST /api/settings { url } — uji koneksi lalu simpan Web App URL Apps Script */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string }
    if (!body.url || typeof body.url !== 'string') {
      return NextResponse.json({ ok: false, error: 'URL wajib diisi' }, { status: 400 })
    }
    await saveSheetUrl(body.url)

    // Setelah terhubung, langsung kirim perubahan yang masih tertunda
    const { pushPendingToSheet } = await import('@/lib/tilawah-server')
    const push = await pushPendingToSheet()

    return NextResponse.json({ ok: true, push, ...(await getSheetSettings()) })
  } catch (err) {
    console.error('[api/settings POST]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Gagal menyimpan URL' },
      { status: 400 },
    )
  }
}

/** DELETE /api/settings — putuskan koneksi Google Sheet */
export async function DELETE() {
  try {
    await clearSheetUrl()
    return NextResponse.json({ ok: true, ...(await getSheetSettings()) })
  } catch (err) {
    console.error('[api/settings DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memutus koneksi' },
      { status: 500 },
    )
  }
}
