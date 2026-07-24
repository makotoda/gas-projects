/**
 * Code.gs — titik masuk web app: routing doGet(e) berdasar e.parameter.page,
 * helper include() untuk template HtmlService, dan agregator data dashboard.
 */

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.page === 'publik') {
    return HtmlService.createTemplateFromFile('publik')
      .evaluate()
      .setTitle('TPA Al-Mukhlisin — Pantau Santri')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('TPA Al-Mukhlisin — Panel Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Dipakai di dalam template lewat <?!= include('nama_file') ?> untuk menyatukan partial. */
function include(namaFile) {
  return HtmlService.createHtmlOutputFromFile(namaFile).getContent();
}

function getDashboardData(token) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);

  var kelasAktif = daftarKelasMentah_()
    .filter(function (k) { return k.aktif; })
    .sort(function (a, b) { return a.urutan - b.urutan; });
  var siswaSemua = bacaSemuaBaris_(SHEET.SISWA);

  var siswaPerKelas = kelasAktif.map(function (k) {
    var jumlah = siswaSemua.filter(function (s) {
      return s.id_kelas === k.idKelas && s.status === STATUS_SISWA.AKTIF;
    }).length;
    return { idKelas: k.idKelas, namaKelas: k.namaKelas, jumlahSiswa: jumlah };
  });

  var totalSiswaAktif = siswaSemua.filter(function (s) { return s.status === STATUS_SISWA.AKTIF; }).length;

  var totalInfaqBulanIni = totalInfaqBulanIni_();
  var totalPengeluaranBulanIni = totalPengeluaranBulanIni_();

  return {
    totalSiswaAktif: totalSiswaAktif,
    jumlahKelasAktif: kelasAktif.length,
    siswaPerKelas: siswaPerKelas,
    kehadiranHariIni: rekapHarianSemuaKelas_(hariIniStr_()),
    totalInfaqBulanIni: totalInfaqBulanIni,
    totalPengeluaranBulanIni: totalPengeluaranBulanIni,
    saldoKasBulanIni: totalInfaqBulanIni - totalPengeluaranBulanIni,
    bulanIni: bulanIniInfo_()
  };
}
