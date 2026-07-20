/**
 * Kelas.gs — CRUD kelas. "Hapus" diimplementasikan sebagai nonaktifkan (aktif=false),
 * bukan hapus baris permanen, supaya id_kelas lama pada riwayat Kehadiran/Infaq tetap
 * bisa ditelusuri namanya.
 */

function listKelas(token) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  return daftarKelasMentah_().sort(function (a, b) { return a.urutan - b.urutan; });
}

function daftarKelasMentah_() {
  return bacaSemuaBaris_(SHEET.KELAS).map(function (k) {
    return {
      idKelas: k.id_kelas, namaKelas: k.nama_kelas, jadwal: k.jadwal,
      waliKelas: k.wali_kelas, urutan: Number(k.urutan) || 0, aktif: k.aktif === true
    };
  });
}

function simpanKelas(token, data) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  data = data || {};
  var namaKelas = wajibIsi_(data.namaKelas, 'Nama kelas');
  var jadwal = (data.jadwal || '').toString().trim();
  var waliKelas = (data.waliKelas || '').toString().trim();

  return withLock_(function () {
    var semua = bacaSemuaBaris_(SHEET.KELAS);

    if (data.idKelas) {
      var existing = semua.filter(function (k) { return k.id_kelas === data.idKelas; })[0];
      if (!existing) throw new Error('Kelas tidak ditemukan.');
      var urutan = (data.urutan !== undefined && data.urutan !== null && data.urutan !== '')
        ? Number(data.urutan) : Number(existing.urutan) || 0;
      timpaBaris_(SHEET.KELAS, existing._row, {
        id_kelas: existing.id_kelas, nama_kelas: namaKelas, jadwal: jadwal,
        wali_kelas: waliKelas, urutan: urutan, aktif: existing.aktif
      });
      catatLog_(sesi.username, 'ubah_kelas', existing.id_kelas + ' -> ' + namaKelas);
      return { ok: true, idKelas: existing.id_kelas };
    }

    var idYangSudahAda = semua.map(function (k) { return k.id_kelas; });
    var id = slugKelas_(namaKelas, idYangSudahAda);
    var urutanBaru = (data.urutan !== undefined && data.urutan !== null && data.urutan !== '')
      ? Number(data.urutan)
      : semua.reduce(function (m, k) { return Math.max(m, Number(k.urutan) || 0); }, 0) + 1;
    tambahBaris_(SHEET.KELAS, {
      id_kelas: id, nama_kelas: namaKelas, jadwal: jadwal, wali_kelas: waliKelas,
      urutan: urutanBaru, aktif: true
    });
    catatLog_(sesi.username, 'tambah_kelas', id + ' (' + namaKelas + ')');
    return { ok: true, idKelas: id };
  });
}

function hapusKelas(token, idKelas) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  return withLock_(function () {
    var kelas = cariBarisById_(SHEET.KELAS, 'id_kelas', idKelas);
    if (!kelas) throw new Error('Kelas tidak ditemukan.');
    var siswaAktif = bacaSemuaBaris_(SHEET.SISWA).filter(function (s) {
      return s.id_kelas === idKelas && s.status === STATUS_SISWA.AKTIF;
    });
    if (siswaAktif.length > 0) {
      throw new Error('Kelas ini masih punya ' + siswaAktif.length + ' siswa aktif. Pindahkan siswa ke kelas lain dulu sebelum menghapus.');
    }
    timpaBaris_(SHEET.KELAS, kelas._row, Object.assign({}, kelas, { aktif: false }));
    catatLog_(sesi.username, 'hapus_kelas', idKelas);
    return { ok: true };
  });
}

function aktifkanKelas(token, idKelas) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  return withLock_(function () {
    var kelas = cariBarisById_(SHEET.KELAS, 'id_kelas', idKelas);
    if (!kelas) throw new Error('Kelas tidak ditemukan.');
    timpaBaris_(SHEET.KELAS, kelas._row, Object.assign({}, kelas, { aktif: true }));
    catatLog_(sesi.username, 'aktifkan_kelas', idKelas);
    return { ok: true };
  });
}
