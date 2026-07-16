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

## Daftar pegawai

Sheet `Pegawai` **terisi otomatis** dari daftar default (`DEFAULT_PEGAWAI` di
`Code.js`, 117 nama) pada pemakaian pertama — dropdown langsung siap tanpa
langkah manual. Setelah ter-seed, **sheet menjadi sumber kebenaran**:

- Tambah/hapus/ubah nama cukup diedit langsung di kolom A sheet `Pegawai`.
- Mengubah `DEFAULT_PEGAWAI` di kode **tidak** memengaruhi sheet yang sudah
  terisi (seed hanya berjalan saat sheet benar-benar kosong).
- Untuk menemukan lokasi spreadsheet data: jalankan `setup()` sekali dari editor
  Apps Script (URL muncul di **Logs** & sebagai nilai kembalian).
- Untuk menimpa seluruh daftar sekaligus: `seedPegawai(['Nama A', 'Nama B', ...])`.

## Catatan

- Skema pertanyaan adalah **sumber kebenaran tunggal** di `SURVEYS` (`Code.js`);
  header sheet respons dan render di client mengikutinya. Menambah/mengubah
  pertanyaan cukup di objek `SURVEYS` — header sheet baru terbentuk otomatis.
- Bila kelak ingin **meneruskan** jawaban ke Google Form asli, tinggal tambah
  helper `UrlFetchApp` ke endpoint `.../formResponse` dengan pemetaan `entry.<id>`
  (butuh tautan pra-isi dari tiap form untuk mendapatkan entry ID).
