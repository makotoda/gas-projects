/**
 * Migrasi.gs — alat SEKALI-PAKAI untuk memindahkan seluruh isi database (semua sheet di
 * HEADER) dari spreadsheet lama ke spreadsheet baru, lalu mengarahkan SPREADSHEET_ID ke
 * sana. Dibuat terpisah dari Setup.gs karena ini bukan bagian alur normal aplikasi —
 * boleh dihapus dari project setelah dipakai.
 *
 * Cara pakai: jalankan pindahkanDatabase() SATU KALI dari dropdown fungsi di editor
 * (sama seperti setup() dulu). Spreadsheet LAMA tidak disentuh/dihapus sama sekali —
 * tetap ada sebagai cadangan; hapus manual sendiri nanti kalau sudah yakin migrasi sukses.
 *
 * Aman dijalankan ulang secara tidak sengaja: kalau SPREADSHEET_ID sudah menunjuk ke
 * tujuan, fungsi berhenti tanpa melakukan apa-apa. Kalau sheet dengan nama yang sama
 * SUDAH ADA BERISI DATA di tujuan (mis. migrasi sebelumnya sempat berjalan sebagian),
 * fungsi berhenti dengan error dan TIDAK menimpa apa pun -- supaya tidak ada data yang
 * hilang atau terduplikasi diam-diam.
 */

var ID_SPREADSHEET_TUJUAN_MIGRASI = '1iKg8FJ4UuQ7BHf7G56OYXyIjT1-zHdRnOv_L_Va-XSs';

function pindahkanDatabase() {
  var props = PropertiesService.getScriptProperties();
  var idSumber = props.getProperty('SPREADSHEET_ID');
  if (!idSumber) {
    throw new Error('SPREADSHEET_ID belum diatur -- belum ada database untuk dipindah. Jalankan setup() dulu.');
  }
  if (idSumber === ID_SPREADSHEET_TUJUAN_MIGRASI) {
    return 'SPREADSHEET_ID sudah menunjuk ke spreadsheet tujuan (' + ID_SPREADSHEET_TUJUAN_MIGRASI + '). Tidak ada yang dipindah.';
  }

  var sumber;
  try {
    sumber = SpreadsheetApp.openById(idSumber);
  } catch (e) {
    throw new Error('Spreadsheet SUMBER ("' + idSumber + '") tidak bisa dibuka: ' + e.message);
  }
  var tujuan;
  try {
    tujuan = SpreadsheetApp.openById(ID_SPREADSHEET_TUJUAN_MIGRASI);
  } catch (e) {
    throw new Error('Spreadsheet TUJUAN ("' + ID_SPREADSHEET_TUJUAN_MIGRASI + '") tidak bisa dibuka -- pastikan ID benar ' +
      'dan akun yang menjalankan fungsi ini punya akses edit ke sana: ' + e.message);
  }

  var ringkasan = [];
  ringkasan.push('Sumber : ' + sumber.getUrl());
  ringkasan.push('Tujuan : ' + tujuan.getUrl());
  ringkasan.push('');

  Object.keys(HEADER).forEach(function (namaSheet) {
    var shSumber = sumber.getSheetByName(namaSheet);
    if (!shSumber) {
      ringkasan.push(namaSheet + ': tidak ada di sumber (mungkin fitur baru, belum pernah dibuat) -- dilewati.');
      return;
    }

    var shTujuanLama = tujuan.getSheetByName(namaSheet);
    if (shTujuanLama) {
      if (shTujuanLama.getLastRow() > 1) {
        throw new Error('Sheet "' + namaSheet + '" di spreadsheet TUJUAN sudah berisi data (' +
          (shTujuanLama.getLastRow() - 1) + ' baris). Migrasi dihentikan di sini supaya tidak menimpa/' +
          'menduplikasi data yang sudah ada di tujuan. Sheet lain yang belum diproses BELUM ikut tersalin. ' +
          'Periksa manual dulu sheet ini di spreadsheet tujuan sebelum menjalankan ulang.');
      }
      tujuan.deleteSheet(shTujuanLama);
    }

    var jumlahBaris = Math.max(shSumber.getLastRow() - 1, 0);
    var salinan = shSumber.copyTo(tujuan);
    salinan.setName(namaSheet);
    ringkasan.push(namaSheet + ': ' + jumlahBaris + ' baris data disalin.');
  });

  bersihkanSheetDefault_(tujuan);

  props.setProperty('SPREADSHEET_ID', ID_SPREADSHEET_TUJUAN_MIGRASI);
  ringkasan.push('');
  ringkasan.push('SPREADSHEET_ID diarahkan ke: ' + ID_SPREADSHEET_TUJUAN_MIGRASI);

  // setup() idempoten: membuat sheet yang belum ada di sumber (mis. Pengeluaran, fitur
  // baru yang belum sempat di-setup di database lama) dan menerapkan ulang format kolom
  // teks -- tidak menimpa/menduplikasi data yang baru saja disalin (kelas/admin sudah ada
  // -> dilewati, sheet yang sudah ada headernya -> dilewati juga).
  ringkasan.push('');
  ringkasan.push('--- Menjalankan setup() di spreadsheet tujuan ---');
  ringkasan.push(setup());

  var pesan = ringkasan.join('\n');
  Logger.log(pesan);
  return pesan;
}
