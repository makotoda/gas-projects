/**
 * Menyusun Index.html + seluruh berkas include menjadi satu dokumen HTML,
 * meniru apa yang dilakukan doGet() di server.
 *
 * Gunanya: memeriksa perubahan frontend TANPA deploy. Halaman hasilnya bisa
 * dibuka langsung di browser atau diuji lewat tools/smoke.cjs.
 *
 *   node tools/render.cjs [keluaran.html]      (default: /tmp/kodomo-render.html)
 *
 * Berkas ini TIDAK ikut ke Apps Script — berekstensi .cjs, sementara .clasp.json
 * hanya mengirim .js/.gs (lihat juga .claspignore).
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const TAG = /^<\?!= include\('(\w+)'\) \?>$/;

function render() {
  const kerangka = fs.readFileSync(path.join(AKAR, 'Index.html'), 'utf8');
  const dipakai = [];
  const hasil = kerangka.split('\n').map(baris => {
    const m = baris.match(TAG);
    if (!m) return baris;
    const berkas = path.join(AKAR, m[1] + '.html');
    if (!fs.existsSync(berkas)) {
      throw new Error(`Index.html memanggil include('${m[1]}') tapi ${m[1]}.html tidak ada.`);
    }
    dipakai.push(m[1] + '.html');
    const isi = fs.readFileSync(berkas, 'utf8');
    return isi.endsWith('\n') ? isi.slice(0, -1) : isi;
  }).join('\n');
  return { html: hasil, dipakai };
}

/** Berkas potongan yang ada di folder tapi tidak pernah di-include (kode mati). */
function yatimPiatu(dipakai) {
  return fs.readdirSync(AKAR)
    .filter(f => /^(Style|Body|Js)\w+\.html$/.test(f))
    .filter(f => dipakai.indexOf(f) < 0);
}

if (require.main === module) {
  const keluaran = process.argv[2] || '/tmp/kodomo-render.html';
  const { html, dipakai } = render();
  fs.writeFileSync(keluaran, html);
  const yatim = yatimPiatu(dipakai);
  console.log(`${dipakai.length} potongan → ${keluaran} (${html.length} byte)`);
  if (yatim.length) console.log('TIDAK DI-INCLUDE (kode mati?):', yatim.join(', '));
}

module.exports = { render, yatimPiatu };
