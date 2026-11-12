/**
 * KODOMO — penjemputan otomatis invoice GrabFood dari Gmail pemilik skrip.
 *
 * Pemicu terjadwal (Senin–Kamis pukul 15.00 WIB, lihat INVOICE_JADWAL) dan
 * tombol "Ambil invoice Grab" di Kodomo mencari email "Your Grab E-Receipt" dari
 * no-reply@grab.com, membaca TEKS email lewat Gemini (Pesanan.js →
 * bacaInvoiceGemini_), lalu menyimpannya sebagai pesanan 'menunggu' — sama
 * persis seperti unggah screenshot manual, termasuk pemeriksaan keseimbangan
 * dan penolakan Pesanan ID ganda. Admin tinggal membagi di Kodomo.
 *
 * SEKALI SAJA, dari editor Apps Script: jalankan pasangPemicuInvoice() dan
 * setujui izin Gmail. Email yang datang SEBELUM itu sengaja tidak diambil,
 * supaya order lama yang sudah dicatat lewat struk tidak muncul lagi.
 *
 * Hanya MEMBACA Gmail. Email tidak diberi label, dipindah, atau dihapus;
 * yang sudah diproses dicatat (ID pesan) di Script Properties.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global.
 */

const INVOICE_GMAIL_KUERI = 'from:no-reply@grab.com subject:"Your Grab E-Receipt" newer_than:7d';
const INVOICE_PROP_MULAI = 'INVOICE_GMAIL_MULAI';          // ISO: email sebelum ini diabaikan
const INVOICE_PROP_TERPROSES = 'INVOICE_GMAIL_TERPROSES';  // JSON: ID pesan Gmail yang selesai
const INVOICE_PROP_GAGAL = 'INVOICE_GMAIL_GAGAL';          // JSON: catatan gagal baca untuk UI
const INVOICE_SIMPAN_TERPROSES = 300;  // Script Property maks ~9 KB → simpan 300 ID terakhir
/** Batas kasar email per jalan. Dulu 5 (wajar saat jadwal tiap 10 menit); dengan
 *  jadwal sekali sehari, 5 membuat receipt ke-6 dst. tertunda sampai jadwal
 *  BERIKUTNYA (Kamis sore → Senin). Pengaman sesungguhnya INVOICE_BATAS_JALAN_MS. */
const INVOICE_MAKS_PER_JALAN = 30;
/** Jangan MULAI email baru setelah sekian lama berjalan. Saat Gemini penuh, satu
 *  email bisa makan ±100 dtk (coba ulang + cadangan); pemicu GAS dipotong paksa
 *  di 6 menit, dan eksekusi yang terpotong tidak sempat menyimpan daftar email
 *  yang sudah diproses. */
const INVOICE_BATAS_JALAN_MS = 4 * 60 * 1000;

/**
 * Jadwal otomatis: hari kerja kantor (Senin–Kamis) pukul 15.00 WIB — setelah
 * order makan siang selesai dan email receipt-nya pasti sudah datang. Order di
 * luar jadwal bisa diambil kapan saja lewat tombol "Ambil invoice Grab".
 * (GAS menjalankan pemicu harian "sekitar" jam itu, bisa meleset ±15 menit.)
 */
