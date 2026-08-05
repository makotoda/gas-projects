/**
 * KODOMO — Aplikasi Pencatat Amalan (Pahala & Dosa)
 * Google Apps Script Web App — v2
 * (Tes push dari Claude iPhone via GitHub Actions — 08 Jul 2026)
 *
 * Fitur baru v2:
 * - Transfer pahala (otomatis membuat 2 transaksi: Dosa pengirim + Pahala penerima)
 * - Riwayat 5 transaksi terakhir per orang (untuk expand di leaderboard)
 *
 * Cara pakai:
 * 1. Buat Google Spreadsheet baru, buka Extensions > Apps Script
 * 2. Salin file ini ke Code.gs, dan Index.html ke file HTML bernama "Index"
 * 3. Jalankan fungsi setupSheets() sekali untuk membuat sheet & data awal
 * 4. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)
 */

const SHEET_TRANSAKSI = 'Transaksi';
const SHEET_ANGGOTA = 'Anggota';
// Entitas kas infaq — baris di sheet Anggota bernama persis 'KAS'.
// Infaq = transfer pahala ke KAS; leaderboard kas dihitung dari prefix
// keterangan (lihat isKetInfaq_) karena transfer tidak punya tipe sendiri.
const KAS_NAMA = 'KAS';
// Nominal infaq default (dipakai UI & migrasi flag lama). Sejak Jul 2026 tiap
// orang punya nominal infaq sendiri, disimpan sebagai ANGKA di kolom C 'Infaq'
// sheet Anggota (0/kosong = tidak ikut). Nilai lama '1' (flag centang) dibaca
// sebagai default ini demi kompatibilitas.
const INFAQ_NOMINAL = 500;

// Penanda transaksi infaq KAS lewat prefix keterangan. Format baru:
// 'KAS — <keterangan dosa>'. Format lama tetap dikenali agar data historis
// (dan transfer manual ke KAS) tetap terhitung sebagai infaq.
const KET_INFAQ_BARU = 'KAS — ';
const KET_INFAQ_LAMA = 'Transfer pahala ke ' + KAS_NAMA;
function isKetInfaq_(ket) {
  const s = String(ket || '');
  return s.indexOf(KET_INFAQ_BARU) === 0 || s.indexOf(KET_INFAQ_LAMA) === 0;
}
// Baca nominal infaq dari kolom C: 0/kosong = tidak ikut; angka = nominal;
// nilai '1' adalah flag centang lama → dianggap default INFAQ_NOMINAL.
function bacaInfaqNominal_(raw) {
  const v = Number(raw) || 0;
  if (v <= 0) return 0;
  return v === 1 ? INFAQ_NOMINAL : v;
}

// Nama bulan Indonesia (Utilities.formatDate memakai locale en_US untuk MMMM).
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];
/** 'yyyy-MM' → 'Juli 2026' */
function labelBulan_(key) {
  const [y, m] = String(key).split('-').map(Number);
  return (BULAN_ID[m - 1] || key) + ' ' + y;
}

const DEFAULT_ANGGOTA = [
  'Ajeng', 'Andik', 'Andri', 'Ari', 'Aris', 'Ayu', 'Budek Yudha', 'Dayu',
  'Dini', 'Fitri', 'Gede', 'Gusde', 'Hari', 'Hera', 'Imam', 'Jana',
  'Jerome', 'Kadek', 'Khresna', 'Komang', 'Kumala', 'Lilik', 'Maria',
  'Ochi', 'Pera', 'Putri', 'Putu Ardhi', 'Putu Jaya', 'Raditya', 'Ratna',
  'Rere', 'Riski', 'Rofikoh', 'Siwi', 'Surya', 'Teja', 'Wesh', 'Wulan',
  'Yanti', 'Yudha'
];

/**
 * Entry point web app.
 *
 * Index.html sengaja hanya kerangka: seluruh CSS, markup, dan JS-nya tinggal
 * di berkas-berkas terpisah yang dijahit di sini lewat `<?!= include(...) ?>`.
 * GAS hanya menyajikan SATU berkas per doGet, jadi pemecahan berkas menuntut
 * createTemplateFromFile (bukan createHtmlOutputFromFile) — halaman hasilnya
 * tetap satu dokumen yang persis sama seperti sebelum dipecah.
 *
 * Semua potongan CSS dijahit di dalam satu <style>, dan semua potongan JS di
 * dalam SATU <script>. Ini disengaja: memecahnya menjadi banyak tag <script>
 * akan mengubah aturan cakupan variabel antar potongan.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Kodomo — Pencatat Amalan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Sisipkan isi sebuah berkas apa adanya (dipanggil dari Index.html).
 *
 * WAJIB memakai createTemplateFromFile(...).getRawContent(). Pola include yang
 * lazim beredar memakai createHtmlOutputFromFile(...).getContent(), tapi itu
 * MEM-PARSING isinya sebagai HTML — sementara berkas potongan di sini berisi
 * CSS dan JS mentah (tanpa tag <style>/<script>, karena tagnya sudah ada di
 * Index.html). Operator seperti `a < b` atau `=>` di dalamnya membuat parser
 * gagal dengan "Malformed HTML content" dan seluruh aplikasi mati.
 * getRawContent() mengembalikan teks apa adanya tanpa validasi.
 */
