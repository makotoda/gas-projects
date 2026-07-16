/**
 * Survei Ortala Ditjen Bimas Hindu
 * ---------------------------------
 * Web app Google Apps Script mandiri (standalone) yang menampilkan DUA survei
 * dalam satu halaman, masing-masing di dalam card besar terpisah:
 *   1) Survei Implementasi Standar Operasional Prosedur (SOP)
 *   2) Survei Pelaksanaan Budaya Kerja dan Evaluasi Kesiapan Perubahan
 *
 * Jawaban disimpan ke Google Spreadsheet milik app ini sendiri (bukan dikirim
 * ke Google Form). Nama pada dropdown "Nama Lengkap" dibaca dari sheet
 * "Pegawai" kolom A.
 *
 * Konvensi (mengikuti gaya repo Kodomo):
 * - Bahasa Indonesia untuk kosakata domain (nama, saran, pertanyaan, dsb.).
 * - Helper internal diakhiri underscore (getSS_, setupSheets_, ...).
 * - Fungsi mutasi memakai LockService untuk read-modify-write yang aman.
 * - Error dilempar sebagai Error dengan pesan Indonesia siap tampil ke user.
 */

/** Nama web app (dipakai untuk <title> dan judul spreadsheet data). */
const APP_NAME = 'Survei Ortala Ditjen Bimas Hindu';

/** Sub-judul instansi. */
const INSTANSI = 'Direktorat Jenderal Bimbingan Masyarakat Hindu';

/** Sheet berisi daftar nama pegawai (kolom A, mulai baris 2). */
const SHEET_PEGAWAI = 'Pegawai';

/**
 * Daftar pegawai default. Hanya dipakai untuk MEN-SEED sheet "Pegawai" saat
 * masih kosong (sekali, pada pemakaian pertama). Setelah itu sheet menjadi
 * sumber kebenaran: tambah/hapus nama cukup diedit di sheet — mengubah daftar
 * ini tidak lagi berpengaruh ke sheet yang sudah terisi. Urutan dipertahankan.
 */