const INVOICE_JADWAL = { hari: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'], jam: 15, zona: 'Asia/Jakarta' };

/**
 * Hanya order JAM KERJA yang diambil otomatis: email receipt yang masuk pada
 * hari INVOICE_JADWAL.hari, pukul [mulai, selesai) WIB. Order kantor paling
 * lambat sekitar 14.00 dan receipt-nya datang setelah makanan diantar, jadi
 * batas 15.00 masih menangkapnya — sementara order pribadi malam hari / akhir
 * pekan TIDAK ikut (dan tidak menghabiskan kuota Gemini). Order di luar jam ini
 * tetap bisa dicatat lewat unggah screenshot manual.
 */
const INVOICE_JAM_KERJA = { mulai: 7, selesai: 15 };

/** Email ini masuk di jam kerja (hari & jam menurut zona WIB)? */
function dalamJamKerja_(tanggal) {
  const [hari, jam] = Utilities.formatDate(tanggal, INVOICE_JADWAL.zona, 'u H').split(' ').map(Number);
  const NAMA_HARI = ['', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  return INVOICE_JADWAL.hari.indexOf(NAMA_HARI[hari]) >= 0 &&
    jam >= INVOICE_JAM_KERJA.mulai && jam < INVOICE_JAM_KERJA.selesai;
}
/** Naikkan angka ini setiap INVOICE_JADWAL diubah: pemicu lama yang masih
 *  terpasang akan memasang ulang jadwal sendiri saat berjalan berikutnya. */
const INVOICE_JADWAL_VERSI = '2';
const INVOICE_PROP_JADWAL = 'INVOICE_GMAIL_JADWAL_VERSI';
/** Jeda minimum antar-pengambilan manual dari tombol di Kodomo (detik). */
const INVOICE_JEDA_MANUAL_DTK = 60;

/** Jalankan dari editor Apps Script. Aman diulang (tidak menggandakan pemicu). */
function pasangPemicuInvoice() {
  lepasPemicuInvoice();
  INVOICE_JADWAL.hari.forEach(hari => {
    ScriptApp.newTrigger('jemputInvoiceGmail').timeBased()
      .onWeekDay(ScriptApp.WeekDay[hari]).atHour(INVOICE_JADWAL.jam).nearMinute(0)
      .inTimezone(INVOICE_JADWAL.zona).create();
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(INVOICE_PROP_MULAI)) {
    props.setProperty(INVOICE_PROP_MULAI, new Date().toISOString());
  }
  props.setProperty(INVOICE_PROP_JADWAL, INVOICE_JADWAL_VERSI);
  const pesan = 'Pemicu terpasang: invoice Grab dicek Senin–Kamis pukul ' + INVOICE_JADWAL.jam +
    '.00 WIB, mulai email setelah ' + props.getProperty(INVOICE_PROP_MULAI) + '.';
  console.log(pesan);
  return pesan;
}

/**
 * Tombol "Ambil invoice Grab" di Kodomo: jemput sekarang tanpa menunggu jadwal.
 * Dibatasi sekali per menit — web app ini bisa dibuka siapa saja tanpa login,
 * jadi jangan biarkan tombol ini dipakai menghabiskan kuota Gemini.
 */
function jemputInvoiceSekarang() {
  return jemputManual_(false);
}

/** selaluDasbor: true bila pemanggil sudah mengubah data lain (mis. menghapus catatan gagal). */
function jemputManual_(selaluDasbor) {
  const cache = CacheService.getScriptCache();
  if (cache.get('INVOICE_JEMPUT_MANUAL')) {
    throw new Error('Email baru saja dicek. Coba lagi sebentar lagi.');
  }
  cache.put('INVOICE_JEMPUT_MANUAL', '1', INVOICE_JEDA_MANUAL_DTK);
  const ringkas = jemputInvoiceGmail();
  // Dasbor hanya dihitung ulang kalau ada yang berubah — klik "tidak ada yang
  // baru" (paling sering) jadi jauh lebih cepat. Klien me-render bila ada data.
  const berubah = selaluDasbor || ringkas.baru || ringkas.gagal;
  return { ringkas: ringkas, data: berubah ? getDashboardData() : null };
}

/**
 * Tombol "Baca ulang" di peringatan gagal: lepas tanda "sudah diproses" dari
 * email yang gagal, hapus peringatannya, lalu jemput lagi. Catatan lama tanpa
 * ID pesan dicocokkan lewat waktu email (sampai menit).
 */
function cobaLagiInvoiceGagal() {
  if (CacheService.getScriptCache().get('INVOICE_JEMPUT_MANUAL')) {
    throw new Error('Email baru saja dicek. Coba lagi sebentar lagi.');
  }
  const props = PropertiesService.getScriptProperties();
  const gagal = daftarInvoiceGagal_();
  const lepas = {}, waktuLama = {};
  gagal.forEach(g => { if (g.id) lepas[g.id] = true; else waktuLama[g.waktu] = true; });
  if (Object.keys(waktuLama).length) {
    const tz = Session.getScriptTimeZone();
    GmailApp.search(INVOICE_GMAIL_KUERI, 0, 30).forEach(th => th.getMessages().forEach(m => {
      if (waktuLama[Utilities.formatDate(m.getDate(), tz, 'dd MMM yyyy • HH:mm')]) lepas[m.getId()] = true;
    }));
  }
  let terproses = [];
  try { terproses = JSON.parse(props.getProperty(INVOICE_PROP_TERPROSES) || '[]'); } catch (e) {}
  props.setProperty(INVOICE_PROP_TERPROSES, JSON.stringify(terproses.filter(id => !lepas[id])));
  props.deleteProperty(INVOICE_PROP_GAGAL);
  return jemputManual_(true); // catatan gagal sudah dihapus → dasbor wajib dikirim ulang
}

/** Hentikan penjemputan otomatis (unggah manual tetap bisa dipakai). */
function lepasPemicuInvoice() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'jemputInvoiceGmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/**
 * Dipanggil pemicu (atau manual dari editor untuk mencoba). Balikan ringkasan
 * { baru, dilewati, gagal, ditunda, luarJam } — juga tercatat di log Executions.
 */
function jemputInvoiceGmail() {
  const props = PropertiesService.getScriptProperties();
  // Migrasi diam-diam: pemicu versi lama (mis. tiap 10 menit) memasang jadwal
  // terbaru lalu terhapus sendiri, tanpa admin perlu membuka editor lagi.
  if (props.getProperty(INVOICE_PROP_JADWAL) !== INVOICE_JADWAL_VERSI) {
    try { pasangPemicuInvoice(); } catch (e) { console.warn('Gagal memperbarui jadwal: ' + e.message); }
  }
  const mulaiStr = props.getProperty(INVOICE_PROP_MULAI);
  const mulai = mulaiStr ? new Date(mulaiStr) : new Date();
  let terproses = [];
  try { terproses = JSON.parse(props.getProperty(INVOICE_PROP_TERPROSES) || '[]'); } catch (e) {}
  const sudah = {};
  terproses.forEach(id => { sudah[id] = true; });
  const tandai = id => { if (!sudah[id]) { sudah[id] = true; terproses.push(id); } };

  // luarJam = email Grab 7 hari terakhir di luar jam kerja: TIDAK ditandai
  // selesai (cek tanggalnya murah), supaya tiap klik tetap bisa memberi tahu
  // admin bahwa order itu ada tapi harus dicatat lewat unggah screenshot.
  const ringkas = { baru: 0, dilewati: 0, gagal: 0, ditunda: 0, luarJam: 0 };
  let dikerjakan = 0;
  const mulaiJalan = Date.now();

  const threads = GmailApp.search(INVOICE_GMAIL_KUERI, 0, 30);
  // SATU panggilan Gmail untuk semua thread — dulu getMessages() per thread
  // (hingga 30 panggilan terpisah) padahal hampir semuanya sudah diproses.
  const pesanPerThread = threads.length ? GmailApp.getMessagesForThreads(threads) : [];
  luar:
  for (let t = 0; t < pesanPerThread.length; t++) {
    const pesanList = pesanPerThread[t];
    for (let m = 0; m < pesanList.length; m++) {
      const msg = pesanList[m];
      const id = msg.getId();
      if (sudah[id]) continue;
      if (msg.getDate() < mulai) { tandai(id); continue; } // sebelum fitur dipasang
      if (!dalamJamKerja_(msg.getDate())) { ringkas.luarJam++; continue; } // order pribadi / di luar jam kerja
      const teks = String(msg.getPlainBody() || '');
      if (!/GrabFood/i.test(teks)) { tandai(id); ringkas.dilewati++; continue; } // GrabCar, GrabBike, dll
      // sisanya di jalan berikutnya (10 menit lagi)
      if (dikerjakan >= INVOICE_MAKS_PER_JALAN || Date.now() - mulaiJalan > INVOICE_BATAS_JALAN_MS) break luar;
      dikerjakan++;

      try {
        const detail = bacaInvoiceGemini_([{ text: 'Teks email e-receipt:\n\n' + teks.slice(0, 20000) }]);
        simpanPesananMenunggu_(detail);
        tandai(id);
        ringkas.baru++;
      } catch (e) {
        const alasan = String((e && e.message) || e);
        if (/sudah tercatat/.test(alasan)) {
          tandai(id); ringkas.dilewati++;               // sudah dicatat lewat unggah manual
        } else if (/sedang penuh|GEMINI_API_KEY/.test(alasan)) {
          ringkas.ditunda++;                            // sementara: coba lagi 10 menit lagi
        } else {
          tandai(id); ringkas.gagal++;                  // permanen: beri tahu admin di UI
          catatInvoiceGagal_(msg.getDate(), alasan, id);
          console.warn('Invoice email gagal dibaca (' + id + '): ' + alasan);
        }
      }
    }
  }

  props.setProperty(INVOICE_PROP_TERPROSES, JSON.stringify(terproses.slice(-INVOICE_SIMPAN_TERPROSES)));
  console.log('jemputInvoiceGmail: ' + JSON.stringify(ringkas));
  return ringkas;
}

/** Simpan 10 kegagalan terakhir supaya tampil di Kodomo, bukan hilang di log. */
function catatInvoiceGagal_(tanggal, alasan, id) {
  const props = PropertiesService.getScriptProperties();
  let daftar = [];
  try { daftar = JSON.parse(props.getProperty(INVOICE_PROP_GAGAL) || '[]'); } catch (e) {}
  daftar.push({
    waktu: Utilities.formatDate(tanggal, Session.getScriptTimeZone(), 'dd MMM yyyy • HH:mm'),
    alasan: alasan.replace(/\s*\[[^\]]*\]\s*$/, '').slice(0, 200),
    id: id || ''   // ID pesan Gmail, untuk tombol "Baca ulang"
  });
  props.setProperty(INVOICE_PROP_GAGAL, JSON.stringify(daftar.slice(-10)));
}

/** Untuk dasbor: daftar invoice email yang gagal dibaca otomatis. */
function daftarInvoiceGagal_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(INVOICE_PROP_GAGAL) || '[]');
  } catch (e) {
    return [];
  }
}

/** Dipanggil klien saat admin menutup peringatan (sudah diunggah manual). */
function hapusCatatanInvoiceGagal() {
  PropertiesService.getScriptProperties().deleteProperty(INVOICE_PROP_GAGAL);
  return getDashboardData();
}
