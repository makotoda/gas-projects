/**
 * Kehadiran.gs — input kehadiran harian (batch upsert), grid bulanan, dan rekap
 * yang dipakai bersama oleh dashboard, Laporan.gs, dan Publik.gs.
 */

function getDaftarKehadiran(token, idKelas, tanggal) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);

  var siswaKelas = bacaSemuaBaris_(SHEET.SISWA)
    .filter(function (s) { return s.id_kelas === idKelas && s.status === STATUS_SISWA.AKTIF; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); });

  var kehadiranHariIni = {};
  bacaSemuaBaris_(SHEET.KEHADIRAN).forEach(function (k) {
    if (k.id_kelas === idKelas && k.tanggal === tanggal) kehadiranHariIni[k.id_siswa] = k.status;
  });

  return siswaKelas.map(function (s, i) {
    return { no: i + 1, idSiswa: s.id_siswa, nama: s.nama, status: kehadiranHariIni[s.id_siswa] || null };
  });
}

/** Simpan banyak status sekaligus (upsert per siswa+tanggal). Aman dipanggil ulang (idempoten). */
function simpanKehadiranBatch(token, idKelas, tanggal, entries) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);
  if (!entries || !entries.length) throw new Error('Tidak ada data kehadiran untuk disimpan.');
  entries.forEach(function (e) {
    wajibIsi_(e.idSiswa, 'ID siswa');
    validasiStatusKehadiran_(e.status);
  });

  return withLock_(function () {
    var existingMap = {};
    bacaSemuaBaris_(SHEET.KEHADIRAN).forEach(function (k) {
      if (k.id_kelas === idKelas && k.tanggal === tanggal) existingMap[k.id_siswa] = k;
    });

    var waktu = jamSekarangStr_();
    var akanDitambah = [];
    var ringkasan = { H: 0, S: 0, I: 0, A: 0 };

    entries.forEach(function (e) {
      ringkasan[e.status]++;
      var existing = existingMap[e.idSiswa];
      if (existing) {
        timpaBaris_(SHEET.KEHADIRAN, existing._row, {
          id: existing.id, id_siswa: e.idSiswa, id_kelas: idKelas, tanggal: tanggal,
          status: e.status, dicatat_oleh: sesi.username, timestamp: waktu
        });
      } else {
        akanDitambah.push(e);
      }
    });

    if (akanDitambah.length) {
      var idBaru = alokasikanId_('KHD', akanDitambah.length);
      var baris = akanDitambah.map(function (e, i) {
        return {
          id: idBaru[i], id_siswa: e.idSiswa, id_kelas: idKelas, tanggal: tanggal,
          status: e.status, dicatat_oleh: sesi.username, timestamp: waktu
        };
      });
      tambahBanyakBaris_(SHEET.KEHADIRAN, baris);
    }

    catatLog_(sesi.username, 'simpan_kehadiran', idKelas + ' ' + tanggal + ' (' + entries.length + ' siswa)');
    return { ok: true, ringkasan: ringkasan };
  });
}

/** Grid bulanan ala Excel lama: baris = siswa, kolom = tanggal 1..N. */
function getGridBulanan(token, idKelas, tahun, bulan) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idKelas, 'Kelas');
  tahun = Number(tahun); bulan = Number(bulan);
  if (!tahun || !bulan || bulan < 1 || bulan > 12) throw new Error('Tahun/bulan tidak valid.');

  var jumlahHari = new Date(tahun, bulan, 0).getDate();
  var prefix = tahun + '-' + Utilities.formatString('%02d', bulan) + '-';

  var siswaKelas = bacaSemuaBaris_(SHEET.SISWA)
    .filter(function (s) { return s.id_kelas === idKelas && s.status === STATUS_SISWA.AKTIF; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); });

  var data = {};
  siswaKelas.forEach(function (s) { data[s.id_siswa] = {}; });

  bacaSemuaBaris_(SHEET.KEHADIRAN).forEach(function (k) {
    if (k.id_kelas !== idKelas) return;
    if (String(k.tanggal).indexOf(prefix) !== 0) return;
    if (!data[k.id_siswa]) return;
    var tgl = Number(String(k.tanggal).slice(8, 10));
    data[k.id_siswa][tgl] = k.status;
  });

  return {
    jumlahHari: jumlahHari,
    siswa: siswaKelas.map(function (s, i) {
      return { no: i + 1, idSiswa: s.id_siswa, nama: s.nama, kehadiran: data[s.id_siswa] };
    })
  };
}

