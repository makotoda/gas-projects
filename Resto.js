/**
 * KODOMO — infografis harga rata-rata resto (deteksi nama dari Keterangan,
 * pembuangan transaksi borongan, cache di sheet Resto).
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

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
