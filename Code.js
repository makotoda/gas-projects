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
// Infaq = transfer biasa ke KAS; leaderboard kas dihitung dari prefix
// keterangan 'Transfer pahala ke KAS' (transfer tidak punya tipe sendiri).
const KAS_NAMA = 'KAS';
// Nominal infaq otomatis per entri Dosa manual, untuk orang yang langganan
// (kolom C 'Infaq' di sheet Anggota berisi 1). Kesepakatan polling Jul 2026.
const INFAQ_NOMINAL = 500;

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
      // Infaq otomatis: entri Dosa manual dari orang yang langganan memicu
      // transfer INFAQ_NOMINAL ke KAS. Barisnya ditulis langsung (bukan lewat
      // submitAmalan lagi), jadi tidak bisa memicu berantai.
      if (tipe === 'Dosa' && nama !== KAS_NAMA && getInfaqList_().indexOf(nama) !== -1) {
        sheet.getRange(sheet.getLastRow() + 1, 1, 2, 5).setValues([
          [now, nama, 'Dosa', INFAQ_NOMINAL, 'Transfer pahala ke ' + KAS_NAMA + ' — infaq otomatis'],
          [now, KAS_NAMA, 'Pahala', INFAQ_NOMINAL, 'Transfer pahala dari ' + nama + ' — infaq otomatis']
        ]);
      }
    }
  } finally {
    lock.releaseLock();
  }
  return getDashboardData();
}

/** Daftar nama yang langganan infaq otomatis (kolom C 'Infaq' berisi nilai truthy) */
function getInfaqList_() {
  const sheet = getSheet_(SHEET_ANGGOTA);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 3).getValues()
    .filter(r => r[2])
    .map(r => String(r[0]).trim())
    .filter(n => n && n !== KAS_NAMA);
}

/** Simpan daftar langganan infaq otomatis (centang di menu Kas) ke kolom C Anggota */
function saveInfaqList(namaList) {
  const dipilih = {};
  (Array.isArray(namaList) ? namaList : []).forEach(n => { dipilih[String(n).trim()] = true; });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_ANGGOTA);
    sheet.getRange(1, 3).setValue('Infaq');
    const last = sheet.getLastRow();
    if (last >= 2) {
      const nama = sheet.getRange(2, 1, last - 1, 1).getValues();
      sheet.getRange(2, 3, last - 1, 1)
        .setValues(nama.map(r => [dipilih[String(r[0]).trim()] ? 1 : '']));
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
  const infaqMap = {}; // nama → total infaq ke KAS
  const bulanSet = {}; // 'yyyy-MM' yang punya transaksi (utk pemilih laporan)
  const history = [];
  const KET_INFAQ = 'Transfer pahala ke ' + KAS_NAMA;

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
      totalDosa += val;
      if (String(ket || '').indexOf(KET_INFAQ) === 0) {
        infaqMap[nm] = (infaqMap[nm] || 0) + val;
      }
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
    infaqList: getInfaqList_(),
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

  const KET_INFAQ = 'Transfer pahala ke ' + KAS_NAMA;
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
      // Infaq per orang bulan ini: baris sisi PENGIRIM ('ke KAS'), nama = pengirim.
      if (k === bulanKey && isDosa && String(ket || '').indexOf(KET_INFAQ) === 0) {
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
    const isInfaq = isDosa && String(ket || '').indexOf(KET_INFAQ) === 0;
    const p = String(rnm).trim();
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
    foto: getFotoMap_()[nama] || '',
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