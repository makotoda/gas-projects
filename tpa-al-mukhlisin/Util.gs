/**
 * Util.gs — konstanta bersama, helper baca/tulis Sheet, format, dan validasi.
 *
 * Konvensi projek ini:
 * - Fungsi TANPA akhiran "_" adalah endpoint yang dipanggil client lewat google.script.run.
 * - Fungsi berakhiran "_" adalah helper internal, tidak pernah dipanggil dari client.
 * - Fungsi mutasi mengembalikan hasil kecil yang relevan saja (mis. { ok:true, siswa:{...} }),
 *   BUKAN seluruh dashboard — client memanggil ulang fungsi list/get terkait untuk refresh.
 *   (Ini beda dengan konvensi projek Kodomo yang mengembalikan seluruh dashboard tiap mutasi;
 *   TPA punya banyak tampilan besar independen sehingga pola itu boros di sini.)
 * - Error selalu dilempar sebagai `throw new Error('pesan singkat berbahasa Indonesia')`,
 *   ditangkap client lewat withFailureHandler(err => toast(err.message, 'error')).
 * - Sheet yang belum ada TIDAK auto-heal saat dibaca — getSheet_ melempar error yang jelas
 *   dan mengarahkan menjalankan setup(). Sheet hanya pernah dibuat oleh Setup.gs, supaya
 *   penghapusan sheet yang tidak sengaja tidak diam-diam mereset data (lihat catatan di README).
 */

var SHEET = {
  KELAS: 'Kelas',
  SISWA: 'Siswa',
  KEHADIRAN: 'Kehadiran',
  INFAQ: 'Infaq',
  PENGELUARAN: 'Pengeluaran',
  ADMIN: 'Admin',
  LOG: 'Log'
};

var HEADER = {};
HEADER[SHEET.KELAS] = ['id_kelas', 'nama_kelas', 'jadwal', 'wali_kelas', 'urutan', 'aktif'];
HEADER[SHEET.SISWA] = ['id_siswa', 'nama', 'jenis_kelamin', 'id_kelas', 'nama_wali', 'no_hp_wali', 'tanggal_masuk', 'status', 'catatan', 'kode_publik'];
HEADER[SHEET.KEHADIRAN] = ['id', 'id_siswa', 'id_kelas', 'tanggal', 'status', 'dicatat_oleh', 'timestamp'];
// 'sumber_lain' SENGAJA ditambahkan di UJUNG (bukan disisipkan di tengah) -- baris lama
// tanpa kolom ini tetap aman, posisi kolom lain tak berubah. Diisi HANYA kalau id_siswa
// kosong (infaq dari donatur/sumber non-siswa, mis. kotak amal); untuk infaq siswa biasa
// kolom ini tetap kosong. Lihat simpanInfaqSatuan di Infaq.gs.
HEADER[SHEET.INFAQ] = ['id', 'id_siswa', 'id_kelas', 'tanggal', 'jumlah', 'metode', 'keterangan', 'dicatat_oleh', 'timestamp', 'sumber_lain'];
HEADER[SHEET.PENGELUARAN] = ['id', 'tanggal', 'kategori', 'jumlah', 'keterangan', 'dicatat_oleh', 'timestamp'];
HEADER[SHEET.ADMIN] = ['id_admin', 'nama', 'username', 'password_hash', 'salt', 'peran', 'aktif', 'terakhir_login'];
HEADER[SHEET.LOG] = ['timestamp', 'username', 'aksi', 'detail'];

var STATUS_KEHADIRAN = ['H', 'S', 'I', 'A'];
var LABEL_STATUS_KEHADIRAN = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa' };
var PERAN = { SUPER_ADMIN: 'super_admin', ADMIN: 'admin' };
var STATUS_SISWA = { AKTIF: 'Aktif', NONAKTIF: 'Nonaktif' };
var METODE_INFAQ = ['Tunai', 'Transfer', 'QRIS'];
// Kategori pengeluaran kas TPA. Daftar ini di-hardcode SAMA di infaq.html (dropdown) --
// kalau menambah/mengubah kategori, ubah dua tempat (lihat pola METODE_INFAQ yang sama).
var KATEGORI_PENGELUARAN = ['Honor Pengajar', 'Konsumsi', 'ATK & Perlengkapan', 'Operasional', 'Kegiatan Santri', 'Lainnya'];

