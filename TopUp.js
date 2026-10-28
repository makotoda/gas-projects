/**
 * KODOMO — verifikasi top-up otomatis: bukti transfer yang diunggah anggota
 * dicocokkan dengan email notifikasi DANA MASUK dari bank di Gmail pemilik skrip.
 *
 * Kenapa: screenshot bukti transfer bisa diedit. Notifikasi bank tidak.
 *
 * Alur saat verifikasi AKTIF:
 * 1. Anggota unggah bukti TF → ajukanTopUp: Gmail disinkronkan ke sheet `Mutasi`
 *    (Gemini membaca tiap email notifikasi SEKALI), lalu dicari notifikasi yang
 *    cocok. Ketemu → Pahala langsung masuk ("terverifikasi"). Belum → baris
 *    'menunggu' di sheet `TopUp`.
 * 2. Pemicu tiap jam (prosesTopUpMenunggu) mencoba lagi yang menunggu — notifikasi
 *    bank kadang datang terlambat.
 * 3. Admin memutuskan manual lewat Mode Admin di Kodomo (🔐, ber-PIN — lihat
 *    adminDaftarTopUp), atau langsung di sheet `TopUp`: ubah kolom Status menjadi
 *    "setujui" atau "tolak" (mis. transfer dari e-wallet yang tidak mengirim
 *    email). Diproses seketika oleh pemicu onEdit.
 *
 * Syarat cocok: nominal SAMA PERSIS, waktu notifikasi dalam ±TOPUP_JENDELA_HARI
 * dari unggah, nama pengirim mirip (bank sering memotong nama), dan notifikasi
 * itu belum pernah dipakai top-up lain. Ragu → dibiarkan menunggu admin.
 *
 * AKTIF kalau Script Property ADMIN_PIN dan/atau MUTASI_GMAIL_KUERI (kueri
 * pencarian Gmail untuk notifikasi dana masuk) diisi. Hanya ADMIN_PIN → semua
 * top-up menunggu persetujuan admin; dengan MUTASI_GMAIL_KUERI → yang cocok
 * dengan notifikasi bank disetujui otomatis. Tanpa keduanya, top-up langsung
 * masuk seperti dulu. Setelah mengisi MUTASI_GMAIL_KUERI, jalankan
 * pasangPemicuTopUp() sekali.
 *
 * Hanya MEMBACA Gmail. Bagian dari proyek Kodomo — namespace global bersama.
 */

const SHEET_TOPUP = 'TopUp';
const TOPUP_HEADER = ['ID', 'Diunggah', 'Nama', 'Nominal', 'Status (ubah ke: setujui / tolak)',
  'Pengirim di bukti', 'Keterangan', 'Notifikasi bank', 'Diperbarui'];
const SHEET_MUTASI = 'Mutasi';
const MUTASI_HEADER = ['Msg ID', 'Waktu', 'Bank', 'Pengirim', 'Nominal', 'Referensi', 'Status',
  'Dipakai top-up', 'Dibaca'];

const TOPUP_MENUNGGU = 'menunggu';
const TOPUP_DISETUJUI = 'disetujui';
const TOPUP_DISETUJUI_MANUAL = 'disetujui (manual)';
const TOPUP_DITOLAK = 'ditolak';
const MUTASI_BEBAS = 'bebas';
const MUTASI_DIPAKAI = 'dipakai';
const MUTASI_ABAIKAN = 'abaikan';   // bukan dana masuk / tak terbaca

const TOPUP_PROP_KUERI = 'MUTASI_GMAIL_KUERI';
const TOPUP_JENDELA_HARI = 3;

/** Verifikasi aktif kalau ada CARA memverifikasi: notifikasi bank di Gmail
 *  (MUTASI_GMAIL_KUERI) dan/atau admin yang bisa menyetujui (ADMIN_PIN).
 *  Tanpa keduanya, top-up langsung masuk seperti dulu. */
function verifikasiTopUpAktif_() {
  const props = PropertiesService.getScriptProperties();
  return !!String(props.getProperty(TOPUP_PROP_KUERI) || '').trim() ||
    !!String(props.getProperty(ADMIN_PROP_PIN) || '').trim();
}

/* ===========================================================================
 * MODE ADMIN — daftar & persetujuan top-up di Kodomo.
 *
 * Web app ini tanpa login (ANYONE_ANONYMOUS), jadi setiap fungsi admin WAJIB
 * menerima PIN dan memeriksanya di server. PIN disimpan di Script Property
 * ADMIN_PIN — tidak pernah di kode, tidak pernah dikirim balik ke klien.
 * Salah PIN 5× dalam 10 menit → mode admin terkunci 10 menit.
 * ======================================================================== */
