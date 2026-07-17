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
const GEMINI_MODEL = 'gemini-2.5-flash';

/** API key Gemini disimpan di Script Properties (Project Settings > Script
 *  Properties di editor Apps Script), BUKAN di source code — lihat GAPS.md #1
 *  soal kenapa hardcode key itu buruk. */
function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

/**
 * Baca foto struk/screenshot split tagihan lewat Gemini Vision, balikin daftar
 * {nama, nominal} per orang (baris 'You'/'Anda'/host sendiri difilter oleh
 * prompt). Nama hasil OCR belum tentu cocok dengan roster Anggota — pencocokan
 * & konfirmasi akhir dilakukan di klien (dropdown per baris), fungsi ini cuma OCR.
 */
function parseStruk(base64, mimeType) {
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('Fitur baca struk belum diaktifkan (GEMINI_API_KEY belum diatur).');
  if (!base64) throw new Error('Gambar struk kosong.');
  const tipe = String(mimeType || '').trim();
  if (tipe.indexOf('image/') !== 0) throw new Error('File harus berupa gambar.');

  const prompt = 'Ini screenshot daftar split tagihan/utang. Setiap baris berisi nama ' +
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
          properties: { nama: { type: 'STRING' }, nominal: { type: 'NUMBER' } },
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
    .map(it => ({ nama: String(it.nama || '').trim(), nominal: Math.round(Number(it.nominal)) || 0 }))
    .filter(it => it.nama && it.nominal > 0)
    .slice(0, 50);
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
      // Infaq otomatis: entri Dosa manual dari orang yang punya nominal infaq
      // (kolom C > 0) memicu transfer nominal itu ke KAS. Barisnya ditulis
      // langsung (bukan lewat submitAmalan lagi), jadi tidak memicu berantai.
      const infaqNominal = tipe === 'Dosa' && nama !== KAS_NAMA
        ? (getInfaqMap_()[nama] || 0) : 0;
      if (infaqNominal > 0) {
        const ketDosaKet = ket || 'infaq otomatis';
        const ketDosa = KET_INFAQ_BARU + ketDosaKet;
        const ketPahalaKas = nama + ' - ' + ketDosaKet;
        sheet.getRange(sheet.getLastRow() + 1, 1, 2, 5).setValues([
          [now, nama, 'Dosa', infaqNominal, ketDosa],
          [now, KAS_NAMA, 'Pahala', infaqNominal, ketPahalaKas]
        ]);
      }
    }
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
      if (nm !== KAS_NAMA && isKetInfaq_(ket)) {
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
    infaqMap: getInfaqMap_(),
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