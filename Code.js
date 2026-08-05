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

/** Model Gemini untuk baca struk (foto) — ganti di sini kalau mau versi lain. */
const GEMINI_MODEL = 'gemini-3.5-flash';

/** API key Gemini disimpan di Script Properties (Project Settings > Script
 *  Properties di editor Apps Script), BUKAN di source code — lihat GAPS.md #1
 *  soal kenapa hardcode key itu buruk. */
function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

/**
 * Baca foto lewat Gemini Vision, balikin daftar {nama, nominal}.
 * mode 'struk' (default): screenshot split tagihan, satu baris per orang
 *   (baris 'You'/'Anda'/host difilter oleh prompt).
 * mode 'transfer': bukti transfer bank/e-wallet, diambil nama PENGIRIM +
 *   nominal (biasanya satu item) — dipakai menu top-up pahala.
 * Nama hasil baca belum tentu cocok dengan roster Anggota — pencocokan &
 * konfirmasi akhir dilakukan di klien (dropdown per baris), fungsi ini cuma baca.
 */
function parseStruk(base64, mimeType, mode) {
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('Fitur baca struk belum diaktifkan (GEMINI_API_KEY belum diatur).');
  if (!base64) throw new Error('Gambar struk kosong.');
  const tipe = String(mimeType || '').trim();
  if (tipe.indexOf('image/') !== 0) throw new Error('File harus berupa gambar.');

  const prompt = mode === 'transfer'
    ? 'Ini screenshot bukti transfer bank atau e-wallet (Rupiah). Ekstrak nama PENGIRIM ' +
      '(bukan penerima) persis seperti tertulis, nominal uang yang ditransfer sebagai ' +
      'angka bulat tanpa "Rp"/titik/koma, dan nama bank atau dompet digital yang dipakai ' +
      '(field bank, mis. "BCA", "GoPay") kalau terlihat. Abaikan biaya admin. ' +
      'Biasanya hanya ada satu transfer.'
    : 'Ini screenshot daftar split tagihan/utang. Setiap baris berisi nama ' +
      'orang dan nominal uang (Rupiah). Ambil semua baris KECUALI baris milik pemilik akun ' +
      'sendiri (berlabel "You", "Anda", "Kamu", atau "Host"). Untuk tiap baris sisanya, ' +
      'balikan nama persis seperti tertulis dan nominal sebagai angka bulat tanpa "Rp"/titik/koma.';

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: tipe, data: base64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            nama: { type: 'STRING' },
            nominal: { type: 'NUMBER' },
            bank: { type: 'STRING' }
          },
          required: ['nama', 'nominal']
        }
      }
    }
  };

  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
      ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    }
  );
  // ponytail: pesan error menyertakan detail asli dari Gemini (bukan dibungkus generik)
  // supaya kegagalan gampang didiagnosis dari toast tanpa buka Stackdriver dulu.
  if (res.getResponseCode() !== 200) {
    throw new Error('Gagal membaca struk (HTTP ' + res.getResponseCode() + '): ' +
      res.getContentText().slice(0, 800));
  }

  let items;
  try {
    const json = JSON.parse(res.getContentText());
    const cand = json.candidates && json.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts[0] &&
      cand.content.parts[0].text;
    if (!text) {
      const alasan = cand && cand.finishReason;
      throw new Error('respons Gemini tanpa teks' + (alasan ? ' (finishReason: ' + alasan + ')' : '') +
        ': ' + res.getContentText().slice(0, 300));
    }
    items = JSON.parse(text);
  } catch (e) {
    throw new Error('Gagal membaca struk: ' + (e.message || 'parse error'));
  }
  if (!Array.isArray(items)) throw new Error('Gagal membaca struk: respons bukan daftar (array).');

  return items
    .map(it => ({
      nama: String(it.nama || '').trim(),
      nominal: Math.round(Number(it.nominal)) || 0,
      bank: String(it.bank || '').trim()
    }))
    .filter(it => it.nama && it.nominal > 0)
    .slice(0, 50);
}

/**
 * Alias nama hasil baca foto → nama roster, dipelajari dari koreksi user di
 * modal review (kunci = nama OCR yang dinormalisasi klien). Disimpan di
 * Script Properties supaya berlaku untuk semua pemakai, bukan per-device.
 */
function getStrukAlias_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('STRUK_ALIAS') || '{}');
  } catch (e) {
    return {};
  }
}

/** Gabungkan alias baru dari klien ke map tersimpan. */
function saveStrukAlias(map) {
  if (!map || typeof map !== 'object') return;
  const cur = getStrukAlias_();
  Object.keys(map).forEach(k => {
    const key = String(k).trim().slice(0, 80);
    const val = String(map[k]).trim().slice(0, 80);
    if (key && val) cur[key] = val;
  });
  // ponytail: tanpa lock — tabrakan dua koreksi bersamaan paling banter kehilangan
  // satu alias yang akan terpelajari lagi di upload berikutnya. Script Properties
  // max ~9KB per value; pangkas manual kalau suatu saat penuh.
  PropertiesService.getScriptProperties().setProperty('STRUK_ALIAS', JSON.stringify(cur));
}

