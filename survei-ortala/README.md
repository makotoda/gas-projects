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

## Deploy

### Otomatis via GitHub Actions (utama)

Workflow `.github/workflows/deploy-survei.yml` otomatis menjalankan
`clasp push -f` + memperbarui deployment web app **di tempat** (URL tetap)
setiap ada push ke branch `claude/survei-ortala-web-app-pz7bto` (atau lewat
`workflow_dispatch`). Memakai secret `CLASPRC_JSON` yang sama dengan Kodomo.

**URL web app (stabil):**

```
https://script.google.com/macros/s/AKfycbxcqqNnS54s609QskAV4r6GeSvSg82F22a7TK_Hd_XXVnHwEv1bFQqdCCU-bfS9HoiV/exec
```

### ⚠️ Satu langkah manual wajib: otorisasi (sekali saja)

Web app berjalan sebagai akun *deployer* (`executeAs: USER_DEPLOYING`) dan
memakai Spreadsheet/Drive. `clasp deploy` **tidak** memicu layar izin, jadi
sekali saja pemilik harus mengotorisasi:

1. Buka editor Apps Script proyek survei (`clasp open` atau lewat
   script.google.com).
2. Jalankan fungsi **`setup()`** → setujui prompt izin (Spreadsheet + Drive).
3. Selesai — spreadsheet data otomatis dibuat, URL-nya muncul di **Logs**, dan
   dropdown "Nama Lengkap" langsung berisi 117 nama.

Tanpa langkah ini, URL publik akan menampilkan error otorisasi karena app
belum diizinkan berjalan atas nama akun deployer.

### Manual (alternatif, dari dalam folder)

```bash
cd survei-ortala
clasp push -f
clasp open   # Deploy → Manage deployments → edit deployment → New version
```

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
