# Kodomo — Pencatat Amalan (Google Apps Script)

Web app GAS tanpa build step: teman-teman mencatat Pahala/Dosa dan transfer; Google Sheet
jadi basis datanya. Disinkronkan lewat clasp; GitHub Actions auto-`clasp push -f` pada
setiap push ke `main`.

Detail arsitektur & alasan desain: **[PROJECT.md](PROJECT.md)**.
Kelemahan yang diketahui (keamanan, utang teknis): **[GAPS.md](GAPS.md)** — baca sebelum
menyentuh `submitAmalan` atau apa pun soal roster.

## Alur wajib — GIT SUMBER KEBENARAN, BUKAN GAS

Repo ini diedit dari banyak tempat. Actions men-deploy setiap push ke `main`, jadi
**perubahan yang hanya di-`clasp push` tanpa di-commit akan tertimpa deploy berikutnya**
(pernah terjadi: modul logo 3D hilang dari produksi).

1. Sebelum edit: `git fetch origin` lalu rekonsiliasi dengan `origin/main`.
2. Setelah edit: commit + `git push origin main`. Actions men-deploy sendiri.
3. `clasp push -f` manual hanya SETELAH langkah 2, tidak pernah menggantikannya.

## Peta berkas — buka yang relevan saja, jangan semuanya

**Server (`.js` → `.gs`).** Semua berbagi satu namespace global; tidak ada import.

| Berkas | Isi |
|---|---|
| `Code.js` | konstanta bersama, `doGet` + `include`, `setupSheets`, `getSheet_`, `getAnggota`, helper foto & nominal |
| `Amalan.js` | `submitAmalan`, `submitAmalanBatch`, baris infaq KAS otomatis |
| `Dasbor.js` | `getDashboardData` + `deretHarian_` (deret grafik) |
| `Resto.js` | deteksi nama resto, statistik harga, cache sheet `Resto`, `refreshResto`/`tambahResto`/`hapusResto`/`debugResto` |
| `Struk.js` | baca struk/bukti transfer via Gemini + alias nama OCR |
| `Laporan.js` | `getLaporanBulanan` |
| `Kopdos.js` | katalog belanja (`KATALOG_KOPDOS`) + `submitBelanja` |
| `Infaq.js` | `getInfaqMap_` / `saveInfaqMap` (kolom C sheet Anggota) |

**Frontend.** `Index.html` cuma kerangka berisi `<?!= include('...') ?>`.

| Berkas | Isi |
|---|---|
| `StyleBase` | reset + variabel `:root` (tema gelap) |
| `StyleTema` | tema terang, tema Merah Putih, hujan bendera |
| `StyleUi` | header, tombol, kartu statistik, grid, form, tabs, modal Rekening & Kopdos |
| `StyleBoard` | leaderboard, riwayat, modal statistik/grafik |
| `StyleEfek` | trail kursor, hujan uang, loader, toast, pita ayat, responsif |
| `StyleTutorial` / `StyleLanding` / `StyleLaporan` | tur, landing page, review struk + halaman A4 |
| `BodyUtama` / `BodyLanding` | markup aplikasi (termasuk semua modal) / landing page |
| `JsInti` | state global, `fmt`/`esc`, animasi angka, input nominal, toggle tipe, modal Rekening |
| `JsPapan` | tabs, toast, baris riwayat, avatar, panel expand, papan Leaderboard/Gold/Kas/Resto, modal statistik |
| `JsGrafik` | grafik garis saldo harian (SVG) |
| `JsAplikasi` | `render(data)` + submit form |
| `JsKopdos` / `JsStruk` / `JsLaporan` | katalog belanja, upload & review struk, penyusunan PDF |
| `JsTema` | siklus tema + hujan bendera |
| `JsEfek` | trail kursor, hujan uang, pemutar suara (`playSfx`, `SFX_ALIAS`) |
| `JsAyat` / `JsMuatAwal` / `JsTutorial` / `JsLogo3D` | pita ayat, panggilan dasbor pertama, tur, logo 3D |

Peta visual (alur `doGet` + siapa memanggil siapa):
<https://claude.ai/code/artifact/e8153830-e77b-4cfe-a08f-735a6c20a904>

## Verifikasi tanpa deploy

```bash
node tools/render.cjs [keluar.html]   # jahit Index + include jadi satu dokumen
node tools/smoke.cjs                  # jalankan halaman itu di Chromium (butuh playwright)
```

