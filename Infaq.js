/**
 * KODOMO — nominal infaq otomatis per orang (kolom C sheet Anggota).
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

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
