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

/** PIN admin default untuk unduh laporan (ubah via setAdminPin() di editor). */
const DEFAULT_PIN = '2026';

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
    saran: true, // punya kolom "Saran" (paragraf, opsional)
    // --- metadata laporan (BAB III & IV) ---
    warna: '#1b6bce',
    topik: 'implementasi Standar Operasional Prosedur (SOP)',
    judulLaporan: 'LAPORAN HASIL SURVEI STANDAR OPERASIONAL PROSEDUR (SOP)',
    fileBase: 'Laporan_Survei_SOP',
    indikator: [
      'Ketersediaan SOP',
      'Kesesuaian SOP dengan Pelaksanaan Kegiatan',
      'Kemudahan Akses SOP',
      'Pemahaman Isi SOP',
      'Sosialisasi atau Pelatihan SOP',
      'Pemahaman Tugas',
      'Pelaksanaan Sesuai Alur SOP',
      'Penyimpangan Pelaksanaan SOP',
      'Kesesuaian Prosedur Pelaksanaan',
      'Monitoring Pelaksanaan SOP',
      'Penanggung Jawab Pengawasan',
      'Hasil Monitoring Dicatat atau Dilaporkan'
    ]
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
    saran: false,
    // --- metadata laporan (BAB III & IV) ---
    warna: '#0f8f7e',
    topik: 'pelaksanaan budaya kerja dan kesiapan perubahan organisasi',
    judulLaporan: 'LAPORAN HASIL SURVEI PELAKSANAAN BUDAYA KERJA DAN EVALUASI KESIAPAN PERUBAHAN',
    fileBase: 'Laporan_Survei_Budaya_Kerja',
    indikator: [
      'Pelayanan Berorientasi pada Masyarakat',
      'Akuntabilitas Pelaksanaan Tugas',
      'Penolakan Gratifikasi dan Anti-KKN',
      'Peningkatan Kompetensi',
      'Harmonis dan Tanpa Diskriminasi',
      'Menjaga Nama Baik Instansi',
      'Adaptif terhadap Perubahan',
      'Keterbukaan terhadap Ide dan Cara Kerja Baru',
      'Kolaborasi Antar Unit Kerja',
      'Kesiapan Mendukung Perubahan'
    ]
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
// Laporan (BAB III & IV) — unduh PDF
// ---------------------------------------------------------------------------

/**
 * Buat laporan hasil survei (HANYA BAB III & BAB IV) dalam bentuk PDF,
 * dihitung dari seluruh respons pada sheet survei.
 * @param {string} surveyKey 'sop' | 'budaya'
 * @return {{filename:string, mimeType:string, base64:string}}
 */
function generateReport(surveyKey, pin) {
  if (String(pin == null ? '' : pin).trim() !== String(getAdminPin_())) {
    throw new Error('PIN salah. Unduhan laporan hanya untuk admin.');
  }
  const survey = SURVEYS[surveyKey];
  if (!survey) throw new Error('Survei tidak dikenal.');
  const stats = computeStats_(survey);
  if (!stats.n) throw new Error('Belum ada respons untuk survei ini, laporan belum bisa dibuat.');

  const tahun = new Date().getFullYear();
  const html = buildReportHtml_(survey, stats, tahun);
  const pdf = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf');
  return {
    filename: survey.fileBase + '_' + tahun + '.pdf',
    mimeType: 'application/pdf',
    base64: Utilities.base64Encode(pdf.getBytes())
  };
}

/** Baca seluruh respons sebuah survei dari sheet-nya. */
function getResponses_(survey) {
  const sheet = getSheet_(survey);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const nQ = survey.pertanyaan.length;
  const width = 2 + nQ + (survey.saran ? 1 : 0);
  const values = sheet.getRange(2, 1, last - 1, width).getValues();
  return values.map(function (r) {
    return {
      nama: r[1],
      nilai: r.slice(2, 2 + nQ).map(function (v) { return Number(v); }),
      saran: survey.saran ? String(r[2 + nQ] || '').trim() : ''
    };
  });
}

