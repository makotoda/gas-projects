/**
 * Setup.gs — jalankan setup() SEKALI dari editor Apps Script (pilih fungsi "setup",
 * klik Run) untuk menyiapkan seluruh struktur data. Aman dijalankan berkali-kali:
 * langkah yang datanya sudah ada akan dilewati (idempoten).
 *
 * Kenapa TANPA underscore: fungsi ber-underscore TIDAK muncul di dropdown "Run" editor
 * Apps Script, sehingga tidak bisa dijalankan manual sama sekali. Entry point setup ini
 * WAJIB bisa dijalankan dari editor, jadi namanya tidak boleh diakhiri underscore.
 *
 * Keamanan RPC: meski tanpa underscore membuat setup() bisa dipanggil lewat
 * google.script.run, fungsi ini SENGAJA tidak me-return kredensial apa pun. Password
 * super admin awal HANYA ditulis ke Logger.log (Execution log), yang tidak bisa dibaca
 * oleh pemanggil RPC. Jadi walau ada yang memanggil google.script.run.setup() dari
 * devtools, dia tidak memperoleh data sensitif — nilai kembaliannya hanya pesan generik.
 *
 * Setelah setup() selesai, baca hasilnya di "Execution log" — kredensial super admin
 * awal HANYA ditampilkan sekali di sana.
 */

function setup() {
  var ringkasan = [];

  var ss = pastikanSpreadsheet_();
  ringkasan.push('Spreadsheet: ' + ss.getUrl());

  Object.keys(HEADER).forEach(function (namaSheet) {
    pastikanSheetDanHeader_(ss, namaSheet);
  });
  bersihkanSheetDefault_(ss);
  ringkasan.push('Sheet & header siap: ' + Object.keys(HEADER).join(', '));

  paksaFormatKolomTeks_(ss);

  ringkasan.push(seedKelasAwal_(ss));
  ringkasan.push(seedSuperAdminAwal_(ss));

  // Detail lengkap (termasuk password super admin awal) HANYA ke log, tidak di-return.
  Logger.log(ringkasan.join('\n'));

  // Nilai kembalian sengaja generik supaya pemanggil RPC tidak mendapat kredensial.
  return 'Setup selesai. Buka "Execution log" di editor untuk melihat kredensial super admin awal (hanya tampil sekali).';
}

function pastikanSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('SPREADSHEET_ID di Script Properties ("' + id + '") tidak bisa dibuka: ' + e.message);
    }
  }
  var ss = SpreadsheetApp.create('Database TPA Al-Mukhlisin');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function pastikanSheetDanHeader_(ss, namaSheet) {
  var sh = ss.getSheetByName(namaSheet);
  if (!sh) {
    sh = ss.insertSheet(namaSheet);
  }
  var header = HEADER[namaSheet];
  var headerSaatIni = sh.getRange(1, 1, 1, header.length).getValues()[0];
  var sudahSesuai = header.every(function (h, i) { return headerSaatIni[i] === h; });
  if (!sudahSesuai) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#10403B').setFontColor('#EAF3F0');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, header.length);
  }
  return sh;
}

function bersihkanSheetDefault_(ss) {
  var sh = ss.getSheetByName('Sheet1');
  if (sh && ss.getSheets().length > 1 && sh.getLastRow() === 0 && sh.getLastColumn() === 0) {
    ss.deleteSheet(sh);
  }
}

/**
 * Paksa kolom berisi tanggal/jam/nomor HP/kode PIN menjadi format Teks Biasa ("@").
 * Tanpa ini, Sheets otomatis mengonversi "2026-07-20" jadi tanggal serial dan
 * "0042"/"081234..." jadi angka (menghilangkan nol di depan) — merusak semua
 * perbandingan string yang dipakai kode ini (tanggal, kode_publik, dst).
 * Pakai notasi "D:D" (satu kolom penuh) supaya berlaku juga untuk baris yang
 * ditambahkan nanti, bukan cuma baris yang sudah ada saat setup() dijalankan.
 *
 * Daftar kolomnya diambil dari KOLOM_TANGGAL/KOLOM_WAKTU/KOLOM_KODE (Util.gs) --
 * SATU-SATUNYA sumber kebenaran, dipakai juga oleh bacaSemuaBaris_ untuk memulihkan
 * objek Date yang lolos meski sudah diformat (lihat komentar di sana). Jangan buat
 * daftar terpisah di sini -- dua daftar yang bisa saling menyimpang justru salah satu
 * akar masalah yang pernah bikin bug ini muncul lagi di sheet yang berbeda.
 */
function paksaFormatKolomTeks_(ss) {
  var target = [].concat(KOLOM_TANGGAL, KOLOM_WAKTU, KOLOM_KODE);
  target.forEach(function (t) {
    var sh = ss.getSheetByName(t[0]);
    var indeksKolom = HEADER[t[0]].indexOf(t[1]) + 1;
    var huruf = hurufKolom_(indeksKolom);
    sh.getRange(huruf + ':' + huruf).setNumberFormat('@');
  });
}

function hurufKolom_(indeks1Based) {
  var s = '';
  var n = indeks1Based;
  while (n > 0) {
    var sisa = (n - 1) % 26;
    s = String.fromCharCode(65 + sisa) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function seedKelasAwal_(ss) {
  var sh = ss.getSheetByName(SHEET.KELAS);
  if (sh.getLastRow() > 1) {
    return 'Kelas: sudah ada data, tidak diseed ulang.';
  }
  var idYangSudahAda = [];
  var baris = KELAS_AWAL.map(function (k) {
    var id = slugKelas_(k.nama_kelas, idYangSudahAda);
    idYangSudahAda.push(id);
    return [id, k.nama_kelas, k.jadwal || '', k.wali_kelas || '', k.urutan, true];
  });
  sh.getRange(2, 1, baris.length, HEADER[SHEET.KELAS].length).setValues(baris);
  return 'Kelas: ' + baris.length + ' kelas awal ditambahkan (' +
    KELAS_AWAL.map(function (k) { return k.nama_kelas; }).join(', ') + ').';
}

function seedSuperAdminAwal_(ss) {
  var sh = ss.getSheetByName(SHEET.ADMIN);
  if (sh.getLastRow() > 1) {
    return 'Admin: sudah ada akun, tidak membuat super admin baru.';
  }
  var username = 'superadmin';
  var passwordAwal = passwordAcak_(10);
  var salt = Utilities.getUuid();
  var hash = hashPassword_(passwordAwal, salt);
  sh.getRange(2, 1, 1, HEADER[SHEET.ADMIN].length).setValues([[
    'ADM-0001', 'Super Admin', username, hash, salt, PERAN.SUPER_ADMIN, true, ''
  ]]);
  PropertiesService.getScriptProperties().setProperty('SEQ_ADM', '1');
  return 'Admin: super admin awal dibuat.\n' +
    '  username : ' + username + '\n' +
    '  password : ' + passwordAwal + '\n' +
    '  >>> SEGERA LOGIN DAN GANTI PASSWORD INI DARI MENU AKUN. Pesan ini hanya tampil sekali. <<<';
}

function passwordAcak_(panjang) {
  var karakter = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var hasil = '';
  for (var i = 0; i < panjang; i++) {
    hasil += karakter.charAt(Math.floor(Math.random() * karakter.length));
  }
  return hasil;
}
