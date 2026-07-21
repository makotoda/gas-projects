# TPA Al-Mukhlisin — Web App Pengelolaan

Web app Google Apps Script untuk pengelolaan Taman Pendidikan Al-Qur'an (TPA) Masjid
Al-Mukhlisin: absensi harian, infaq, dan laporan untuk 6 kelas (±180 santri), menggantikan
pencatatan manual di Excel. **Project ini terpisah dari Kodomo** (project GAS lain di root
repo ini) — direktori, script ID, dan deployment-nya sendiri-sendiri, tidak saling terkait.

## Struktur

```
Code.gs            doGet(e) + routing (?page=publik vs panel admin), include(), agregator dashboard
Auth.gs            login, hash password, sesi, verifikasi peran, rate-limit, manajemen akun admin
Siswa.gs           CRUD siswa, filter/pencarian/paginasi, impor massal, kode PIN publik
Kelas.gs           CRUD kelas
Kehadiran.gs       input harian (batch upsert) + grid bulanan + rekap
Infaq.gs           input batch/satuan + subtotal + rekap
Laporan.gs         generate & ekspor .xlsx/PDF (rekap + grid bulanan ala Excel)
Publik.gs          endpoint read-only untuk halaman orang tua (digerbangi kode PIN)
Setup.gs           setup() sekali-jalan: bikin Sheet + header + seed kelas + super admin
Util.gs            konstanta, skema kolom Sheet, helper baca/tulis, format, validasi

index.html         shell admin (nav + seluruh section, router client-side)
scripts.html       runtime bersama: pembungkus google.script.run, sesi, router, toast, dsb.
styles.html        desain sistem (glassmorphism teal+emas, dipakai index.html & publik.html)
login/dashboard/siswa/kelas/kehadiran/infaq/laporan/admin.html   section per fitur
publik.html        halaman mandiri untuk orang tua (?page=publik), tidak pakai scripts.html
```

`admin.html` (manajemen akun admin + log audit, khusus super_admin) adalah tambahan di luar
daftar file pada prompt asli — fitur §6.9 butuh rumah, dan memisahkannya sendiri lebih
konsisten daripada menumpuknya di dashboard.html.

## Deploy (pertama kali)

Prasyarat: `clasp` terpasang & `clasp login` dengan akun Google yang akan memiliki project
ini (lihat CLAUDE.md di root repo untuk cara pasang clasp bila belum ada).

1. **Buat project Apps Script & hubungkan folder ini:**
   ```bash
   cd tpa-al-mukhlisin
   clasp create --type webapp --title "TPA Al-Mukhlisin" --rootDir .
   ```
   Ini membuat `.clasp.json` baru di folder ini (sengaja **tidak** ikut ditulis oleh sesi ini
   karena tidak ada project Apps Script nyata yang bisa dibuat dari sandbox ini). Setelah
   `clasp create`, jalankan `git diff appsscript.json` — kalau isinya berubah/tertimpa,
   kembalikan dengan `git checkout -- appsscript.json` sebelum lanjut ke langkah berikut.

2. **Push kode:**
   ```bash
   clasp push -f
   ```

3. **Jalankan `setup()` sekali** — `clasp open` → pilih fungsi `setup` di dropdown → ▶ Run →
   izinkan semua permission yang diminta (Sheets, Drive, koneksi eksternal untuk ekspor).
   Buka **Execution log** (Ctrl+Enter) dan baca hasilnya:
   - Sebuah Spreadsheet baru "Database TPA Al-Mukhlisin" otomatis dibuat dan ID-nya
     tersimpan ke Script Properties — **tidak perlu diisi manual**, kecuali memang ingin
     memakai Spreadsheet yang sudah ada (isi `SPREADSHEET_ID` di Script Properties dulu
     sebelum menjalankan `setup()` kalau begitu).
   - `setup()` sengaja TIDAK diberi akhiran underscore supaya muncul di dropdown fungsi
     editor dan bisa dijalankan manual (fungsi ber-underscore tidak muncul di sana). Agar
     tetap aman dari `google.script.run`, `setup()` tidak pernah me-return kredensial —
     password super admin awal HANYA ditulis ke Execution log yang tak terbaca pemanggil
     RPC (lihat komentar di Setup.gs).
   - **Username & password super admin awal** — HANYA tampil sekali di log ini, catat
     sekarang.

4. **Deploy sebagai Web App** — `clasp open` → Deploy → New deployment → tipe "Web app":
   - Execute as: **Me**
   - Who has access: **Anyone**

   Salin URL yang muncul.

5. **Dua tautan yang dibagikan:**
   - Panel admin (pengurus): `<URL_DEPLOY>`
   - Halaman publik (orang tua): `<URL_DEPLOY>?page=publik`

6. **Login pertama** ke panel admin pakai kredensial dari langkah 3, lalu segera ganti
   password lewat **Kelola Admin → Ganti Password Saya**.