const ADMIN_PROP_PIN = 'ADMIN_PIN';
const ADMIN_MAKS_SALAH = 5;
const ADMIN_KUNCI_DTK = 600;
const ADMIN_RIWAYAT_HARI = 30;

function cekPinAdmin_(pin) {
  const benar = String(PropertiesService.getScriptProperties().getProperty(ADMIN_PROP_PIN) || '').trim();
  if (!benar) throw new Error('Mode admin belum diaktifkan: isi ADMIN_PIN di Script Properties.');
  const cache = CacheService.getScriptCache();
  const salah = Number(cache.get('ADMIN_SALAH') || 0);
  if (salah >= ADMIN_MAKS_SALAH) throw new Error('Terlalu banyak PIN salah. Coba lagi 10 menit lagi.');
  if (String(pin || '').trim() !== benar) {
    cache.put('ADMIN_SALAH', String(salah + 1), ADMIN_KUNCI_DTK);
    throw new Error('PIN admin salah.');
  }
}

/**
 * Daftar top-up 30 hari terakhir untuk admin, terbaru dulu, beserta asal
 * persetujuannya: 'email' (cocok notifikasi bank), 'manual' (admin), atau
 * belum. Notifikasi bank yang dipakai ikut ditampilkan sebagai bukti.
 */
function adminDaftarTopUp(pin) {
  cekPinAdmin_(pin);
  return daftarTopUpAdmin_();
}

function daftarTopUpAdmin_() {
  const sheet = getSheet_(SHEET_TOPUP);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const mutasi = {};
  bacaMutasi_().forEach(m => { mutasi[m.id] = m; });
  const batas = Date.now() - ADMIN_RIWAYAT_HARI * 86400000;
  const tz = Session.getScriptTimeZone();
  return sheet.getRange(2, 1, last - 1, TOPUP_HEADER.length).getValues()
    .filter(r => new Date(r[1]).getTime() >= batas)
    .map(r => {
      const status = String(r[4]).trim().toLowerCase();
      const m = mutasi[String(r[7])];
      return {
        id: String(r[0]),
        waktu: Utilities.formatDate(new Date(r[1]), tz, 'dd MMM yyyy • HH:mm'),
        nama: String(r[2]), nominal: Number(r[3]) || 0,
        status: status === TOPUP_DISETUJUI ? 'email'
          : status === TOPUP_DISETUJUI_MANUAL ? 'manual'
          : status === TOPUP_DITOLAK ? 'ditolak' : 'menunggu',
        pengirim: String(r[5]), keterangan: String(r[6]),
        notifikasi: m ? { pengirim: m.pengirim, bank: m.bank,
          waktu: Utilities.formatDate(m.waktu, tz, 'dd MMM • HH:mm') } : null
      };
    })
    .reverse();
}

/** Setujui / tolak satu top-up yang masih menunggu. Balikan daftar terbaru + dasbor. */
function adminPutuskanTopUp(pin, id, keputusan) {
  cekPinAdmin_(pin);
  if (keputusan !== 'setujui' && keputusan !== 'tolak') throw new Error('Keputusan tidak dikenal.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_TOPUP);
    const last = sheet.getLastRow();
    const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, TOPUP_HEADER.length).getValues();
    const i = rows.findIndex(r => String(r[0]) === String(id));
    if (i < 0) throw new Error('Top-up tidak ditemukan.');
    const r = rows[i];
    if (String(r[4]).trim().toLowerCase() !== TOPUP_MENUNGGU) {
      throw new Error('Top-up ini sudah diputuskan (' + r[4] + ').');
    }
    if (keputusan === 'setujui') {
      setujuiTopUp_(sheet, i + 2, { id: String(r[0]), nama: String(r[2]), nominal: Number(r[3]) || 0,
        keterangan: String(r[6]) }, TOPUP_DISETUJUI_MANUAL, null);
    } else {
      sheet.getRange(i + 2, 5).setValue(TOPUP_DITOLAK);
      sheet.getRange(i + 2, 9).setValue(new Date().toISOString());
    }
  } finally {
    lock.releaseLock();
  }
  return { daftar: daftarTopUpAdmin_(), data: getDashboardData() };
}

/**
 * Dipanggil klien saat menyimpan bukti transfer.
 * items = [{ nama, nominal, keterangan, pengirim }] — pengirim = nama hasil baca bukti.
 * Balikan { data: dasbor, hasil: ['langsung' | 'terverifikasi' | 'menunggu', ...] }.
 */
