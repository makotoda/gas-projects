/**
 * Laporan.gs — bangun Spreadsheet sementara (rekap + grid bulanan ala Excel lama),
 * ekspor ke .xlsx/PDF lewat endpoint export bawaan Google, simpan hasilnya di folder
 * Drive khusus (yang membersihkan diri sendiri), lalu buang file Spreadsheet sementara.
 */

var NAMA_FOLDER_LAPORAN = 'TPA Al-Mukhlisin - Laporan (auto)';
var FORMAT_LAPORAN_VALID = ['xlsx', 'pdf', 'keduanya'];
var MAKS_BULAN_LAPORAN = 13;

function buatLaporanKehadiran(token, opts) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  opts = opts || {};
  var tglMulai = validasiTanggal_(opts.tglMulai);
  var tglSelesai = validasiTanggal_(opts.tglSelesai);
  if (tglMulai > tglSelesai) throw new Error('Tanggal mulai harus sebelum atau sama dengan tanggal selesai.');
  var format = validasiFormatLaporan_(opts.format);

  var daftarKelas = kelasUntukLaporan_(opts.idKelas);
  if (!daftarKelas.length) throw new Error('Kelas tidak ditemukan.');
  var bulanList = bulanBulanDalamRentang_(tglMulai, tglSelesai);
  if (bulanList.length > MAKS_BULAN_LAPORAN) {
    throw new Error('Rentang periode terlalu panjang (maksimum sekitar ' + MAKS_BULAN_LAPORAN + ' bulan).');
  }

  var siswaSemua = bacaSemuaBaris_(SHEET.SISWA);
  var ss = SpreadsheetApp.create('Laporan Kehadiran TPA ' + tglMulai + '_sd_' + tglSelesai);

  try {
    var shRekap = ss.getSheets()[0];
    shRekap.setName('Rekapitulasi');
    var headerRekap = ['No', 'Nama', 'Kelas', 'Hadir', 'Sakit', 'Izin', 'Alpa', '% Kehadiran'];
    var barisRekap = [headerRekap];
    var no = 1;

    daftarKelas.forEach(function (kelas) {
      var siswaKelas = siswaAktifPadaKelas_(siswaSemua, kelas.idKelas);
      var idList = siswaKelas.map(function (s) { return s.id_siswa; });
      var rekap = hitungRekapPeriode_(idList, tglMulai, tglSelesai);
      siswaKelas.forEach(function (s) {
        var r = rekap[s.id_siswa];
        barisRekap.push([no++, s.nama, kelas.namaKelas, r.H, r.S, r.I, r.A, r.persenHadir + '%']);
      });
    });
    shRekap.getRange(1, 1, barisRekap.length, headerRekap.length).setValues(barisRekap);
    formatHeaderSheet_(shRekap, headerRekap.length);

    var shKelas = ss.insertSheet('Ringkasan per Kelas');
    var headerKelas = ['Kelas', 'Jumlah Siswa', 'Hadir', 'Sakit', 'Izin', 'Alpa', '% Kehadiran Kelas'];
    var barisKelas = [headerKelas];
    daftarKelas.forEach(function (kelas) {
      var siswaKelas = siswaAktifPadaKelas_(siswaSemua, kelas.idKelas);
      var idList = siswaKelas.map(function (s) { return s.id_siswa; });
      var rekap = hitungRekapPeriode_(idList, tglMulai, tglSelesai);
      var t = { H: 0, S: 0, I: 0, A: 0 };
      idList.forEach(function (id) {
        t.H += rekap[id].H; t.S += rekap[id].S; t.I += rekap[id].I; t.A += rekap[id].A;
      });
      var totalDicatat = t.H + t.S + t.I + t.A;
      var persenKelas = totalDicatat > 0 ? Math.round((t.H / totalDicatat) * 1000) / 10 : 0;
      barisKelas.push([kelas.namaKelas, siswaKelas.length, t.H, t.S, t.I, t.A, persenKelas + '%']);
    });
    shKelas.getRange(1, 1, barisKelas.length, headerKelas.length).setValues(barisKelas);
    formatHeaderSheet_(shKelas, headerKelas.length);

    daftarKelas.forEach(function (kelas) {
      var siswaKelas = siswaAktifPadaKelas_(siswaSemua, kelas.idKelas);
      bulanList.forEach(function (bl) {
        tulisSheetGridKehadiran_(ss, kelas, siswaKelas, bl.tahun, bl.bulan);
      });
    });

    var namaFileDasar = 'Laporan Kehadiran - ' + namaRingkasKelas_(daftarKelas) + ' - ' + tglMulai + ' sd ' + tglSelesai;
    var hasil = eksporSpreadsheet_(ss, format, namaFileDasar);
    catatLog_(sesi.username, 'unduh_laporan_kehadiran', namaFileDasar);
    return hasil;
  } finally {
    DriveApp.getFileById(ss.getId()).setTrashed(true);
  }
}

