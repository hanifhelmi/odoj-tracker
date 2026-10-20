---
Task ID: 1-7 (full build, dieksekusi berurutan oleh agent utama)
Agent: Z.ai Code (main agent)
Task: Membangun aplikasi web Tilawah Tracker "One Day One Juz" dengan Google Sheet sebagai sumber jadwal (https://docs.google.com/spreadsheets/d/1N_8Nbr4bRQafoTN6TEkS9ZY0AOON3nS7BWQ1pU_GMws), sesuai user flow: dashboard → menu update progress → daftar nama hari ini → pilih tanggal (default hari ini) → update status (Belum/On Progress/Selesai) → simpan → popup "Barokallahu fii kum" → kembali ke dashboard.

Work Log:
- Task 1: Menganalisis struktur Google Sheet via CSV export (kolom: harike, haritgl, target, nama, status, timestamp; 8 peserta; 6 hari tercatat). Menyusun prisma/schema.prisma (TilawahEntry = cache sheet, LocalUpdate = overlay update dari app, SyncMeta = lastSyncAt) dan menjalankan `bun run db:push`.
- Task 2: Membuat src/lib/tilawah.ts (tipe bersama, parser CSV quote-aware, normalisasi tanggal multi-format "30-Sep-2026" | "10/18/2026" | ISO, parser target "3B" → juz+bagian, formatter Indonesia, todayJakarta()) dan src/lib/tilawah-server.ts (syncFromSheet dengan cache 3 menit + force, merge sheet+local untuk status efektif, buildDashboard agregat, buildDayResponse, saveProgress upsert transactional).
- Task 3: Membuat API routes: POST /api/sync?force=1, GET /api/dashboard?date=, GET /api/day?date=|harike=, POST /api/progress (semua force-dynamic, pakai API route bukan server action).
- Task 4: Frontend dashboard (src/components/tilawah/dashboard-view.tsx): hero banner progres tim, 4 stat cards (posisi program, capaian hari ini, juz terkumpul, peserta aktif), ranking pencapaian per peserta dengan progress bar + badge status hari ini, timeline aktivitas terakhir, matriks capaian harian (peserta × hari) dengan legend.
- Task 5: Frontend update progress (src/components/tilawah/update-view.tsx): date picker Popover+Calendar default hari ini, Select "hari ke-N" untuk navigasi semua jadwal, banner saran otomatis bila tanggal tanpa jadwal (menunjuk hari terdekat yang belum selesai), daftar peserta dengan segmented control 3 status (Belum/On Progress/Selesai), bar simpan sticky, popup Dialog "Barokallahu fii kum" dengan tombol Kembali ke Dashboard. Shell app (src/app/page.tsx): header sticky + nav 2 menu + tombol sinkron manual + footer sticky, view switching via AnimatePresence (single route "/" sesuai aturan).
- Task 6: Fix lint (setState-in-effect → pola penyesuaian state saat render; Select uncontrolled→controlled), lint bersih. Verifikasi E2E via agent-browser: dashboard render (desktop 1280px & mobile 375px), klik Update Progress, ubah status 2 peserta → Simpan → popup muncul → Kembali ke Dashboard (capaian hari ini berubah 0/8→1/8), banner saran tanggal 25 Okt muncul dan tombol "Buka Hari ke-5" berfungsi, footer menempel saat scroll, tanpa page error. Data test di-reset ke kondisi asli sheet (hari 6 semua Belum).

Stage Summary:
- Aplikasi live di route "/" (dev server port 3000), single-page dengan 2 view: Dashboard & Update Progress.
- Arsitektur data: Google Sheet = sumber jadwal (auto-sync tiap 3 menit / tombol sinkron / saat DB kosong); SQLite+Prisma menyimpan cache sheet + overlay LocalUpdate sehingga update via app selalu menang dan tidak pernah tertimpa re-sync.
- Kontrak API: /api/dashboard, /api/day, /api/progress, /api/sync (JSON).
- Keputusan penting: (1) tulis ke Google Sheet langsung tidak memungkinkan tanpa OAuth/service account, sehingga update status disimpan di SQLite sebagai overlay di atas data sheet; (2) tanggal sheet multi-format dinormalisasi ke ISO; (3) hari "posisi program" = hari terdekat yang belum semua Selesai; (4) hari "hari ini" = hari yang tanggalnya sama dengan hari ini (Asia/Jakarta).
- Verifikasi: lint bersih, API 200 semua endpoint, E2E golden path lulus via agent-browser, footer sticky OK, responsif OK, tanpa error runtime/console.

---
Task ID: Fix 1-5
Agent: Z.ai Code (main agent)
Task: Perbaikan — "Update Progress per peserta BELUM mengupdate data di Google Sheet". Implementasi penulisan langsung (write-through) ke Google Sheet.

Work Log:
- Fix 1: Analisis akar masalah — Google tidak mengizinkan penulisan ke Sheet dari server pihak ketiga tanpa otorisasi pemilik. Solusi standar: jembatan Google Apps Script Web App (dideploy pemilik sheet sekali, akses "Anyone", execute as "Me"). Schema: tambah kolom `sheetSynced Boolean @default(false)` di LocalUpdate + db push + bersihkan data lama.
- Fix 2: Backend — src/lib/tilawah.ts: tambah APPS_SCRIPT_CODE (kode Code.gs siap tempel: doPost mencari baris by harike+nama, menulis kolom E=status & F=timestamp format M/d/yyyy Asia/Jakarta, doGet untuk uji koneksi), tipe PushResult & SheetSettings. src/lib/tilawah-server.ts: getSheetSettings, saveSheetUrl (validasi format /exec + uji GET 15s), clearSheetUrl, pushPendingToSheet (POST batch semua LocalUpdate sheetSynced=false, timeout 20s, tandai per-baris berdasarkan results[].ok). saveProgress kini: upsert (sheetSynced=false) → pushPendingToSheet() → kembalikan { ...day, push }.
- Fix 3: API baru — GET/POST/DELETE /api/settings (POST juga langsung push pending setelah terhubung), POST /api/push (kirim ulang). Frontend — komponen sheet-setup-dialog.tsx: dialog setup 4 langkah bernomor + link buka Sheet + kode Code.gs dengan tombol Salin + input Web App URL + Uji Koneksi & Simpan + Putuskan Koneksi (zustand store openSheetSetup). SheetConnectionBanner: amber bila belum terhubung / teal bila ada baris belum terkirim + tombol Kirim Ulang. Popup "Barokallahu fii kum" kini menampilkan status penulisan ke Sheet: hijau "N status berhasil ditulis ke Google Sheet", atau peringatan + tombol kirim ulang / ajakan hubungkan. Header: tombol amber "Hubungkan Sheet" bila belum terhubung.
- Fix 4: Lint bersih. Restart dev server (Prisma client reload untuk kolom baru). Uji E2E dengan mock Apps Script (bun server :4444): POST /api/progress → push.ok=true pushed=2, mock menerima "6|Freddi|Selesai" & "6|Reza|On Progress", DB sheetSynced=true, /api/push retry pushed=0. Browser: popup menampilkan "✅ 1 status berhasil ditulis ke Google Sheet"; dialog setup tampil sempurna dari tombol header; banner belum-terhubung OK. Cleanup data uji + mock + koneksi.
- Temuan saat pengujian: pemilik sheet telah menambah jadwal (48 → 152 baris, hari 1-19 dengan tanggal berurutan; hari ini 18 Okt 2026 = hari ke-19 target 10A). Aplikasi otomatis mengikuti via sync — perilaku benar. Force sync dijalankan, data terbaru 152 baris termuat.

Stage Summary:
- Update status via aplikasi kini WRITE-THROUGH ke Google Sheet (begitu admin menyelesaikan setup Apps Script sekali: salin kode → deploy Web App (Me/Anyone) → tempel URL /exec di dialog Hubungkan Sheet).
- Jika belum terhubung: data tetap tersimpan di app (tidak hilang) dengan banner peringatan; begitu terhubung, semua perubahan tertunda otomatis terkirim (juga tersedia tombol Kirim Ulang).
- Kolom sheet yang ditulis: E (status) & F (timestamp, M/d/yyyy Asia/Jakarta); pencarian baris berdasarkan A (harike) + D (nama) — cocok dengan struktur sheet asli.
- State akhir: LocalUpdate kosong, koneksi belum diisi (menunggu setup admin), DB tersinkron dengan sheet terbaru (152 baris, 19 hari).

---
Task ID: Fix 2
Agent: Z.ai Code (main agent)
Task: Perbaikan dashboard — widget "Posisi Program Hari Ke xxx" dan caption hero belum akurat; harus di-match-kan dengan harike di mana haritgl = today (Asia/Jakarta).

Work Log:
- Analisis: buildDashboard lama menghitung posisiProgram = "hari paling awal yang belum semua Selesai" → saat sheet berubah (pemilik menambah jadwal hari 1-19, 9 peserta, 171 baris; hari ini 18 Okt 2026 = hari ke-19 target 10A), widget tetap menunjuk hari ke-5 (sisa 7 peserta).
- src/lib/tilawah-server.ts (buildDashboard): posisiProgram kini = hari yang bertanggal HARI INI (match haritgl == today, todayISO = param ?date atau todayJakarta()). Fallback berlapis bila tanggal hari ini tidak ada di sheet: (1) tanggal terdekat — prioritas tanggal terakhir <= hari ini, jika tidak ada → tanggal paling awal > hari ini (program belum mulai); (2) sheet tanpa tanggal sama sekali → hari paling awal yang belum semua Selesai. sisaDiPosisi dihitung dari hari posisiProgram (status !== 'Selesai').
- src/lib/tilawah-server.ts (buildDayResponse): suggestion banner "tanggal tanpa jadwal" kini juga memprioritaskan hari yang bertanggal hari ini (bila masih ada yang belum selesai), fallback ke hari paling awal yang belum selesai.
- src/components/tilawah/dashboard-view.tsx: caption hero kini menyertakan tanggal — "Saat ini program berada pada hari ke-N (tanggal) dengan target Juz X Bagian Y" + teks khusus bila sisa = 0 ("Masya Allah, seluruh peserta sudah menyelesaikan target..."). Kartu "Posisi Program" sub jadi "18 Okt 2026 • Target 10A" (tanggal ditambahkan; bagian "Juz X awal/akhir" dipangkas agar tidak terpotong truncate).
- src/lib/tilawah.ts: komentar tipe posisiProgram diperbarui.
- Verifikasi: lint bersih; force sync (171 baris, 9 peserta); API: ?date=2026-10-18 → posisi hari ke-19 target 10A sisa 6 & selesaiHariIni 3/9 (sesuai sheet live); ?date=2026-12-25 → fallback hari 19; ?date=2026-09-01 → fallback hari 1 (program belum mulai); tanpa param → default todayJakarta() hari 19; /api/day?date=2026-10-25 → suggestion hari 19. Browser E2E: hero caption benar, kartu Posisi Program "Hari ke-19 / 18 Okt 2026 • Target 10A", Capaian Hari Ini 3/9, mobile 375px rapi, footer sticky (footerBottom = viewport), Update Progress tetap berfungsi (hari ke-19, banner saran tersembunyi bila jadwal ada), console tanpa error.

Stage Summary:
- Posisi program di seluruh dashboard kini selalu = baris sheet dengan haritgl == hari ini (Asia/Jakarta), bukan lagi hari-unfinished terawal; caption hero dan kartu statistik konsisten dengan logika tersebut.
- Aman untuk tanggal tanpa jadwal (fallback tanggal terdekat) dan sheet tanpa kolom tanggal (fallback hari-unfinished terawal).
- Tidak ada perubahan skema DB / API contract; perubahan murni logika agregasi + tampilan.

---
Task ID: Fix 3
Agent: Z.ai Code (main agent)
Task: Perbaikan — "sering koneksi aplikasi ke Google Sheet terputus, diminta Hubungkan Sheet kembali". Agar koneksi & data terjaga terus (always-connected).

Work Log:
- Diagnosis akar masalah: SQLite (db/custom.db) ter-reset saat sandbox/dev server restart (dibuktikan: SyncMeta kehilangan key sheetWebAppUrl + lastSyncAt, TilawahEntry kosong lalu tersinkron ulang pagi ini). URL koneksi sebelumnya HANYA disimpan di SQLite → setiap restart, koneksi hilang → aplikasi meminta "Hubungkan Sheet" ulang. LokalUpdate tertunda pun berisiko hilang.
- Backend (src/lib/tilawah-server.ts) — arsitektur tahan-reset:
  1) File konfigurasi durable sheet-bridge.json (root proyek) menyimpan { webAppUrl, savedAt, pendingUpdates } dengan penulisan atomik (tmp+rename).
  2) getBridgeUrl(): sumber berlapis DB → sheet-bridge.json → env SHEET_WEBAPP_URL; bila DB kehilangan URL, otomatis dipulihkan ke DB (self-heal) + log "[sheet-bridge] koneksi dipulihkan otomatis".
  3) saveSheetUrl: uji koneksi kini 2 percobaan (timeout 20s, jeda 1,5s) tahan gangguan sesaat Google; simpan ke DB + file. clearSheetUrl: hapus dari DB + file (pending tetap dipertahankan).
  4) Mirror pending: mirrorPendingToBridge() menyalin LocalUpdate sheetSynced=false ke file (dipanggil setelah saveProgress & setelah push); restorePendingFromBridge() memulihkan update tertunda dari file ke DB bila DB kosong (hanya baris yang masih ada di sheet), lalu memicu auto-push.
  5) Auto-push latar belakang: startAutoPushLoop() interval 60 detik (globalThis-guard, unref) + autoPushOnce(trigger) dengan penjaga busy & jeda min 45 detik; dipicu dari ensureSynced/getSheetSettings. Log jelas di dev.log ([auto-push] ...).
  6) pushPendingToSheet kini baca URL via getBridgeUrl() (bukan DB mentah).
