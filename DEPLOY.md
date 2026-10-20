# 🚀 Panduan Deploy ke Vercel — Tilawah Tracker "One Day One Juz"

Panduan langkah demi langkah untuk mendeploy aplikasi ini ke **Vercel** (gratis).
Ikuti berurutan — total ±15 menit.

---

## ⚙️ Ringkasan Cara Kerja di Vercel

Aplikasi ini sudah disiapkan khusus agar **100% kompatibel dengan serverless Vercel**:

| Komponen | Di lokal (sandbox) | Di Vercel |
|---|---|---|
| Jadwal program | Google Sheet → cache SQLite | Google Sheet → **memori proses** (auto-sync tiap 3 menit / cold start) |
| Update status | SQLite + tulis ke Sheet | **Langsung tulis ke Google Sheet** via Apps Script (write-through) |
| Koneksi Sheet | SQLite + `sheet-bridge.json` | **Env var `SHEET_WEBAPP_URL`** (permanen) |
| Database SQLite | Dipakai penuh | **Otomatis dilewati** (filesystem Vercel read-only) |

> **Kunci penting:** di Vercel, Google Sheet adalah satu-satunya penyimpanan
> permanen. Semua status yang disimpan lewat aplikasi langsung ditulis ke
> Google Sheet — jadi tidak ada data yang hilang walau server Vercel berganti
> instance setiap saat.

---

## ✅ Prasyarat

1. Akun **GitHub** (gratis) — https://github.com/signup
2. Akun **Vercel** (gratis, bisa login pakai GitHub) — https://vercel.com/signup
3. **Web App URL** Google Apps Script (jembatan tulis ke Sheet).
   Jika belum ada: buka aplikasi → tombol **"Hubungkan Sheet"** → ikuti 4
   langkah di dialog itu (salin kode Code.gs → deploy Web App dengan
   *Execute as: Me* dan *Who has access: Anyone*) → salin URL berakhiran `/exec`.

---

## 📦 Langkah 1 — Push kode ke GitHub

Dari folder proyek (`/home/z/my-project`), jalankan:

```bash
# 1. Pastikan semua perubahan ter-commit
git add -A
git commit -m "Siapkan deploy Vercel: lapisan data serverless + konfigurasi build"

# 2. Buat repository baru di https://github.com/new
#    - Nama repo: mis. tilawah-tracker
#    - Pilih Private (disarankan) atau Public
#    - JANGAN centang "Add a README" (repo harus kosong)

# 3. Hubungkan dan push (ganti USERNAME dengan username GitHub Anda)
git remote add origin https://github.com/USERNAME/tilawah-tracker.git
git push -u origin main
```

> 💡 File `.env` **tidak ikut ter-push** (sudah di-gitignore) — aman.
> Kredensial akan diisi lewat Vercel Environment Variables di langkah 3.

---

## ▲ Langkah 2 — Import proyek di Vercel

1. Buka https://vercel.com/new
2. Klik **"Import Git Repository"** → pilih repo `tilawah-tracker` yang barusan dibuat
   (jika diminta, klik **"Adjust GitHub App Permissions" → All Repositories**, atau pilih repo tersebut)
3. Vercel otomatis mendeteksi **Next.js** — biarkan semua *Build Settings* default
   (Build Command: `next build`, Install: otomatis pakai `bun.lock`)
4. **Jangan klik Deploy dulu** — lanjut ke Langkah 3 untuk mengisi Environment Variables.

---

## 🔐 Langkah 3 — Isi Environment Variables (PENTING)

Di halaman import Vercel, buka bagian **"Environment Variables"** dan tambahkan:

| Name | Value | Wajib? |
|---|---|---|
| `SHEET_WEBAPP_URL` | Web App URL Apps Script Anda, contoh: `https://script.google.com/macros/s/AKfycb.../exec` | **YA** |
| `DATABASE_URL` | `file:/tmp/tilawah.db` | Opsional (disarankan diisi) |

**`SHEET_WEBAPP_URL` adalah kunci agar koneksi Google Sheet tidak pernah
"hilang".** Di serverless Vercel, server sering di-reset — dengan env var ini,
setiap instance baru langsung terhubung otomatis (self-heal) tanpa perlu
menekan "Hubungkan Sheet" lagi.

