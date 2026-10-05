/**
 * KODOMO — baca struk & bukti transfer lewat Gemini Vision, plus alias
 * nama hasil OCR yang dipelajari dari koreksi pemakai.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

/** Model Gemini untuk baca struk (foto) — ganti di sini kalau mau versi lain. */
const GEMINI_MODEL = 'gemini-3.5-flash';

/**
 * Model cadangan, dicoba berurutan kalau model utama sedang penuh (HTTP 503
 * "high demand") atau kuotanya habis (HTTP 429). Kapasitas & kuota Gemini
 * dihitung PER MODEL, jadi model lain sering masih longgar saat model utama
 * kewalahan. Dipakai alias "-latest" resmi Google supaya tidak basi saat
 * versi model berganti.
 *
 * Bisa ditimpa tanpa deploy ulang lewat Script Properties:
 *   GEMINI_MODEL_CADANGAN = model-a, model-b
 * Model yang tidak dikenali (HTTP 404) dilewati otomatis, tidak menggagalkan.
 */
const GEMINI_MODEL_CADANGAN = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

/** Berapa kali satu model dicoba sebelum pindah ke model berikutnya. */
const GEMINI_PERCOBAAN_PER_MODEL = 3;

/** Batas total waktu menunggu (ms) untuk SATU gambar. Di atas ini menyerah
 *  dengan pesan yang jelas — pengguna lebih baik diberi tahu daripada
 *  menunggu tanpa kepastian. Jauh di bawah batas eksekusi GAS (6 menit). */
const GEMINI_BATAS_WAKTU_MS = 90000;

/** Kalau Google menyuruh menunggu lebih lama dari ini (kuota per menit/hari
 *  habis), jangan ditunggu — langsung pindah ke model cadangan. */
const GEMINI_JEDA_MAKS_MS = 15000;

/** API key Gemini disimpan di Script Properties (Project Settings > Script
 *  Properties di editor Apps Script), BUKAN di source code — lihat GAPS.md #1
 *  soal kenapa hardcode key itu buruk. */
function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

/** Urutan model yang dicoba: utama dulu, lalu cadangan (tanpa duplikat). */
function daftarModelGemini_() {
  const prop = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_CADANGAN');
  const cadangan = prop
    ? prop.split(',').map(m => m.trim()).filter(Boolean)
    : GEMINI_MODEL_CADANGAN;
  return [GEMINI_MODEL].concat(cadangan).filter((m, i, a) => a.indexOf(m) === i);
}

/**
 * Jeda yang DIMINTA Google (ms), kalau ada. Respons 429 biasanya membawa
 * RetryInfo, mis. {"@type": "...RetryInfo", "retryDelay": "33s"}.
 * Balikan 0 kalau tidak ada saran jeda.
 */
function jedaSaranGemini_(teks) {
  try {
    const detail = (JSON.parse(teks).error || {}).details || [];
    for (let i = 0; i < detail.length; i++) {
      const m = String(detail[i].retryDelay || '').match(/^([\d.]+)s$/);
      if (m) return Math.ceil(Number(m[1]) * 1000);
    }
  } catch (e) { /* bukan JSON — tidak ada saran */ }
  return 0;
}

/**
 * Kirim satu permintaan generateContent dengan ketahanan terhadap server
 * Google yang sibuk. Balikan teks respons (JSON mentah) saat HTTP 200.
 *
 * - 429 / 5xx / koneksi putus  → coba ulang dengan jeda bertahap (1s, 2s, …
 *   + acak), atau sesuai jeda yang diminta Google; kalau tetap gagal, pindah
 *   ke model cadangan.
 * - 404 (model tak dikenal) / 400 → lewati model ini, coba model berikutnya.
 * - 401 / 403 (masalah API key) → langsung gagal; ganti model tidak menolong.
 */
function panggilGemini_(apiKey, body) {
  const mulai = Date.now();
  const jejak = [];          // ringkas, untuk pesan error & log: 'model#coba→kode'
  let galatLain = '';        // galat pertama yang BUKAN "sibuk", untuk diagnosis
  const sisaWaktu = () => GEMINI_BATAS_WAKTU_MS - (Date.now() - mulai);

  const models = daftarModelGemini_();
  luar:
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    for (let coba = 1; coba <= GEMINI_PERCOBAAN_PER_MODEL; coba++) {
      if (sisaWaktu() <= 0) break luar;

      let kode = 0, teks = '';
      try {
        const res = UrlFetchApp.fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model +
            ':generateContent?key=' + encodeURIComponent(apiKey),
          {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(body),
            muteHttpExceptions: true
          }
        );
        kode = res.getResponseCode();
        teks = res.getContentText();
      } catch (e) {
        teks = String((e && e.message) || e); // timeout / koneksi putus
      }

      if (kode === 200) {
        if (jejak.length) console.log('Gemini berhasil setelah: ' + jejak.join(', ') + ' → ' + model);
        return teks;
      }
      jejak.push(model + '#' + coba + '→' + (kode || 'putus'));
      console.warn('Gemini gagal ' + jejak[jejak.length - 1] + ': ' + teks.slice(0, 300));

      if (kode === 401 || kode === 403) {
        throw new Error('Gagal membaca struk: API key Gemini ditolak (HTTP ' + kode + '). ' +
          'Periksa GEMINI_API_KEY di Script Properties.');
      }
      const sibuk = kode === 0 || kode === 429 || kode >= 500;
      if (!sibuk) {
        if (!galatLain) galatLain = 'HTTP ' + kode + ': ' + teks.slice(0, 300);
        continue luar; // 400/404: model ini tak bisa dipakai, coba berikutnya
      }

      const saran = jedaSaranGemini_(teks);
      if (saran > GEMINI_JEDA_MAKS_MS) continue luar; // kuota model ini habis lama
      if (coba < GEMINI_PERCOBAAN_PER_MODEL) {
        const jeda = saran || (1000 * Math.pow(2, coba - 1) + Math.floor(Math.random() * 600));
        if (jeda >= sisaWaktu()) break luar;
        Utilities.sleep(jeda);
      }
    }
  }

  if (galatLain && jejak.every(j => !/→(0|429|5\d\d|putus)$/.test(j))) {
    throw new Error('Gagal membaca struk (' + galatLain + ')');
  }
  throw new Error('Server Google (Gemini) sedang penuh, gambar belum bisa dibaca. ' +
    'Coba lagi 1–2 menit lagi. [' + jejak.join(', ') + ']');
}