/** Simpan transaksi amalan baru (Pahala / Dosa / Transfer) */
function submitAmalan(data) {
  if (!data || !data.nama) throw new Error('Nama wajib dipilih.');
  const nama = String(data.nama).trim();
  const nominal = parseNominal_(data.nominal);
  const ket = String(data.keterangan || '').trim();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_TRANSAKSI);
    const now = new Date();

    if (data.tipe === 'Transfer') {
      const tujuan = String(data.tujuan || '').trim();
      if (!tujuan) throw new Error('Nama tujuan transfer wajib dipilih.');
      if (tujuan === nama) throw new Error('Tidak bisa transfer pahala ke diri sendiri.');

      const ketPengirim = 'Transfer pahala ke ' + tujuan + (ket ? ' — ' + ket : '');
      const ketPenerima = 'Transfer pahala dari ' + nama + (ket ? ' — ' + ket : '');

      sheet.getRange(sheet.getLastRow() + 1, 1, 2, 5).setValues([
        [now, nama, 'Dosa', nominal, ketPengirim],
        [now, tujuan, 'Pahala', nominal, ketPenerima]
      ]);
    } else {
      const tipe = data.tipe === 'Dosa' ? 'Dosa' : 'Pahala';
      sheet.appendRow([now, nama, tipe, nominal, ket]);
      const infaqRows = barisInfaqOtomatis_(now, nama, tipe, ket);
      if (infaqRows.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, infaqRows.length, 5).setValues(infaqRows);
      }
    }
  } finally {
    lock.releaseLock();
  }
  // Di luar lock: perbarui harga rata-rata resto kalau keterangan ini cocok
  // dengan resto yang sudah terdaftar (resto baru → refreshResto() manual).
  if (data.tipe === 'Dosa') perbaruiRestoOtomatis_([ket]);
  return getDashboardData();
}

/** Baris infaq otomatis (Dosa + Pahala KAS) kalau nominal infaq nama ini > 0,
 *  else array kosong. Dipakai submitAmalan (single) & submitAmalanBatch. */
function barisInfaqOtomatis_(now, nama, tipe, ket) {
  const infaqNominal = tipe === 'Dosa' && nama !== KAS_NAMA
    ? (getInfaqMap_()[nama] || 0) : 0;
  if (infaqNominal <= 0) return [];
  const ketDosaKet = ket || 'infaq otomatis';
  return [
    [now, nama, 'Dosa', infaqNominal, KET_INFAQ_BARU + ketDosaKet],
    [now, KAS_NAMA, 'Pahala', infaqNominal, nama + ' - ' + ketDosaKet]
  ];
}

/**
 * Simpan banyak transaksi (Pahala/Dosa saja — bukan Transfer) dalam SATU
 * write ke sheet & SATU lock, dipakai review upload struk supaya semua baris
 * (termasuk baris "yang traktir") masuk sekali jalan alih-alih satu request
 * per baris. Mengembalikan dashboard hasil akhir seperti submitAmalan.
 */
