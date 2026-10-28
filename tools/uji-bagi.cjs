/**
 * Uji rumus pembagian pesanan Grab (Pesanan.js + salinannya di JsPesanan.html).
 *
 *   node tools/uji-bagi.cjs      → baris OK/GAGAL + kode keluar
 *
 * Yang diperiksa:
 *  1. Salinan rumus di klien IDENTIK dengan server (teks di antara penanda
 *     <bagi-pesanan>), supaya pratinjau di layar tidak pernah menyimpang.
 *  2. Order nyata 28 Okt 2026 (RM Sari Minang) menghasilkan angka Grab ±Rp1.
 *  3. Ribuan pesanan acak: jumlah porsi SELALU = total tagihan, tiap porsi
 *     berselisih < Rp1 dari nilai eksaknya, dan klien = server.
 *
 * Berkas ini TIDAK ikut ke Apps Script (ekstensi .cjs, lihat .claspignore).
 */
const fs = require('fs');
const path = require('path');
const AKAR = path.join(__dirname, '..');

const blok = teks => {
  const a = teks.indexOf('// <bagi-pesanan>');
  const b = teks.indexOf('// </bagi-pesanan>');
  if (a < 0 || b < 0) throw new Error('penanda <bagi-pesanan> tidak ditemukan');
  return teks.slice(a, b);
};
const rapikan = t => t.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
const muat = kode => new Function(kode + '\nreturn { unitPesanan_, hitungBagiPesanan_ };')();

const kodeServer = blok(fs.readFileSync(path.join(AKAR, 'Pesanan.js'), 'utf8'));
const kodeKlien = blok(fs.readFileSync(path.join(AKAR, 'JsPesanan.html'), 'utf8'));
const server = muat(kodeServer);
const klien = muat(kodeKlien);

let gagal = 0;
const cek = (nama, syarat, detail) => {
  console.log(`${syarat ? 'OK   ' : 'GAGAL'} ${nama}${detail ? '  — ' + detail : ''}`);
  if (!syarat) gagal++;
};

// 1. Salinan identik
cek('salinan rumus klien identik dengan server', rapikan(kodeServer) === rapikan(kodeKlien));

// 2. Order nyata — pembagian menu disimpulkan dari layar Grab
const nyata = {
  total: 86740,
  items: [
    { nama: 'nasi gulai ayam', qty: 1, harga: 30500 }, { nama: 'Nasi Gembung goreng', qty: 1, harga: 30500 },
    { nama: 'Nasi Ayam +telor', qty: 1, harga: 37500 }, { nama: 'nasi ayam bakar', qty: 1, harga: 30500 },
    { nama: 'rendang ati', qty: 1, harga: 22000 }, { nama: 'goreng jengkol', qty: 1, harga: 17000 },
    { nama: 'Nasi Ayam Cabe ijo', qty: 1, harga: 30500 }, { nama: 'rendang daging', qty: 1, harga: 23000 }
  ],
  biaya: [{ label: 'Biaya Pengiriman', nominal: 15000 }, { label: 'Biaya Pemesanan', nominal: 2000 }],
  diskon: [
    { label: 'MANTAPDISKON', nominal: 99675, untuk: 'menu' }, { label: 'Group Orders', nominal: 19935, untuk: 'menu' },
    { label: 'Diskon ongkir', nominal: 10000, untuk: 'biaya' }, { label: 'Diskon 10%', nominal: 22150, untuk: 'menu' }
  ]
};
const grab = { dita: 23126, 'Gede Arya': 14668, 'gede yudha': 12146, __SAYA__: 15206, maretha: 12146, iluh: 9446 };
const hNyata = server.hitungBagiPesanan_(nyata,
  ['dita', 'dita', 'Gede Arya', 'gede yudha', '__SAYA__', '__SAYA__', 'maretha', 'iluh']);
cek('order nyata: jumlah = total tagihan', hNyata.jumlahBayar === 86740, String(hNyata.jumlahBayar));
const maksSelisih = Math.max(...hNyata.peserta.map(p => Math.abs(p.bayar - grab[p.nama])));
cek('order nyata: tiap porsi ±Rp1 dari angka Grab', maksSelisih <= 1, 'selisih maks Rp' + maksSelisih);

// 3. Pesanan acak
let s = 20261028;
const acak = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const ant = (a, b) => a + Math.floor(acak() * (b - a + 1));
let salahTotal = 0, salahEksak = 0, salahSetara = 0;
const N = 2000;
for (let k = 0; k < N; k++) {
  const items = Array.from({ length: ant(1, 12) }, (_, i) =>
    ({ nama: 'm' + i, qty: ant(1, 3), harga: ant(1, 80) * 500 + (acak() < 0.2 ? ant(1, 999) : 0) }));
  const sub = items.reduce((a, it) => a + it.harga, 0);
  const biaya = [{ label: 'ongkir', nominal: ant(0, 30) * 1000 }, { label: 'pemesanan', nominal: 2000 }]
    .filter(b => b.nominal > 0);
  const diskon = [
    { label: 'promo', nominal: Math.floor(sub * acak() * 0.6), untuk: 'menu' },
    { label: 'diskon ongkir', nominal: ant(0, 40) * 1000, untuk: 'biaya' } // kadang > ongkir
  ].filter(d => d.nominal > 0);
  const jm = a => a.reduce((x, y) => x + y.nominal, 0);
  const total = sub + jm(biaya) - jm(diskon);
  const detail = { total, items, biaya, diskon };
  const unit = server.unitPesanan_(detail);
  const orang = Array.from({ length: ant(1, 8) }, (_, i) => 'o' + i);
  const penugasan = unit.map(() => orang[ant(0, orang.length - 1)]);

  const h = server.hitungBagiPesanan_(detail, penugasan);
  if (h.jumlahBayar !== total) salahTotal++;
  // nilai eksak per orang, dengan aturan biaya bersih negatif → pindah ke diskon menu
  let dMenu = jm(diskon.filter(d => d.untuk === 'menu'));
  let bB = jm(biaya) - jm(diskon.filter(d => d.untuk === 'biaya'));
  if (bB < 0) { dMenu -= bB; bB = 0; }
  const n = h.peserta.length;
  h.peserta.forEach(p => {
    const eksak = p.item * (sub - dMenu) / sub + bB / n;
    if (Math.abs(p.bayar - eksak) >= 1) salahEksak++;
  });
  if (JSON.stringify(h) !== JSON.stringify(klien.hitungBagiPesanan_(detail, penugasan))) salahSetara++;
}
cek(`${N} pesanan acak: jumlah porsi selalu = total`, salahTotal === 0, salahTotal + ' salah');
cek(`${N} pesanan acak: tiap porsi < Rp1 dari nilai eksak`, salahEksak === 0, salahEksak + ' salah');
cek(`${N} pesanan acak: hasil klien = server`, salahSetara === 0, salahSetara + ' beda');

console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
