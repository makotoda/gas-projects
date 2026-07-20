/**
 * Siswa.gs — CRUD siswa: daftar dengan filter/pencarian/paginasi, tambah/ubah,
 * soft-delete (nonaktifkan), pindah kelas (lewat simpanSiswa biasa), dan impor massal.
 */

function listSiswa(token, filter) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  filter = filter || {};
  var semua = bacaSemuaBaris_(SHEET.SISWA);
  var petaKelas = petaKelasById_();
  var petaNomorUrut = nomorUrutPerKelas_(semua);

  var hasil = semua.filter(function (s) {
    if (!filter.sertakanNonaktif && s.status !== STATUS_SISWA.AKTIF) return false;
    if (filter.idKelas && s.id_kelas !== filter.idKelas) return false;
    if (filter.cari) {
      var q = String(filter.cari).toLowerCase();
      if (String(s.nama).toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });

  hasil.sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); });

  var total = hasil.length;
  var pageSize = Math.min(Math.max(Number(filter.pageSize) || 20, 5), 100);
  var page = Math.max(Number(filter.page) || 1, 1);
  var mulai = (page - 1) * pageSize;
  var potongan = hasil.slice(mulai, mulai + pageSize);

  return {
    total: total,
    page: page,
    pageSize: pageSize,
    items: potongan.map(function (s) {
      return {
        no: petaNomorUrut[s.id_siswa] || null,
        idSiswa: s.id_siswa, nama: s.nama, jenisKelamin: s.jenis_kelamin,
        idKelas: s.id_kelas, namaKelas: petaKelas[s.id_kelas] || '(tidak diketahui)',
        namaWali: s.nama_wali, noHpWali: s.no_hp_wali, tanggalMasuk: s.tanggal_masuk,
        status: s.status, catatan: s.catatan, kodePublik: s.kode_publik
      };
    })
  };
}

/** Peringkat tiap siswa aktif di dalam kelasnya sendiri (alfabetis), stabil terlepas dari filter/pencarian. */
function nomorUrutPerKelas_(semuaSiswa) {
  var penghitungPerKelas = {};
  var peta = {};
  semuaSiswa
    .filter(function (s) { return s.status === STATUS_SISWA.AKTIF; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); })
    .forEach(function (s) {
      penghitungPerKelas[s.id_kelas] = (penghitungPerKelas[s.id_kelas] || 0) + 1;
      peta[s.id_siswa] = penghitungPerKelas[s.id_kelas];
    });
  return peta;
}

function getSiswa(token, idSiswa) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  var s = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswa);
  if (!s) throw new Error('Siswa tidak ditemukan.');
  return {
    idSiswa: s.id_siswa, nama: s.nama, jenisKelamin: s.jenis_kelamin, idKelas: s.id_kelas,
    namaWali: s.nama_wali, noHpWali: s.no_hp_wali, tanggalMasuk: s.tanggal_masuk,
    status: s.status, catatan: s.catatan, kodePublik: s.kode_publik
  };
}

function simpanSiswa(token, data) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  data = data || {};
  var nama = wajibIsi_(data.nama, 'Nama siswa');
  var idKelas = wajibIsi_(data.idKelas, 'Kelas');

  return withLock_(function () {
    var kelas = cariBarisById_(SHEET.KELAS, 'id_kelas', idKelas);
    if (!kelas) throw new Error('Kelas tidak valid.');

    var payload = {
      nama: nama,
      jenis_kelamin: validasiJenisKelamin_(data.jenisKelamin),
      id_kelas: idKelas,
      nama_wali: (data.namaWali || '').toString().trim(),
      no_hp_wali: (data.noHpWali || '').toString().trim(),
      tanggal_masuk: data.tanggalMasuk || '',
      catatan: (data.catatan || '').toString().trim()
    };

    if (data.idSiswa) {
      var existing = cariBarisById_(SHEET.SISWA, 'id_siswa', data.idSiswa);
      if (!existing) throw new Error('Siswa tidak ditemukan.');
      timpaBaris_(SHEET.SISWA, existing._row, Object.assign({}, existing, payload));
      catatLog_(sesi.username, 'ubah_siswa', existing.id_siswa + ' (' + nama + ')');
      return { ok: true, idSiswa: existing.id_siswa };
    }

    var semuaSiswa = bacaSemuaBaris_(SHEET.SISWA);
    var kodeYangSudahAda = semuaSiswa.map(function (s) { return s.kode_publik; });
    var id = alokasikanId_('SIS', 1)[0];
    payload.id_siswa = id;
    payload.status = STATUS_SISWA.AKTIF;
    payload.tanggal_masuk = payload.tanggal_masuk || hariIniStr_();
    payload.kode_publik = kodePublikBaru_(kodeYangSudahAda);
    tambahBaris_(SHEET.SISWA, payload);
    catatLog_(sesi.username, 'tambah_siswa', id + ' (' + nama + ')');
    return { ok: true, idSiswa: id };
  });
}