const DEFAULT_PEGAWAI = [
  'Prof. Dr. Drs. I Nengah Duija, M.Si.',
  'Dr. Ida Made Pidada Manuaba, S.Ag, M.Si',
  'Prof. Dr. I Ketut Sudarsana, S.Ag., M.Pd.H.',
  'Ida Bagus Ketut Drana Arimbawa, S.Pd., M.Si',
  'Ni Made Ruswiati, S.Ag., M.Si',
  'Raditya Dewa Agung Arsana, S.Ag',
  'Putu Jaya Adnyana Widhita, S.Pd.H., S.Si., M.A., M.M',
  'I Wayan Budiantara, S.Ag., M.Fil.H',
  'I Putu Alit Tinggal Yasa, S.Ag., M.Si',
  'Agus Suteja Putra, S.Pd.H',
  'Anak Agung Ade Wichasena Parbawa, S.H',
  'Andik Prasetiyo, S.Pd.',
  'Arie Rizkia Rahmadita, S.Ak',
  'Besta Andre Adhipurusa, S.Kom',
  'Christofel Erik Oktavianus Gultom, S.H',
  'Dewa Ayu Nyoman Kusumaningrat, S.H., M.H',
  'Dwi Arisetia, S.Pd.H., M.Pd',
  'Eka Indriani, S.Kom',
  'Gama Rozano, A.Md.',
  'Gede Kusuma Yudha, ST',
  'Gunadi, S.Pd',
  'Gusti Ngurah Panji, S.I.Kom',
  'Gusti Putra Hutama Bangga, S.Pd',
  'Hari Cahyono, S.Sos',
  'I Dewa Gede Agus Priana Putra, S.Sos.H., M.I.Kom',
  'I Gede Arya Windhu Saputra, S.Kom',
  'I Gede Dipayana, S.Ag., M.Pd',
  'I Gede Wira, S.Kom',
  'I Gusti Agung Noto Widiantara, ST',
  'I Gusti Made Andi Suyanta, S.Pd',
  'I Gusti Made Partha Wijaya, A.Md.Log',
  'I Gusti Ngurah Jaya Perdhana, S.Sos',
  'I Gusti Ngurah Sathya Dharma, S.I.Kom',
  'I Ketut Ardika, S.Pd',
  'I Ketut Sujana, S.E.',
  'I Ketut Sumerta, S.Pd.H., M.I.Kom',
  'I Luh Sri Wardhani Pujayanti, S.M',
  'I Made Bayu Andika, S.Ag., M.M.',
  'I Made Juni Saputra, S.I.Kom',
  'I Made Mertayasa,S.Pd',
  'I Made Sudhana, S.Pd',
  'I Nengah Sukadana, S.Kom., M.Ap.',
  'I Nyoman Juwitra Kurniantara, S.E',
  'I Nyoman Sudiarta, S.Pd.H',
  'I Putu Agung Krisnayasa, S.E',
  'I Putu Suhartama, S.Ag., M.M',
  'I Putu Indra Setiawan, S.E.',
  'I Putu Khresna Diantika Putra, S.Tr.Pi',
  'I Putu Oka Agus Mahendradatta, S.Pd.',
  'I Wayan Danayasa, S.Pd.H',
  'I Wayan Sudarme, S.Fil',
  'Ida Ayu Kirana Dewi, S.Pd',
  'Ida Bagus Agung Sarwadamana Sogata, S.Ag',
  'Ida Bagus Indriya Kusuma, S.Kom',
  'Ida Bagus Kade Putra Upadana, S.Ag.',
  'Imam, S.E',
  'Jerome Luther William, S.Kom',
  'Josephine Jasmine Octavia, S.M',
  'Kadek Sudarsana, S.Pd.H',
  'Kadek Widya Patni, S.E.',
  'Ketut Wiriani, S.Sos',
  'Komang Juli Agustawan, S.H., M.I.Kom',
  'Lilik Pujiwati, S.Pd',
  'Luh Dewi Putri Mariawan, S.M.',
  'Luh Dwi Mahardini Wiparnawati, S.A.',
  'Lukmanul Hakim, S.Kom',
  'Made Ayu Siwi Paramitha, S. Ak.',
  'Made Hermawati, S.Ag',
  'Maha Putra Jaya, S.Pd',
  'Makoto Daiwa Ambara, S.Si.Kom',
  'Maretha Manik Mintaningtyas, S.Fil.',
  'Maria Ulpah, S.M.',
  'Muhammad Mahmud Alhushori, S.Pd',
  'Ngakan Made Bayu Aditya, S.Kom',
  'Ni Kompiang Sri Erawati, A.Ma. S.Ag',
  'Ni Luh Desy Coniarti Partami, S.Pd.',
  'Ni Luh Putu Sri Juliyanti, S.E., M.Ak',
  'Ni Made Fitria Retnasari, S.Pd',
  'Ni Made Indra Kristhina, S.Pd',
  'Ni Made Setiawati, S.Ag',
  'Ni Made Yudariwati, S.Ag',
  'Ni Nyoman Ayu Adnyaswari, S.H.',
  'Ni Nyoman Muliartini, SH., MH',
  'Ni Putu Ayuning Esa Primatini, S.Sos',
  'Ni Putu Pera Darma Yanti, S.E',
  'Ni Putu Wulan Yuni Dewi, S.Pd.H',
  'Ni Wayan Ari Febriyanti S.Sos.',
  'Ni Wayan Juniarini, S.Ag',
  'Ni Wayan Sandi Pera Pertiwi, S.Pd',
  'Ni Wayan Sukerti, S.Ag',
  'Nyoman Darmawan, S.Pd',
  'Pamela Marcelina, S.Kom',
  'Pande Agus Darwata, S.Kom., M.Kom',
  'Pande Putu Sri Ayu Weshimar, S.Sos.H',
  'Paryanto, S.Ag',
  'Puji Widiyanti, S.Pd.H',
  'Putu Amrita Dewi, S.E.',
  'Putu Ardhi Kurnia Pratama, S.E',
  'Putu Arya Darma, S.Pd.H',
  'Putu Ayu Sri Kumala Dewi, S.Sos., M.I.Kom',
  'Putu Gatot Yogiawan, S.Pd',
  'Putu Novarisna Wiyatna, S.H., M.H',
  'Putu Riantika Sari, S.Pd',
  'Rahajeng Buana Saraswati, S.H.',
  'Ratnaningtyas Yoga Wijayanti, S.Pd.H',
  'Riccar Baginda Susanto, A.Md.Kom.',
  'Riski Basuki, S.Pd',
  'Rofikoh, S.AP',
  'Roni Kriswanto, S.Ag',
  'Saleppang, S.Pd',
  'Saraswati Yoga Andriyani, S.Kom',
  'Septriana Asih. AM, S.Kom',
  'Shifa Awaliyah, S.Kom',
  'Surya Oktavianis, S.Pd',
  'Tri Sutanto, S.Pd.',
  'Yogo Anggoro, S.Ag',
  'Yudanto Hutagalung, S.Kom'
];