function buatLaporanInfaq(token, opts) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  opts = opts || {};
  var tglMulai = validasiTanggal_(opts.tglMulai);
  var tglSelesai = validasiTanggal_(opts.tglSelesai);
  if (tglMulai > tglSelesai) throw new Error('Tanggal mulai harus sebelum atau sama dengan tanggal selesai.');
  var format = validasiFormatLaporan_(opts.format);

  var daftarKelas = kelasUntukLaporan_(opts.idKelas);
  if (!daftarKelas.length) throw new Error('Kelas tidak ditemukan.');
  var idKelasFilter = daftarKelas.length === 1 ? daftarKelas[0].idKelas : null;

  var siswaSemua = bacaSemuaBaris_(SHEET.SISWA);
  var ss = SpreadsheetApp.create('Laporan Infaq TPA ' + tglMulai + '_sd_' + tglSelesai);

  try {
    var shRekap = ss.getSheets()[0];
    shRekap.setName('Rekap Infaq');
    var headerRekap = ['No', 'Nama', 'Kelas', 'Total Infaq (Rp)'];
    var barisRekap = [headerRekap];
    var no = 1;
    var grandTotal = 0;
    var totalPerKelas = [];

    daftarKelas.forEach(function (kelas) {
      var siswaKelas = siswaAktifPadaKelas_(siswaSemua, kelas.idKelas);
      var idList = siswaKelas.map(function (s) { return s.id_siswa; });
      var rekap = rekapInfaqPeriode_(idList, tglMulai, tglSelesai);
      var totalKelas = 0;
      siswaKelas.forEach(function (s) {
        var jumlah = rekap[s.id_siswa] || 0;
        totalKelas += jumlah;
        barisRekap.push([no++, s.nama, kelas.namaKelas, jumlah]);
      });
      totalPerKelas.push([kelas.namaKelas, totalKelas]);
      grandTotal += totalKelas;
    });
    barisRekap.push(['', '', '', '']);
    totalPerKelas.forEach(function (t) { barisRekap.push(['', 'Subtotal ' + t[0], '', t[1]]); });
    barisRekap.push(['', 'GRAND TOTAL', '', grandTotal]);

    shRekap.getRange(1, 1, barisRekap.length, headerRekap.length).setValues(barisRekap);
    shRekap.getRange(2, 4, barisRekap.length - 1, 1).setNumberFormat('#,##0');
    formatHeaderSheet_(shRekap, headerRekap.length);

    var shRincian = ss.insertSheet('Rincian Transaksi');
    var headerRincian = ['Tanggal', 'Nama', 'Kelas', 'Jumlah (Rp)', 'Metode', 'Keterangan'];
    var rincian = rincianInfaqPeriode_(idKelasFilter, tglMulai, tglSelesai);
    var barisRincian = [headerRincian].concat(rincian.map(function (r) {
      return [formatTanggalIndo_(r.tanggal), r.namaSiswa, r.namaKelas, r.jumlah, r.metode, r.keterangan];
    }));
    shRincian.getRange(1, 1, barisRincian.length, headerRincian.length).setValues(barisRincian);
    if (barisRincian.length > 1) shRincian.getRange(2, 4, barisRincian.length - 1, 1).setNumberFormat('#,##0');
    formatHeaderSheet_(shRincian, headerRincian.length);

    var namaFileDasar = 'Laporan Infaq - ' + namaRingkasKelas_(daftarKelas) + ' - ' + tglMulai + ' sd ' + tglSelesai;
    var hasil = eksporSpreadsheet_(ss, format, namaFileDasar);
    catatLog_(sesi.username, 'unduh_laporan_infaq', namaFileDasar);
    return hasil;
  } finally {
    DriveApp.getFileById(ss.getId()).setTrashed(true);
  }
}