function nonaktifkanSiswa(token, idSiswa) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  return withLock_(function () {
    var s = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswa);
    if (!s) throw new Error('Siswa tidak ditemukan.');
    timpaBaris_(SHEET.SISWA, s._row, Object.assign({}, s, { status: STATUS_SISWA.NONAKTIF }));
    catatLog_(sesi.username, 'nonaktifkan_siswa', idSiswa + ' (' + s.nama + ')');
    return { ok: true };
  });
}

function aktifkanSiswa(token, idSiswa) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  return withLock_(function () {
    var s = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswa);
    if (!s) throw new Error('Siswa tidak ditemukan.');
    timpaBaris_(SHEET.SISWA, s._row, Object.assign({}, s, { status: STATUS_SISWA.AKTIF }));
    catatLog_(sesi.username, 'aktifkan_siswa', idSiswa + ' (' + s.nama + ')');
    return { ok: true };
  });
}

/** Generate ulang kode PIN publik siswa (mis. karena bocor). */
function regenerasiKodePublik(token, idSiswa) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  return withLock_(function () {
    var s = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswa);
    if (!s) throw new Error('Siswa tidak ditemukan.');
    var kodeYangSudahAda = bacaSemuaBaris_(SHEET.SISWA).map(function (x) { return x.kode_publik; });
    var kodeBaru = kodePublikBaru_(kodeYangSudahAda);
    timpaBaris_(SHEET.SISWA, s._row, Object.assign({}, s, { kode_publik: kodeBaru }));
    catatLog_(sesi.username, 'ganti_kode_publik', idSiswa);
    return { ok: true, kodePublik: kodeBaru };
  });
}

/** Impor cepat: satu nama per baris dari textarea paste, semua masuk ke satu kelas. */
function importSiswaBatch(token, idKelas, teks) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  var baris = String(teks || '').split('\n')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  if (!baris.length) throw new Error('Tidak ada nama untuk diimpor.');
  if (baris.length > 200) throw new Error('Maksimum 200 nama sekali impor.');

  return withLock_(function () {
    var kelas = cariBarisById_(SHEET.KELAS, 'id_kelas', idKelas);
    if (!kelas) throw new Error('Kelas tidak valid.');

    var semuaSiswa = bacaSemuaBaris_(SHEET.SISWA);
    var kodeYangSudahAda = semuaSiswa.map(function (s) { return s.kode_publik; });
    var idBaru = alokasikanId_('SIS', baris.length);
    var hariIni = hariIniStr_();

    var baruBaru = baris.map(function (nama, i) {
      var kode = kodePublikBaru_(kodeYangSudahAda);
      kodeYangSudahAda.push(kode);
      return {
        id_siswa: idBaru[i], nama: nama, jenis_kelamin: '', id_kelas: idKelas,
        nama_wali: '', no_hp_wali: '', tanggal_masuk: hariIni, status: STATUS_SISWA.AKTIF,
        catatan: '', kode_publik: kode
      };
    });
    tambahBanyakBaris_(SHEET.SISWA, baruBaru);
    catatLog_(sesi.username, 'impor_siswa', baruBaru.length + ' siswa ke kelas ' + idKelas);
    return { ok: true, jumlah: baruBaru.length };
  });
}
