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
 * bebas: 0812…, +62 812…, 62812…). Jalankan pasangBotWa() sekali dari editor.
 *
 * Bagian dari proyek Kodomo — namespace global bersama.
 */

const WA_PROP_TOKEN = 'WA_BOT_TOKEN';
const WA_KOLOM_NOMOR = 4;

function doPost(e) {
  let hasil;
  try {
    hasil = topUpDariWa_(JSON.parse(e.postData.contents));
  } catch (err) {
    hasil = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(hasil))
    .setMimeType(ContentService.MimeType.JSON);
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
  const cocok = sheet.getRange(2, 1, last - 1, WA_KOLOM_NOMOR).getValues()
    .filter(r => normalisasiNomorWa_(r[WA_KOLOM_NOMOR - 1]) === n)[0];
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
    keterangan: 'Top-up via WA' + (it.bank ? ' · ' + it.bank : '') + ' · pengirim: ' + it.nama
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
