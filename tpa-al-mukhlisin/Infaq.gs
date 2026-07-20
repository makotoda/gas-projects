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

/** Input infaq satu siswa (di luar alur batch per kelas). */
function simpanInfaqSatuan(token, data) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  data = data || {};
  var idSiswa = wajibIsi_(data.idSiswa, 'Siswa');
  var tanggal = validasiTanggal_(data.tanggal || hariIniStr_());
  var jumlah = validasiNominal_(data.jumlah);

  return withLock_(function () {
    var siswa = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswa);
    if (!siswa) throw new Error('Siswa tidak ditemukan.');
    var id = alokasikanId_('INF', 1)[0];
    tambahBaris_(SHEET.INFAQ, {
      id: id, id_siswa: idSiswa, id_kelas: siswa.id_kelas, tanggal: tanggal,
      jumlah: jumlah, metode: data.metode || 'Tunai', keterangan: (data.keterangan || '').toString().trim(),
      dicatat_oleh: sesi.username, timestamp: jamSekarangStr_()
    });
    catatLog_(sesi.username, 'simpan_infaq_satuan', idSiswa + ' ' + tanggal + ' ' + formatRupiah_(jumlah));
    return { ok: true, idInfaq: id };
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
      return {
        tanggal: r.tanggal, idSiswa: r.id_siswa,
        namaSiswa: (petaSiswa[r.id_siswa] && petaSiswa[r.id_siswa].nama) || '(tidak diketahui)',
        namaKelas: petaKelas[r.id_kelas] || '(tidak diketahui)',
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
