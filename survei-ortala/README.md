# Survei Ortala Ditjen Bimas Hindu

Web app Google Apps Script **mandiri** (terpisah dari project Kodomo di root repo
ini). Menampilkan **dua survei** dalam satu halaman, masing-masing di **card besar
terpisah**:

1. **Survei Implementasi Standar Operasional Prosedur (SOP)** — 12 pertanyaan
   penilaian bintang 1–5 + kolom **Saran** (opsional).
2. **Survei Pelaksanaan Budaya Kerja dan Evaluasi Kesiapan Perubahan** — 10
   pertanyaan penilaian bintang 1–5.

Referensi desain berasal dari dua Google Form yang diberikan pemilik; web app ini
**tidak mengirim ke Google Form**, melainkan menyimpan jawaban ke Google
Spreadsheet miliknya sendiri (lihat "Alur data").

## Isi folder

| File              | Fungsi                                                                 |
|-------------------|------------------------------------------------------------------------|
| `Code.js`         | Backend: `doGet`, `getBootstrap`, `submitSurvey`, helper sheet, admin. |
| `Index.html`      | Seluruh frontend (HTML + CSS + JS inline) — 2 card, rating bintang.     |
| `appsscript.json` | Manifest web app (`ANYONE_ANONYMOUS`, `USER_DEPLOYING`, Asia/Jakarta).  |
| `.clasp.json`     | Mengikat folder ini ke scriptId `1FH4eZbCkJ5qz…85Tsx` (script terpisah).|

> Folder ini punya `.clasp.json` sendiri. `.clasp.json` root repo sudah di-set
> `skipSubdirectories: true` agar auto-deploy Kodomo (Actions `clasp push -f` dari
> root) **tidak** ikut mendorong file di sini ke script Kodomo.

## Alur data

- Jawaban disimpan ke **Google Spreadsheet milik script** ini. Spreadsheet dibuat
  otomatis saat pertama kali app dipakai; ID-nya disimpan di Script Properties
  (`SPREADSHEET_ID`). Kalau script terikat (container-bound) ke sebuah Sheet,
  Sheet itu yang dipakai.
- Sheet yang dikelola otomatis:
  - **`Pegawai`** — kolom A = daftar nama untuk dropdown "Nama Lengkap".
  - **`Respons SOP`** — `Timestamp, Nama, 1..12, Saran`.
  - **`Respons Budaya Kerja`** — `Timestamp, Nama, 1..10`.

## Cara deploy

Jalankan dari **dalam folder ini** (bukan root repo):

```bash
cd survei-ortala
clasp push -f          # dorong Code.js + Index.html + appsscript.json ke script
clasp open             # buka editor Apps Script untuk deploy web app
```

Lalu di editor: **Deploy → New deployment → Web app**
(`Execute as: Me`, `Who has access: Anyone`).

## Setelah deploy — isi daftar pegawai

Dropdown "Nama Lengkap" kosong sampai sheet `Pegawai` diisi. Dua cara:

1. **Manual** — buka spreadsheet data lalu isi nama di kolom A sheet `Pegawai`.
   Untuk tahu lokasi spreadsheet, jalankan fungsi `setup()` sekali dari editor
   Apps Script; URL-nya muncul di **Logs** dan sebagai nilai kembalian.
2. **Programatik** — dari editor jalankan
   `seedPegawai(['Nama Satu', 'Nama Dua', ...])` untuk mengisi sekaligus.

## Catatan

- Skema pertanyaan adalah **sumber kebenaran tunggal** di `SURVEYS` (`Code.js`);
  header sheet respons dan render di client mengikutinya. Menambah/mengubah
  pertanyaan cukup di objek `SURVEYS` — header sheet baru terbentuk otomatis.
- Bila kelak ingin **meneruskan** jawaban ke Google Form asli, tinggal tambah
  helper `UrlFetchApp` ke endpoint `.../formResponse` dengan pemetaan `entry.<id>`
  (butuh tautan pra-isi dari tiap form untuk mendapatkan entry ID).