- Frontend (sheet-setup-dialog.tsx): useSheetSettings refetchInterval 30 detik (banner/button ikut memudar setelah auto-push); copy dialog: "koneksi tersimpan permanen di server dan otomatis aktif kembali bila server/sandbox restart"; banner pending: "akan dikirim ulang otomatis (pemeriksaan tiap ±1 menit)" + tombol "Kirim Sekarang"; banner belum-terhubung: "Hubungkan sekali saja — koneksi tersimpan permanen".
- E2E test (mock Apps Script bun :4444, skrip di .zscripts/): (1) auto-heal — URL hanya di file, DB kosong → GET /api/settings connected:true + DB terisi; (2) write-through — POST /api/progress → push.ok pushed:1, mock menerima update, sheetSynced=true, mirror file bersih; (3) restore — DB LocalUpdate dihapus + file berisi pending → restore memulihkan baris & auto-push mengirim ke mock, pending 0; (4) skenario persis user — URL dihapus dari DB + 1 pending → settings connected:true, auto-push (trigger settings) berhasil, pendingCount 1→0. Lint bersih. Cleanup penuh (URL test dihapus, LocalUpdate kosong, bridge file dihapus, mock dimatikan, force sync 180 baris; sheet kini 20 hari — 19 Okt = hari ke-20 target 10B).