function ajukanTopUp(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Tidak ada top-up untuk disimpan.');
  const roster = getAnggota();
  const bersih = items.map(it => {
    const nama = String(it && it.nama || '').trim();
    if (!nama || nama === KAS_NAMA || roster.indexOf(nama) < 0) throw new Error('"' + nama + '" bukan anggota Kodomo.');
    return {
      nama: nama,
      nominal: parseNominal_(it.nominal),
      keterangan: String(it.keterangan || '').trim(),
      pengirim: String(it.pengirim || '').trim()
    };
  });

  if (!verifikasiTopUpAktif_()) {
    // Verifikasi belum diaktifkan admin → perilaku lama: langsung masuk.
    const data = submitAmalanBatch(bersih.map(it =>
      ({ nama: it.nama, tipe: 'Pahala', nominal: it.nominal, keterangan: it.keterangan })));
    return { data: data, hasil: bersih.map(() => 'langsung') };
  }

  // Notifikasi bank biasanya sudah tiba saat bukti diunggah — sinkronkan dulu.
  try { sinkronMutasiGmail_(3, 45000); } catch (e) { console.warn('Sinkron mutasi gagal: ' + e.message); }

  const hasil = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_TOPUP);
    const mutasi = bacaMutasi_();
    const sekarang = new Date();
    bersih.forEach(it => {
      const topup = {
        id: 'T' + sekarang.getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        diunggah: sekarang, nama: it.nama, nominal: it.nominal,
        pengirim: it.pengirim, keterangan: it.keterangan
      };
      const cocok = cariMutasiCocok_(topup, mutasi);
      const r = sheet.getLastRow() + 1;
      sheet.getRange(r, 1, 1, TOPUP_HEADER.length).setValues([[topup.id, sekarang.toISOString(),
        topup.nama, topup.nominal, TOPUP_MENUNGGU, topup.pengirim, topup.keterangan, '', sekarang.toISOString()]]);
      if (cocok) {
        setujuiTopUp_(sheet, r, topup, TOPUP_DISETUJUI, cocok);
        hasil.push('terverifikasi');
      } else {
        hasil.push('menunggu');
      }
    });
  } finally {
    lock.releaseLock();
  }
  return { data: getDashboardData(), hasil: hasil };
}

/**
 * Pemicu tiap jam (dan onEdit): sinkronkan notifikasi bank, terapkan keputusan
 * manual admin, lalu cocokkan ulang semua top-up yang masih menunggu.
 */
function prosesTopUpMenunggu() {
  if (!verifikasiTopUpAktif_()) return { disetujui: 0, ditolak: 0 };
  try { sinkronMutasiGmail_(10, 4 * 60 * 1000); } catch (e) { console.warn('Sinkron mutasi gagal: ' + e.message); }
  return terapkanTopUp_();
}

/** Pemicu onEdit spreadsheet: hanya bereaksi kalau kolom Status sheet TopUp diubah. */
function saatSheetDiedit(e) {
  try {
    const range = e && e.range;
    if (!range || range.getSheet().getName() !== SHEET_TOPUP || range.getColumn() > 5 ||
        range.getColumn() + range.getNumColumns() - 1 < 5) return;
    terapkanTopUp_();
  } catch (err) {
    console.warn('saatSheetDiedit: ' + err.message);
  }
}

function terapkanTopUp_() {
  const ringkas = { disetujui: 0, ditolak: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_TOPUP);
    const last = sheet.getLastRow();
    if (last < 2) return ringkas;
    const rows = sheet.getRange(2, 1, last - 1, TOPUP_HEADER.length).getValues();
    const mutasi = bacaMutasi_();
    rows.forEach((r, i) => {
      const status = String(r[4]).trim().toLowerCase();
      const topup = { id: String(r[0]), diunggah: new Date(r[1]), nama: String(r[2]),
        nominal: Number(r[3]) || 0, pengirim: String(r[5]), keterangan: String(r[6]) };
      if (status === 'setujui') {
        setujuiTopUp_(sheet, i + 2, topup, TOPUP_DISETUJUI_MANUAL, null);
        ringkas.disetujui++;
      } else if (status === 'tolak') {
        sheet.getRange(i + 2, 5).setValue(TOPUP_DITOLAK);
        sheet.getRange(i + 2, 9).setValue(new Date().toISOString());
        ringkas.ditolak++;
      } else if (status === TOPUP_MENUNGGU) {
        const cocok = cariMutasiCocok_(topup, mutasi);
        if (cocok) {
          setujuiTopUp_(sheet, i + 2, topup, TOPUP_DISETUJUI, cocok);
          ringkas.disetujui++;
        }
      }
    });
  } finally {
    lock.releaseLock();
  }
  if (ringkas.disetujui || ringkas.ditolak) console.log('Top-up diproses: ' + JSON.stringify(ringkas));
  return ringkas;
}

