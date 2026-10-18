// Mock Google Apps Script Web App untuk pengujian (meniru Code.gs)
Bun.serve({
  port: 4444,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === 'GET') {
      return Response.json({ ok: true, message: 'Tilawah Tracker mock siap' })
    }
    if (req.method === 'POST') {
      const body = (await req.json()) as {
        updates?: { harike: number; nama: string; status: string }[]
      }
      const updates = body.updates ?? []
      const lines = updates.map((u) => `${u.harike}|${u.nama}|${u.status}`).join('\n')
      await Bun.write('/home/z/my-project/tool-results/mock-appsscript-received.txt', lines + '\n')
      return Response.json({
        ok: true,
        updated: updates.length,
        results: updates.map((u) => ({ ...u, ok: true })),
        error: '',
      })
    }
    return Response.json({ ok: false, error: 'method not supported' }, { status: 405 })
  },
})
console.log('Mock Apps Script running on :4444')