/** Hitung statistik agregat untuk laporan. */
function computeStats_(survey) {
  const rows = getResponses_(survey);
  const nQ = survey.pertanyaan.length;
  const indikator = [];
  for (let i = 0; i < nQ; i++) {
    const dist = [0, 0, 0, 0, 0];
    let sum = 0, cnt = 0;
    for (let r = 0; r < rows.length; r++) {
      const v = Math.round(rows[r].nilai[i]);
      if (v >= 1 && v <= 5) { dist[v - 1]++; sum += v; cnt++; }
    }
    indikator.push({
      label: (survey.indikator && survey.indikator[i]) || ('Indikator ' + (i + 1)),
      avg: cnt ? sum / cnt : 0,
      dist: dist,
      cnt: cnt
    });
  }
  let overall = 0;
  if (indikator.length) {
    overall = indikator.reduce(function (a, x) { return a + x.avg; }, 0) / indikator.length;
  }
  let hi = null, lo = null;
  indikator.forEach(function (x) {
    if (!hi || x.avg > hi.avg) hi = x;
    if (!lo || x.avg < lo.avg) lo = x;
  });
  const saranList = rows.map(function (r) { return r.saran; }).filter(function (s) { return s; });
  return { n: rows.length, indikator: indikator, overall: overall, hi: hi, lo: lo, saranList: saranList };
}

