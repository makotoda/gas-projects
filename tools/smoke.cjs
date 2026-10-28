/**
 * Smoke test frontend Kodomo tanpa deploy dan tanpa Google.
 *
 * Menjalankan halaman hasil tools/render.cjs di Chromium, dengan
 * google.script.run dipalsukan supaya memakai data contoh. Yang diperiksa:
 * halaman termuat tanpa galat, dasbor ter-render, ketiga tema berputar,
 * grafik saldo terbentuk, checkout Kopdos mengirim payload yang benar, dan
 * pembagian invoice Grab (Pesanan Masuk) sampai ke simpanPesanan.
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
  history: [{ waktu: '05 Aug 2026 • 09:00', nama: 'Jana', tipe: 'Pahala', nominal: 50000,
              keterangan: 'Melalui BCA', menunggu: true },
            { waktu: '04 Aug 2026 • 20:00', nama: 'Ochi', tipe: 'Dosa', nominal: 35000,
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
            jumlah: 13, dipakai: 10, rata: 8707, min: 5682, max: 11142, update: '04 Aug 2026' }],
  topupMenunggu: [{ nama: 'Jana', nominal: 120000, waktu: '28 Oct • 14:02' }],
  // Invoice Grab nyata (28 Okt 2026) yang menunggu dibagi
  pesanan: [{ id: 'A-AWRBEG3WX9C9AV', resto: 'RM Sari Minang', waktu: '28 Oct 26 11:02', total: 86740,
    detail: { pesananId: 'A-AWRBEG3WX9C9AV', resto: 'RM Sari Minang', waktu: '28 Oct 26 11:02',
      subtotal: 221500, total: 86740,
      items: [['nasi gulai ayam', 30500], ['Nasi Gembung goreng', 30500], ['Nasi Ayam +telor', 37500],
              ['nasi ayam bakar', 30500], ['rendang ati', 22000], ['goreng jengkol', 17000],
              ['Nasi Ayam Cabe ijo', 30500], ['rendang daging', 23000]].map(([nama, harga]) => ({ nama, qty: 1, harga })),
      biaya: [{ label: 'Biaya Pengiriman', nominal: 15000 }, { label: 'Biaya Pemesanan', nominal: 2000 }],
      diskon: [{ label: 'Promo', nominal: 99675, untuk: 'menu' }, { label: 'Group', nominal: 19935, untuk: 'menu' },
               { label: 'Diskon ongkir', nominal: 10000, untuk: 'biaya' }, { label: '10%', nominal: 22150, untuk: 'menu' }] } }]
};

const STUB = `<script>
window.google = { script: { run: new Proxy({}, { get(t, k) {
  if (k === 'withSuccessHandler') return fn => (window.__ok = fn, google.script.run);
  if (k === 'withFailureHandler') return fn => (window.__err = fn, google.script.run);
  return (...a) => { window.__rpc = { fn: k, args: a };
    const balas = window.__balas && k in window.__balas ? window.__balas[k] : ${JSON.stringify(DATA)};
    setTimeout(() => window.__ok && window.__ok(balas), 20); };
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
  // Leaderboard default = gelembung (JsGelembung)
  cek('leaderboard gelembung ter-render',
    (await page.locator('#viewLeaderboard .bb').count()) === 3);
  cek('gelembung dosa ditandai .neg & saldo disingkat',
    (await page.locator('#viewLeaderboard .bb.neg').count()) === 1 &&
    (await page.textContent('#viewLeaderboard .bb.neg .bb-nilai')) === '−165K');
  const luas = await page.$$eval('#viewLeaderboard .bb', els => els.map(e => e.getBoundingClientRect().width));
  cek('gelembung terbesar = saldo terbesar', luas[0] > luas[1] && luas[1] > luas[2], luas.join(' '));
  await page.locator('#viewLeaderboard .bb').first().click();
  await page.waitForTimeout(150);
  cek('ketuk gelembung → kartu rincian terbuka',
    (await page.locator('#viewLeaderboard .bb-detail .lb-item.open').count()) === 1 &&
    /Ochi/.test(await page.textContent('#viewLeaderboard .bb-detail .lb-name')));
  const bb = await page.locator('#viewLeaderboard .bb').nth(1).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 5, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  cek('seret gelembung tidak mengganti pilihan',
    /Ochi/.test(await page.textContent('#viewLeaderboard .bb-detail .lb-name')));
  await page.click('#viewLeaderboard .papan-mode [data-mode="daftar"]');
  cek('mode Daftar: leaderboard baris ter-render',
    (await page.locator('#viewLeaderboard .lb-item').count()) === 3);
  cek('baris dosa ditandai .neg',
    (await page.locator('#viewLeaderboard .lb-item.neg').count()) === 1);
  await page.click('#viewLeaderboard .papan-mode [data-mode="gelembung"]');
  cek('kembali ke mode Gelembung', (await page.locator('#viewLeaderboard .bb').count()) === 3);
  cek('riwayat: top-up menunggu bertanda',
    (await page.locator('#viewRiwayat .hx-row.menunggu .hx-tunda').count()) === 1);
  cek('tab resto terisi', (await page.locator('#viewResto .resto-item').count()) === 1);

  // Tema: default Gelap, lalu berputar dua langkah kembali ke awal.
  const kelas = () => page.evaluate(() =>
    [...document.body.classList].sort().join(' ') || '(gelap)');
  const tema = [await kelas()];
  for (let i = 0; i < 2; i++) {
    await page.click('#themeBtn');
    await page.waitForTimeout(80);
    tema.push(await kelas());
  }
  cek('tema default Gelap', tema[0] === '(gelap)', tema[0]);
  cek('siklus tema dua langkah kembali ke awal',
    tema[2] === tema[0] && new Set(tema.slice(0, 2)).size === 2, tema.join(' → '));

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

  // Top-up yang menunggu notifikasi bank tampil (hanya info, tanpa tombol setujui).
  const teksTopup = (await page.textContent('#topupMenunggu')).replace(/\s+/g, ' ').trim();
  cek('top-up menunggu verifikasi tampil', await page.isVisible('#topupMenunggu') &&
    teksTopup.includes('Jana') && teksTopup.includes('120.000'), teksTopup.slice(0, 60));

  // Pesanan Masuk: bagi invoice Grab per orang lalu simpan.
  cek('banner pesanan menunggu tampil', await page.isVisible('#pesananBanner'),
    (await page.textContent('#pesananBanner')).replace(/\s+/g, ' ').trim());
  await page.click('#pesananBanner');
  await page.waitForTimeout(200);
  cek('1 pesanan → langsung ke layar bagi', await page.isVisible('#psnBagi'));
  await page.click('.psn-unit[data-i="0"]');
  cek('ketuk menu tanpa memilih orang → diingatkan',
    (await page.textContent('#toast')).includes('Pilih orangnya dulu'));
  cek('tombol simpan nonaktif sebelum semua terbagi', await page.isDisabled('#psnSimpan'));
  const tetapkan = async (nama, unit) => {
    if (nama === 'Saya') await page.click('.psn-chip[data-nama="__SAYA__"]');
    else await page.selectOption('#psnTambah', nama);
    for (const i of unit) await page.click(`.psn-unit[data-i="${i}"]`);
  };
  await tetapkan('Ochi', [0, 1]);
  await tetapkan('Jana', [2]);
  await tetapkan('Jana', [3]);       // Jana dipilih lagi → slot TITIPAN baru (Jana#2)
  await tetapkan('Saya', [4, 5]);
  await tetapkan('Kumala', [6, 7]);
  const chipJana = await page.$$eval('.psn-chip', cs => cs
    .filter(c => c.dataset.nama.replace(/#\d+$/, '') === 'Jana')
    .map(c => ({ label: c.textContent.replace(/\s+/g, ' ').trim(), warna: c.style.getPropertyValue('--w') })));
  cek('titipan: Jana punya 2 chip dengan warna berbeda',
    chipJana.length === 2 && chipJana[0].warna !== chipJana[1].warna,
    chipJana.map(c => `${c.label} [${c.warna}]`).join(' | '));
  const status = await page.textContent('#psnStatus');
  cek('semua terbagi → status hijau & jumlah = total', status.includes('✓') && status.includes('86.740'), status);
  cek('tombol simpan aktif untuk 3 orang (Saya tidak dicatat)',
    !(await page.isDisabled('#psnSimpan')) && (await page.textContent('#psnSimpan')).includes('3 orang'));
  await page.click('#psnSimpan');
  await page.waitForTimeout(300);
  const rpcPsn = await page.evaluate(() => window.__rpc);
  const rk = rpcPsn && rpcPsn.args[2] ? Object.values(rpcPsn.args[2]).reduce((a, b) => a + b, 0) : 0;
  cek('simpan memanggil simpanPesanan dengan penugasan & ringkas',
    rpcPsn && rpcPsn.fn === 'simpanPesanan' && rpcPsn.args[1].length === 8 && rk === 86740,
    rpcPsn && JSON.stringify(rpcPsn.args[2]));
  cek('titipan dikirim sebagai slot tersendiri (Jana#2)',
    rpcPsn && rpcPsn.args[1][3] === 'Jana#2' && 'Jana#2' in rpcPsn.args[2]);

  // Invoice email yang gagal dibaca otomatis harus terlihat, bukan hilang senyap.
  await page.evaluate(() => {
    dataPesanan = [];
    dataInvoiceGagal = [{ waktu: '28 Oct 2026 • 11:02', alasan: 'Hasil baca invoice tidak seimbang' }];
    renderBannerPesanan();
  });
  const teksBanner = (await page.textContent('#pesananBanner')).replace(/\s+/g, ' ').trim();
  cek('invoice email gagal → banner peringatan tampil', await page.isVisible('#pesananBanner') &&
    teksBanner.includes('gagal dibaca'), teksBanner);
  await page.click('#pesananBanner');
  await page.waitForTimeout(200);
  cek('daftar menampilkan rincian kegagalan', await page.isVisible('.psn-gagal'));
  await page.click('#psnTutupGagal');
  await page.waitForTimeout(200);
  cek('modal punya jalan cadangan unggah screenshot manual', await page.isVisible('#psnUnggahManual'));
  cek('tutup peringatan memanggil hapusCatatanInvoiceGagal',
    (await page.evaluate(() => window.__rpc && window.__rpc.fn)) === 'hapusCatatanInvoiceGagal');

  await page.click('#pesananClose');
  await page.click('#ambilInvoiceBtn');
  await page.waitForTimeout(200);
  cek('tombol "Ambil invoice Grab" memanggil jemputInvoiceSekarang',
    (await page.evaluate(() => window.__rpc && window.__rpc.fn)) === 'jemputInvoiceSekarang');

  // Mode admin: daftar top-up ber-PIN (TopUp.js adminDaftarTopUp / adminPutuskanTopUp)
  const ADM = [
    { id: 'T1', waktu: '28 Oct 2026 • 10:00', nama: 'Jana', nominal: 50000, status: 'menunggu', pengirim: 'JANA P', keterangan: '', notifikasi: null },
    { id: 'T2', waktu: '28 Oct 2026 • 09:00', nama: 'Ochi', nominal: 75000, status: 'email', pengirim: 'Ochi', keterangan: 'Melalui BCA',
      notifikasi: { pengirim: 'OCHI W', bank: 'BCA', waktu: '28 Oct • 09:01' } }
  ];
  await page.evaluate(a => { window.__balas = { adminDaftarTopUp: a }; }, ADM);
  await page.click('#adminBtn');
  cek('🔐 membuka modal admin dengan form PIN', await page.isVisible('#admPin'));
  await page.fill('#admPin', '246810');
  await page.click('#admMasukBtn');
  await page.waitForTimeout(200);
  const rpcAdm = await page.evaluate(() => window.__rpc);
  cek('PIN dikirim ke adminDaftarTopUp', rpcAdm.fn === 'adminDaftarTopUp' && rpcAdm.args[0] === '246810');
  cek('tab Menunggu: hanya yang menunggu, jumlah benar',
    (await page.$$eval('.adm-item', el => el.length)) === 1 && (await page.textContent('#admJmlMenunggu')) === '1');
  await page.click('.adm-filter [data-filter="semua"]');
  cek('tab Semua: yang terkonfirmasi email ditandai + notifikasi bank',
    /Terkonfirmasi email/.test(await page.textContent('.adm-item.ok')) && /OCHI W/.test(await page.textContent('.adm-item.ok')));
  await page.click('.adm-filter [data-filter="menunggu"]');
  await page.evaluate(() => { window.__rpc = null; });
  await page.click('.adm-tolak');
  cek('Tolak butuh dua ketukan', (await page.evaluate(() => window.__rpc)) === null && /Yakin/.test(await page.textContent('.adm-tolak')));
  await page.evaluate(([d, data]) => { window.__balas = { adminPutuskanTopUp: { daftar: d, data } }; },
    [ADM.map(t => t.id === 'T1' ? Object.assign({}, t, { status: 'manual' }) : t), DATA]);
  await page.click('.adm-setujui');
  await page.waitForTimeout(200);
  const rpcPut = await page.evaluate(() => window.__rpc);
  cek('Setujui memanggil adminPutuskanTopUp(pin, id, "setujui")',
    rpcPut && rpcPut.fn === 'adminPutuskanTopUp' && rpcPut.args.join() === '246810,T1,setujui', JSON.stringify(rpcPut));
  cek('setelah disetujui: antrean kosong, dasbor ter-render ulang',
    (await page.textContent('#admJmlMenunggu')) === '0' && await page.isVisible('.adm-kosong'));

  await browser.close();
  console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : '\nsemua pemeriksaan lolos');
  process.exit(gagal ? 1 : 0);
})();