`smoke.cjs` memalsukan `google.script.run`, jadi UI bisa diuji tanpa Google: halaman
termuat tanpa galat, leaderboard & tab resto ter-render, siklus tema, grafik saldo, dan
payload checkout Kopdos. Jalankan setiap kali menyentuh berkas frontend. Untuk perubahan
server, checklist manualnya ada di [PROJECT.md](PROJECT.md#manual-qa-checklist).

Perintah clasp lengkap juga di [PROJECT.md](PROJECT.md#perintah-clasp). Tidak ada lint;
samakan gaya dengan kode sekitarnya secara manual.

## Konvensi

- **Kosakata domain dalam Bahasa Indonesia**, idiom kode dalam Inggris. `nama`, `tipe`,
  `nominal`, `keterangan`, `tujuan` adalah kontrak antara skema sheet, fungsi server, dan
  klien — **jangan diterjemahkan**. Field baru ikut pola yang sama.
- **Akhiran garis bawah = helper internal** (`getSheet_`, `parseNominal_`), tidak dipanggil
  dari klien.
- **Fungsi server yang mengubah data selalu mengembalikan dasbor penuh**
  (`return getDashboardData();`), supaya klien cukup `render(data)` sekali.
- **Error = `Error` biasa dengan pesan Indonesia siap tampil** (mis. `'Nominal harus angka
  lebih dari 0.'`); klien menampilkannya apa adanya lewat `toast(err.message, 'err')`.
- **Semua akses sheet lewat `getSheet_(name)`**, bukan `ss.getSheetByName` langsung (tapi
  baca GAPS.md #5 — perilaku auto-heal-nya sendiri adalah jebakan).
- **`LockService.getScriptLock()`** membungkus setiap read-modify-write ke sheet
  `Transaksi` (`waitLock(10000)` / `try … finally releaseLock()`). Wajib untuk fungsi baru
  yang menulis.
- **Tanpa framework, tanpa build step.** Menambah berkas frontend = tambah satu baris
  `include` di `Index.html` pada urutan yang benar (urutan include = urutan eksekusi).

## Jebakan — hal yang tampak bekerja padahal tidak

- **`include()` WAJIB `createTemplateFromFile(...).getRawContent()`.** Pola lazim
  `createHtmlOutputFromFile(...).getContent()` mem-parsing isi sebagai HTML; potongan di
  sini berisi CSS/JS mentah, sehingga `a < b` dibaca sebagai tag rusak dan seluruh aplikasi
  mati ("Malformed HTML content"). Sudah pernah terjadi.
- **Semua potongan CSS dijahit dalam SATU `<style>`, semua JS dalam SATU `<script>`.** JS-nya
  tidak dibungkus IIFE dan berbagi variabel tingkat atas.
- **Pemecahan berkas server aman**, kecuali pernyataan tingkat atas yang merujuk konstanta
  berkas lain (urutan evaluasi tak dijamin). Satu-satunya yang ada, `KET_INFAQ_LAMA` yang
  memakai `KAS_NAMA`, sengaja sebekas di `Code.js`.
- **Dropdown nama TIDAK membatasi apa yang diterima server.** `submitAmalan` mempercayai
  `data.nama`/`data.tujuan` apa adanya (GAPS.md #2).
- **Roster diedit di Sheet, bukan di kode.** `DEFAULT_ANGGOTA` hanya menyemai sheet `Anggota`
  saat pertama dibuat.
- **Sheet yang hilang tidak error — ia dibuat ulang diam-diam** oleh `setupSheets()`, dan
  `Anggota` kembali ke daftar bawaan. Tidak ada konfirmasi, tidak ada cadangan.
- **Foto profil** dari kolom B `Anggota`, harus URL gambar langsung atau link share Google
  Drive (dikonversi `normalizeFotoUrl_`). Link halaman (mis. post Instagram) tidak akan tampil.
- **Transfer bukan tipe baris tersendiri**: selalu ditulis sebagai Dosa (pengirim) + Pahala
  (penerima), dibedakan hanya lewat prefiks `Keterangan`.
- **Transfer > Rp500.000 diblokir HANYA di klien** (`BATAS_TRANSFER_ADMIN` di `JsAplikasi`),
  bukan di `submitAmalan`. Ini kebijakan operasional (admin mencatat manual ke sheet), bukan
  pengaman keamanan — jangan bingung dengan validasi nominal yang memang server-side.
- **Belanja Kopdos tidak lewat `submitAmalan`.** Harga hidup di server; `submitBelanja` hanya
  menerima `{id, qty}` dan menulis baris Dosa **tanpa** infaq KAS — disengaja.
- **Tema ada tiga, berputar**: `mp` (Merah Putih, default sementara) → `dark` → `light`. `mp`
  memasang kelas `.light` DAN `.mp`, jadi blok `body.mp` di CSS harus tetap setelah
  `body.light`. Kuncinya `kodomoTema` (bukan `kodomoTheme` yang lama).
- **Modal Total Pahala/Dosa punya dua wujud**: ≥900px grafik garis saldo harian (dari `deret`,
  bukan `leaderboard`), di bawah itu daftar peringkat berhalaman.
- **Daftar resto adalah cache, tidak dihitung ulang tiap load.** Diperbarui hanya saat ada
  transaksi Dosa yang cocok dengan resto yang SUDAH terdaftar, atau `refreshResto()` manual.
  Resto baru (<10 transaksi) sengaja tidak muncul sendiri; pakai `debugResto()` sebelum
  menyetel `RESTO_MIN_TRX`/`RESTO_MAD_K`. Nama resto ditebak dari `Keterangan` — salah
  tangkap itu wajar, buang dengan `hapusResto('nama')`.
- **Web app berjalan sebagai pemilik deployment untuk SEMUA pengunjung**
  (`executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS`). Tidak ada login; tidak ada
  konsep "pengguna saat ini" di server.

## Jangan diubah tanpa berpikir

- **Urutan kolom sheet `Transaksi`** (`Timestamp, Nama, Tipe Amalan, Nominal, Keterangan`)
  adalah skema tak tertulis yang dipakai `setupSheets`, penulis baris, dan pembaca dasbor.
  Mengubahnya menuntut ketiganya berubah serentak — tidak ada migrasi.
- **`appsscript.json` → `webapp.access`/`executeAs`**: itu keseluruhan model keamanan, bukan
  sekadar konfigurasi.
- **`.clasp.json` → `scriptId`**: mengikat folder ini ke satu proyek Apps Script tertentu.
- **`.claspignore`**: menjaga `tools/` tidak ikut ter-push. Skrip Node punya `require()` di
  tingkat atas, dan di GAS itu dijalankan saat proyek dimuat — aplikasi gagal start.
- **Jangan gabungkan lagi berkas server jadi satu.** Fitur baru yang berdiri sendiri sebaiknya
  jadi berkas `.js` sendiri.