/** Format angka 2 desimal gaya Indonesia (4.4 -> "4,40"). */
function fmt_(n) {
  if (!isFinite(n)) return '-';
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

/** Kategori mutu berdasar rata-rata skala 1–5. */
function kategori_(avg) {
  if (avg >= 4.5) return 'Sangat Baik';
  if (avg >= 4.0) return 'Baik';
  if (avg >= 3.0) return 'Cukup';
  if (avg >= 2.0) return 'Kurang';
  return 'Sangat Kurang';
}

/** Escape HTML untuk konten laporan. */
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Grafik BATANG distribusi nilai 1–5 sebuah indikator, dirender sebagai
 * GAMBAR PNG melalui layanan Charts GAS lalu disematkan sebagai data URI.
 * Konverter HTML→PDF GAS mengabaikan warna latar (CSS background maupun
 * atribut bgcolor), tetapi MENAMPILKAN <img> data URI dengan andal —
 * mekanisme yang sama dengan foto pada laporan Kodomo.
 */
function chartHtml_(dist, n, warna) {
  try {
    const dt = Charts.newDataTable()
      .addColumn(Charts.ColumnType.STRING, 'Nilai')
      .addColumn(Charts.ColumnType.NUMBER, 'Jumlah Responden');
    for (let v = 1; v <= 5; v++) dt.addRow([String(v), dist[v - 1]]);
    const chart = Charts.newColumnChart()
      .setDataTable(dt.build())
      .setDimensions(500, 240)
      .setColors([warna])
      .setLegendPosition(Charts.Position.NONE)
      .setXAxisTitle('Nilai (1–5)')
      .setYAxisTitle('Jumlah Responden')
      .build();
    const blob = chart.getAs ? chart.getAs('image/png') : chart.getBlob();
    const uri = 'data:image/png;base64,' + Utilities.base64Encode(blob.getBytes());
    return '<div style="text-align:center;margin:6px 0 2px;">' +
      '<img src="' + uri + '" width="500" style="width:500px;max-width:100%;height:auto;" ' +
      'alt="Grafik distribusi nilai"/></div>';
  } catch (e) {
    // Cadangan teks bila layanan Charts tidak tersedia.
    const parts = [];
    for (let v = 1; v <= 5; v++) {
      const c = dist[v - 1];
      const pct = n ? Math.round((c / n) * 100) : 0;
      parts.push('Nilai ' + v + ': ' + c + ' (' + pct + '%)');
    }
    return '<p style="font-size:9pt;color:#555;margin:4px 0;text-align:center;">' +
      parts.join(' &nbsp;&middot;&nbsp; ') + '</p>';
  }
}

/** Susun HTML laporan BAB III & IV, siap dikonversi ke PDF. */
function buildReportHtml_(survey, stats, tahun) {
  const warna = survey.warna || '#1b3a6b';
  const kat = kategori_(stats.overall);
  const diAtas4 = stats.indikator.filter(function (x) { return x.avg > 4.0; }).length;
  const hiL = stats.hi ? esc_(stats.hi.label) : '-';
  const loL = stats.lo ? esc_(stats.lo.label) : '-';
  const hiV = stats.hi ? fmt_(stats.hi.avg) : '-';
  const loV = stats.lo ? fmt_(stats.lo.avg) : '-';

  const hH2 = 'text-align:center;font-weight:bold;font-size:13pt;margin:18px 0 10px;';
  const hH3 = 'font-weight:bold;font-size:11pt;color:' + warna + ';margin:14px 0 4px;';
  const pP = 'margin:0 0 8px;text-align:justify;';

  // 3.2 analisis per indikator (+ grafik)
  let gambar = 1;
  let analisis = '';
  stats.indikator.forEach(function (x, i) {
    gambar++;
    let interp;
    if (stats.hi && x.label === stats.hi.label) interp = 'Nilai ini merupakan capaian tertinggi pada survei, menunjukkan bahwa aspek tersebut telah berjalan sangat baik.';
    else if (stats.lo && x.label === stats.lo.label) interp = 'Nilai ini merupakan capaian terendah pada survei sehingga menjadi aspek yang paling perlu ditingkatkan.';
    else if (x.avg >= 4.2) interp = 'Nilai ini menunjukkan bahwa aspek tersebut telah berjalan dengan baik.';
    else if (x.avg >= 4.0) interp = 'Nilai ini menunjukkan bahwa aspek tersebut secara umum telah berjalan baik.';
    else if (x.avg >= 3.5) interp = 'Nilai ini tergolong cukup dan masih memerlukan penguatan.';
    else interp = 'Nilai ini tergolong rendah dan memerlukan perhatian serta perbaikan.';
    analisis +=
      '<div style="margin:10px 0 14px;page-break-inside:avoid;">' +
        '<p style="margin:0 0 2px;font-weight:bold;">' + (i + 1) + '. ' + esc_(x.label) +
          ' <span style="font-weight:normal;color:' + warna + ';">(rata-rata ' + fmt_(x.avg) + ')</span></p>' +
        '<p style="margin:0 0 4px;text-align:justify;">Indikator ini memperoleh nilai rata-rata ' + fmt_(x.avg) + '. ' + interp + '</p>' +
        chartHtml_(x.dist, stats.n, warna) +
        '<p style="margin:2px 0 0;font-size:9pt;font-style:italic;color:#666;">Gambar ' + gambar + '. Grafik ' + esc_(x.label) + '</p>' +
      '</div>';
  });

  // 3.3 saran (kalau survei punya kolom saran & ada isinya)
  let saranBlok = '';
  const punyaSaran = survey.saran && stats.saranList.length;
  if (punyaSaran) {
    const items = stats.saranList.map(function (s) {
      return '<li style="margin:2px 0;">' + esc_(s) + '</li>';
    }).join('');
    saranBlok =
      '<h3 style="' + hH3 + '">3.3. Saran dari Pelaksanaan Survei</h3>' +
      '<ul style="margin:4px 0 8px;padding-left:20px;">' + items + '</ul>';
  }
  const noPembahasan = punyaSaran ? '3.4' : '3.3';

  const header =
    '<div style="text-align:center;border-bottom:2px solid ' + warna + ';padding-bottom:8px;margin-bottom:6px;">' +
      '<div style="font-size:14pt;font-weight:bold;">' + esc_(survey.judulLaporan) + '</div>' +
      '<div style="font-size:11pt;">PADA DIREKTORAT JENDERAL BIMBINGAN MASYARAKAT HINDU</div>' +
      '<div style="font-size:10pt;color:#666;margin-top:3px;">Tahun ' + tahun + ' &middot; ' + stats.n +
        ' responden &middot; Ekstrak BAB III &amp; BAB IV</div>' +
    '</div>';

  const babIII =
    '<h2 style="' + hH2 + '">BAB III<br>HASIL EVALUASI</h2>' +
    '<h3 style="' + hH3 + '">3.1. Hasil Survei</h3>' +
    '<p style="' + pP + '">Hasil pengolahan data terhadap ' + stats.n + ' responden menunjukkan bahwa ' +
      esc_(survey.topik) + ' pada Direktorat Jenderal Bimbingan Masyarakat Hindu memperoleh penilaian ' +
      'dengan kategori ' + kat + ' (rata-rata ' + fmt_(stats.overall) + '). Sebanyak ' + diAtas4 + ' dari ' +
      stats.indikator.length + ' indikator memperoleh nilai rata-rata di atas 4,00, yang menunjukkan bahwa ' +
      esc_(survey.topik) + ' telah dipahami dan diterapkan oleh sebagian besar pegawai.</p>' +
    '<h3 style="' + hH3 + '">3.2. Analisis Hasil Evaluasi</h3>' + analisis +
    saranBlok +
    '<h3 style="' + hH3 + '">' + noPembahasan + '. Pembahasan</h3>' +
    '<p style="' + pP + '">Secara umum hasil evaluasi menunjukkan bahwa ' + esc_(survey.topik) +
      ' pada Direktorat Jenderal Bimbingan Masyarakat Hindu telah berjalan dengan kategori ' + kat +
      '. Aspek dengan capaian tertinggi adalah ' + hiL + ' (' + hiV + '), sedangkan aspek yang paling ' +
      'memerlukan perhatian adalah ' + loL + ' (' + loV + '). Peningkatan berkelanjutan, khususnya pada ' +
      'aspek dengan nilai terendah, diharapkan dapat meningkatkan konsistensi penerapan di seluruh unit kerja.</p>';

  const babIV =
    '<div style="page-break-before:always;"></div>' +
    '<h2 style="' + hH2 + '">BAB IV<br>KESIMPULAN DAN SARAN</h2>' +
    '<h3 style="' + hH3 + '">4.1. Kesimpulan</h3>' +
    '<p style="' + pP + '">Berdasarkan hasil survei terhadap ' + stats.n + ' responden, dapat disimpulkan ' +
      'bahwa ' + esc_(survey.topik) + ' pada Direktorat Jenderal Bimbingan Masyarakat Hindu berada pada ' +
      'kategori ' + kat + ', dengan rata-rata nilai sebesar ' + fmt_(stats.overall) + '. Indikator dengan ' +
      'nilai tertinggi adalah ' + hiL + ' (' + hiV + '), sedangkan indikator dengan nilai terendah adalah ' +
      loL + ' (' + loV + '). Secara keseluruhan, ' + esc_(survey.topik) + ' telah mendukung pelaksanaan ' +
      'tugas dan fungsi organisasi, namun peningkatan berkelanjutan tetap diperlukan untuk menjaga kualitas ' +
      'pelayanan dan tata kelola pemerintahan.</p>' +
    '<h3 style="' + hH3 + '">4.2. Saran</h3>' +
    '<p style="' + pP + '">Berdasarkan hasil evaluasi, beberapa rekomendasi yang dapat dilakukan adalah ' +
      'sebagai berikut:</p>' +
    '<ol style="margin:4px 0 8px;padding-left:20px;">' +
      '<li style="margin:3px 0;">Memperkuat aspek ' + loL + ' yang memperoleh nilai terendah (' + loV +
        ') melalui kegiatan yang terjadwal dan berkala.</li>' +
      '<li style="margin:3px 0;">Melaksanakan sosialisasi, pelatihan, dan pendampingan secara rutin kepada pegawai.</li>' +
      '<li style="margin:3px 0;">Melakukan reviu dan pembaruan secara berkala sesuai perkembangan regulasi dan kebutuhan organisasi.</li>' +
      '<li style="margin:3px 0;">Mengembangkan sistem digital untuk memudahkan akses dokumen serta memperkuat monitoring dan evaluasi.</li>' +
    '</ol>';

  const footer =
    '<div style="margin-top:18px;border-top:1px solid #ccc;padding-top:6px;font-size:8.5pt;color:#888;text-align:center;">' +
      'Laporan (BAB III &amp; BAB IV) dibuat otomatis oleh aplikasi ' + esc_(APP_NAME) +
      ' berdasarkan ' + stats.n + ' respons.' +
    '</div>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#222;line-height:1.5;">' +
    header + babIII + babIV + footer +
    '</body></html>';
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

/** PIN admin aktif (Script Property ADMIN_PIN, atau DEFAULT_PIN bila belum diatur). */
function getAdminPin_() {
  const p = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  return (p && String(p).trim()) || DEFAULT_PIN;
}

/**
 * Ubah PIN admin untuk unduh laporan. Jalankan dari editor: setAdminPin('1357').
 * @param {string|number} pin  4–10 digit angka.
 */
function setAdminPin(pin) {
  pin = String(pin == null ? '' : pin).trim();
  if (!/^[0-9]{4,10}$/.test(pin)) throw new Error('PIN harus 4–10 digit angka.');
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', pin);
  return 'PIN admin diperbarui.';
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
