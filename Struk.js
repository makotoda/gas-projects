/**
 * KODOMO — baca struk & bukti transfer lewat Gemini Vision, plus alias
 * nama hasil OCR yang dipelajari dari koreksi pemakai.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

/** Model Gemini untuk baca struk (foto) — ganti di sini kalau mau versi lain. */
const GEMINI_MODEL = 'gemini-3.5-flash';

/** API key Gemini disimpan di Script Properties (Project Settings > Script
 *  Properties di editor Apps Script), BUKAN di source code — lihat GAPS.md #1
 *  soal kenapa hardcode key itu buruk. */
function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
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

  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
      ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    }
  );
  // ponytail: pesan error menyertakan detail asli dari Gemini (bukan dibungkus generik)
  // supaya kegagalan gampang didiagnosis dari toast tanpa buka Stackdriver dulu.
  if (res.getResponseCode() !== 200) {
    throw new Error('Gagal membaca struk (HTTP ' + res.getResponseCode() + '): ' +
      res.getContentText().slice(0, 800));
  }

  let items;
  try {
    const json = JSON.parse(res.getContentText());
    const cand = json.candidates && json.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts[0] &&
      cand.content.parts[0].text;
    if (!text) {
      const alasan = cand && cand.finishReason;
      throw new Error('respons Gemini tanpa teks' + (alasan ? ' (finishReason: ' + alasan + ')' : '') +
        ': ' + res.getContentText().slice(0, 300));
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
