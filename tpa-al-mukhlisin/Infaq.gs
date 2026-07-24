/**
 * Infaq.gs — input infaq (batch per kelas/tanggal atau satuan per siswa), subtotal,
 * dan rekap yang dipakai bersama oleh dashboard, Laporan.gs, dan Publik.gs.
 * Beda dengan Kehadiran, satu siswa boleh punya lebih dari satu entri infaq per
 * tanggal (tidak upsert) — simpan selalu menambah baris baru untuk jumlah > 0.
 */

function getDaftarInfaq(token, idKelas, tanggal) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);

  var siswaKelas = bacaSemuaBaris_(SHEET.SISWA)
    .filter(function (s) { return s.id_kelas === idKelas && s.status === STATUS_SISWA.AKTIF; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); });

  var sudahTercatat = {};
  bacaSemuaBaris_(SHEET.INFAQ).forEach(function (r) {
    if (r.id_kelas === idKelas && r.tanggal === tanggal) {
      sudahTercatat[r.id_siswa] = (sudahTercatat[r.id_siswa] || 0) + Number(r.jumlah);
    }
  });

  return siswaKelas.map(function (s, i) {
    return { no: i + 1, idSiswa: s.id_siswa, nama: s.nama, sudahTercatat: sudahTercatat[s.id_siswa] || 0 };
  });
}

/** Simpan banyak entri infaq sekaligus. Baris dengan jumlah kosong/0 dilewati. */
function simpanInfaqBatch(token, idKelas, tanggal, entries) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);
  if (!entries || !entries.length) throw new Error('Tidak ada data infaq untuk disimpan.');

  var terisi = entries.filter(function (e) {
    return e.jumlah !== undefined && e.jumlah !== null && e.jumlah !== '' && Number(e.jumlah) > 0;
  });
  if (!terisi.length) throw new Error('Isi minimal satu jumlah infaq.');

  return withLock_(function () {
    var idBaru = alokasikanId_('INF', terisi.length);
    var waktu = jamSekarangStr_();
    var baris = terisi.map(function (e, i) {
      return {
        id: idBaru[i], id_siswa: wajibIsi_(e.idSiswa, 'ID siswa'), id_kelas: idKelas, tanggal: tanggal,
        jumlah: validasiNominal_(e.jumlah), metode: e.metode || 'Tunai',
        keterangan: (e.keterangan || '').toString().trim(), dicatat_oleh: sesi.username, timestamp: waktu
      };
    });
    tambahBanyakBaris_(SHEET.INFAQ, baris);
    var totalRupiah = baris.reduce(function (t, b) { return t + b.jumlah; }, 0);
    catatLog_(sesi.username, 'simpan_infaq', idKelas + ' ' + tanggal + ' (' + baris.length + ' entri, ' + formatRupiah_(totalRupiah) + ')');
    return { ok: true, jumlahEntri: baris.length, totalRupiah: totalRupiah };
  });
}

/**
 * Input infaq satuan (di luar alur batch per kelas), DUA mode:
 *  - Dari siswa: data.idSiswa diisi -> id_kelas ikut siswa, sumber_lain kosong.
 *  - Dari sumber lain (donatur umum, kotak amal, dst.): data.sumberLain diisi (bukan
 *    idSiswa) -> id_siswa/id_kelas kosong, sumber_lain diisi teks bebas. Tetap ikut
 *    terhitung di totalInfaqBulanIni_ (dashboard) dan Ringkasan Keuangan (Laporan.gs),
 *    tapi TIDAK muncul di rekap per-siswa/per-kelas manapun (memang tak berelasi ke sana).
 */
function simpanInfaqSatuan(token, data) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  data = data || {};
  var tanggal = validasiTanggal_(data.tanggal || hariIniStr_());
  var jumlah = validasiNominal_(data.jumlah);
  var metode = data.metode || 'Tunai';
  var keterangan = (data.keterangan || '').toString().trim();
  var dariSumberLain = !!(data.sumberLain && String(data.sumberLain).trim());
  var sumberLain = dariSumberLain ? wajibIsi_(data.sumberLain, 'Sumber') : '';
  var idSiswaInput = dariSumberLain ? '' : wajibIsi_(data.idSiswa, 'Siswa');

  return withLock_(function () {
    var idSiswa = '', idKelas = '';
    if (!dariSumberLain) {
      var siswa = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswaInput);
      if (!siswa) throw new Error('Siswa tidak ditemukan.');
      idSiswa = idSiswaInput;
      idKelas = siswa.id_kelas;
    }
    var id = alokasikanId_('INF', 1)[0];
    tambahBaris_(SHEET.INFAQ, {
      id: id, id_siswa: idSiswa, id_kelas: idKelas, tanggal: tanggal,
      jumlah: jumlah, metode: metode, keterangan: keterangan, sumber_lain: sumberLain,
      dicatat_oleh: sesi.username, timestamp: jamSekarangStr_()
    });
    catatLog_(sesi.username, 'simpan_infaq_satuan', (idSiswa || sumberLain) + ' ' + tanggal + ' ' + formatRupiah_(jumlah));
    return { ok: true, idInfaq: id };
  });
}