### Update setelah deploy pertama

```bash
clasp push -f
```
memperbarui kode di balik deployment yang sudah ada. Supaya URL deploy mencerminkan versi
terbaru: `clasp open` → Deploy → Manage deployments → edit deployment → New version.

Kalau folder ini nantinya dikelola dari banyak sesi/mesin (seperti Kodomo), pertimbangkan
commit `.clasp.json` ke git supaya semua sesi mengikat ke project Apps Script yang sama —
lihat pola "git sumber kebenaran" di CLAUDE.md root repo.

## Keputusan default yang diambil (lihat bagian §10 prompt asli)

1. **Skema infaq**: entri bebas per tanggal (bukan tagihan bulanan wajib lunas/belum) — default prompt.
2. **Cakupan admin**: semua admin melihat semua kelas, tidak ada pembatasan per `id_kelas_ampuan` — default prompt.
3. **Gerbang PIN publik**: **diaktifkan**. Setiap siswa punya `kode_publik` (4 digit acak,
   digenerate saat siswa dibuat, bisa dibuat ulang dari form ubah siswa). Alasan: halaman
   publik menampilkan nama, kehadiran, dan nominal infaq anak — data ini pantas digerbangi
   sesuatu meski hanya PIN ringan, mengingat siapa pun yang tahu URL bisa membuka halaman itu.
4. **Format unduhan**: mendukung **xlsx dan PDF**, dipilih dari dropdown saat mengunduh.
5. **Status kehadiran**: H/S/I/A saja, tanpa tambahan status (mis. Terlambat) — default prompt.

## Catatan desain lain yang berbeda dari draf prompt (dengan alasan)

- **Konvensi return value beda dari Kodomo.** Kodomo selalu me-return seluruh dashboard tiap
  mutasi; project ini TIDAK — tiap fungsi mutasi me-return hasil kecil yang relevan saja
  (`{ok:true, idSiswa:...}` dsb.), client memanggil ulang fungsi list/get yang relevan untuk
  refresh. TPA punya banyak tampilan besar yang independen (tabel siswa, grid bulanan, log),
  jadi pola "return semua" Kodomo akan boros di sini. Konvensi error (`throw new Error(pesan
  Indonesia)` + `withFailureHandler`) tetap sama seperti Kodomo karena memang pola yang baik.
- **Sheet yang hilang TIDAK auto-heal.** Beda dari `getSheet_` Kodomo yang diam-diam membuat
  ulang sheet kalau hilang (footgun yang didokumentasikan sendiri di GAPS.md Kodomo), di sini
  `getSheet_` melempar error yang mengarahkan menjalankan `setup()`. Sheet cuma pernah dibuat
  oleh `Setup.gs`, supaya penghapusan sheet yang tidak sengaja tidak diam-diam mereset data.
- **Kolom tanggal/HP/kode dipaksa format Teks Biasa** (`Setup.gs` → `paksaFormatKolomTeks_`).
  Tanpa ini, Google Sheets otomatis mengonversi `"2026-07-20"` jadi tanggal serial dan
  `"0042"`/`"08123..."` jadi angka (nol di depan hilang) — merusak semua perbandingan string
  yang dipakai kode ini.
- **ID mudah dibaca** (`SIS-0001`, `ADM-0002`, dst.) lewat penghitung di Script Properties
  yang dialokasikan di dalam kunci `withLock_`, bukan UUID acak — supaya kalau pengurus buka
  Sheet mentah secara manual (kemungkinan besar terjadi, mengingat asalnya dari Excel), ID
  masih bisa dibaca dan diurutkan wajar.
- **Laporan dikirim langsung sebagai byte ke browser, tidak disimpan di Drive.** Server
  membangun Spreadsheet sementara, mengekspornya ke `.xlsx`/PDF, mengembalikan byte-nya
  (base64) ke client untuk diunduh (blob), lalu membuang Spreadsheet sementara itu. **Tidak
  ada file laporan publik** — dulu file di-share `ANYONE_WITH_LINK` (berisiko membocorkan PII
  siswa lewat tautan); karena admin login via auth kustom (bukan akun Google) sehingga file
  tidak bisa di-share ke identitas Google mereka, byte laporan sekarang dialirkan langsung ke
  browser admin. (Catatan: unduhan bergantung pada izin `allow-downloads` iframe sandbox
  Apps Script — sudah didukung; unduh dipicu oleh klik pengguna.)
- **Sesi login pakai CacheService, 6 jam** (bukan 8 jam seperti contoh di prompt) — itu batas
  maksimum `CacheService` di Apps Script; prompt sendiri menulis "mis. 8 jam" sebagai contoh,
  bukan angka wajib.
