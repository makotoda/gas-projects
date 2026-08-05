/**
 * KODOMO — pencatatan amalan: submitAmalan (Pahala/Dosa/Transfer),
 * submitAmalanBatch (hasil upload struk), dan baris infaq KAS otomatis.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

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