- Klik **Add** di tiap variabel.
- Setelah kedua variabel terisi → klik **Deploy**.

---

## 🎉 Langkah 4 — Verifikasi setelah Deploy

Tunggu build selesai (±1–2 menit), lalu buka URL yang diberikan Vercel
(mis. `https://tilawah-tracker-xxx.vercel.app`) dan periksa:

1. **Dashboard tampil** dengan data dari Google Sheet
   (posisi program sesuai tanggal hari ini, mis. "Hari ke-N • Target XX").
2. **Update Progress**: ubah status salah satu peserta → Simpan →
   popup **"Barokallahu fii kum"** muncul, idealnya dengan pesan hijau
   *"N status berhasil ditulis ke Google Sheet"*.
3. **Cek Google Sheet langsung**: kolom Status & Timestamp baris yang diubah
   ikut berubah → bukti write-through berfungsi.
4. Tekan tombol sinkron (ikon ↻) di header — data tetap konsisten.

> ℹ️ Pengecualian popup: jika Sheet **belum terhubung** (Anda belum mengisi
> `SHEET_WEBAPP_URL` atau belum deploy Apps Script), popup menampilkan
> peringatan amber + tombol "Hubungkan Google Sheet". Data tetap aman dan
> otomatis terkirim begitu koneksi tersedia.

---

## 🛠 Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| Tombol "Hubungkan Sheet" selalu muncul | Env var `SHEET_WEBAPP_URL` belum di-set di Vercel. Set di **Project → Settings → Environment Variables**, lalu **Redeploy**. |
| Popup: "Web App tidak mengembalikan JSON" | Deployment Apps Script salah. Pastikan *Execute as: Me* dan *Who has access: Anyone*, lalu deploy ulang versi baru. |
| Dashboard kosong / error 500 saat load pertama | Sheet tidak publik untuk CSV. Pastikan Sheet di-share **"Anyone with the link → Viewer"**. |
| Build gagal di Prisma | Pastikan `postinstall: prisma generate` ada di `package.json` (sudah disiapkan). Cek log build untuk detail. |
| Status tersimpan tapi tidak muncul di Sheet | Ada koneksi tertunda — aplikasi otomatis mengirim ulang (auto-push). Bisa juga tekan "Kirim Sekarang" di banner, atau tunggu ±1 menit. |
| Jam terlihat beda | Server memakai zona Asia/Jakarta secara eksplisit — pastikan jadwal `haritgl` di Sheet benar. |

---

## 📝 Catatan Teknis (hasil persiapan deploy)

Perubahan yang sudah dilakukan agar siap Vercel:

1. **`src/lib/tilawah-store.ts`** (baru) — lapisan data resilient: semua
   operasi Prisma dibungkus `tryDb()`; di Vercel (`VERCEL=1`) otomatis memakai
   memori proses, bila DB gagal → fallback memori + cooldown 10 menit.
2. **`src/lib/tilawah-server.ts`** — seluruh akses DB kini lewat lapisan store;
   file `sheet-bridge.json` ditulis ke `/tmp` saat di Vercel (root project di lokal).
3. **`package.json`** — `build` jadi `next build` murni; script standalone
   dipindah ke `build:standalone` (untuk self-host lokal); tambah
   `postinstall: prisma generate` (wajib untuk build Vercel).
4. **`next.config.ts`** — `output: "standalone"` hanya aktif di luar Vercel.
5. **API routes** — semua diberi `export const maxDuration = 60` agar penulisan
   ke Apps Script tidak terpotong timeout default.
6. **`src/lib/db.ts`** — fallback `DATABASE_URL` ke `file:/tmp/...` agar aman
   bila env lupa diisi.

> **Opsi pengembangan berikutnya:** jika suatu saat butuh data overlay lokal
> yang persisten di server (bukan hanya di Google Sheet), migrasikan ke
> database eksternal (mis. Turso/Neon, free tier) lalu set `TILAWAH_FORCE_DB=1`.
> Untuk kebutuhan saat ini — status selalu tertulis ke Google Sheet — tidak diperlukan.