function submitAmalanBatch(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Tidak ada transaksi untuk disimpan.');

  const ketResto = []; // keterangan baris Dosa, untuk pembaruan harga resto
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_TRANSAKSI);
    const now = new Date();
    const rows = [];
    items.forEach(it => {
      const nama = String(it && it.nama || '').trim();
      if (!nama) throw new Error('Nama wajib dipilih.');
      const nominal = parseNominal_(it.nominal);
      const tipe = it.tipe === 'Dosa' ? 'Dosa' : 'Pahala';
      const ket = String(it.keterangan || '').trim();
      rows.push([now, nama, tipe, nominal, ket]);
      if (tipe === 'Dosa') ketResto.push(ket);
      rows.push.apply(rows, barisInfaqOtomatis_(now, nama, tipe, ket));
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  perbaruiRestoOtomatis_(ketResto);
  return getDashboardData();
}

/* =====================================================================
 * KOPDOS MERAH PUTIH — katalog belanja
 * ---------------------------------------------------------------------
 * Katalog didefinisikan DI SERVER dan harga tidak pernah diambil dari
 * klien: submitBelanja hanya menerima id barang + jumlah unit, lalu
 * mengalikannya sendiri. Klien yang dimodifikasi karenanya tidak bisa
 * membeli tisu seharga 1 rupiah.
 *
 * Belanja tercatat sebagai transaksi Dosa biasa, TAPI tanpa baris infaq
 * KAS — sengaja, karena ini pembelian barang koperasi, bukan jajan.
 * Karena itu ia memakai jalur sendiri, bukan submitAmalan.
 * ===================================================================== */

const KATALOG_KOPDOS = [
  { id: 'tissue', nama: 'Tissue', harga: 35000, emoji: '🧻' }
];

/** Prefix keterangan belanja koperasi. Dipakai untuk mengenali baris belanja
 *  di riwayat, dan sudah otomatis luput dari deteksi resto (lihat
 *  RESTO_BUKAN_BELANJA). */
const KET_KOPDOS = 'Kopdos';

function getKatalog() {
  return KATALOG_KOPDOS;
}

/**
 * Checkout katalog Kopdos. data = { nama, items: [{ id, qty }] }.
 * Menulis satu baris Dosa per jenis barang, TANPA baris infaq KAS.
 */
function submitBelanja(data) {
  const nama = String(data && data.nama || '').trim();
  if (!nama) throw new Error('Nama wajib dipilih.');
  const items = (data && data.items) || [];
  if (!Array.isArray(items) || !items.length) throw new Error('Keranjang masih kosong.');

  const rows = [];
  const now = new Date();
  items.forEach(it => {
    const barang = KATALOG_KOPDOS.filter(b => b.id === String(it && it.id || ''))[0];
    if (!barang) throw new Error('Barang tidak dikenal.');
    const qty = Math.floor(Number(it.qty) || 0);
    if (qty <= 0) return;
    if (qty > 99) throw new Error('Jumlah maksimal 99 unit per barang.');
    rows.push([now, nama, 'Dosa', barang.harga * qty,
      KET_KOPDOS + ' — ' + barang.nama + ' x' + qty]);
  });
  if (!rows.length) throw new Error('Jumlah unit harus lebih dari 0.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_TRANSAKSI);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return getDashboardData();
}

/** Peta nama → nominal infaq otomatis (kolom C 'Infaq' berisi angka > 0) */
function getInfaqMap_() {
  const sheet = getSheet_(SHEET_ANGGOTA);
  const last = sheet.getLastRow();
  const map = {};
  if (last < 2) return map;
  sheet.getRange(2, 1, last - 1, 3).getValues().forEach(r => {
    const nama = String(r[0]).trim();
    const nominal = bacaInfaqNominal_(r[2]);
    if (nama && nama !== KAS_NAMA && nominal > 0) map[nama] = nominal;
  });
  return map;
}

/** Simpan nominal infaq per orang (menu Kas) ke kolom C Anggota.
 *  map = { nama: nominal }. Nominal <= 0 / tidak ada = tidak ikut (kolom kosong). */
function saveInfaqMap(map) {
  const nominalOf = {};
  if (map && typeof map === 'object') {
    Object.keys(map).forEach(k => {
      const n = Math.floor(Number(map[k]) || 0);
      if (n > 0) nominalOf[String(k).trim()] = n;
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_ANGGOTA);
    sheet.getRange(1, 3).setValue('Infaq');
    const last = sheet.getLastRow();
    if (last >= 2) {
      const nama = sheet.getRange(2, 1, last - 1, 1).getValues();
      sheet.getRange(2, 3, last - 1, 1)
        .setValues(nama.map(r => {
          const n = nominalOf[String(r[0]).trim()] || 0;
          return [n > 0 ? n : ''];
        }));
    }
  } finally {
    lock.releaseLock();
  }
  return getDashboardData();
}

/** Batas aman jumlah hari di grafik saldo harian. Untuk sementara grafik
 *  memakai SELURUH riwayat (sejak transaksi pertama), bukan jendela tetap;
 *  batas ini hanya menjaga payload tidak meledak kalau data sudah bertahun. */
const DERET_HARI_MAX = 730;

/**
 * Saldo kumulatif tiap orang per hari untuk DERET_HARI hari terakhir.
 * Saldo hari pertama sudah memperhitungkan SELURUH transaksi sebelum jendela
 * ini, jadi titik terakhir grafik selalu sama dengan angka di leaderboard.
 * Dipakai grafik garis di modal Total Pahala/Dosa (tampilan desktop).
 */
function deretHarian_(rows, tz, fotoMap) {
  const hariDari = t => Utilities.formatDate(t, tz, 'yyyy-MM-dd');
  const tglDari = ts => {
    const t = ts instanceof Date ? ts : new Date(ts);
    return (!t || isNaN(t.getTime())) ? null : t;
  };

  // Rentang = sejak transaksi pertama sampai hari ini (dibatasi DERET_HARI_MAX).
  const now = new Date();
  let paling = null;
  rows.forEach(r => {
    const t = tglDari(r[0]);
    if (t && t.getTime() < now.getTime() && (!paling || t.getTime() < paling.getTime())) paling = t;
  });
  const hariAwal = new Date(now.getTime() -
    Math.min(DERET_HARI_MAX - 1,
      paling ? Math.floor((now.getTime() - paling.getTime()) / 86400000) : 29) * 86400000);
  const jumlahHari = Math.floor((now.getTime() - hariAwal.getTime()) / 86400000) + 1;

  const hariKey = [];
  for (let i = 0; i < jumlahHari; i++) {
    hariKey.push(hariDari(new Date(hariAwal.getTime() + i * 86400000)));
  }
  const posisi = {};
  hariKey.forEach((h, i) => { posisi[h] = i; });
  const batasAwal = hariKey[0];

  // saldo = TOTAL semua transaksi, dihitung dengan aturan yang sama persis
  // dengan leaderboard. Deret harian diturunkan MUNDUR dari angka ini, bukan
  // dijumlahkan maju dari nol: dengan begitu titik terakhir grafik dijamin
  // sama dengan saldo di leaderboard walau ada baris yang stempel waktunya
  // tidak terbaca (mis. hasil migrasi yang tersimpan sebagai teks) — baris
  // seperti itu tetap masuk saldo, hanya tidak memengaruhi bentuk kurvanya.
  const saldo = {};
  const delta = {};  // nama → perubahan saldo per hari dalam rentang
  rows.forEach(r => {
    const [ts, nama, tipe, nominal] = r;
    const nm = String(nama).trim();
    const val = Number(nominal) || 0;
    if (!nm || !val || nm === KAS_NAMA) return;
    const d = tipe === 'Dosa' ? -val : val;
    saldo[nm] = (saldo[nm] || 0) + d;

    const t = tglDari(ts);
    if (!t) return;                                        // tak terbaca → hanya ke saldo
    const k = hariDari(t);
    if (k < batasAwal) return;                             // di luar rentang (terpotong batas)
    const i = posisi[k] === undefined ? jumlahHari - 1 : posisi[k]; // masa depan → hari ini
    if (!delta[nm]) delta[nm] = new Array(jumlahHari).fill(0);
    delta[nm][i] += d;
  });

  return {
    hari: hariKey.map(k => k.slice(8) + '/' + k.slice(5, 7)), // 'dd/MM'
    tanggal: hariKey,
    orang: Object.keys(saldo).map(nm => {
      const dl = delta[nm] || [];
      const nilai = new Array(jumlahHari);
      let run = saldo[nm];
      for (let i = jumlahHari - 1; i >= 0; i--) {
        nilai[i] = run;              // saldo pada akhir hari ke-i
        run -= (dl[i] || 0);         // mundur satu hari
      }
      return { nama: nm, foto: fotoMap[nm] || '', nilai: nilai };
    })
  };
}

/** Data lengkap untuk dashboard: statistik, leaderboard (+5 transaksi terakhir per orang), riwayat */
function getDashboardData() {
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] :
    sheet.getRange(2, 1, last - 1, 5).getValues();

  const tz = Session.getScriptTimeZone();
  const saldoMap = {};
  const infaqMap = {}; // nama → total infaq ke KAS
  const bulanSet = {}; // 'yyyy-MM' yang punya transaksi (utk pemilih laporan)
  const history = [];

  rows.forEach(r => {
    const [ts, nama, tipe, nominal, ket] = r;
    const nm = String(nama).trim();
    const val = Number(nominal) || 0;
    if (!nm || !val) return;
    if (ts instanceof Date) bulanSet[Utilities.formatDate(ts, tz, 'yyyy-MM')] = true;

    if (!saldoMap[nm]) saldoMap[nm] = { nama: nm, pahala: 0, dosa: 0, recent: [] };

    const isDosa = tipe === 'Dosa';
    if (isDosa) {
      saldoMap[nm].dosa += val;
      if (nm !== KAS_NAMA && isKetInfaq_(ket)) {
        infaqMap[nm] = (infaqMap[nm] || 0) + val;
      }
    } else {
      saldoMap[nm].pahala += val;
    }

    const item = {
      waktu: ts instanceof Date
        ? Utilities.formatDate(ts, tz, 'dd MMM yyyy • HH:mm')
        : String(ts),
      nama: nm,
      tipe: isDosa ? 'Dosa' : 'Pahala',
      nominal: val,
      keterangan: String(ket || '')
    };

    history.push(item);
    saldoMap[nm].recent.push(item);
  });

  const fotoMap = getFotoMap_();
  const kasData = saldoMap[KAS_NAMA];
  const leaderboard = Object.values(saldoMap)
    .filter(o => o.nama !== KAS_NAMA)
    .map(o => ({
      nama: o.nama,
      foto: fotoMap[o.nama] || '',
      pahala: o.pahala,
      dosa: o.dosa,
      saldo: o.pahala - o.dosa,
      recent: o.recent.slice(-40).reverse() // buffer utk panel (client paginasi 10 + filter KAS)
    }))
    .sort((a, b) => b.saldo - a.saldo);

  // Total Pahala/Dosa = jumlah saldo bersih tiap orang di leaderboard (bukan
  // total transaksi mentah), tidak termasuk anggota "(Gold)".
  let totalPahala = 0;
  let totalDosa = 0;
  leaderboard.forEach(o => {
    if (o.nama.includes('(Gold)')) return;
    if (o.saldo > 0) totalPahala += o.saldo;
    else if (o.saldo < 0) totalDosa += -o.saldo;
  });

  return {
    totalPahala: totalPahala,
    totalDosa: totalDosa,
    totalTransaksi: history.length,
    leaderboard: leaderboard,
    history: history.slice(-30).reverse(), // 30 transaksi terbaru
    kas: {
      saldo: kasData ? kasData.pahala - kasData.dosa : 0,
      history: kasData ? kasData.recent.slice(-30).reverse() : [],
      leaderboard: Object.keys(infaqMap)
        .map(nm => ({ nama: nm, foto: fotoMap[nm] || '', total: infaqMap[nm] }))
        .sort((a, b) => b.total - a.total)
    },
    deret: deretHarian_(rows, tz, fotoMap), // grafik saldo harian (modal desktop)
    katalog: KATALOG_KOPDOS,    // katalog belanja Kopdos Merah Putih
    resto: bacaSheetResto_(),   // urut termurah dulu; lihat modul infografis resto
    infaqMap: getInfaqMap_(),
    strukAlias: getStrukAlias_(),
    anggota: getAnggota(),
    bulanList: Object.keys(bulanSet).sort().reverse().map(k => ({ key: k, label: labelBulan_(k) }))
  };
}

/**
 * Laporan bulanan satu entitas (orang atau KAS) untuk bulan 'yyyy-MM'.
 * Read-only (tanpa lock). Angka infaq & ranking bersifat all-time (kumulatif).
 */
function getLaporanBulanan(nama, bulanKey) {
  nama = String(nama || '').trim();
  if (!nama) throw new Error('Nama wajib dipilih.');
  if (!/^\d{4}-\d{2}$/.test(String(bulanKey || ''))) throw new Error('Bulan tidak valid.');

  const tz = Session.getScriptTimeZone();
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 5).getValues(); // urut lama→baru

  const [yy, mm] = bulanKey.split('-').map(Number);
  const prevKey = Utilities.formatDate(new Date(yy, mm - 2, 1), tz, 'yyyy-MM');
  const asDate = ts => ts instanceof Date ? ts : new Date(ts);
  const mkey = ts => Utilities.formatDate(asDate(ts), tz, 'yyyy-MM');
  const fmtWaktu = ts => Utilities.formatDate(asDate(ts), tz, 'dd MMM yyyy • HH:mm');
  const base = {
    nama: nama,
    bulanKey: bulanKey,
    bulanLabel: labelBulan_(bulanKey),
    dibuat: Utilities.formatDate(new Date(), tz, 'dd MMM yyyy • HH:mm')
  };

  if (nama === KAS_NAMA) {
    let saldoAwal = 0, run = 0, pemasukan = 0, pengeluaran = 0, jml = 0;
    let prevMasuk = 0, prevKeluar = 0;
    const pengeluaranList = [];
    const infaqOrang = {}; // nama → infaq bulan ini (dari sisi pengirim)
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const dailyClose = new Array(daysInMonth).fill(null);

    rows.forEach(r => {
      const [ts, rnm, tipe, nominal, ket] = r;
      const val = Number(nominal) || 0;
      if (!val) return;
      const k = mkey(ts);
      const isDosa = tipe === 'Dosa';
      // Infaq per orang bulan ini: baris sisi PENGIRIM, nama = pengirim.
      if (k === bulanKey && isDosa && isKetInfaq_(ket) && String(rnm).trim() !== KAS_NAMA) {
        const p = String(rnm).trim();
        infaqOrang[p] = (infaqOrang[p] || 0) + val;
      }
      if (String(rnm).trim() !== KAS_NAMA) return;
      const delta = isDosa ? -val : val;
      if (k < bulanKey) {
        run += delta; saldoAwal = run;
        if (k === prevKey) { isDosa ? (prevKeluar += val) : (prevMasuk += val); }
      } else if (k === bulanKey) {
        run += delta; jml++;
        if (isDosa) { pengeluaran += val; pengeluaranList.push({ waktu: fmtWaktu(ts), keterangan: String(ket || ''), nominal: val, saldo: run }); }
        else pemasukan += val;
        dailyClose[Number(Utilities.formatDate(asDate(ts), tz, 'd')) - 1] = run;
      }
    });

    let carry = saldoAwal;
    const harian = dailyClose.map((v, i) => { if (v !== null) carry = v; return { hari: i + 1, saldo: carry }; });

    return Object.assign(base, {
      tipe: 'kas',
      saldoAwal: saldoAwal,
      saldoAkhir: saldoAwal + pemasukan - pengeluaran,
      perubahan: pemasukan - pengeluaran,
      pemasukan: pemasukan,
      pengeluaran: pengeluaran,
      selisih: pemasukan - pengeluaran,
      jumlahTransaksi: jml,
      prev: { pemasukan: prevMasuk, pengeluaran: prevKeluar },
      harian: harian,
      infaqPerOrang: Object.keys(infaqOrang).map(p => ({ nama: p, total: infaqOrang[p] })).sort((a, b) => b.total - a.total),
      pengeluaranList: pengeluaranList
    });
  }

  // ---- Laporan per orang ----
  let saldoAwal = 0, topUp = 0, peng = 0, infaqBulan = 0, jml = 0;
  let prevTopUp = 0, prevPeng = 0;
  const inBulan = [];
  const infaqMap = {}; // all-time, semua orang → total infaq (untuk ranking)

  rows.forEach(r => {
    const [ts, rnm, tipe, nominal, ket] = r;
    const val = Number(nominal) || 0;
    if (!val) return;
    const isDosa = tipe === 'Dosa';
    const p = String(rnm).trim();
    const isInfaq = isDosa && isKetInfaq_(ket) && p !== KAS_NAMA;
    if (isInfaq) infaqMap[p] = (infaqMap[p] || 0) + val; // ranking all-time
    if (p !== nama) return;
    const k = mkey(ts);
    if (k < bulanKey) {
      saldoAwal += isDosa ? -val : val;
      if (k === prevKey) { isDosa ? (prevPeng += val) : (prevTopUp += val); }
    } else if (k === bulanKey) {
      if (isDosa) peng += val; else topUp += val;
      if (isInfaq) infaqBulan += val;
      jml++;
      inBulan.push(r);
    }
  });

  let run = saldoAwal;
  const transaksi = inBulan.map(r => {
    const isDosa = r[2] === 'Dosa';
    const val = Number(r[3]) || 0;
    run += isDosa ? -val : val;
    return { waktu: fmtWaktu(r[0]), tipe: isDosa ? 'Dosa' : 'Pahala', nominal: val, keterangan: String(r[4] || ''), saldo: run };
  });

  const ranking = Object.keys(infaqMap).map(p => ({ nama: p, total: infaqMap[p] })).sort((a, b) => b.total - a.total);
  const idx = ranking.findIndex(x => x.nama === nama);

  return Object.assign(base, {
    tipe: 'orang',
    foto: fotoDataUri_(getFotoMap_()[nama] || ''), // data URI, bukan URL (lihat fotoDataUri_)
    saldoAwal: saldoAwal,
    saldoAkhir: saldoAwal + topUp - peng,
    perubahan: topUp - peng,
    totalTopUp: topUp,
    totalPengeluaran: peng,
    selisih: topUp - peng,
    infaqBulan: infaqBulan,
    infaqTotal: infaqMap[nama] || 0,   // all-time
    infaqRank: idx >= 0 ? idx + 1 : null,
    infaqPeserta: ranking.length,
    jumlahTransaksi: jml,
    prev: { totalTopUp: prevTopUp, totalPengeluaran: prevPeng, perubahan: prevTopUp - prevPeng },
    transaksi: transaksi
  });
}
/* =====================================================================
 * INFOGRAFIS HARGA RATA-RATA RESTO
 * ---------------------------------------------------------------------
 * Nama resto TIDAK punya kolom sendiri — ia hanya tersirat di kolom
 * Keterangan baris Dosa ('makan di Warung Mak Beng', 'warung mak beng',
 * 'Mak Beng'). Modul ini menebak resto dengan cara: normalisasi keterangan
 * → buang kata pengisi → kelompokkan varian yang mirip → resto = kelompok
 * yang cukup sering muncul (>= RESTO_MIN_TRX transaksi).
 *
 * Harga rata-rata dihitung SETELAH membuang transaksi borongan (satu
 * transaksi berisi banyak menu) memakai median + MAD, bukan rata-rata +
 * simpangan baku: dengan sampel ~10 transaksi, satu nilai borongan yang
 * ekstrem ikut menggeser rata-rata dan simpangan bakunya sendiri sehingga
 * outlier justru lolos. Median & MAD kebal terhadap itu.
 *
 * Pembaruan:
 * - OTOMATIS (di dalam submitAmalan/submitAmalanBatch) hanya kalau
 *   keterangan yang baru masuk cocok dengan resto yang SUDAH ada di sheet.
 * - MANUAL untuk resto baru: jalankan refreshResto() dari editor Apps
 *   Script (Run > refreshResto), atau tambahResto('nama') untuk memaksa
 *   sebuah resto masuk daftar walau transaksinya belum 10.
 * ===================================================================== */

const SHEET_RESTO = 'Resto';

/** Minimal transaksi agar sebuah kelompok keterangan diakui sebagai resto
 *  pada pemindaian otomatis. Resto yang sudah ada barisnya di sheet Resto
 *  (termasuk hasil tambahResto) tetap dipertahankan walau di bawah ambang. */
const RESTO_MIN_TRX = 10;

/** Ambang outlier: buang nominal yang jaraknya > K x MAD dari median.
 *  K = 3 kira-kira setara "3 simpangan baku" versi tahan-outlier. Setel di
 *  sini setelah melihat sebaran asli lewat debugResto(). */
const RESTO_MAD_K = 3;

/** Lebar band minimal sebagai pecahan median (lihat statistikResto_). */
const RESTO_BAND_MIN = 0.35;

/** Kata pengisi di awal/akhir keterangan yang bukan bagian nama resto. */
const RESTO_STOPWORD = [
  'makan', 'mkn', 'mam', 'makanan', 'jajan', 'jajanan', 'beli', 'bayar',
  'bayarin', 'traktir', 'traktiran', 'ditraktir', 'sarapan', 'brunch',
  'lunch', 'dinner', 'siang', 'malam', 'pagi', 'sore', 'di', 'ke', 'dari',
  'utang', 'hutang', 'split', 'bill', 'tagihan', 'pesan', 'order', 'pesen',
  'gofood', 'grabfood', 'shopeefood', 'delivery', 'takeaway', 'ta', 'nongkrong',
  'maksi', 'maksia', 'mamsi', 'mardun', 'buka', 'sahur'
];

/** Keterangan yang memuat salah satu kata ini bukan belanja makan sama sekali
 *  (migrasi saldo, langganan, tarik tunai, biaya admin). Dicek pada kunci yang
 *  sudah dinormalisasi, jadi cukup tulis dalam huruf kecil. */
const RESTO_BUKAN_BELANJA = [
  'migrasi', 'netflix', 'spotify', 'youtube', 'langganan', 'gestun', 'tartun',
  'tarik tunai', 'transfer', 'topup', 'top up', 'saldo', 'admin', 'kas',
  'tissue', 'tisu', 'tip', 'parkir', 'bensin', 'pulsa', 'listrik', 'gaji',
  'kopdos'  // belanja katalog koperasi, bukan makan di resto
];

/** Kata yang terlalu umum untuk dipakai menyatukan dua nama tempat. 'kopi'
 *  sendirian pernah menggabungkan 'kopi dari hati' + 'kopi toko djawa' jadi
 *  satu resto — tiga tempat berbeda. Kunci yang SELURUH katanya generik tidak
 *  boleh menyerap kunci lain. */
const RESTO_GENERIK = [
  'kopi', 'coffee', 'kafe', 'cafe', 'sate', 'satay', 'jus', 'juice', 'teh',
  'susu', 'nasi', 'nasgor', 'mie', 'mi', 'bakmi', 'ayam', 'ikan', 'sayur',
  'bakso', 'soto', 'roti', 'martabak', 'dimsum', 'es', 'aqua', 'air',
  'makan', 'minum', 'snack', 'warung', 'warteg', 'kedai', 'resto', 'restoran'
];

/** Keterangan yang jelas bukan aktivitas beli makan (transfer & infaq). */
function bukanKetResto_(ket) {
  const s = String(ket || '');
  return !s.trim() || isKetInfaq_(s) ||
    s.indexOf('Transfer pahala ke ') === 0 || s.indexOf('Transfer pahala dari ') === 0;
}

/**
 * Keterangan mentah → kunci ternormalisasi ('' kalau tak layak dipakai).
 * Huruf kecil, tanda baca & angka dibuang, kata pengisi di ujung dipangkas.
 */
function normalisasiResto_(ket) {
  if (bukanKetResto_(ket)) return '';
  let s = String(ket).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')     // tanda baca → spasi
    .replace(/\b\d+\b/g, ' ')          // token angka murni (tanggal, nominal)
    .replace(/\s+/g, ' ')
    .trim();
  let kata = s.split(' ').filter(Boolean);
  while (kata.length && RESTO_STOPWORD.indexOf(kata[0]) >= 0) kata.shift();
  while (kata.length && RESTO_STOPWORD.indexOf(kata[kata.length - 1]) >= 0) kata.pop();
  const kunci = kata.join(' ');
  if (!kunci) return '';
  const berpagar = ' ' + kunci + ' ';
  if (RESTO_BUKAN_BELANJA.some(w => berpagar.indexOf(' ' + w + ' ') >= 0)) return '';
  return kunci;
}

/** Seluruh katanya kata umum → tidak layak jadi induk penggabungan. */
function kunciGenerik_(k) {
  const kata = k.split(' ').filter(Boolean);
  return kata.length > 0 && kata.every(w => RESTO_GENERIK.indexOf(w) >= 0);
}

/** 'kopi toko djawa' → 'Kopi Toko Djawa'. Label diambil dari kunci, bukan dari
 *  keterangan mentah, supaya konsisten dan bebas karakter aneh. */
function judulResto_(k) {
  return k.split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Apakah dua kunci resto merujuk tempat yang sama? Dipakai untuk menyatukan
 * varian ejaan ('warung mak beng' vs 'mak beng' vs 'warung mak beng sanur').
 * Cocok kalau salah satu memuat yang lain sebagai frasa, atau himpunan
 * katanya beririsan cukup banyak (Jaccard >= 0.6 / subset penuh).
 */
function restoMirip_(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Kunci yang isinya kata umum saja ('kopi', 'sate') tidak boleh menyerap yang
  // lain — itu nama jenis makanan, bukan nama tempat.
  if (kunciGenerik_(a) || kunciGenerik_(b)) return false;
  if ((' ' + a + ' ').indexOf(' ' + b + ' ') >= 0) return true;
  if ((' ' + b + ' ').indexOf(' ' + a + ' ') >= 0) return true;
  const ta = a.split(' ').filter(w => w.length >= 3 && RESTO_GENERIK.indexOf(w) < 0);
  const tb = b.split(' ').filter(w => w.length >= 3 && RESTO_GENERIK.indexOf(w) < 0);
  if (!ta.length || !tb.length) return false;
  const setB = {};
  tb.forEach(w => { setB[w] = true; });
  let irisan = 0;
  ta.forEach(w => { if (setB[w]) irisan++; });
  if (!irisan) return false;
  if (irisan === ta.length || irisan === tb.length) return true; // subset penuh
  return irisan / (ta.length + tb.length - irisan) >= 0.6;
}

function median_(arrTerurut) {
  const n = arrTerurut.length;
  if (!n) return 0;
  const t = n >> 1;
  return n % 2 ? arrTerurut[t] : (arrTerurut[t - 1] + arrTerurut[t]) / 2;
}

/**
 * Nominal satu resto → statistik harga sekali makan, tanpa transaksi borongan.
 * Buang nilai yang |v - median| > K x MAD. Kalau MAD = 0 (nominal seragam),
 * pakai batas ±50% median. Kalau sisanya < 3, pakai semua — lebih baik angka
 * kasar daripada rata-rata dari 1-2 data.
 */
function statistikResto_(nominals) {
  const s = nominals.slice().sort((a, b) => a - b);
  const med = median_(s);
  const dev = s.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median_(dev);
  // Lantai band: MAD bisa nyaris 0 kalau banyak nominal kembar (split tagihan
  // rata), dan 3 x MAD lantas membuang harga yang masih sangat wajar. Band
  // minimal +-35% median menjaga itu tanpa melonggarkan kasus normal.
  const batas = Math.max(RESTO_MAD_K * mad, med * RESTO_BAND_MIN);
  let pakai = s.filter(v => Math.abs(v - med) <= batas);
  if (pakai.length < 3) pakai = s;
  const total = pakai.reduce((a, b) => a + b, 0);
  return {
    jumlah: s.length,
    dipakai: pakai.length,
    rata: Math.round(total / pakai.length),
    min: pakai[0],
    max: pakai[pakai.length - 1]
  };
}

/**
 * Pindai seluruh sheet Transaksi → daftar kelompok resto.
 * kunciWajib = daftar kunci yang tetap dipertahankan walau di bawah minTrx
 * (yaitu resto yang sudah tercatat di sheet Resto / ditambah manual).
 */
function pindaiResto_(minTrx, kunciWajib) {
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 5).getValues();

  // 1. Kumpulkan varian keterangan: kunci → { label mentah terpopuler, nominal[] }
  const varian = {};
  rows.forEach(r => {
    const [, , tipe, nominal, ket] = r;
    if (tipe !== 'Dosa') return;                 // beli makan selalu tercatat Dosa
    const val = Number(nominal) || 0;
    if (val <= 0) return;
    const kunci = normalisasiResto_(ket);
    if (!kunci) return;
    if (!varian[kunci]) varian[kunci] = { kunci: kunci, nominals: [] };
    varian[kunci].nominals.push(val);
  });

  // 2. Gabungkan varian yang mirip — varian tersering jadi induk kelompok.
  const urut = Object.keys(varian).sort((a, b) =>
    varian[b].nominals.length - varian[a].nominals.length || a.length - b.length);
  const grup = [];
  urut.forEach(k => {
    const v = varian[k];
    const induk = grup.filter(g => restoMirip_(g.kunci, k))[0];
    if (induk) {
      induk.varian.push(k);
      induk.nominals.push.apply(induk.nominals, v.nominals);
    } else {
      grup.push({ kunci: k, varian: [k], nominals: v.nominals.slice() });
    }
  });

  // 3. Saring: cukup sering, atau memang sudah terdaftar di sheet Resto.
  const wajib = kunciWajib || [];
  const ambang = Number(minTrx) > 0 ? Number(minTrx) : RESTO_MIN_TRX;
  return grup
    .filter(g => g.nominals.length >= ambang ||
      wajib.some(w => g.varian.indexOf(w) >= 0 || restoMirip_(g.kunci, w)))
    .map(g => {
      const st = statistikResto_(g.nominals);
      return {
        nama: judulResto_(g.kunci), kunci: g.kunci, varian: g.varian.join(' | '),
        jumlah: st.jumlah, dipakai: st.dipakai,
        rata: st.rata, min: st.min, max: st.max
      };
    })
    .sort((a, b) => a.rata - b.rata);   // termurah dulu
}

/** Baris sheet Resto → objek (dipakai dashboard & sebagai daftar kunci wajib). */
function bacaSheetResto_() {
  const sheet = getSheet_(SHEET_RESTO);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 9).getValues()
    .map(r => ({
      nama: String(r[0]).trim(),
      kunci: String(r[1]).trim(),
      varian: String(r[2]).trim(),
      jumlah: Number(r[3]) || 0,
      dipakai: Number(r[4]) || 0,
      rata: Number(r[5]) || 0,
      min: Number(r[6]) || 0,
      max: Number(r[7]) || 0,
      update: r[8] instanceof Date
        ? Utilities.formatDate(r[8], Session.getScriptTimeZone(), 'dd MMM yyyy • HH:mm')
        : String(r[8] || '')
    }))
    .filter(o => o.nama)
    .sort((a, b) => a.rata - b.rata);
}