Stage Summary:
- Koneksi Google Sheet kini TAHAN RESET: tersimpan di DB + sheet-bridge.json (+ env SHEET_WEBAPP_URL opsional); bila DB ter-reset, koneksi pulih otomatis tanpa "Hubungkan Sheet" ulang.
- Update tertunda dipantarkan ke file dan dipulihkan otomatis; auto-push tiap ±1 menit memastikan semua perubahan akhirnya tertulis di Google Sheet tanpa aksi manual.
- Satu-satunya setup yang tersisa bagi admin: deploy Apps Script + tempel URL sekali (dialog Hubungkan Sheet); setelah itu tidak pernah diminta lagi.

---
Task ID: Deploy 1
Agent: Z.ai Code (main agent)
Task: Persiapan deploy aplikasi ke Vercel + panduan langkah demi langkah (permintaan user: "Saya mau deploy aplikasi ini di Vercel. Tlg dipandu.")

Work Log:
- Analisis hambatan Vercel: (1) SQLite tidak bisa MENULIS di filesystem serverless Vercel (read-only/ephemeral) — padahal app menulis LocalUpdate + cache sync; (2) sheet-bridge.json ditulis ke project root (read-only di Vercel); (3) build script package.json masih gaya self-host standalone; (4) penulisan Apps Script 20 detik bisa terpotong timeout default function.
- Baru: src/lib/tilawah-store.ts — lapisan data resilient. Semua operasi Prisma dibungkus tryDb(): mode DB (lokal) berperilaku sama persis; mode memori otomatis aktif bila VERCEL=1 (atau TILAWAH_NO_DB=1) atau bila query DB gagal (cooldown 10 menit). Fungsi: get/set/deleteMeta, countEntries, readAllEntries, replaceAllEntries, readAllLocals, readPendingLocals, countPendingLocals, upsertLocals, markLocalsSynced, restoreLocalsIfEmpty.
- Refactor penuh src/lib/tilawah-server.ts: seluruh akses db.* diganti panggilan store (tidak ada lagi import db); BRIDGE_FILE pindah ke /tmp saat VERCEL=1 (root project di lokal). Logika bisnis (sync 3 menit, merge overlay, push Apps Script, auto-push, bridge self-heal DB→file→env) tidak berubah.
- Konfigurasi build Vercel: package.json → build = "next build" murni, standalone dipindah ke build:standalone, tambah postinstall "prisma generate"; next.config.ts → output standalone hanya non-Vercel; semua 6 API route diberi export const maxDuration = 60; src/lib/db.ts → fallback datasourceUrl file:/tmp/tilawah-fallback.db; .gitignore += sheet-bridge.json & /tool-results/.
- Pengujian: (1) Simulasi Vercel — VERCEL=1 TILAWAH_NO_DB=1 bun .zscripts/test-vercel-mode.ts: sync sheet OK (189 baris/21 hari/9 peserta), buildDashboard OK, saveProgress → overlay memori OK (source=app), push benar ter-skip saat belum terhubung, settings pendingCount=1 → SEMUA LULUS; (2) mode DB normal via dev server: /api/dashboard 200 (133/189, 70%, hari ke-21 target 11A), query Prisma jalan; (3) tsc --noEmit: src/ tanpa error (sisa error hanya di examples/, skills/, tool-results/ bawaan); (4) lint bersih.
- E2E agent-browser: dashboard render (hero hari ke-21 20 Okt 2026, 133/189 70%), Update Progress → ubah Daniel Abbas Belum→Selesai → Simpan → popup "Barokallahu fii kum" + status penulisan Sheet, Kembali ke Dashboard → Capaian Hari Ini 1/9, Juz 67 juz, aktivitas "Daniel Abbas → Selesai ... via app"; console tanpa error page. Data uji direset (LocalUpdate dikosongkan, 133/189 & 0/9).
- Dokumen: DEPLOY.md — panduan 4 langkah (push GitHub → import Vercel → env vars → verifikasi), tabel troubleshooting, catatan teknis, opsi migrasi DB eksternal di masa depan (TILAWAH_FORCE_DB=1).

Stage Summary:
- Repo SIAP DEPLOY ke Vercel tanpa perubahan perilaku di lokal: di Vercel Google Sheet menjadi satu-satunya penyimpanan permanen (jadwal via CSV export; status ditulis langsung via Apps Script write-through), sehingga ephemeral-nya serverless tidak menyebabkan kehilangan data.
- Kunci koneksi permanen di Vercel = env var SHEET_WEBAPP_URL (sudah didukung rantai self-heal DB → file → env); DATABASE_URL=file:/tmp/tilawah.db opsional.
- Pengguna tinggal ikuti DEPLOY.md: push ke GitHub, import di vercel.com/new, isi SHEET_WEBAPP_URL (+DATABASE_URL opsional), Deploy, verifikasi write-through ke Sheet.