/**
 * Legenda skala bintang 1–5 (dipakai kedua survei).
 * Nilai yang disimpan ke sheet adalah angka 1–5.
 */
const LEGEND = [
  { star: 1, label: 'Sangat Tidak Sesuai' },
  { star: 2, label: 'Tidak Sesuai' },
  { star: 3, label: 'Cukup Sesuai' },
  { star: 4, label: 'Sesuai' },
  { star: 5, label: 'Sangat Sesuai' }
];

/**
 * Skema kedua survei. Menjadi sumber kebenaran tunggal untuk:
 * - render pertanyaan di client,
 * - header sheet respons,
 * - validasi di server.
 */
const SURVEYS = {
  sop: {
    key: 'sop',
    sheet: 'Respons SOP',
    title: 'Survei Implementasi Standar Operasional Prosedur (SOP)',
    deskripsi:
      'Survei Implementasi Standar Operasional Prosedur (SOP) pada ' + INSTANSI +
      ' bertujuan untuk mengukur tingkat pemahaman dan penerapan SOP oleh pegawai. ' +
      'Hasil survei akan digunakan sebagai bahan evaluasi dan perbaikan guna ' +
      'meningkatkan efektivitas pelaksanaan tugas serta kualitas tata kelola ' +
      'organisasi. Seluruh jawaban responden bersifat rahasia dan hanya digunakan ' +
      'untuk kepentingan pengembangan organisasi.',
    pertanyaan: [
      'Apakah Standar Operasional Prosedur (SOP) tersedia dalam bentuk dokumen resmi?',
      'Apakah Standar Operasional Prosedur (SOP) sesuai dengan kegiatan yang dilaksanakan?',
      'Apakah Standar Operasional Prosedur (SOP) mudah diakses oleh petugas?',
      'Apakah anda memahami isi Standar Operasional Prosedur (SOP)?',
      'Apakah anda pernah mendapatkan sosialisasi/pelatihan Standar Operasional Prosedur (SOP)?',
      'Apakah anda mengetahui tugas sesuai Standar Operasional Prosedur (SOP)?',
      'Apakah kegiatan dilaksanakan sesuai alur Standar Operasional Prosedur (SOP)?',
      'Apakah tidak terdapat penyimpangan dalam pelaksanaan Standar Operasional Prosedur (SOP)?',
      'Apakah prosedur pelaksanaan sesuai Standar Operasional Prosedur (SOP)?',
      'Apakah terdapat kegiatan monitoring secara rutin?',
      'Apakah ada penanggung jawab pengawasan?',
      'Apakah hasil monitoring dicatat/dilaporkan?'
    ],
    saran: true // punya kolom "Saran" (paragraf, opsional)
  },
  budaya: {
    key: 'budaya',
    sheet: 'Respons Budaya Kerja',
    title: 'Survei Pelaksanaan Budaya Kerja dan Evaluasi Kesiapan Perubahan',
    deskripsi:
      'Yth. Bapak/Ibu ASN Pada ' + INSTANSI + ',\n\n' +
      'Survei ini diselenggarakan dalam rangka mengevaluasi pelaksanaan budaya kerja ' +
      'serta mengukur kesiapan pegawai dalam menghadapi perubahan organisasi di ' +
      'lingkungan ' + INSTANSI + '. Pelaksanaan survei ini mengacu pada Surat ' +
      'Keputusan Direktur Jenderal Bimbingan Masyarakat Hindu Nomor 403 Tahun 2024 ' +
      'tentang Pedoman Penegakan Etika dan Perilaku Kerja Aparatur Sipil Negara di ' +
      'Lingkungan ' + INSTANSI + '.\n\n' +
      'Hasil survei akan digunakan sebagai bahan evaluasi untuk mengetahui tingkat ' +
      'penerapan nilai-nilai etika dan perilaku kerja ASN, serta sebagai dasar ' +
      'penyusunan langkah-langkah perbaikan dan penguatan budaya kerja yang ' +
      'profesional, berintegritas, adaptif, dan berorientasi pada pelayanan.\n\n' +
      'Mohon Bapak/Ibu memberikan penilaian secara objektif sesuai dengan kondisi ' +
      'yang dirasakan dalam pelaksanaan tugas sehari-hari.',
    pertanyaan: [
      'Saya memberikan pelayanan yang ramah, responsif, dan berorientasi pada kebutuhan masyarakat.',
      'Saya melaksanakan tugas sesuai prosedur serta bertanggung jawab atas hasil pekerjaan yang saya lakukan.',
      'Saya menolak segala bentuk gratifikasi, korupsi, kolusi, dan nepotisme dalam pelaksanaan tugas.',
      'Saya secara aktif meningkatkan kompetensi dan pengetahuan untuk mendukung pelaksanaan pekerjaan.',
      'Saya menghormati rekan kerja dan menjaga hubungan kerja yang harmonis tanpa membedakan latar belakang, suku, agama, ras, maupun jenis kelamin.',
      'Saya menjaga nama baik instansi serta mematuhi kode etik dan perilaku ASN dalam kehidupan sehari-hari.',
      'Saya mampu beradaptasi dengan perubahan kebijakan, sistem kerja, dan perkembangan teknologi.',
      'Saya terbuka terhadap ide, saran, dan cara kerja baru yang dapat meningkatkan kinerja organisasi.',
      'Saya bersedia bekerja sama dan berkolaborasi dengan unit kerja atau pihak lain untuk mencapai tujuan bersama.',
      'Saya merasa siap mendukung dan terlibat aktif dalam setiap perubahan yang dilakukan untuk meningkatkan kinerja organisasi.'
    ],
    saran: false
  }
};

