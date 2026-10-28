/**
 * KODOMO — Pesanan Masuk: invoice GrabFood (e-receipt email) dibagi per orang
 * dengan rumus yang sama seperti aplikasi Grab, lalu dicatat sebagai Dosa.
 *
 * Alur: parseInvoiceGrab (Gemini membaca gambar invoice) → baris 'menunggu' di
 * sheet Pesanan → admin menetapkan pemilik tiap menu di Kodomo → simpanPesanan
 * menghitung ulang di server dan menulis baris Dosa.
 *
 * Rumus Grab (dicocokkan dengan order nyata 28 Okt 2026, selisih ≤ Rp1/orang):
 * - diskon MENU (promo, diskon group order, diskon minimal pesanan) dibagi
 *   PRORATA terhadap harga menu tiap orang;
 * - biaya BERSAMA (ongkir, biaya pemesanan/layanan, tip, kemasan) DIKURANGI
 *   diskon biaya (mis. "Diskon ongkir") lalu dibagi RATA ke semua pemesan;
 * - dibulatkan ke bawah, sisa rupiah ke pecahan terbesar → jumlah semua porsi
 *   SELALU sama persis dengan total tagihan.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global.
 */

const SHEET_PESANAN = 'Pesanan';
const PESANAN_HEADER = ['Pesanan ID', 'Waktu', 'Resto', 'Total', 'Status', 'Detail (JSON)', 'Diperbarui'];
const STATUS_PESANAN_MENUNGGU = 'menunggu';
const STATUS_PESANAN_TERCATAT = 'tercatat';
const STATUS_PESANAN_DIABAIKAN = 'diabaikan';

/** Penanda "porsi admin sendiri": ikut dihitung sebagai pemesan (biaya bersama
 *  dibagi termasuk dia, persis seperti Grab), tapi TIDAK ditulis sebagai Dosa
 *  — sama dengan perilaku upload struk yang membuang baris "You". */
const PESANAN_SAYA = '__SAYA__';

/**
 * TITIPAN: teman yang tidak terdaftar di Kodomo sering "nitip" lewat satu
 * anggota (atau lewat admin). Di Grab ia tetap pemesan terpisah — ikut
 * menanggung bagian ongkir sendiri — jadi di sini satu nama boleh punya
 * beberapa SLOT: 'dita', 'dita#2', '__SAYA__#2', dst. Rumus memperlakukan tiap
 * slot sebagai satu pemesan; saat dicatat, semua slot satu nama DIJUMLAHKAN
 * menjadi satu baris Dosa atas nama itu (dialah yang menagih temannya).
 */
