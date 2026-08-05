/**
 * KODOMO — Kopdos Merah Putih: katalog belanja koperasi & checkout-nya.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

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