/** Daftar infaq dari SUMBER LAIN saja (bukan siswa), terbaru dulu, dengan paginasi. */
function listInfaqSumberLain(token, filter) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  filter = filter || {};

  var semua = bacaSemuaBaris_(SHEET.INFAQ).filter(function (r) {
    if (r.id_siswa) return false;
    if (filter.tglMulai && r.tanggal < filter.tglMulai) return false;
    if (filter.tglSelesai && r.tanggal > filter.tglSelesai) return false;
    return true;
  });

  semua.sort(function (a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    return a.timestamp < b.timestamp ? 1 : -1;
  });

  var total = semua.length;
  var totalJumlah = semua.reduce(function (t, r) { return t + Number(r.jumlah); }, 0);
  var pageSize = Math.min(Math.max(Number(filter.pageSize) || 20, 5), 100);
  var page = Math.max(Number(filter.page) || 1, 1);
  var mulai = (page - 1) * pageSize;

  return {
    total: total,
    totalJumlah: totalJumlah,
    page: page,
    pageSize: pageSize,
    items: semua.slice(mulai, mulai + pageSize).map(function (r) {
      return {
        idInfaq: r.id, tanggal: r.tanggal, sumberLain: r.sumber_lain,
        jumlah: Number(r.jumlah), metode: r.metode, keterangan: r.keterangan, dicatatOleh: r.dicatat_oleh
      };
    })
  };
}

/** Hapus satu entri infaq SUMBER LAIN (mis. salah catat). Sengaja menolak menghapus baris
 * infaq siswa lewat endpoint ini -- itu bukan tujuannya, dan siswa punya jejak yang lebih
 * sensitif untuk dihapus sembarangan. */
function hapusInfaqSumberLain(token, idInfaq) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idInfaq, 'ID infaq');
  return withLock_(function () {
    var r = cariBarisById_(SHEET.INFAQ, 'id', idInfaq);
    if (!r) throw new Error('Data infaq tidak ditemukan.');
    if (r.id_siswa) throw new Error('Entri ini tercatat atas nama siswa, bukan sumber lain -- tidak bisa dihapus lewat sini.');
    getSheet_(SHEET.INFAQ).deleteRow(r._row);
    catatLog_(sesi.username, 'hapus_infaq_sumber_lain', r.tanggal + ' ' + r.sumber_lain + ' ' + formatRupiah_(Number(r.jumlah)));
    return { ok: true };
  });
}

function getSubtotalHarian(token, idKelas, tanggal) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);
  var total = 0;
  var siswaBerinfaq = {};
  bacaSemuaBaris_(SHEET.INFAQ).forEach(function (r) {
    if (r.id_kelas === idKelas && r.tanggal === tanggal) {
      total += Number(r.jumlah);
      siswaBerinfaq[r.id_siswa] = true;
    }
  });
  return { total: total, jumlahSiswaBerinfaq: Object.keys(siswaBerinfaq).length };
}

// ---------- Helper rekap internal (dipakai Code.gs/Laporan.gs/Publik.gs) ----------

function totalInfaqBulanIni_() {
  var info = bulanIniInfo_();
  var prefix = info.tahun + '-' + Utilities.formatString('%02d', info.bulan) + '-';
  var total = 0;
  bacaSemuaBaris_(SHEET.INFAQ).forEach(function (r) {
    if (String(r.tanggal).indexOf(prefix) === 0) total += Number(r.jumlah);
  });
  return total;
}

/** Total infaq dari sumber lain (bukan siswa) dalam rentang tanggal -- dipakai Laporan.gs
 * untuk melengkapi "Total Infaq Masuk" di Ringkasan Keuangan, yang kalau cuma dari rekap
 * per-siswa akan meleset (entri sumber lain tak tercatat di rekap manapun yang berbasis
 * siswa/kelas). */
function totalInfaqSumberLainPeriode_(tglMulai, tglSelesai) {
  var total = 0;
  bacaSemuaBaris_(SHEET.INFAQ).forEach(function (r) {
    if (r.id_siswa) return;
    if (r.tanggal < tglMulai || r.tanggal > tglSelesai) return;
    total += Number(r.jumlah);
  });
  return total;
}

function rekapInfaqPeriode_(daftarIdSiswa, tglMulai, tglSelesai) {
  var peta = {};
  daftarIdSiswa.forEach(function (id) { peta[id] = 0; });
  bacaSemuaBaris_(SHEET.INFAQ).forEach(function (r) {
    if (!peta.hasOwnProperty(r.id_siswa)) return;
    if (r.tanggal < tglMulai || r.tanggal > tglSelesai) return;
    peta[r.id_siswa] += Number(r.jumlah);
  });
  return peta;
}

function rincianInfaqPeriode_(idKelas, tglMulai, tglSelesai) {
  var petaSiswa = petaSiswaById_();
  var petaKelas = petaKelasById_();
  return bacaSemuaBaris_(SHEET.INFAQ)
    .filter(function (r) {
      if (idKelas && r.id_kelas !== idKelas) return false;
      return r.tanggal >= tglMulai && r.tanggal <= tglSelesai;
    })
    .map(function (r) {
      // Entri sumber lain (id_siswa kosong) BUKAN "tidak diketahui" -- tampilkan nama
      // sumbernya (mis. "Donatur Umum") apa adanya, bukan label error/kekosongan.
      return {
        tanggal: r.tanggal, idSiswa: r.id_siswa,
        namaSiswa: r.id_siswa ? ((petaSiswa[r.id_siswa] && petaSiswa[r.id_siswa].nama) || '(tidak diketahui)') : (r.sumber_lain || '(sumber lain)'),
        namaKelas: r.id_siswa ? (petaKelas[r.id_kelas] || '(tidak diketahui)') : '(Sumber Lain)',
        jumlah: Number(r.jumlah), metode: r.metode, keterangan: r.keterangan
      };
    })
    .sort(function (a, b) { return a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0); });
}

function riwayatInfaqSiswa_(idSiswa, tglMulai, tglSelesai) {
  return bacaSemuaBaris_(SHEET.INFAQ)
    .filter(function (r) { return r.id_siswa === idSiswa && r.tanggal >= tglMulai && r.tanggal <= tglSelesai; })
    .map(function (r) { return { tanggal: r.tanggal, jumlah: Number(r.jumlah), metode: r.metode }; })
    .sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : -1; });
}