/** Tulis Pahala top-up + tandai notifikasi terpakai. Pemanggil memegang lock. */
function setujuiTopUp_(sheet, baris, topup, status, mutasi) {
  if (!(topup.nominal > 0) || !topup.nama) return;
  const tanda = status === TOPUP_DISETUJUI ? 'terverifikasi otomatis' : 'disetujui admin';
  tulisBarisBatch_([{ nama: topup.nama, tipe: 'Pahala', nominal: topup.nominal,
    keterangan: (topup.keterangan ? topup.keterangan + ' · ' : '') + tanda }]);
  sheet.getRange(baris, 5).setValue(status);
  sheet.getRange(baris, 8).setValue(mutasi ? mutasi.id : '');
  sheet.getRange(baris, 9).setValue(new Date().toISOString());
  if (mutasi) {
    mutasi.status = MUTASI_DIPAKAI; // supaya tidak dipakai top-up lain di putaran yang sama
    const mSheet = getSheet_(SHEET_MUTASI);
    mSheet.getRange(mutasi.baris, 7).setValue(MUTASI_DIPAKAI);
    mSheet.getRange(mutasi.baris, 8).setValue(topup.id);
  }
}

/**
 * Notifikasi yang cocok untuk satu top-up, atau null kalau tidak yakin.
 * Wajib: nominal sama persis, belum dipakai, waktunya dalam jendela. Lalu
 * nama pengirim harus mirip — nominal bulat seperti 50.000 sangat sering kembar
 * antar-orang, jadi nominal saja tidak cukup. Lebih dari satu kandidat → yang
 * waktunya paling dekat dengan unggah.
 */
function cariMutasiCocok_(topup, mutasi) {
  const jendela = TOPUP_JENDELA_HARI * 86400000;
  const t = topup.diunggah.getTime();
  const kandidat = mutasi.filter(m => m.status === MUTASI_BEBAS && m.nominal === topup.nominal &&
    Math.abs(m.waktu.getTime() - t) <= jendela &&
    (namaPengirimMirip_(m.pengirim, topup.pengirim) || namaPengirimMirip_(m.pengirim, topup.nama)));
  if (!kandidat.length) return null;
  kandidat.sort((a, b) => Math.abs(a.waktu.getTime() - t) - Math.abs(b.waktu.getTime() - t));
  return kandidat[0];
}

/** "MAKOTO DAIWA A" ~ "Makoto Daiwa Ambara": ada satu kata (≥3 huruf) yang sama,
 *  atau satu kata ≥4 huruf yang jadi awalan kata lain (nama terpotong bank). */
function namaPengirimMirip_(a, b) {
  const kata = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const ka = kata(a), kb = kata(b);
  return ka.some(x => kb.some(y => x === y ||
    (Math.min(x.length, y.length) >= 4 && (x.indexOf(y) === 0 || y.indexOf(x) === 0))));
}

function bacaMutasi_() {
  const sheet = getSheet_(SHEET_MUTASI);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, MUTASI_HEADER.length).getValues().map((r, i) => ({
    baris: i + 2, id: String(r[0]), waktu: new Date(r[1]), bank: String(r[2]),
    pengirim: String(r[3]), nominal: Number(r[4]) || 0, status: String(r[6])
  }));
}

/**
 * Baca email notifikasi bank yang belum pernah dibaca ke sheet Mutasi (Gemini
 * membaca tiap email SEKALI). maks = email per panggilan, batasMs = waktu
 * maksimum — dari tombol unggah dibatasi ketat karena pemakai sedang menunggu.
 */