- **Logo resmi TPA (hexagon hijau) di-embed sebagai data URI PNG**, satu kali, lewat CSS
  custom property `--logo-img` di `styles.html` (`:root`) — dipakai oleh `.brand .mark`
  (topbar admin), `.hero-orb` (hero login), dan `.pub-header .mark` (publik.html). Sumbernya
  adalah PDF logo resmi (background putih); background putih itu **dibuang jadi transparan**
  (algoritma "color-to-alpha" ala GIMP: jarak tiap piksel dari putih murni menentukan alpha,
  lalu warna asli di-unmultiply), ditrim, dikuantisasi ke ~24 warna (art-nya cuma hijau solid
  + transparan + sedikit anti-alias, jadi nyaris lossless), lalu di-resize ke lebar ±420px
  (~17KB). Hijau logo (`rgb(75,188,59)`) kontrasnya rendah kalau ditaruh transparan langsung
  di atas `--glass-tint`/`--bg-deep` (nyaris menyatu) — makanya ketiga tempat pakai plate
  `var(--mist)` (persegi membulat untuk topbar/publik, lingkaran untuk hero) di belakang logo,
  bukan transparan penuh. Favicon (`<link rel="icon">` di `index.html`/`publik.html`) adalah
  aset terpisah yang lebih kecil (plate+logo di-flatten jadi satu PNG ~96px), bukan
  `--logo-img`, karena favicon tidak bisa memakai CSS layering. Untuk mengganti logo di masa
  depan: ulangi proses ini (trim → color-to-alpha → quantize → resize → base64), jangan
  tempel PNG mentah beresolusi tinggi apa adanya — bisa menggembungkan `styles.html` secara
  signifikan.
- **`regenerasiKodePublik`** ditambahkan (tombol "Buat Ulang" di form ubah siswa) supaya PIN
  yang bocor/lupa bisa diganti tanpa harus utak-atik Sheet manual.

## Manual QA checklist (belum ada automated test)

1. `setup()` dari editor, catat kredensial super admin, login ke panel admin.
2. Ganti password super admin lewat **Kelola Admin**.
3. Tambah kelas baru, tambah siswa (satu-satu dan lewat impor cepat), pindahkan siswa antar
   kelas, nonaktifkan lalu aktifkan lagi seorang siswa.
4. Coba hapus kelas yang masih ada siswa aktifnya → harus ditolak dengan pesan yang jelas.
5. Input kehadiran harian untuk satu kelas (termasuk "Tandai Semua Hadir"), simpan, buka lagi
   halaman yang sama → status tersimpan harus muncul kembali (upsert bekerja).
6. Buka Grid Bulanan kelas yang sama, klik beberapa sel untuk siklus H→S→I→A→kosong, pastikan
   rekap H/S/I/A per baris ikut berubah tanpa reload.
7. Input infaq batch untuk satu kelas + satu entri infaq perorangan, cek subtotal harian naik
   sesuai.
8. Unduh Laporan Kehadiran & Laporan Infaq (masing-masing xlsx dan PDF) untuk kelas tertentu
   dan untuk "Semua Kelas" pada rentang yang mencakup lebih dari satu bulan — buka hasilnya,
   pastikan sheet Rekapitulasi, Ringkasan per Kelas, dan Grid Bulanan (satu per bulan×kelas)
   semua terisi benar.
9. Tambah admin baru (harus gagal di percobaan ke-5 kalau sudah ada 4 admin biasa aktif),
   nonaktifkan salah satu, reset password salah satu, cek semuanya tercatat di **Log Audit**.
10. Buka halaman publik (`?page=publik`) di mode privat/HP: pilih kelas → cari nama →
    masukkan kode PIN yang salah beberapa kali (harus ditolak, lalu setelah 10x kena jeda) →
    masukkan kode benar dari form ubah siswa → rekap kehadiran & infaq bulan berjalan
    tampil, tombol ‹ › ganti bulan berfungsi, dan **tidak ada** no. HP wali/catatan yang bocor
    ke halaman ini.
11. Logout, pastikan token lama tidak lagi diterima server (coba panggil ulang lewat tab yang
    masih terbuka — harus diarahkan ke login).

## Keamanan & siapa boleh apa

| Aksi | super_admin | admin |
|---|---|---|
| Kelola akun admin, lihat Log | ✅ | ❌ |
| CRUD siswa & kelas, input kehadiran/infaq, unduh laporan | ✅ | ✅ |

Semua fungsi server yang menyentuh data memverifikasi peran di server (`requireRole_`),
bukan cuma menyembunyikan tombol di client. Password di-hash SHA-256 + salt per akun, tidak
pernah disimpan/ dikirim balik plaintext setelah dibuat — **segera ganti password super admin
awal** setelah login pertama. Halaman publik tidak pernah menerima `no_hp_wali`/`catatan` dari
server sama sekali (bukan cuma disembunyikan di tampilan).
