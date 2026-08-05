/**
 * KODOMO — laporan bulanan per orang / KAS (sumber data PDF di klien).
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

/**
 * Laporan bulanan satu entitas (orang atau KAS) untuk bulan 'yyyy-MM'.
 * Read-only (tanpa lock). Angka infaq & ranking bersifat all-time (kumulatif).
 */
function getLaporanBulanan(nama, bulanKey) {
  nama = String(nama || '').trim();
  if (!nama) throw new Error('Nama wajib dipilih.');
  if (!/^\d{4}-\d{2}$/.test(String(bulanKey || ''))) throw new Error('Bulan tidak valid.');

  const tz = Session.getScriptTimeZone();
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 5).getValues(); // urut lama→baru

  const [yy, mm] = bulanKey.split('-').map(Number);
  const prevKey = Utilities.formatDate(new Date(yy, mm - 2, 1), tz, 'yyyy-MM');
  const asDate = ts => ts instanceof Date ? ts : new Date(ts);
  const mkey = ts => Utilities.formatDate(asDate(ts), tz, 'yyyy-MM');
  const fmtWaktu = ts => Utilities.formatDate(asDate(ts), tz, 'dd MMM yyyy • HH:mm');
  const base = {
    nama: nama,
    bulanKey: bulanKey,
    bulanLabel: labelBulan_(bulanKey),
    dibuat: Utilities.formatDate(new Date(), tz, 'dd MMM yyyy • HH:mm')
  };

  if (nama === KAS_NAMA) {
    let saldoAwal = 0, run = 0, pemasukan = 0, pengeluaran = 0, jml = 0;
    let prevMasuk = 0, prevKeluar = 0;
    const pengeluaranList = [];
    const infaqOrang = {}; // nama → infaq bulan ini (dari sisi pengirim)
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const dailyClose = new Array(daysInMonth).fill(null);

    rows.forEach(r => {
      const [ts, rnm, tipe, nominal, ket] = r;
      const val = Number(nominal) || 0;
      if (!val) return;
      const k = mkey(ts);
      const isDosa = tipe === 'Dosa';
      // Infaq per orang bulan ini: baris sisi PENGIRIM, nama = pengirim.
      if (k === bulanKey && isDosa && isKetInfaq_(ket) && String(rnm).trim() !== KAS_NAMA) {
        const p = String(rnm).trim();
        infaqOrang[p] = (infaqOrang[p] || 0) + val;
      }
      if (String(rnm).trim() !== KAS_NAMA) return;
      const delta = isDosa ? -val : val;
      if (k < bulanKey) {
        run += delta; saldoAwal = run;
        if (k === prevKey) { isDosa ? (prevKeluar += val) : (prevMasuk += val); }
      } else if (k === bulanKey) {
        run += delta; jml++;
        if (isDosa) { pengeluaran += val; pengeluaranList.push({ waktu: fmtWaktu(ts), keterangan: String(ket || ''), nominal: val, saldo: run }); }
        else pemasukan += val;
        dailyClose[Number(Utilities.formatDate(asDate(ts), tz, 'd')) - 1] = run;
      }
    });

    let carry = saldoAwal;
    const harian = dailyClose.map((v, i) => { if (v !== null) carry = v; return { hari: i + 1, saldo: carry }; });

    return Object.assign(base, {
      tipe: 'kas',
      saldoAwal: saldoAwal,
      saldoAkhir: saldoAwal + pemasukan - pengeluaran,
      perubahan: pemasukan - pengeluaran,
      pemasukan: pemasukan,
      pengeluaran: pengeluaran,
      selisih: pemasukan - pengeluaran,
      jumlahTransaksi: jml,
      prev: { pemasukan: prevMasuk, pengeluaran: prevKeluar },
      harian: harian,
      infaqPerOrang: Object.keys(infaqOrang).map(p => ({ nama: p, total: infaqOrang[p] })).sort((a, b) => b.total - a.total),
      pengeluaranList: pengeluaranList
    });
  }

  // ---- Laporan per orang ----
  let saldoAwal = 0, topUp = 0, peng = 0, infaqBulan = 0, jml = 0;
  let prevTopUp = 0, prevPeng = 0;
  const inBulan = [];
  const infaqMap = {}; // all-time, semua orang → total infaq (untuk ranking)

  rows.forEach(r => {
    const [ts, rnm, tipe, nominal, ket] = r;
    const val = Number(nominal) || 0;
    if (!val) return;
    const isDosa = tipe === 'Dosa';
    const p = String(rnm).trim();
    const isInfaq = isDosa && isKetInfaq_(ket) && p !== KAS_NAMA;
    if (isInfaq) infaqMap[p] = (infaqMap[p] || 0) + val; // ranking all-time
    if (p !== nama) return;
    const k = mkey(ts);
    if (k < bulanKey) {
      saldoAwal += isDosa ? -val : val;
      if (k === prevKey) { isDosa ? (prevPeng += val) : (prevTopUp += val); }
    } else if (k === bulanKey) {
      if (isDosa) peng += val; else topUp += val;
      if (isInfaq) infaqBulan += val;
      jml++;
      inBulan.push(r);
    }
  });

  let run = saldoAwal;
  const transaksi = inBulan.map(r => {
    const isDosa = r[2] === 'Dosa';
    const val = Number(r[3]) || 0;
    run += isDosa ? -val : val;
    return { waktu: fmtWaktu(r[0]), tipe: isDosa ? 'Dosa' : 'Pahala', nominal: val, keterangan: String(r[4] || ''), saldo: run };
  });

  const ranking = Object.keys(infaqMap).map(p => ({ nama: p, total: infaqMap[p] })).sort((a, b) => b.total - a.total);
  const idx = ranking.findIndex(x => x.nama === nama);

  return Object.assign(base, {
    tipe: 'orang',
    foto: fotoDataUri_(getFotoMap_()[nama] || ''), // data URI, bukan URL (lihat fotoDataUri_)
    saldoAwal: saldoAwal,
    saldoAkhir: saldoAwal + topUp - peng,
    perubahan: topUp - peng,
    totalTopUp: topUp,
    totalPengeluaran: peng,
    selisih: topUp - peng,
    infaqBulan: infaqBulan,
    infaqTotal: infaqMap[nama] || 0,   // all-time
    infaqRank: idx >= 0 ? idx + 1 : null,
    infaqPeserta: ranking.length,
    jumlahTransaksi: jml,
    prev: { totalTopUp: prevTopUp, totalPengeluaran: prevPeng, perubahan: prevTopUp - prevPeng },
    transaksi: transaksi
  });
}