/** Edit satu sel cepat dari tampilan grid bulanan (upsert satu baris). */
function updateKehadiranSel(token, idSiswa, idKelas, tanggal, status) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idSiswa, 'ID siswa');
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);
  validasiStatusKehadiran_(status);

  return withLock_(function () {
    var existing = bacaSemuaBaris_(SHEET.KEHADIRAN).filter(function (k) {
      return k.id_siswa === idSiswa && k.id_kelas === idKelas && k.tanggal === tanggal;
    })[0];
    var waktu = jamSekarangStr_();
    if (existing) {
      timpaBaris_(SHEET.KEHADIRAN, existing._row, {
        id: existing.id, id_siswa: idSiswa, id_kelas: idKelas, tanggal: tanggal,
        status: status, dicatat_oleh: sesi.username, timestamp: waktu
      });
    } else {
      var id = alokasikanId_('KHD', 1)[0];
      tambahBaris_(SHEET.KEHADIRAN, {
        id: id, id_siswa: idSiswa, id_kelas: idKelas, tanggal: tanggal,
        status: status, dicatat_oleh: sesi.username, timestamp: waktu
      });
    }
    catatLog_(sesi.username, 'ubah_kehadiran_sel', idSiswa + ' ' + tanggal + ' -> ' + status);
    return { ok: true };
  });
}

/** Kembalikan satu sel grid ke "belum ditandai" (hapus baris kehadirannya, bukan cuma ubah status). */
function hapusKehadiranSel(token, idSiswa, idKelas, tanggal) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idSiswa, 'ID siswa');
  wajibIsi_(idKelas, 'Kelas');
  validasiTanggal_(tanggal);

  return withLock_(function () {
    var existing = bacaSemuaBaris_(SHEET.KEHADIRAN).filter(function (k) {
      return k.id_siswa === idSiswa && k.id_kelas === idKelas && k.tanggal === tanggal;
    })[0];
    if (existing) {
      getSheet_(SHEET.KEHADIRAN).deleteRow(existing._row);
      catatLog_(sesi.username, 'hapus_kehadiran_sel', idSiswa + ' ' + tanggal);
    }
    return { ok: true };
  });
}

// ---------- Helper rekap internal (dipakai Code.gs/Laporan.gs/Publik.gs) ----------

/** Rekap H/S/I/A semua kelas aktif untuk satu tanggal — buat kartu dashboard. */
function rekapHarianSemuaKelas_(tanggal) {
  var idKelasAktif = {};
  daftarKelasMentah_().forEach(function (k) { if (k.aktif) idKelasAktif[k.idKelas] = true; });

  var totalSiswaAktif = bacaSemuaBaris_(SHEET.SISWA).filter(function (s) {
    return s.status === STATUS_SISWA.AKTIF && idKelasAktif[s.id_kelas];
  }).length;

  var hitung = { H: 0, S: 0, I: 0, A: 0 };
  bacaSemuaBaris_(SHEET.KEHADIRAN).forEach(function (k) {
    if (k.tanggal === tanggal && idKelasAktif[k.id_kelas] && hitung[k.status] !== undefined) hitung[k.status]++;
  });
  var totalDicatat = hitung.H + hitung.S + hitung.I + hitung.A;

  return {
    tanggal: tanggal, totalSiswaAktif: totalSiswaAktif, totalDicatat: totalDicatat,
    belumDicatat: Math.max(totalSiswaAktif - totalDicatat, 0), hitung: hitung
  };
}

/** Rekap H/S/I/A + persen kehadiran per siswa dalam rentang tanggal (inklusif, format yyyy-MM-dd). */
function hitungRekapPeriode_(daftarIdSiswa, tglMulai, tglSelesai) {
  var peta = {};
  daftarIdSiswa.forEach(function (id) { peta[id] = { H: 0, S: 0, I: 0, A: 0 }; });

  bacaSemuaBaris_(SHEET.KEHADIRAN).forEach(function (k) {
    if (!peta.hasOwnProperty(k.id_siswa)) return;
    if (k.tanggal < tglMulai || k.tanggal > tglSelesai) return;
    if (peta[k.id_siswa][k.status] !== undefined) peta[k.id_siswa][k.status]++;
  });

  var hasil = {};
  Object.keys(peta).forEach(function (id) {
    var c = peta[id];
    var totalDicatat = c.H + c.S + c.I + c.A;
    var persen = totalDicatat > 0 ? Math.round((c.H / totalDicatat) * 1000) / 10 : 0;
    hasil[id] = { H: c.H, S: c.S, I: c.I, A: c.A, totalDicatat: totalDicatat, persenHadir: persen };
  });
  return hasil;
}

/** Riwayat tanggal+status kehadiran satu siswa dalam rentang, terbaru dulu. */
function riwayatKehadiranSiswa_(idSiswa, tglMulai, tglSelesai) {
  return bacaSemuaBaris_(SHEET.KEHADIRAN)
    .filter(function (k) { return k.id_siswa === idSiswa && k.tanggal >= tglMulai && k.tanggal <= tglSelesai; })
    .map(function (k) { return { tanggal: k.tanggal, status: k.status }; })
    .sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : -1; });
}