// ---------- Kolom yang WAJIB string, dipulihkan otomatis oleh bacaSemuaBaris_ ----------
// Meski sudah diformat Teks Biasa ('@') lewat paksaFormatKolomTeks_ (lihat Setup.gs),
// Google Sheets kadang tetap mengembalikan sel tanggal sebagai objek Date ASLI lewat
// getValues() -- bukan cuma untuk sheet yang baru dibuat, terbukti juga terjadi pada sheet
// Infaq yang sudah lama dipakai (lihat riwayat perbaikan Pengeluaran.gs). Kalau objek Date
// itu lolos sampai ke return value fungsi yang dipanggil client, google.script.run GAGAL
// men-serialize SELURUH respons dan client cuma menerima `null` (bukan error yang jelas).
// Daftar ini SATU-SATUNYA sumber kebenaran (dipakai juga oleh paksaFormatKolomTeks_ di
// Setup.gs supaya kedua daftar tidak bisa saling menyimpang) -- perbaikannya diterapkan
// SEKALI di bacaSemuaBaris_ supaya SEMUA fungsi yang membaca sheet manapun otomatis aman,
// bukan ditambal satu-satu tiap kali bug ini muncul lagi di sheet lain.
var KOLOM_TANGGAL = [ // format string "yyyy-MM-dd"
  [SHEET.SISWA, 'tanggal_masuk'],
  [SHEET.KEHADIRAN, 'tanggal'],
  [SHEET.INFAQ, 'tanggal'],
  [SHEET.PENGELUARAN, 'tanggal']
];
var KOLOM_WAKTU = [ // format string "yyyy-MM-dd HH:mm:ss"
  [SHEET.KEHADIRAN, 'timestamp'],
  [SHEET.INFAQ, 'timestamp'],
  [SHEET.PENGELUARAN, 'timestamp'],
  [SHEET.ADMIN, 'terakhir_login'],
  [SHEET.LOG, 'timestamp']
];
var KOLOM_KODE = [ // risiko beda (ke-Number-kan, nol di depan hilang -- bukan ke-Date-kan),
  [SHEET.SISWA, 'no_hp_wali'],  // tapi sama-sama perlu String() paksa saat dibaca.
  [SHEET.SISWA, 'kode_publik']
];

// 6 kelas awal TPA Al-Mukhlisin (lihat konteks §2 prompt).
var KELAS_AWAL = [
  { nama_kelas: 'A', urutan: 1 },
  { nama_kelas: 'B1', urutan: 2 },
  { nama_kelas: 'BB', urutan: 3 },
  { nama_kelas: 'C Siang', urutan: 4 },
  { nama_kelas: 'C Sore', urutan: 5 },
  { nama_kelas: 'D', urutan: 6 }
];

// ---------- Spreadsheet & Sheet ----------

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('SPREADSHEET_ID belum diatur di Script Properties. Jalankan setup() dari editor Apps Script terlebih dahulu.');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(nama) {
  var sh = getSpreadsheet_().getSheetByName(nama);
  if (!sh) {
    throw new Error('Sheet "' + nama + '" tidak ditemukan. Jalankan setup() dari editor Apps Script terlebih dahulu.');
  }
  return sh;
}

/** Baca seluruh baris data (tanpa header) sebagai array of object. Menyimpan _row = nomor baris asli. */
function bacaSemuaBaris_(namaSheet) {
  var sh = getSheet_(namaSheet);
  var header = HEADER[namaSheet];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, header.length).getValues();
  var hasil = [];
  for (var i = 0; i < values.length; i++) {
    var obj = { _row: i + 2 };
    for (var k = 0; k < header.length; k++) obj[header[k]] = values[i][k];
    paksaKolomTeksBaris_(namaSheet, obj);
    hasil.push(obj);
  }
  return hasil;
}