// ---------- Helper laporan ----------

function validasiFormatLaporan_(format) {
  format = format || 'xlsx';
  if (FORMAT_LAPORAN_VALID.indexOf(format) === -1) throw new Error('Format unduhan tidak valid.');
  return format;
}

function kelasUntukLaporan_(idKelas) {
  var semua = daftarKelasMentah_().sort(function (a, b) { return a.urutan - b.urutan; });
  if (!idKelas || idKelas === 'SEMUA') return semua;
  return semua.filter(function (k) { return k.idKelas === idKelas; });
}

function siswaAktifPadaKelas_(siswaSemua, idKelas) {
  return siswaSemua
    .filter(function (s) { return s.id_kelas === idKelas && s.status === STATUS_SISWA.AKTIF; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); });
}

function namaRingkasKelas_(daftarKelas) {
  return daftarKelas.length === 1 ? daftarKelas[0].namaKelas : 'Semua Kelas';
}

function bulanBulanDalamRentang_(tglMulai, tglSelesai) {
  var mulai = new Date(tglMulai + 'T00:00:00');
  var selesai = new Date(tglSelesai + 'T00:00:00');
  var hasil = [];
  var tahun = mulai.getFullYear(), bulan = mulai.getMonth() + 1;
  var tahunAkhir = selesai.getFullYear(), bulanAkhir = selesai.getMonth() + 1;
  while (tahun < tahunAkhir || (tahun === tahunAkhir && bulan <= bulanAkhir)) {
    hasil.push({ tahun: tahun, bulan: bulan });
    bulan++;
    if (bulan > 12) { bulan = 1; tahun++; }
  }
  return hasil;
}

function tulisSheetGridKehadiran_(ss, kelas, siswaKelas, tahun, bulan) {
  var jumlahHari = new Date(tahun, bulan, 0).getDate();
  var prefix = tahun + '-' + Utilities.formatString('%02d', bulan) + '-';
  var namaSheet = namaSheetUnik_(ss, 'Grid ' + kelas.namaKelas + ' ' + NAMA_BULAN_INDO_SINGKAT[bulan - 1] + tahun);
  var sh = ss.insertSheet(namaSheet);

  var header = ['No', 'Nama'];
  for (var h = 1; h <= jumlahHari; h++) header.push(String(h));
  header.push('H', 'S', 'I', 'A', '%');

  var dataPerSiswa = {};
  siswaKelas.forEach(function (s) { dataPerSiswa[s.id_siswa] = {}; });
  bacaSemuaBaris_(SHEET.KEHADIRAN).forEach(function (k) {
    if (k.id_kelas !== kelas.idKelas) return;
    if (String(k.tanggal).indexOf(prefix) !== 0) return;
    if (!dataPerSiswa[k.id_siswa]) return;
    var tgl = Number(String(k.tanggal).slice(8, 10));
    dataPerSiswa[k.id_siswa][tgl] = k.status;
  });

  var baris = [header];
  siswaKelas.forEach(function (s, i) {
    var row = [i + 1, s.nama];
    var hitung = { H: 0, S: 0, I: 0, A: 0 };
    for (var h2 = 1; h2 <= jumlahHari; h2++) {
      var st = dataPerSiswa[s.id_siswa][h2] || '';
      row.push(st);
      if (hitung[st] !== undefined) hitung[st]++;
    }
    var totalDicatat = hitung.H + hitung.S + hitung.I + hitung.A;
    var persen = totalDicatat > 0 ? Math.round((hitung.H / totalDicatat) * 1000) / 10 : 0;
    row.push(hitung.H, hitung.S, hitung.I, hitung.A, persen + '%');
    baris.push(row);
  });

  sh.getRange(1, 1, baris.length, header.length).setValues(baris);
  formatHeaderSheet_(sh, header.length);
  sh.setFrozenColumns(2);
}