function namaDasarSlot_(slot) {
  return String(slot || '').replace(/#\d+$/, '');
}

/* ---------------------------------------------------------------------------
 * Hitungan pembagian — fungsi murni, tanpa API GAS.
 *
 * ADA SALINANNYA di JsPesanan.html (pratinjau langsung di layar). Keduanya
 * diapit penanda <bagi-pesanan> dan diuji setara oleh tools/uji-bagi.cjs —
 * ubah keduanya bersamaan, lalu jalankan uji itu. Server tetap penentu akhir:
 * simpanPesanan menghitung ulang dan menolak kalau angka layar berbeda.
 * ------------------------------------------------------------------------- */
// <bagi-pesanan>
/** Pecah tiap baris menu menjadi unit (qty 2 → 2 unit) supaya tiap unit bisa
 *  dimiliki orang berbeda. Harga baris dibagi rata; sisa rupiah ke unit awal. */
function unitPesanan_(detail) {
  const units = [];
  (detail.items || []).forEach((it, i) => {
    const qty = Math.max(1, Math.floor(Number(it.qty)) || 1);
    const harga = Math.round(Number(it.harga)) || 0;
    const dasar = Math.floor(harga / qty);
    const lebih = harga - dasar * qty;
    for (let k = 0; k < qty; k++) {
      units.push({ item: i, nama: String(it.nama || ''), harga: dasar + (k < lebih ? 1 : 0) });
    }
  });
  return units;
}

/**
 * penugasan[i] = nama pemilik unit ke-i ('' = belum ditetapkan).
 * Balikan { peserta: [{nama, item, bayar}], total, belum, lengkap, jumlahBayar }.
 * Urutan peserta = urutan kemunculan pertama di penugasan.
 */
function hitungBagiPesanan_(detail, penugasan) {
  const units = unitPesanan_(detail);
  if (!Array.isArray(penugasan) || penugasan.length !== units.length) {
    throw new Error('Penugasan menu tidak sesuai dengan isi pesanan.');
  }
  const jumlah = arr => (arr || []).reduce((a, x) => a + (Math.round(Number(x.nominal)) || 0), 0);
  const diskon = detail.diskon || [];
  const subtotal = units.reduce((a, u) => a + u.harga, 0);
  let diskonMenu = jumlah(diskon.filter(d => d.untuk !== 'biaya'));
  let biayaBersih = jumlah(detail.biaya) - jumlah(diskon.filter(d => d.untuk === 'biaya'));
  if (biayaBersih < 0) { diskonMenu += -biayaBersih; biayaBersih = 0; } // diskon ongkir > ongkir
  const total = subtotal - diskonMenu + biayaBersih;

  const perOrang = Object.create(null);
  const urutan = [];
  let belum = 0;
  penugasan.forEach((nama, i) => {
    if (!nama) { belum++; return; }
    if (!(nama in perOrang)) { perOrang[nama] = 0; urutan.push(nama); }
    perOrang[nama] += units[i].harga;
  });
  const n = urutan.length;
  if (!n || subtotal <= 0) {
    return { peserta: [], total: total, belum: belum, lengkap: false, jumlahBayar: 0 };
  }

  // Porsi eksak = item × (subtotal − diskonMenu)/subtotal + biayaBersih/n,
  // dihitung sebagai pecahan berpenyebut subtotal × n supaya bebas galat float.
  const penyebut = subtotal * n;
  const baris = urutan.map((nama, idx) => {
    const pembilang = perOrang[nama] * (subtotal - diskonMenu) * n + biayaBersih * subtotal;
    return { nama: nama, item: perOrang[nama], bayar: Math.floor(pembilang / penyebut),
             sisa: pembilang % penyebut, pembilang: pembilang, idx: idx };
  });
  const target = Math.round(baris.reduce((a, b) => a + b.pembilang, 0) / penyebut);
  let kurang = target - baris.reduce((a, b) => a + b.bayar, 0);
  baris.slice().sort((a, b) => (b.sisa - a.sisa) || (a.idx - b.idx)).forEach(b => {
    if (kurang > 0) { b.bayar++; kurang--; }
  });

  const peserta = baris.map(b => ({ nama: b.nama, item: b.item, bayar: b.bayar }));
  return {
    peserta: peserta,
    total: total,
    belum: belum,
    lengkap: belum === 0,
    jumlahBayar: peserta.reduce((a, p) => a + p.bayar, 0)
  };
}
// </bagi-pesanan>

/**
 * Periksa keseimbangan hasil baca: harga menu harus berjumlah subtotal, dan
 * subtotal + biaya − diskon harus sama dengan total. Inilah yang membuat hasil
 * baca AI aman dipakai untuk uang — angka yang salah baca hampir mustahil
 * tetap seimbang. Balikan daftar masalah (kosong = aman).
 */
function periksaPesanan_(d) {
  const masalah = [];
  if (!d.items.length) masalah.push('tidak ada menu terbaca');
  d.items.forEach(it => {
    if (!(it.harga > 0)) masalah.push('harga "' + it.nama + '" tidak terbaca');
  });
  const jumlah = arr => arr.reduce((a, x) => a + x.nominal, 0);
  const sumItem = d.items.reduce((a, it) => a + it.harga, 0);
  if (d.subtotal && sumItem !== d.subtotal) {
    masalah.push('jumlah harga menu ' + sumItem + ' ≠ subtotal ' + d.subtotal);
  }
  const hitung = sumItem + jumlah(d.biaya) - jumlah(d.diskon);
  if (hitung !== d.total) {
    masalah.push('menu + biaya − diskon = ' + hitung + ', padahal total ' + d.total);
  }
  return masalah;
}

/** Prompt & skema dipakai bersama oleh unggah gambar dan penjemputan email. */
const PROMPT_INVOICE_GRAB =
  'Ekstrak dari e-receipt GrabFood ini (Rupiah):\n' +
  '- pesananId: nilai "Pesanan ID" persis seperti tertulis (mis. A-XXXXXXXX).\n' +
  '- resto: nama merchant di bagian "Pesanan Dari", HANYA nama tokonya (tanpa alamat).\n' +
  '- waktu: tanggal dan waktu pesanan persis seperti tertulis.\n' +
  '- items: SETIAP baris menu: nama (gabungkan teks tambahan/topping yang masih bagian ' +
  'baris itu), qty (angka sebelum "x"), harga (harga total baris itu).\n' +
  '- subtotal dan total ("TOTAL (INCL. TAX)").\n' +
  '- biaya: setiap biaya tambahan bernilai positif selain subtotal (Biaya Pengiriman, ' +
  'Biaya Pemesanan, Biaya Layanan, Biaya Kemasan, Tip, dll).\n' +
  '- diskon: setiap potongan (baris bertanda minus), nominal ditulis sebagai angka POSITIF, ' +
  'dan untuk = "biaya" bila potongan itu khusus untuk ongkos kirim/pengiriman/biaya ' +
  'layanan, selain itu untuk = "menu".\n' +
  'Abaikan blok "Detail Pembayaran" yang berisi metode bayar (Visa, OVO, dll) — itu bukan ' +
  'biaya. Semua angka bulat tanpa "Rp", titik, atau koma.';

function skemaInvoiceGrab_() {
  const angka = { type: 'NUMBER' };
  return {
    type: 'OBJECT',
    properties: {
      pesananId: { type: 'STRING' },
      resto: { type: 'STRING' },
      waktu: { type: 'STRING' },
      subtotal: angka,
      total: angka,
      items: { type: 'ARRAY', items: { type: 'OBJECT',
        properties: { nama: { type: 'STRING' }, qty: angka, harga: angka },
        required: ['nama', 'qty', 'harga'] } },
      biaya: { type: 'ARRAY', items: { type: 'OBJECT',
        properties: { label: { type: 'STRING' }, nominal: angka },
        required: ['label', 'nominal'] } },
      diskon: { type: 'ARRAY', items: { type: 'OBJECT',
        properties: { label: { type: 'STRING' }, nominal: angka,
          untuk: { type: 'STRING', enum: ['menu', 'biaya'] } },
        required: ['label', 'nominal', 'untuk'] } }
    },
    required: ['pesananId', 'resto', 'total', 'items']
  };
}

/**
 * Kirim satu invoice ke Gemini (parts = gambar ATAU teks email), rapikan
 * hasilnya, lalu periksa keseimbangannya. Balikan detail pesanan yang sudah
 * aman dipakai, atau lempar Error berbahasa Indonesia.
 */
function bacaInvoiceGemini_(parts) {
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('Fitur baca invoice belum diaktifkan (GEMINI_API_KEY belum diatur).');
  const body = {
    contents: [{ parts: [{ text: PROMPT_INVOICE_GRAB }].concat(parts) }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: skemaInvoiceGrab_() }
  };
  const teks = panggilGemini_(apiKey, body); // coba ulang + model cadangan (Struk.js)
  let mentah;
  try {
    const json = JSON.parse(teks);
    const cand = json.candidates && json.candidates[0];
    const isi = cand && cand.content && cand.content.parts && cand.content.parts[0] &&
      cand.content.parts[0].text;
    if (!isi) throw new Error('respons tanpa teks' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
    mentah = JSON.parse(isi);
  } catch (e) {
    throw new Error('Gagal membaca invoice: ' + (e.message || 'parse error'));
  }

  const bulat = v => Math.round(Math.abs(Number(v))) || 0;
  const detail = {
    pesananId: String(mentah.pesananId || '').trim(),
    resto: String(mentah.resto || '').trim(),
    waktu: String(mentah.waktu || '').trim(),
    subtotal: bulat(mentah.subtotal),
    total: bulat(mentah.total),
    items: (mentah.items || []).map(it => ({
      nama: String(it.nama || '').trim(),
      qty: Math.max(1, Math.floor(Number(it.qty)) || 1),
      harga: bulat(it.harga)
    })).filter(it => it.nama),
    biaya: (mentah.biaya || []).map(b => ({ label: String(b.label || '').trim(), nominal: bulat(b.nominal) }))
      .filter(b => b.nominal > 0),
    diskon: (mentah.diskon || []).map(d => ({
      label: String(d.label || '').trim(), nominal: bulat(d.nominal),
      untuk: d.untuk === 'biaya' ? 'biaya' : 'menu'
    })).filter(d => d.nominal > 0)
  };
  if (!detail.pesananId) throw new Error('Pesanan ID tidak terbaca — pastikan bagian "Pesanan ID" ikut terlihat.');
  if (!detail.resto) throw new Error('Nama resto tidak terbaca — pastikan bagian "Pesanan Dari" ikut terlihat.');
  const masalah = periksaPesanan_(detail);
  if (masalah.length) {
    throw new Error('Hasil baca invoice tidak seimbang (' + masalah.join('; ') + '). ' +
      'Coba unggah screenshot invoice yang jelas dan utuh.');
  }
  return detail;
}

/**
 * Simpan detail sebagai pesanan 'menunggu'. Kalau Pesanan ID yang sama sudah ada:
 * - masih menunggu / diabaikan → dikembalikan apa adanya (dibuka lagi);
 * - sudah tercatat → DITOLAK, supaya satu order tidak tercatat dua kali.
 * Dipakai unggah manual DAN penjemputan email, jadi keduanya aman berpapasan.
 */
function simpanPesananMenunggu_(detail) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ada = cariPesanan_(detail.pesananId);
    if (ada) {
      if (ada.status === STATUS_PESANAN_TERCATAT) {
        throw new Error('Pesanan ' + detail.pesananId + ' (' + ada.resto + ') sudah tercatat sebelumnya.');
      }
      if (ada.status === STATUS_PESANAN_DIABAIKAN) tulisStatusPesanan_(ada.baris, STATUS_PESANAN_MENUNGGU);
      return objekPesanan_(ada.detail);
    }
    const sheet = getSheet_(SHEET_PESANAN);
    const r = sheet.getLastRow() + 1;
    const range = sheet.getRange(r, 1, 1, PESANAN_HEADER.length);
    // Format teks dulu: tanpa ini Sheets bisa "membantu" mengubah waktu / ID
    // yang mirip tanggal menjadi nilai Date.
    range.setNumberFormat('@');
    range.setValues([[detail.pesananId, detail.waktu, detail.resto, String(detail.total),
      STATUS_PESANAN_MENUNGGU, JSON.stringify(detail), new Date().toISOString()]]);
  } finally {
    lock.releaseLock();
  }
  return objekPesanan_(detail);
}