// ---------------------------------------------------------------------------
// Web entry point
// ---------------------------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// ---------------------------------------------------------------------------
// API untuk client
// ---------------------------------------------------------------------------

/**
 * Data awal untuk merender halaman: daftar nama pegawai + skema kedua survei.
 * Dipanggil sekali saat halaman dimuat.
 */
function getBootstrap() {
  return {
    appName: APP_NAME,
    instansi: INSTANSI,
    legend: LEGEND,
    pegawai: getPegawai_(),
    surveys: [publicSurvey_(SURVEYS.sop), publicSurvey_(SURVEYS.budaya)]
  };
}

/** Bentuk skema survei yang aman dikirim ke client (tanpa nama sheet internal). */
function publicSurvey_(s) {
  return {
    key: s.key,
    title: s.title,
    deskripsi: s.deskripsi,
    pertanyaan: s.pertanyaan,
    saran: !!s.saran
  };
}

/**
 * Simpan satu respons survei.
 * @param {{survey:string, nama:string, jawaban:Object, saran:string}} payload
 * @return {{ok:boolean, message:string}}
 */
function submitSurvey(payload) {
  payload = payload || {};
  const survey = SURVEYS[payload.survey];
  if (!survey) throw new Error('Survei tidak dikenal.');

  const nama = String(payload.nama || '').trim();
  if (!nama) throw new Error('Nama Lengkap wajib dipilih.');

  // Validasi nama terhadap daftar pegawai (kalau daftar sudah diisi).
  const daftar = getPegawai_();
  if (daftar.length && daftar.indexOf(nama) === -1) {
    throw new Error('Nama tidak terdaftar. Pilih nama dari daftar.');
  }

  // Validasi jawaban: setiap pertanyaan harus terisi bintang 1–5.
  const jawaban = payload.jawaban || {};
  const nilai = [];
  for (let i = 0; i < survey.pertanyaan.length; i++) {
    const v = Math.round(Number(jawaban[i]));
    if (!(v >= 1 && v <= 5)) {
      throw new Error('Mohon isi penilaian untuk semua pertanyaan (pertanyaan ' + (i + 1) + ' belum diisi).');
    }
    nilai.push(v);
  }

  let saran = '';
  if (survey.saran) {
    saran = String(payload.saran || '').trim().slice(0, 5000);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(survey);
    const row = [new Date(), nama].concat(nilai);
    if (survey.saran) row.push(saran);
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, message: 'Terima kasih, jawaban Anda telah tersimpan.' };
}

