// Mock Google Apps Script Web App untuk pengujian jembatan Tilawah Tracker
// GET  → { ok: true, message: ... }
// POST → { ok: true, updated: n, results: [{ harike, nama, status, ok: true }] }

Bun.serve({
  port: 4444,
  async fetch(req) {
    if (req.method === 'GET') {
      return Response.json({ ok: true, message: 'mock Apps Script siap' })
    }
    if (req.method === 'POST') {
      const body = (await req.json()) as {
        updates?: { harike: number; nama: string; status: string }[]
      }
      const updates = body.updates ?? []
      console.log('[mock] POST diterima:', JSON.stringify(updates))
      return Response.json({
        ok: true,
        updated: updates.length,
        results: updates.map((u) => ({ ...u, ok: true })),
      })
    }
    return new Response('not found', { status: 404 })
  },
})

console.log('mock Apps Script berjalan di http://localhost:4444')