/** Unggah manual: baca gambar invoice (screenshot e-receipt email Grab). */
function parseInvoiceGrab(base64, mimeType) {
  if (!base64) throw new Error('Gambar invoice kosong.');
  const tipe = String(mimeType || '').trim();
  if (tipe.indexOf('image/') !== 0) throw new Error('File harus berupa gambar.');
  const detail = bacaInvoiceGemini_([{ inlineData: { mimeType: tipe, data: base64 } }]);
  return simpanPesananMenunggu_(detail);
}

/**
 * Bagi & catat satu pesanan. penugasan = array SLOT per unit menu (lihat
 * unitPesanan_ & namaDasarSlot_), boleh berisi PESANAN_SAYA dan slot titipan.
 * ringkasLayar = { slot: bayar } hasil pratinjau di klien — kalau berbeda dari
 * hitungan server, ditolak (tanda salinan rumus di JsPesanan.html sudah beda).
 */
function simpanPesanan(pesananId, penugasan, ringkasLayar) {
  const id = String(pesananId || '').trim();
  if (!id) throw new Error('Pesanan tidak dikenal.');
  const roster = getAnggota();
  let ketResto = [];
  let resto = '';

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ada = cariPesanan_(id);
    if (!ada) throw new Error('Pesanan ' + id + ' tidak ditemukan.');
    if (ada.status === STATUS_PESANAN_TERCATAT) throw new Error('Pesanan ' + id + ' sudah tercatat sebelumnya.');

    (penugasan || []).forEach(slot => {
      const nama = namaDasarSlot_(slot);
      if (nama && nama !== PESANAN_SAYA && (roster.indexOf(nama) < 0 || nama === KAS_NAMA)) {
        throw new Error('"' + nama + '" bukan anggota Kodomo.');
      }
    });
    const hasil = hitungBagiPesanan_(ada.detail, penugasan);
    if (!hasil.lengkap) throw new Error('Masih ada ' + hasil.belum + ' menu yang belum punya pemilik.');
    if (hasil.jumlahBayar !== ada.detail.total) {
      throw new Error('Pembagian tidak pas dengan total tagihan — muat ulang halaman lalu coba lagi.');
    }
    if (ringkasLayar && typeof ringkasLayar === 'object') {
      const beda = hasil.peserta.some(p => Number(ringkasLayar[p.nama]) !== p.bayar);
      if (beda) throw new Error('Hitungan di layar berbeda dengan server — muat ulang halaman lalu coba lagi.');
    }

    resto = ada.detail.resto;
    // Gabungkan slot titipan per nama: satu baris Dosa per anggota (infaq
    // otomatis pun hanya sekali), keterangan tetap nama resto apa adanya.
    const perNama = {};
    const urutNama = [];
    hasil.peserta.forEach(p => {
      const nama = namaDasarSlot_(p.nama);
      if (nama === PESANAN_SAYA) return;
      if (!(nama in perNama)) { perNama[nama] = 0; urutNama.push(nama); }
      perNama[nama] += p.bayar;
    });
    const items = urutNama
      .filter(nama => perNama[nama] > 0)
      .map(nama => ({ nama: nama, tipe: 'Dosa', nominal: perNama[nama], keterangan: resto }));
    if (!items.length) throw new Error('Tidak ada porsi orang lain untuk dicatat.');

    ketResto = tulisBarisBatch_(items); // Amalan.js — lock sudah dipegang di sini
    ada.detail.penugasan = penugasan;
    ada.detail.pembagian = hasil.peserta;
    tulisStatusPesanan_(ada.baris, STATUS_PESANAN_TERCATAT, ada.detail);
  } finally {
    lock.releaseLock();
  }
  perbaruiRestoOtomatis_(ketResto);
  return getDashboardData();
}

