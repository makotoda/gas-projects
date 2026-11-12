/**
 * KODOMO — top-up dari bot WhatsApp (proyek terpisah `wa-bukti-transfer`).
 *
 * Bot mengirim bukti transfer yang masuk lewat chat pribadi ke doPost. Di sini
 * gambar dibaca dengan parseStruk lalu Pahala-nya LANGSUNG ditulis — sengaja
 * tidak lewat ajukanTopUp, jadi verifikasi notifikasi bank / persetujuan admin
 * (TopUp.js) TIDAK berlaku untuk jalur WA.
 *
 * Dijaga token di Script Property WA_BOT_TOKEN; tanpa token, endpoint menolak
 * semua permintaan. Nomor WA anggota di kolom D 'WA' sheet Anggota (format
 * bebas: 0812…, +62 812…, 62812…; beberapa nomor dipisah koma). Jalankan
 * pasangBotWa() sekali dari editor.
 *
 * Bagian dari proyek Kodomo — namespace global bersama.
 */

const WA_PROP_TOKEN = 'WA_BOT_TOKEN';
const WA_KOLOM_NOMOR = 4;

const SHEET_WA_LOG = 'WA Log';
const WA_LOG_HEADER = ['Waktu', 'Nomor', 'Nama', 'Hasil', 'Nominal', 'Catatan'];
const WA_LOG_MAKS = 300;

function doPost(e) {
  let hasil, p = {};
  try {
    p = JSON.parse(e.postData.contents) || {};
    hasil = topUpDariWa_(p);
  } catch (err) {
    hasil = { ok: false, error: err.message };
  }
  catatLogWa_(p, hasil);
  return ContentService.createTextOutput(JSON.stringify(hasil))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Satu baris per kiriman bot (terbaru di baris 2) — satu-satunya jejak yang
 * bisa dibaca admin tanpa membuka log eksekusi Apps Script. Kalau bukti
 * seseorang "tidak terdeteksi": tidak ada barisnya → bot tak pernah mengirim;
 * 'tidak terdaftar' → nomor WA belum/salah di kolom D Anggota (atau bot
 * mengirim ID WhatsApp, bukan nomor HP). Gambar tidak disimpan. Gagal mencatat
 * tidak boleh menggagalkan top-up.
 */
function catatLogWa_(p, hasil) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SHEET_WA_LOG);
    if (!sh) {
      sh = ss.insertSheet(SHEET_WA_LOG);
      sh.getRange(1, 1, 1, WA_LOG_HEADER.length).setValues([WA_LOG_HEADER]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const h = hasil || {};
    const status = h.error ? 'galat' : h.terdaftar === false ? 'tidak terdaftar' : (h.hasil || '');
    sh.insertRowBefore(2);
    sh.getRange(2, 1, 1, WA_LOG_HEADER.length).setValues([[
      new Date(), "'" + String(p.nomor || ''), h.nama || '', status, h.nominal || '',
      h.error || (p.base64 ? '' : 'tanpa gambar')
    ]]);
    if (sh.getLastRow() > WA_LOG_MAKS + 1) sh.deleteRows(WA_LOG_MAKS + 2, sh.getLastRow() - WA_LOG_MAKS - 1);
  } catch (err) {
    console.warn('Log WA gagal: ' + err.message);
  }
}

/** '0812-345', '+62 812 345', '812345' → '62812345' */
function normalisasiNomorWa_(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('0') === 0) return '62' + d.slice(1);
  if (d.indexOf('8') === 0) return '62' + d;
  return d;
}

/** Nama anggota pemilik nomor WA, atau '' kalau tidak terdaftar. */
function namaDariNomorWa_(nomor) {
  const n = normalisasiNomorWa_(nomor);
  if (!n) return '';
  const sheet = getSheet_(SHEET_ANGGOTA);
  const last = sheet.getLastRow();
  if (last < 2) return '';
  // Satu sel boleh berisi beberapa nomor, dipisah koma / titik koma / baris baru.
  const cocok = sheet.getRange(2, 1, last - 1, WA_KOLOM_NOMOR).getValues()
    .filter(r => String(r[WA_KOLOM_NOMOR - 1]).split(/[,;\n]/)
      .some(x => normalisasiNomorWa_(x) === n))[0];
  return cocok ? String(cocok[0]).trim() : '';
}

/**
 * p = { token, nomor, base64, mimeType }.
 * Balikan { ok, terdaftar, nama, nominal, hasil: 'langsung'|'terverifikasi'|'menunggu'|'bukan-bukti' }.
 */
function topUpDariWa_(p) {
  const token = String(PropertiesService.getScriptProperties().getProperty(WA_PROP_TOKEN) || '').trim();
  if (!token || String(p && p.token || '') !== token) throw new Error('Token bot WA salah.');

  const nama = namaDariNomorWa_(p.nomor);
  if (!nama || nama === KAS_NAMA) return { ok: true, terdaftar: false };

  // ponytail: hanya transfer pertama di gambar; bukti TF praktis selalu satu transfer.
  const it = parseStruk(p.base64, p.mimeType, 'transfer')[0];
  if (!it) return { ok: true, terdaftar: true, nama: nama, hasil: 'bukan-bukti' };

  // Keputusan pemilik: top-up via WA langsung masuk TANPA verifikasi bank/admin —
  // nomor WA terdaftar dianggap cukup. Bukti hasil edit / dikirim dua kali ikut masuk.
  submitAmalanBatch([{
    nama: nama,
    tipe: 'Pahala',
    nominal: it.nominal,
    keterangan: 'Top-up via WA' + (it.bank ? ' · ' + it.bank : '') + (it.nama ? ' · pengirim: ' + it.nama : '')
  }]);
  return { ok: true, terdaftar: true, nama: nama, nominal: it.nominal, hasil: 'langsung' };
}

/** Jalankan SEKALI dari editor: buat token bot + kolom 'WA' di Anggota. Aman diulang. */
function pasangBotWa() {
  const props = PropertiesService.getScriptProperties();
  let token = String(props.getProperty(WA_PROP_TOKEN) || '').trim();
  if (!token) {
    token = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(WA_PROP_TOKEN, token);
  }
  getSheet_(SHEET_ANGGOTA).getRange(1, WA_KOLOM_NOMOR).setValue('WA').setFontWeight('bold');
  console.log('Isi KODOMO_TOKEN di .env bot dengan: ' + token);
  return token;
}