function include(nama) {
  return HtmlService.createTemplateFromFile(nama).getRawContent();
}

/** Jalankan sekali untuk menyiapkan spreadsheet */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let trx = ss.getSheetByName(SHEET_TRANSAKSI);
  if (!trx) {
    trx = ss.insertSheet(SHEET_TRANSAKSI);
    trx.getRange(1, 1, 1, 5)
      .setValues([['Timestamp', 'Nama', 'Tipe Amalan', 'Nominal', 'Keterangan']])
      .setFontWeight('bold');
    trx.setFrozenRows(1);
  }

  let rst = ss.getSheetByName(SHEET_RESTO);
  if (!rst) {
    rst = ss.insertSheet(SHEET_RESTO);
    rst.getRange(1, 1, 1, RESTO_HEADER.length).setValues([RESTO_HEADER]).setFontWeight('bold');
    rst.setFrozenRows(1);
  }

  let agt = ss.getSheetByName(SHEET_ANGGOTA);
  if (!agt) {
    agt = ss.insertSheet(SHEET_ANGGOTA);
    agt.getRange(1, 1, 1, 3).setValues([['Nama', 'Foto', 'Infaq']]).setFontWeight('bold');
    agt.setFrozenRows(1);
    agt.getRange(2, 1, DEFAULT_ANGGOTA.length, 2)
      .setValues(DEFAULT_ANGGOTA.map(n => [n, '']));
  }
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    setupSheets();
    sheet = ss.getSheetByName(name);
  }
  return sheet;
}

/** Daftar anggota (untuk dropdown) */
function getAnggota() {
  const sheet = getSheet_(SHEET_ANGGOTA);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 1)
    .getValues()
    .map(r => String(r[0]).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'id'));
}

/**
 * Normalisasi URL foto profil (kolom B sheet Anggota).
 * - Hanya menerima URL http(s); nilai lain dianggap kosong.
 * - Link share Google Drive (file/d/... atau ?id=...) diubah otomatis ke URL
 *   thumbnail yang bisa dipakai langsung di <img>. Link halaman web lain
 *   (mis. halaman post Instagram) BUKAN gambar dan tidak akan tampil —
 *   pakai URL gambar langsung atau link share Google Drive.
 */
function normalizeFotoUrl_(raw) {
  const url = String(raw || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  const m = url.match(/drive\.google\.com\/(?:file\/d\/([-\w]{20,})|(?:open|uc|thumbnail)\?[^#]*\bid=([-\w]{20,}))/i);
  if (m) return 'https://drive.google.com/thumbnail?id=' + (m[1] || m[2]) + '&sz=w200';
  return url;
}

/**
 * Ambil foto profil → data URI base64, untuk ditanam di PDF laporan.
 * PDF digambar lewat <canvas>, dan canvas menolak mengekspor piksel gambar
 * lintas domain kecuali host-nya mengirim header CORS. drive.google.com/thumbnail
 * membalas 302 TANPA Access-Control-Allow-Origin, jadi foto Drive selalu gagal
 * dimuat di sisi klien. Diambil di server saja — server-to-server tidak kenal CORS.
 * Balikan '' kalau gagal; klien otomatis jatuh ke monogram inisial.
 * Butuh scope script.external_request (UrlFetchApp).
 */
function fotoDataUri_(url) {
  if (!url) return '';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return '';
    const blob = res.getBlob();
    const tipe = String(blob.getContentType() || '');
    if (tipe.indexOf('image/') !== 0) return ''; // halaman HTML/error, bukan gambar
    const bytes = blob.getBytes();
    if (bytes.length > 2 * 1024 * 1024) return ''; // jangan bengkakkan payload laporan
    return 'data:' + tipe + ';base64,' + Utilities.base64Encode(bytes);
  } catch (e) {
    return ''; // foto sifatnya opsional — jangan sampai menggagalkan laporan
  }
}

/** Peta nama → URL foto profil dari sheet Anggota */
function getFotoMap_() {
  const sheet = getSheet_(SHEET_ANGGOTA);
  const last = sheet.getLastRow();
  const map = {};
  if (last < 2) return map;
  sheet.getRange(2, 1, last - 1, 2).getValues().forEach(r => {
    const nama = String(r[0]).trim();
    if (nama) map[nama] = normalizeFotoUrl_(r[1]);
  });
  return map;
}

/** Validasi nominal */
function parseNominal_(raw) {
  const nominal = Number(raw);
  if (!nominal || nominal <= 0) throw new Error('Nominal harus angka lebih dari 0.');
  return nominal;
}