/** Lihat komentar di atas KOLOM_TANGGAL/KOLOM_WAKTU/KOLOM_KODE -- pulihkan objek Date asli
 * (kalau Sheets mengembalikannya begitu meski sudah diformat Teks Biasa) jadi string yang
 * benar SEBELUM data ini sempat dipakai untuk perbandingan string ("2026-07-01" < ...) atau
 * lolos ke return value RPC (yang bisa membuat google.script.run mengembalikan `null`). */
function paksaKolomTeksBaris_(namaSheet, obj) {
  KOLOM_TANGGAL.forEach(function (t) {
    if (t[0] === namaSheet && obj[t[1]] instanceof Date) {
      obj[t[1]] = Utilities.formatDate(obj[t[1]], 'Asia/Jakarta', 'yyyy-MM-dd');
    }
  });
  KOLOM_WAKTU.forEach(function (t) {
    if (t[0] === namaSheet && obj[t[1]] instanceof Date) {
      obj[t[1]] = Utilities.formatDate(obj[t[1]], 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
    }
  });
  KOLOM_KODE.forEach(function (t) {
    if (t[0] === namaSheet && obj[t[1]] !== '' && obj[t[1]] !== undefined && obj[t[1]] !== null) {
      obj[t[1]] = String(obj[t[1]]);
    }
  });
}

function tambahBaris_(namaSheet, obj) {
  var sh = getSheet_(namaSheet);
  var header = HEADER[namaSheet];
  var row = header.map(function (key) {
    return obj[key] !== undefined && obj[key] !== null ? obj[key] : '';
  });
  sh.appendRow(row);
  return sh.getLastRow();
}

function tambahBanyakBaris_(namaSheet, daftarObj) {
  if (!daftarObj || !daftarObj.length) return;
  var sh = getSheet_(namaSheet);
  var header = HEADER[namaSheet];
  var rows = daftarObj.map(function (obj) {
    return header.map(function (key) {
      return obj[key] !== undefined && obj[key] !== null ? obj[key] : '';
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
}

function timpaBaris_(namaSheet, nomorBaris, obj) {
  var sh = getSheet_(namaSheet);
  var header = HEADER[namaSheet];
  var row = header.map(function (key) {
    return obj[key] !== undefined && obj[key] !== null ? obj[key] : '';
  });
  sh.getRange(nomorBaris, 1, 1, header.length).setValues([row]);
}

function cariBarisById_(namaSheet, kolomId, nilaiId) {
  var semua = bacaSemuaBaris_(namaSheet);
  for (var i = 0; i < semua.length; i++) {
    if (String(semua[i][kolomId]) === String(nilaiId)) return semua[i];
  }
  return null;
}

// ---------- Lock (wajib untuk operasi baca-lalu-tulis) ----------

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Sistem sedang sibuk memproses data lain, silakan coba lagi.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- Generator ID yang mudah dibaca ----------
// Dipanggil DI DALAM withLock_ milik pemanggil supaya alokasi nomor urut aman dari race condition.

function alokasikanId_(prefix, jumlah) {
  var props = PropertiesService.getScriptProperties();
  var kunci = 'SEQ_' + prefix;
  var mulai = Number(props.getProperty(kunci) || '0') + 1;
  var akhir = mulai + jumlah - 1;
  props.setProperty(kunci, String(akhir));
  var hasil = [];
  for (var n = mulai; n <= akhir; n++) {
    hasil.push(prefix + '-' + Utilities.formatString('%04d', n));
  }
  return hasil;
}

function slugKelas_(namaKelas, idYangSudahAda) {
  var dasar = String(namaKelas).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kelas';
  var slug = dasar;
  var i = 2;
  while (idYangSudahAda.indexOf(slug) !== -1) {
    slug = dasar + '-' + i;
    i++;
  }
  return slug;
}

function kodePublikBaru_(kodeYangSudahAda) {
  var kode;
  var percobaan = 0;
  do {
    kode = Utilities.formatString('%04d', Math.floor(Math.random() * 10000));
    percobaan++;
  } while (kodeYangSudahAda.indexOf(kode) !== -1 && percobaan < 50);
  return kode;
}

// ---------- Format ----------

function formatRupiah_(angka) {
  var n = Math.round(Number(angka) || 0);
  var negatif = n < 0;
  n = Math.abs(n);
  var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negatif ? '-Rp ' : 'Rp ') + s;
}

var NAMA_BULAN_INDO = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var NAMA_BULAN_INDO_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatTanggalIndo_(tanggalStr, singkat) {
  if (!tanggalStr) return '-';
  var parts = String(tanggalStr).split('-');
  if (parts.length !== 3) return String(tanggalStr);
  var tahun = parts[0], bulan = Number(parts[1]), tgl = Number(parts[2]);
  var namaBulan = singkat ? NAMA_BULAN_INDO_SINGKAT[bulan - 1] : NAMA_BULAN_INDO[bulan - 1];
  return tgl + ' ' + namaBulan + ' ' + tahun;
}

function hariIniStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
}

function jamSekarangStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
}

function bulanIniInfo_() {
  var now = new Date();
  return {
    tahun: Number(Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy')),
    bulan: Number(Utilities.formatDate(now, 'Asia/Jakarta', 'MM'))
  };
}

// ---------- Validasi ----------

function wajibIsi_(nilai, namaField) {
  if (nilai === undefined || nilai === null || String(nilai).trim() === '') {
    throw new Error(namaField + ' wajib diisi.');
  }
  return String(nilai).trim();
}

var POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function validasiTanggal_(str) {
  if (!str || !POLA_TANGGAL.test(str)) {
    throw new Error('Format tanggal tidak valid, gunakan yyyy-MM-dd.');
  }
  var d = new Date(str + 'T00:00:00');
  if (isNaN(d.getTime())) {
    throw new Error('Tanggal tidak valid.');
  }
  return str;
}

function validasiStatusKehadiran_(status) {
  if (STATUS_KEHADIRAN.indexOf(status) === -1) {
    throw new Error('Status kehadiran tidak valid: ' + status);
  }
  return status;
}

var JENIS_KELAMIN_VALID = ['', 'L', 'P'];

function validasiJenisKelamin_(nilai) {
  var v = nilai || '';
  if (JENIS_KELAMIN_VALID.indexOf(v) === -1) {
    throw new Error('Jenis kelamin harus L, P, atau dikosongkan.');
  }
  return v;
}

function validasiKategoriPengeluaran_(nilai) {
  if (KATEGORI_PENGELUARAN.indexOf(nilai) === -1) {
    throw new Error('Kategori pengeluaran tidak valid.');
  }
  return nilai;
}

// Dipakai bersama oleh Infaq.gs (jumlah infaq) dan Pengeluaran.gs (jumlah pengeluaran) --
// makanya pesannya generik "Jumlah", bukan spesifik "Jumlah infaq".
function validasiNominal_(nilai) {
  var n = Number(nilai);
  if (isNaN(n) || n <= 0) {
    throw new Error('Jumlah harus berupa angka lebih dari 0.');
  }
  return Math.round(n);
}

// ---------- Peta lookup bersama (dipakai lintas modul: Siswa, Kehadiran, Infaq, Laporan, Publik) ----------

function petaKelasById_() {
  var peta = {};
  bacaSemuaBaris_(SHEET.KELAS).forEach(function (k) { peta[k.id_kelas] = k.nama_kelas; });
  return peta;
}

function petaSiswaById_() {
  var peta = {};
  bacaSemuaBaris_(SHEET.SISWA).forEach(function (s) {
    peta[s.id_siswa] = { nama: s.nama, idKelas: s.id_kelas, status: s.status };
  });
  return peta;
}

// ---------- Log audit ----------

function catatLog_(username, aksi, detail) {
  try {
    var sh = getSheet_(SHEET.LOG);
    sh.appendRow([jamSekarangStr_(), username || '-', aksi, detail || '']);
  } catch (e) {
    // Kegagalan mencatat log tidak boleh menggagalkan aksi utama.
  }
}