// ---------------------------------------------------------------------------
// Helper spreadsheet
// ---------------------------------------------------------------------------

/**
 * Spreadsheet data milik app. Prioritas:
 *   1) ID tersimpan di Script Properties (SPREADSHEET_ID),
 *   2) spreadsheet container-bound (kalau script terikat ke sebuah Sheet),
 *   3) buat spreadsheet baru dan simpan ID-nya.
 * Sifatnya self-bootstrap: berjalan tanpa konfigurasi manual.
 */
function getSS_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // ID tidak valid/terhapus — buat ulang di bawah.
    }
  }
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('Data ' + APP_NAME);
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

/** Ambil sheet respons untuk sebuah survei, buat + beri header bila belum ada. */
function getSheet_(survey) {
  const ss = getSS_();
  let sheet = ss.getSheetByName(survey.sheet);
  const header = ['Timestamp', 'Nama'].concat(
    survey.pertanyaan.map(function (q, i) { return (i + 1) + '. ' + q; })
  );
  if (survey.saran) header.push('Saran');

  if (!sheet) {
    sheet = ss.insertSheet(survey.sheet);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sheet;
}

/** Baca daftar nama pegawai dari sheet Pegawai kolom A (baris 2 ke bawah). */
function getPegawai_() {
  const ss = getSS_();
  let sheet = ss.getSheetByName(SHEET_PEGAWAI);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PEGAWAI);
    sheet.getRange(1, 1).setValue('Nama').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  let last = sheet.getLastRow();
  // Seed daftar default sekali saja saat sheet masih kosong (belum ada data).
  if (last < 2 && DEFAULT_PEGAWAI.length) {
    const seed = DEFAULT_PEGAWAI.map(function (n) { return [n]; });
    sheet.getRange(2, 1, seed.length, 1).setValues(seed);
    last = sheet.getLastRow();
  }
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, 1).getValues();
  const seen = {};
  const names = [];
  for (let i = 0; i < values.length; i++) {
    const n = String(values[i][0] || '').trim();
    if (n && !seen[n]) { seen[n] = true; names.push(n); }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Utilitas admin (dijalankan manual dari editor Apps Script oleh pemilik)
// ---------------------------------------------------------------------------

/**
 * Siapkan semua sheet (Pegawai + respons kedua survei) dan kembalikan URL
 * spreadsheet data. Jalankan sekali dari editor untuk tahu tempat mengisi
 * daftar pegawai. URL juga tercatat di Logs.
 */
function setup() {
  getPegawai_();          // pastikan sheet Pegawai ada
  getSheet_(SURVEYS.sop); // pastikan sheet respons SOP ada
  getSheet_(SURVEYS.budaya);
  const url = getSS_().getUrl();
  Logger.log('Spreadsheet data: ' + url);
  return url;
}

/**
 * Seed daftar nama pegawai ke sheet Pegawai (menimpa isi lama, header tetap).
 * Panggil dari editor, contoh: seedPegawai(['Budi', 'Ani', 'Citra']).
 * @param {string[]} names
 */
function seedPegawai(names) {
  if (!Array.isArray(names)) throw new Error('Argumen harus array nama.');
  const ss = getSS_();
  let sheet = ss.getSheetByName(SHEET_PEGAWAI);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PEGAWAI);
  }
  sheet.clear();
  sheet.getRange(1, 1).setValue('Nama').setFontWeight('bold');
  sheet.setFrozenRows(1);
  const rows = names
    .map(function (n) { return String(n || '').trim(); })
    .filter(function (n) { return n; })
    .map(function (n) { return [n]; });
  if (rows.length) sheet.getRange(2, 1, rows.length, 1).setValues(rows);
  return rows.length + ' nama tersimpan di sheet "' + SHEET_PEGAWAI + '".';
}
