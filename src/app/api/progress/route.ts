import { NextRequest, NextResponse } from 'next/server'
import { saveProgress } from '@/lib/tilawah-server'
import type { StatusTilawah } from '@/lib/tilawah'

export const dynamic = 'force-dynamic'

interface SaveBody {
  updates?: { harike?: number; nama?: string; status?: string }[]
}

/** POST /api/progress — simpan update status peserta */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveBody
    const updates = (body.updates ?? []).map((u) => ({
      harike: Number(u.harike),
      nama: String(u.nama ?? '').trim(),
      status: u.status as StatusTilawah,
    }))

    const result = await saveProgress(updates)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[api/progress]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Gagal menyimpan' },
      { status: 400 },
    )
  }
}