function formatHeaderSheet_(sh, jumlahKolom) {
  sh.getRange(1, 1, 1, jumlahKolom).setFontWeight('bold').setBackground('#10403B').setFontColor('#EAF3F0');
  sh.setFrozenRows(1);
  try { sh.autoResizeColumns(1, jumlahKolom); } catch (e) { /* kolom terlalu banyak untuk auto-resize, abaikan */ }
}

function namaSheetAman_(s) {
  return String(s).replace(/[\[\]\*\?\/\\:]/g, '-').slice(0, 95);
}

function namaSheetUnik_(ss, namaDiinginkan) {
  var dasar = namaSheetAman_(namaDiinginkan);
  var nama = dasar;
  var i = 2;
  while (ss.getSheetByName(nama)) {
    nama = (dasar + ' (' + i + ')').slice(0, 95);
    i++;
  }
  return nama;
}

// ---------- Ekspor ke Drive (.xlsx / PDF) ----------

function getLaporanFolder_() {
  var iter = DriveApp.getFoldersByName(NAMA_FOLDER_LAPORAN);
  if (iter.hasNext()) return iter.next();
  return DriveApp.createFolder(NAMA_FOLDER_LAPORAN);
}

/** Buang file ekspor lebih lama dari 24 jam supaya folder Drive tidak menumpuk. */
function bersihkanLaporanLama_(folder) {
  var batas = Date.now() - 24 * 60 * 60 * 1000;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    try {
      if (f.getDateCreated().getTime() < batas) f.setTrashed(true);
    } catch (e) { /* abaikan, jangan sampai laporan baru gagal gara-gara file lama */ }
  }
}

function eksporSpreadsheet_(ss, format, namaFileDasar) {
  var folder = getLaporanFolder_();
  bersihkanLaporanLama_(folder);

  var id = ss.getId();
  var oauthToken = ScriptApp.getOAuthToken();
  var hasil = {};

  if (format === 'xlsx' || format === 'keduanya') {
    var blobXlsx = UrlFetchApp.fetch(
      'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + oauthToken } }
    ).getBlob();
    blobXlsx.setName(namaFileDasar + '.xlsx');
    hasil.xlsxUrl = simpanKeFolder_(folder, blobXlsx);
  }

  if (format === 'pdf' || format === 'keduanya') {
    var urlPdf = 'https://docs.google.com/spreadsheets/d/' + id + '/export' +
      '?format=pdf&size=A4&portrait=false&fitw=true&gridlines=true' +
      '&printtitle=false&sheetnames=true&pagenumbers=true' +
      '&top_margin=0.4&bottom_margin=0.4&left_margin=0.3&right_margin=0.3';
    var blobPdf = UrlFetchApp.fetch(urlPdf, { headers: { Authorization: 'Bearer ' + oauthToken } }).getBlob();
    blobPdf.setName(namaFileDasar + '.pdf');
    hasil.pdfUrl = simpanKeFolder_(folder, blobPdf);
  }

  return hasil;
}

function simpanKeFolder_(folder, blob) {
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}