/**
 * Baca foto lewat Gemini Vision, balikin daftar {nama, nominal}.
 * mode 'struk' (default): screenshot split tagihan, satu baris per orang
 *   (baris 'You'/'Anda'/host difilter oleh prompt).
 * mode 'transfer': bukti transfer bank/e-wallet, diambil nama PENGIRIM +
 *   nominal (biasanya satu item) — dipakai menu top-up pahala.
 * Nama hasil baca belum tentu cocok dengan roster Anggota — pencocokan &
 * konfirmasi akhir dilakukan di klien (dropdown per baris), fungsi ini cuma baca.
 */
function parseStruk(base64, mimeType, mode) {
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('Fitur baca struk belum diaktifkan (GEMINI_API_KEY belum diatur).');
  if (!base64) throw new Error('Gambar struk kosong.');
  const tipe = String(mimeType || '').trim();
  if (tipe.indexOf('image/') !== 0) throw new Error('File harus berupa gambar.');

  const prompt = mode === 'transfer'
    ? 'Ini screenshot bukti transfer bank atau e-wallet (Rupiah). Ekstrak nama PENGIRIM ' +
      '(bukan penerima) persis seperti tertulis, nominal uang yang ditransfer sebagai ' +
      'angka bulat tanpa "Rp"/titik/koma, dan nama bank atau dompet digital yang dipakai ' +
      '(field bank, mis. "BCA", "GoPay") kalau terlihat. Abaikan biaya admin. ' +
      'Biasanya hanya ada satu transfer.'
    : 'Ini screenshot daftar split tagihan/utang. Setiap baris berisi nama ' +
      'orang dan nominal uang (Rupiah). Ambil semua baris KECUALI baris milik pemilik akun ' +
      'sendiri (berlabel "You", "Anda", "Kamu", atau "Host"). Untuk tiap baris sisanya, ' +
      'balikan nama persis seperti tertulis dan nominal sebagai angka bulat tanpa "Rp"/titik/koma.';

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: tipe, data: base64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            nama: { type: 'STRING' },
            nominal: { type: 'NUMBER' },
            bank: { type: 'STRING' }
          },
          required: ['nama', 'nominal']
        }
      }
    }
  };

  // Coba ulang + model cadangan saat server Google penuh (lihat panggilGemini_).
  // Pesan error tetap menyertakan jejak kode HTTP per percobaan, supaya
  // kegagalan bisa didiagnosis dari toast tanpa membuka log eksekusi.
  const teksRespons = panggilGemini_(apiKey, body);

  let items;
  try {
    const json = JSON.parse(teksRespons);
    const cand = json.candidates && json.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts[0] &&
      cand.content.parts[0].text;
    if (!text) {
      const alasan = cand && cand.finishReason;
      throw new Error('respons Gemini tanpa teks' + (alasan ? ' (finishReason: ' + alasan + ')' : '') +
        ': ' + teksRespons.slice(0, 300));
    }
    items = JSON.parse(text);
  } catch (e) {
    throw new Error('Gagal membaca struk: ' + (e.message || 'parse error'));
  }
  if (!Array.isArray(items)) throw new Error('Gagal membaca struk: respons bukan daftar (array).');

  return items
    .map(it => ({
      nama: String(it.nama || '').trim(),
      nominal: Math.round(Number(it.nominal)) || 0,
      bank: String(it.bank || '').trim()
    }))
    .filter(it => it.nama && it.nominal > 0)
    .slice(0, 50);
}

/**
 * Alias nama hasil baca foto → nama roster, dipelajari dari koreksi user di
 * modal review (kunci = nama OCR yang dinormalisasi klien). Disimpan di
 * Script Properties supaya berlaku untuk semua pemakai, bukan per-device.
 */
function getStrukAlias_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('STRUK_ALIAS') || '{}');
  } catch (e) {
    return {};
  }
}

/** Gabungkan alias baru dari klien ke map tersimpan. */
function saveStrukAlias(map) {
  if (!map || typeof map !== 'object') return;
  const cur = getStrukAlias_();
  Object.keys(map).forEach(k => {
    const key = String(k).trim().slice(0, 80);
    const val = String(map[k]).trim().slice(0, 80);
    if (key && val) cur[key] = val;
  });
  // ponytail: tanpa lock — tabrakan dua koreksi bersamaan paling banter kehilangan
  // satu alias yang akan terpelajari lagi di upload berikutnya. Script Properties
  // max ~9KB per value; pangkas manual kalau suatu saat penuh.
  PropertiesService.getScriptProperties().setProperty('STRUK_ALIAS', JSON.stringify(cur));
}
