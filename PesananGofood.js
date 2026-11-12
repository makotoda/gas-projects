/**
 * KODOMO — unggah struk GoFood → Pesanan Masuk.
 *
 * Struk GoFood (layar rincian pesanan di aplikasi Gojek) hanya berisi daftar
 * menu + biaya + potongan untuk SATU pesanan — belum dibagi per orang. Jadi
 * diperlakukan persis seperti e-receipt Grab: dibaca Gemini (bacaInvoiceGemini_,
 * lengkap dengan pemeriksaan keseimbangan), disimpan sebagai pesanan 'menunggu'
 * di sheet Pesanan, lalu dibagi di layar bagi dengan rumus yang sama
 * (hitungBagiPesanan_): diskon menu PRORATA harga menu, ongkir & biaya lain
 * dibagi RATA per pemesan, diskon ongkir mengurangi biaya bersama.
 *
 * Bagian dari proyek Kodomo — namespace global bersama.
 */

/** Rincian GoFood sering lebih panjang dari satu layar → boleh beberapa screenshot. */
const GOFOOD_MAKS_GAMBAR = 3;

const PROMPT_STRUK_GOFOOD =
  'Ekstrak dari screenshot rincian pesanan GoFood ini (Rupiah):\n' +
  '- pesananId: ID pesanan / Order ID persis seperti tertulis (biasanya diawali "F-"); ' +
  'kosongkan bila tidak terlihat.\n' +
  '- resto: nama restoran saja (tanpa alamat).\n' +
  '- waktu: tanggal dan jam pesanan persis seperti tertulis.\n' +
  '- items: SETIAP menu: nama (gabungkan varian/topping/catatan yang masih bagian menu itu), ' +
  'qty, harga = harga TOTAL baris itu (qty × harga satuan bila yang tertulis harga satuan). ' +
  'Bila ada harga coret, pakai harga SETELAH coret.\n' +
  '- subtotal: total harga menu sebelum biaya dan potongan.\n' +
  '- total: total yang dibayar untuk pesanan ini (sebelum dipotong saldo GoPay Coins / ' +
  'metode bayar).\n' +
  '- biaya: setiap biaya tambahan bernilai positif selain harga menu (Ongkos kirim, Biaya ' +
  'layanan, Biaya jasa aplikasi, Biaya kemasan, Biaya pemesanan, dll).\n' +
  '- diskon: SETIAP potongan/promo/voucher/diskon — baik bertanda minus maupun tidak — ' +
  'nominal ditulis sebagai angka POSITIF, dan untuk = "biaya" bila potongan itu khusus ' +
  'ongkos kirim/biaya layanan (mis. "Diskon ongkir", "Gratis ongkir"), selain itu ' +
  'untuk = "menu". Jangan masukkan baris ringkasan yang hanya menjumlahkan potongan lain ' +
  '(mis. "Kamu hemat").\n' +
  'Abaikan metode pembayaran (GoPay, GoPay Coins, GoPayLater, kartu) — itu bukan potongan.\n' +
  'Periksa: subtotal + semua biaya − semua diskon HARUS sama persis dengan total.\n' +
  'Semua angka bulat tanpa "Rp", titik, atau koma.';

/**
 * Dipanggil klien. gambar = [{ base64, mime }] — 1 sampai GOFOOD_MAKS_GAMBAR
 * screenshot dari SATU pesanan (mis. bagian menu + bagian rincian bayar).
 * Balikan objek pesanan (objekPesanan_) untuk langsung dibuka di layar bagi.
 */
function parseStrukGofood(gambar) {
  const daftar = (Array.isArray(gambar) ? gambar : []).filter(g => g && g.base64);
  if (!daftar.length) throw new Error('Gambar struk GoFood kosong.');
  if (daftar.length > GOFOOD_MAKS_GAMBAR) {
    throw new Error('Maksimal ' + GOFOOD_MAKS_GAMBAR + ' screenshot untuk satu pesanan GoFood.');
  }
  const parts = daftar.map(g => {
    const tipe = String(g.mime || '').trim();
    if (tipe.indexOf('image/') !== 0) throw new Error('File harus berupa gambar.');
    return { inlineData: { mimeType: tipe, data: g.base64 } };
  });
  if (parts.length > 1) {
    parts.unshift({ text: 'Ada ' + parts.length + ' screenshot dari SATU pesanan yang sama ' +
      '(bagian berbeda dari layar yang sama). Gabungkan; baris yang terlihat di dua screenshot ' +
      'hanya dihitung sekali.' });
  }
  const detail = bacaInvoiceGemini_(parts, {
    prompt: PROMPT_STRUK_GOFOOD,
    sumber: 'gofood',
    idCadangan: idGofoodCadangan_
  });
  return simpanPesananMenunggu_(detail);
}

/**
 * ID pengganti kalau "ID pesanan" tidak ikut ter-screenshot: sidik dari resto,
 * waktu, total, dan menu — unggah ulang struk yang sama tetap jatuh ke ID yang
 * sama (tidak dobel), selama Gemini membacanya sama.
 */
function idGofoodCadangan_(d) {
  const kunci = [d.resto, d.waktu, d.total].concat(d.items.map(it => it.nama + '×' + it.qty + '=' + it.harga))
    .join('|').toLowerCase();
  const sidik = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, kunci, Utilities.Charset.UTF_8)
    .slice(0, 6).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
  return 'GF-' + sidik.toUpperCase();
}
