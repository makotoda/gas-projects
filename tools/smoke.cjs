/**
 * Smoke test frontend Kodomo tanpa deploy dan tanpa Google.
 *
 * Menjalankan halaman hasil tools/render.cjs di Chromium, dengan
 * google.script.run dipalsukan supaya memakai data contoh. Yang diperiksa:
 * halaman termuat tanpa galat, dasbor ter-render, ketiga tema berputar,
 * grafik saldo terbentuk, dan checkout Kopdos mengirim payload yang benar.
 *
 *   npm i -D playwright        (sekali; Chromium biasanya sudah ada di CI)
 *   node tools/smoke.cjs       → deretan baris OK/GAGAL + kode keluar
 *
 * Berkas ini TIDAK ikut ke Apps Script (ekstensi .cjs, lihat .claspignore).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { render } = require('./render.cjs');

const DATA = {
  totalPahala: 1200000, totalDosa: 800000, totalTransaksi: 42,
  leaderboard: [
    { nama: 'Ochi',   foto: '', pahala: 400000, dosa: 25299,  saldo: 374701,  recent: [] },
    { nama: 'Jana',   foto: '', pahala: 350000, dosa: 16547,  saldo: 333453,  recent: [] },
    { nama: 'Kumala', foto: '', pahala: 10000,  dosa: 175215, saldo: -165215, recent: [] }
  ],
  history: [{ waktu: '04 Aug 2026 • 20:00', nama: 'Ochi', tipe: 'Dosa', nominal: 35000,
              keterangan: 'Kopdos — Tissue x1' }],
  kas: { saldo: 125000, history: [], leaderboard: [{ nama: 'Ochi', foto: '', total: 5000 }] },
  infaqMap: { Ochi: 500 },
  strukAlias: {},
  anggota: ['Ochi', 'Jana', 'Kumala', 'KAS'],
  bulanList: [{ key: '2026-08', label: 'Agustus 2026' }],
  deret: {
    hari: ['01/08', '02/08', '03/08'], tanggal: ['2026-08-01', '2026-08-02', '2026-08-03'],
    orang: [{ nama: 'Ochi', foto: '', nilai: [360000, 370000, 374701] },
            { nama: 'Kumala', foto: '', nilai: [-150000, -160000, -165215] }]
  },
  katalog: [{ id: 'tissue', nama: 'Tissue', harga: 35000, emoji: '🧻' }],
  resto: [{ nama: 'Ayam Ternate', kunci: 'ayam ternate', varian: 'ayam ternate',
            jumlah: 13, dipakai: 10, rata: 8707, min: 5682, max: 11142, update: '04 Aug 2026' }]
};

const STUB = `<script>
window.google = { script: { run: new Proxy({}, { get(t, k) {
  if (k === 'withSuccessHandler') return fn => (window.__ok = fn, google.script.run);
  if (k === 'withFailureHandler') return fn => (window.__err = fn, google.script.run);
  return (...a) => { window.__rpc = { fn: k, args: a };
    setTimeout(() => window.__ok && window.__ok(${JSON.stringify(DATA)}), 20); };
}})}};
</script>`;

let gagal = 0;
const cek = (nama, syarat, detail) => {
  console.log(`${syarat ? 'OK   ' : 'GAGAL'} ${nama}${detail ? '  — ' + detail : ''}`);
  if (!syarat) gagal++;
};

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.error('playwright belum terpasang: npm i -D playwright'); process.exit(2); }

  const berkas = path.join(os.tmpdir(), 'kodomo-smoke.html');
  fs.writeFileSync(berkas, STUB + render().html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const galat = [];
  page.on('pageerror', e => galat.push(String(e)));

  await page.goto('file://' + berkas);
  await page.evaluate(() => {
    try {
      localStorage.setItem('kodomoSkipLanding', 'true');
      localStorage.setItem('kodomo_tutorial_seen', 'true');
      localStorage.setItem('kodomoTutorialDone', 'true');
    } catch (e) {}
  });
  await page.reload();
  await page.waitForTimeout(2000);

  cek('halaman termuat tanpa galat JS', galat.length === 0, galat[0]);
  cek('dasbor pertama dipanggil',
    await page.evaluate(() => !!window.__rpc || !!document.querySelector('.lb-item')));
  cek('leaderboard ter-render',
    (await page.locator('#viewLeaderboard .lb-item').count()) === 3);
  cek('baris dosa ditandai .neg',
    (await page.locator('#viewLeaderboard .lb-item.neg').count()) === 1);
  cek('tab resto terisi', (await page.locator('#viewResto .resto-item').count()) === 1);

  // Tema: default Merah Putih, lalu berputar tiga langkah kembali ke awal.
  // Dibandingkan sebagai HIMPUNAN kelas: urutan className di DOM tidak stabil
  // ('mp light' vs 'light mp' adalah keadaan yang sama).
  const kelas = () => page.evaluate(() =>
    [...document.body.classList].sort().join(' ') || '(gelap)');
  const tema = [await kelas()];
  for (let i = 0; i < 3; i++) {
    await page.click('#themeBtn');
    await page.waitForTimeout(80);
    tema.push(await kelas());
  }
  cek('tema default Merah Putih', tema[0].includes('mp'), tema[0]);
  cek('siklus tema tiga langkah kembali ke awal',
    tema[3] === tema[0] && new Set(tema.slice(0, 3)).size === 3, tema.join(' → '));

  // Grafik saldo harian (hanya di layar lebar).
  await page.click('.stat[data-metric="pahala"]');
  await page.waitForTimeout(300);
  const garis = await page.locator('#modalList .grafik-garis').count();
  const label = await page.locator('#modalList .grafik-ujung').count();
  cek('grafik saldo tergambar', garis > 0, garis + ' garis');
  cek('tiap garis punya label ujung', garis === label, `${garis} garis / ${label} label`);
  await page.click('#modalClose');

  // Checkout Kopdos: klien hanya boleh mengirim id + qty, tanpa harga.
  await page.click('#kopdosBtn');
  await page.waitForTimeout(200);
  await page.selectOption('#kopdosNama', 'Ochi');
  await page.click('.kop-row [data-aksi="tambah"]');
  await page.click('.kop-row [data-aksi="tambah"]');
  cek('total keranjang 2 unit', (await page.textContent('#kopdosTotal')) === '70.000');
  await page.click('#kopdosCheckout');
  await page.waitForTimeout(400);
  const rpc = await page.evaluate(() => window.__rpc);
  cek('checkout memanggil submitBelanja', rpc && rpc.fn === 'submitBelanja', JSON.stringify(rpc));
  cek('payload tanpa harga',
    rpc && JSON.stringify(rpc.args[0]) === '{"nama":"Ochi","items":[{"id":"tissue","qty":2}]}',
    JSON.stringify(rpc && rpc.args[0]));

  await browser.close();
  console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : '\nsemua pemeriksaan lolos');
  process.exit(gagal ? 1 : 0);
})();