function sinkronMutasiGmail_(maks, batasMs) {
  const kueri = String(PropertiesService.getScriptProperties().getProperty(TOPUP_PROP_KUERI) || '').trim();
  if (!kueri) return 0;
  const sheet = getSheet_(SHEET_MUTASI);
  const last = sheet.getLastRow();
  const sudah = {};
  if (last >= 2) sheet.getRange(2, 1, last - 1, 1).getValues().forEach(r => { sudah[String(r[0])] = true; });

  const mulai = Date.now();
  let dibaca = 0;
  const threads = GmailApp.search(kueri + ' newer_than:' + (TOPUP_JENDELA_HARI + 1) + 'd', 0, 50);
  luar:
  for (let t = 0; t < threads.length; t++) {
    const pesan = threads[t].getMessages();
    for (let m = 0; m < pesan.length; m++) {
      const msg = pesan[m];
      if (sudah[msg.getId()]) continue;
      if (dibaca >= maks || Date.now() - mulai > batasMs) break luar;
      dibaca++;
      let n;
      try {
        n = bacaNotifikasiBank_(msg.getSubject() + '\n\n' + String(msg.getPlainBody() || '').slice(0, 8000));
      } catch (e) {
        if (/sedang penuh/.test(e.message)) break luar; // Gemini penuh: lanjut di putaran berikutnya
        n = { masuk: false, nominal: 0, pengirim: '', bank: '', referensi: 'tak terbaca: ' + e.message.slice(0, 80) };
      }
      const ok = n.masuk && n.nominal > 0;
      const r = sheet.getLastRow() + 1;
      sheet.getRange(r, 1, 1, MUTASI_HEADER.length).setNumberFormat('@');
      sheet.getRange(r, 1, 1, MUTASI_HEADER.length).setValues([[msg.getId(), msg.getDate().toISOString(),
        n.bank, n.pengirim, String(n.nominal), n.referensi, ok ? MUTASI_BEBAS : MUTASI_ABAIKAN, '',
        new Date().toISOString()]]);
      sudah[msg.getId()] = true;
    }
  }
  return dibaca;
}

/** Satu email notifikasi bank → { masuk, nominal, pengirim, bank, referensi }. */
function bacaNotifikasiBank_(teks) {
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('GEMINI_API_KEY belum diatur.');
  const body = {
    contents: [{ parts: [{ text:
      'Ini email notifikasi transaksi dari bank atau dompet digital (Rupiah). Tentukan:\n' +
      '- masuk: true HANYA jika ini dana MASUK ke rekening penerima email ini (transfer ' +
      'masuk / kredit). Transfer keluar, pembayaran, OTP, promo → false.\n' +
      '- nominal: jumlah dana masuk, angka bulat tanpa "Rp"/titik/koma.\n' +
      '- pengirim: nama pengirim persis seperti tertulis (kosong jika tidak ada).\n' +
      '- bank: nama bank/dompet digital penerbit notifikasi.\n' +
      '- referensi: nomor referensi/transaksi jika ada.\n\n' + teks }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: {
        masuk: { type: 'BOOLEAN' }, nominal: { type: 'NUMBER' }, pengirim: { type: 'STRING' },
        bank: { type: 'STRING' }, referensi: { type: 'STRING' } }, required: ['masuk', 'nominal'] }
    }
  };
  const json = JSON.parse(panggilGemini_(apiKey, body));
  const cand = json.candidates && json.candidates[0];
  const isi = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
  if (!isi) throw new Error('respons tanpa teks');
  const o = JSON.parse(isi);
  return {
    masuk: o.masuk === true,
    nominal: Math.round(Math.abs(Number(o.nominal))) || 0,
    pengirim: String(o.pengirim || '').trim(),
    bank: String(o.bank || '').trim(),
    referensi: String(o.referensi || '').trim()
  };
}

/** Untuk dasbor: top-up yang masih menunggu verifikasi (terbaru dulu). */
function daftarTopUpMenunggu_() {
  const sheet = getSheet_(SHEET_TOPUP);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sheet.getRange(2, 1, last - 1, 7).getValues()
    .filter(r => String(r[4]).trim().toLowerCase() === TOPUP_MENUNGGU)
    .map(r => ({ nama: String(r[2]), nominal: Number(r[3]) || 0, keterangan: String(r[6]),
      t: new Date(r[1]).getTime() || 0,
      waktu: Utilities.formatDate(new Date(r[1]), tz, 'dd MMM • HH:mm') }))
    .reverse()
    .slice(0, 20);
}

/** Jalankan SEKALI dari editor setelah mengisi MUTASI_GMAIL_KUERI. Aman diulang. */
function pasangPemicuTopUp() {
  if (!String(PropertiesService.getScriptProperties().getProperty(TOPUP_PROP_KUERI) || '').trim()) {
    throw new Error('Isi dulu Script Property ' + TOPUP_PROP_KUERI + ' (kueri Gmail notifikasi dana masuk).');
  }
  ScriptApp.getProjectTriggers()
    .filter(t => ['prosesTopUpMenunggu', 'saatSheetDiedit'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('prosesTopUpMenunggu').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('saatSheetDiedit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  const n = sinkronMutasiGmail_(10, 4 * 60 * 1000);
  const pesan = 'Verifikasi top-up aktif: dicek tiap jam + saat kolom Status sheet TopUp diubah. ' +
    n + ' email notifikasi dibaca sekarang — cek sheet Mutasi untuk memastikan hasilnya benar.';
  console.log(pesan);
  return pesan;
}
