/**
 * Simulasi deploy Vercel — mode TANPA database (filesystem read-only).
 * Menjalankan seluruh alur server dengan lapisan memori proses.
 *
 * Jalankan: VERCEL=1 TILAWAH_NO_DB=1 bun .zscripts/test-vercel-mode.ts
 */
import {
  buildDashboard,
  buildDayResponse,
  ensureSynced,
  getSheetSettings,
  saveProgress,
  syncFromSheet,
} from '../src/lib/tilawah-server'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion gagal: ${msg}`)
}

async function main() {
  console.log('=== 1. Sync dari Google Sheet (mode memori, tanpa DB) ===')
  const sync = await syncFromSheet(true)
  console.log('sync:', sync)
  assert(sync.ok && (sync.rows ?? 0) > 0, 'sync harus ok dengan rows > 0')

  console.log('\n=== 2. ensureSynced + buildDashboard ===')
  await ensureSynced()
  const dash = await buildDashboard(null)
  console.log(
    'totalPeserta:', dash.totalPeserta,
    '| totalHari:', dash.totalHari,
    '| posisi:', dash.posisiProgram?.harike,
    dash.posisiProgram?.tanggal,
    '| target:', dash.posisiProgram?.target,
    '| selesaiHariIni:', dash.selesaiHariIni,
  )
  assert(dash.totalPeserta > 0, 'harus ada peserta')
  assert(dash.posisiProgram != null, 'posisiProgram tidak boleh null')

  console.log('\n=== 3. buildDayResponse hari posisi ===')
  const harike = dash.posisiProgram!.harike
  const day = await buildDayResponse({ harike })
  assert(day.day?.harike === harike && day.entries.length > 0, 'day response harus berisi entries')
  const target0 = day.entries[0]
  console.log('hari:', day.day?.harike, '| entries:', day.entries.length, '| sample:', target0.nama, '=', target0.status)

  console.log('\n=== 4. saveProgress (belum terhubung Sheet → push harus skip) ===')
  const newStatus = target0.status === 'Selesai' ? 'On Progress' : 'Selesai'
  const saved = await saveProgress([{ harike, nama: target0.nama, status: newStatus }])
  console.log('push:', saved.push)
  assert(!saved.push.ok, 'push harus gagal/skip karena belum terhubung')

  console.log('\n=== 5. Verifikasi overlay status di memori ===')
  const day2 = await buildDayResponse({ harike })
  const after = day2.entries.find((e) => e.nama === target0.nama)
  console.log('status setelah simpan:', after?.status, '| source:', after?.source)
  assert(after?.status === newStatus, 'status harus berubah di memori')
  assert(after?.source === 'app', 'source harus app (overlay)')

  console.log('\n=== 6. Settings koneksi (belum terhubung, ada pending) ===')
  const settings = await getSheetSettings()
  console.log('settings:', settings)
  assert(settings.connected === false, 'belum boleh terhubung (tanpa env/file)')
  assert(settings.pendingCount >= 1, 'harus ada update tertunda')

  console.log('\n✅ SEMUA TES MODE TANPA-DB (SIMULASI VERCEL) LULUS')
}

main().catch((err) => {
  console.error('❌ GAGAL:', err)
  process.exit(1)
})