/** Tandai pesanan tidak perlu dibagi (mis. order pribadi). */
function abaikanPesanan(pesananId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ada = cariPesanan_(String(pesananId || '').trim());
    if (!ada) throw new Error('Pesanan tidak ditemukan.');
    if (ada.status === STATUS_PESANAN_TERCATAT) throw new Error('Pesanan ini sudah tercatat, tidak bisa diabaikan.');
    tulisStatusPesanan_(ada.baris, STATUS_PESANAN_DIABAIKAN);
  } finally {
    lock.releaseLock();
  }
  return getDashboardData();
}

/** Pesanan berstatus menunggu, terbaru dulu — dikirim ke klien lewat dasbor. */
function daftarPesananMenunggu_() {
  const sheet = getSheet_(SHEET_PESANAN);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, PESANAN_HEADER.length).getValues()
    .filter(r => String(r[4]) === STATUS_PESANAN_MENUNGGU)
    .map(r => { try { return objekPesanan_(JSON.parse(r[5])); } catch (e) { return null; } })
    .filter(Boolean)
    .reverse()
    .slice(0, 20);
}

function objekPesanan_(detail) {
  return {
    id: detail.pesananId, resto: detail.resto, waktu: detail.waktu, total: detail.total,
    detail: {
      pesananId: detail.pesananId, resto: detail.resto, waktu: detail.waktu,
      subtotal: detail.subtotal, total: detail.total,
      items: detail.items, biaya: detail.biaya, diskon: detail.diskon
    }
  };
}

/** Cari baris pesanan berdasarkan ID. Balikan {baris, status, resto, detail} atau null. */
function cariPesanan_(id) {
  if (!id) return null;
  const sheet = getSheet_(SHEET_PESANAN);
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== id) continue;
    const r = sheet.getRange(i + 2, 1, 1, PESANAN_HEADER.length).getValues()[0];
    return { baris: i + 2, status: String(r[4]), resto: String(r[2]), detail: JSON.parse(r[5]) };
  }
  return null;
}

function tulisStatusPesanan_(baris, status, detail) {
  const sheet = getSheet_(SHEET_PESANAN);
  sheet.getRange(baris, 5).setValue(status);
  if (detail) sheet.getRange(baris, 6).setValue(JSON.stringify(detail));
  sheet.getRange(baris, 7).setValue(new Date().toISOString());
}