const RESTO_HEADER = ['Nama Resto', 'Kunci', 'Varian Keterangan', 'Jumlah Transaksi',
  'Dipakai (tanpa borongan)', 'Rata-rata', 'Termurah', 'Termahal', 'Terakhir Update'];

/** Tulis ulang seluruh isi sheet Resto. */
function tulisSheetResto_(list) {
  const sheet = getSheet_(SHEET_RESTO);
  sheet.clear();
  sheet.getRange(1, 1, 1, RESTO_HEADER.length).setValues([RESTO_HEADER]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (!list.length) return;
  const now = new Date();
  sheet.getRange(2, 1, list.length, RESTO_HEADER.length).setValues(list.map(o =>
    [o.nama, o.kunci, o.varian, o.jumlah, o.dipakai, o.rata, o.min, o.max, now]));
}

/**
 * Hitung ulang seluruh daftar resto dan simpan ke sheet Resto.
 * JALANKAN MANUAL dari editor Apps Script untuk memunculkan resto BARU
 * (yang transaksinya belum 10). Contoh: refreshResto(4) → ambang 4 transaksi.
 */
function refreshResto(minTrx) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const kunciWajib = bacaSheetResto_().map(o => o.kunci).filter(Boolean);
    const list = pindaiResto_(minTrx, kunciWajib);
    tulisSheetResto_(list);
    return list;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Paksa satu resto masuk daftar walau transaksinya belum RESTO_MIN_TRX.
 * Jalankan dari editor Apps Script: tambahResto('Warung Mak Beng').
 * Sekali masuk, resto ini ikut diperbarui otomatis seperti yang lain.
 */
function tambahResto(nama) {
  const label = String(nama || '').trim();
  if (!label) throw new Error('Nama resto wajib diisi.');
  const kunci = normalisasiResto_(label);
  if (!kunci) throw new Error('Nama resto tidak valid setelah dinormalisasi.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const wajib = bacaSheetResto_().map(o => o.kunci).filter(Boolean);
    if (!wajib.some(k => restoMirip_(k, kunci))) wajib.push(kunci);
    const list = pindaiResto_(RESTO_MIN_TRX, wajib);
    if (!list.some(o => restoMirip_(o.kunci, kunci))) {
      throw new Error('Belum ada transaksi Dosa dengan keterangan "' + label + '".');
    }
    tulisSheetResto_(list);
    return list;
  } finally {
    lock.releaseLock();
  }
}

/** Hapus satu resto dari daftar (mis. salah tangkap). */
function hapusResto(nama) {
  const kunci = normalisasiResto_(nama);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sisa = bacaSheetResto_().filter(o => !restoMirip_(o.kunci, kunci));
    tulisSheetResto_(sisa);
    return sisa;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Dipanggil setelah transaksi baru tersimpan. Perbarui daftar resto HANYA
 * kalau ada keterangan baru yang cocok dengan resto yang sudah terdaftar —
 * resto baru sengaja tidak ikut, itu urusan refreshResto() manual.
 * Kegagalan di sini tidak boleh menggagalkan pencatatan amalan.
 */
function perbaruiRestoOtomatis_(ketList) {
  try {
    const kunciBaru = (ketList || []).map(normalisasiResto_).filter(Boolean);
    if (!kunciBaru.length) return;
    const terdaftar = bacaSheetResto_();
    if (!terdaftar.length) return;
    const adaYangCocok = kunciBaru.some(kb =>
      terdaftar.some(o => o.kunci && restoMirip_(o.kunci, kb)));
    if (!adaYangCocok) return;
    const list = pindaiResto_(RESTO_MIN_TRX, terdaftar.map(o => o.kunci).filter(Boolean));
    tulisSheetResto_(list);
  } catch (e) {
    console.error('perbaruiRestoOtomatis_ gagal: ' + (e && e.message));
  }
}

/**
 * Diagnostik — jalankan dari editor Apps Script lalu lihat Execution log.
 * Menampilkan sebaran nominal tiap kandidat resto beserta nilai yang dibuang,
 * untuk menyetel RESTO_MAD_K & RESTO_MIN_TRX dengan data asli.
 */
function debugResto() {
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 5).getValues();
  const varian = {};
  rows.forEach(r => {
    const [, , tipe, nominal, ket] = r;
    if (tipe !== 'Dosa') return;
    const val = Number(nominal) || 0;
    if (val <= 0) return;
    const k = normalisasiResto_(ket);
    if (!k) return;
    (varian[k] = varian[k] || []).push(val);
  });
  const kandidat = Object.keys(varian).sort((a, b) => varian[b].length - varian[a].length);
  console.log('=== ' + kandidat.length + ' kandidat keterangan (sebelum digabung) ===');
  kandidat.slice(0, 60).forEach(k => {
    const st = statistikResto_(varian[k]);
    console.log(varian[k].length + 'x | ' + k + ' | rata=' + st.rata +
      ' | dipakai=' + st.dipakai + '/' + st.jumlah +
      ' | nominal=[' + varian[k].slice().sort((a, b) => a - b).join(', ') + ']');
  });
  const hasil = pindaiResto_(RESTO_MIN_TRX, bacaSheetResto_().map(o => o.kunci));
  console.log('=== ' + hasil.length + ' resto lolos ambang ' + RESTO_MIN_TRX + ' transaksi ===');
  hasil.forEach(o => console.log(o.nama + ' → Rp' + o.rata +
    ' (' + o.dipakai + '/' + o.jumlah + ' transaksi, ' + o.min + '–' + o.max + ')'));
  return hasil;
}
