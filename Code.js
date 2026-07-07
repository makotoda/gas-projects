/**
 * KODOMO — Aplikasi Pencatat Amalan (Pahala & Dosa)
 * Google Apps Script Web App — v2
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

const DEFAULT_ANGGOTA = [
  'Ajeng', 'Andik', 'Andri', 'Ari', 'Aris', 'Ayu', 'Budek Yudha', 'Dayu',
  'Dini', 'Fitri', 'Gede', 'Gusde', 'Hari', 'Hera', 'Imam', 'Jana',
  'Jerome', 'Kadek', 'Khresna', 'Komang', 'Kumala', 'Lilik', 'Maria',
  'Ochi', 'Pera', 'Putri', 'Putu Ardhi', 'Putu Jaya', 'Raditya', 'Ratna',
  'Rere', 'Riski', 'Rofikoh', 'Siwi', 'Surya', 'Teja', 'Wesh', 'Wulan',
  'Yanti', 'Yudha'
];

/** Entry point web app */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Kodomo — Pencatat Amalan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

  let agt = ss.getSheetByName(SHEET_ANGGOTA);
  if (!agt) {
    agt = ss.insertSheet(SHEET_ANGGOTA);
    agt.getRange(1, 1).setValue('Nama').setFontWeight('bold');
    agt.setFrozenRows(1);
    agt.getRange(2, 1, DEFAULT_ANGGOTA.length, 1)
      .setValues(DEFAULT_ANGGOTA.map(n => [n]));
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

/** Validasi nominal */
function parseNominal_(raw) {
  const nominal = Number(raw);
  if (!nominal || nominal <= 0) throw new Error('Nominal harus angka lebih dari 0.');
  return nominal;
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
    }
  } finally {
    lock.releaseLock();
  }
  return getDashboardData();
}

/** Data lengkap untuk dashboard: statistik, leaderboard (+5 transaksi terakhir per orang), riwayat */
function getDashboardData() {
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] :
    sheet.getRange(2, 1, last - 1, 5).getValues();

  const tz = Session.getScriptTimeZone();
  let totalPahala = 0;
  let totalDosa = 0;
  const saldoMap = {};
  const history = [];

  rows.forEach(r => {
    const [ts, nama, tipe, nominal, ket] = r;
    const nm = String(nama).trim();
    const val = Number(nominal) || 0;
    if (!nm || !val) return;

    if (!saldoMap[nm]) saldoMap[nm] = { nama: nm, pahala: 0, dosa: 0, recent: [] };

    const isDosa = tipe === 'Dosa';
    if (isDosa) {
      saldoMap[nm].dosa += val;
      totalDosa += val;
    } else {
      saldoMap[nm].pahala += val;
      totalPahala += val;
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

  const leaderboard = Object.values(saldoMap)
    .map(o => ({
      nama: o.nama,
      pahala: o.pahala,
      dosa: o.dosa,
      saldo: o.pahala - o.dosa,
      recent: o.recent.slice(-5).reverse() // 5 transaksi terakhir, terbaru dulu
    }))
    .sort((a, b) => b.saldo - a.saldo);

  return {
    totalPahala: totalPahala,
    totalDosa: totalDosa,
    totalTransaksi: history.length,
    leaderboard: leaderboard,
    history: history.slice(-30).reverse(), // 30 transaksi terbaru
    anggota: getAnggota()
  };
}