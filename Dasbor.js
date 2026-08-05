/**
 * KODOMO — data dasbor: getDashboardData (dipanggil ulang setiap mutasi)
 * dan deret saldo harian untuk grafik.
 *
 * Bagian dari proyek Kodomo — semua berkas .gs berbagi satu namespace global,
 * jadi fungsi & konstanta di sini bisa dipanggil dari berkas lain apa adanya.
 */

/** Batas aman jumlah hari di grafik saldo harian. Untuk sementara grafik
 *  memakai SELURUH riwayat (sejak transaksi pertama), bukan jendela tetap;
 *  batas ini hanya menjaga payload tidak meledak kalau data sudah bertahun. */
const DERET_HARI_MAX = 730;

/**
 * Saldo kumulatif tiap orang per hari untuk DERET_HARI hari terakhir.
 * Saldo hari pertama sudah memperhitungkan SELURUH transaksi sebelum jendela
 * ini, jadi titik terakhir grafik selalu sama dengan angka di leaderboard.
 * Dipakai grafik garis di modal Total Pahala/Dosa (tampilan desktop).
 */
function deretHarian_(rows, tz, fotoMap) {
  const hariDari = t => Utilities.formatDate(t, tz, 'yyyy-MM-dd');
  const tglDari = ts => {
    const t = ts instanceof Date ? ts : new Date(ts);
    return (!t || isNaN(t.getTime())) ? null : t;
  };

  // Rentang = sejak transaksi pertama sampai hari ini (dibatasi DERET_HARI_MAX).
  const now = new Date();
  let paling = null;
  rows.forEach(r => {
    const t = tglDari(r[0]);
    if (t && t.getTime() < now.getTime() && (!paling || t.getTime() < paling.getTime())) paling = t;
  });
  const hariAwal = new Date(now.getTime() -
    Math.min(DERET_HARI_MAX - 1,
      paling ? Math.floor((now.getTime() - paling.getTime()) / 86400000) : 29) * 86400000);
  const jumlahHari = Math.floor((now.getTime() - hariAwal.getTime()) / 86400000) + 1;

  const hariKey = [];
  for (let i = 0; i < jumlahHari; i++) {
    hariKey.push(hariDari(new Date(hariAwal.getTime() + i * 86400000)));
  }
  const posisi = {};
  hariKey.forEach((h, i) => { posisi[h] = i; });
  const batasAwal = hariKey[0];

  // saldo = TOTAL semua transaksi, dihitung dengan aturan yang sama persis
  // dengan leaderboard. Deret harian diturunkan MUNDUR dari angka ini, bukan
  // dijumlahkan maju dari nol: dengan begitu titik terakhir grafik dijamin
  // sama dengan saldo di leaderboard walau ada baris yang stempel waktunya
  // tidak terbaca (mis. hasil migrasi yang tersimpan sebagai teks) — baris
  // seperti itu tetap masuk saldo, hanya tidak memengaruhi bentuk kurvanya.
  const saldo = {};
  const delta = {};  // nama → perubahan saldo per hari dalam rentang
  rows.forEach(r => {
    const [ts, nama, tipe, nominal] = r;
    const nm = String(nama).trim();
    const val = Number(nominal) || 0;
    if (!nm || !val || nm === KAS_NAMA) return;
    const d = tipe === 'Dosa' ? -val : val;
    saldo[nm] = (saldo[nm] || 0) + d;

    const t = tglDari(ts);
    if (!t) return;                                        // tak terbaca → hanya ke saldo
    const k = hariDari(t);
    if (k < batasAwal) return;                             // di luar rentang (terpotong batas)
    const i = posisi[k] === undefined ? jumlahHari - 1 : posisi[k]; // masa depan → hari ini
    if (!delta[nm]) delta[nm] = new Array(jumlahHari).fill(0);
    delta[nm][i] += d;
  });

  return {
    hari: hariKey.map(k => k.slice(8) + '/' + k.slice(5, 7)), // 'dd/MM'
    tanggal: hariKey,
    orang: Object.keys(saldo).map(nm => {
      const dl = delta[nm] || [];
      const nilai = new Array(jumlahHari);
      let run = saldo[nm];
      for (let i = jumlahHari - 1; i >= 0; i--) {
        nilai[i] = run;              // saldo pada akhir hari ke-i
        run -= (dl[i] || 0);         // mundur satu hari
      }
      return { nama: nm, foto: fotoMap[nm] || '', nilai: nilai };
    })
  };
}

/** Data lengkap untuk dashboard: statistik, leaderboard (+5 transaksi terakhir per orang), riwayat */
function getDashboardData() {
  const sheet = getSheet_(SHEET_TRANSAKSI);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] :
    sheet.getRange(2, 1, last - 1, 5).getValues();

  const tz = Session.getScriptTimeZone();
  const saldoMap = {};
  const infaqMap = {}; // nama → total infaq ke KAS
  const bulanSet = {}; // 'yyyy-MM' yang punya transaksi (utk pemilih laporan)
  const history = [];

  rows.forEach(r => {
    const [ts, nama, tipe, nominal, ket] = r;
    const nm = String(nama).trim();
    const val = Number(nominal) || 0;
    if (!nm || !val) return;
    if (ts instanceof Date) bulanSet[Utilities.formatDate(ts, tz, 'yyyy-MM')] = true;

    if (!saldoMap[nm]) saldoMap[nm] = { nama: nm, pahala: 0, dosa: 0, recent: [] };

    const isDosa = tipe === 'Dosa';
    if (isDosa) {
      saldoMap[nm].dosa += val;
      if (nm !== KAS_NAMA && isKetInfaq_(ket)) {
        infaqMap[nm] = (infaqMap[nm] || 0) + val;
      }
    } else {
      saldoMap[nm].pahala += val;
    }

    const item = {
      waktu: ts instanceof Date
        ? Utilities.formatDate(ts, tz, 'dd MMM yyyy • HH:mm')
        : String(ts),
      nama: nm,
      tipe: isDosa ? 'Dosa' : 'Pahala',
      nominal: val,
      keterangan: String(ket || '')
    };

    history.push(item);
    saldoMap[nm].recent.push(item);
  });

  const fotoMap = getFotoMap_();
  const kasData = saldoMap[KAS_NAMA];
  const leaderboard = Object.values(saldoMap)
    .filter(o => o.nama !== KAS_NAMA)
    .map(o => ({
      nama: o.nama,
      foto: fotoMap[o.nama] || '',
      pahala: o.pahala,
      dosa: o.dosa,
      saldo: o.pahala - o.dosa,
      recent: o.recent.slice(-40).reverse() // buffer utk panel (client paginasi 10 + filter KAS)
    }))
    .sort((a, b) => b.saldo - a.saldo);

  // Total Pahala/Dosa = jumlah saldo bersih tiap orang di leaderboard (bukan
  // total transaksi mentah), tidak termasuk anggota "(Gold)".
  let totalPahala = 0;
  let totalDosa = 0;
  leaderboard.forEach(o => {
    if (o.nama.includes('(Gold)')) return;
    if (o.saldo > 0) totalPahala += o.saldo;
    else if (o.saldo < 0) totalDosa += -o.saldo;
  });

  return {
    totalPahala: totalPahala,
    totalDosa: totalDosa,
    totalTransaksi: history.length,
    leaderboard: leaderboard,
    history: history.slice(-30).reverse(), // 30 transaksi terbaru
    kas: {
      saldo: kasData ? kasData.pahala - kasData.dosa : 0,
      history: kasData ? kasData.recent.slice(-30).reverse() : [],
      leaderboard: Object.keys(infaqMap)
        .map(nm => ({ nama: nm, foto: fotoMap[nm] || '', total: infaqMap[nm] }))
        .sort((a, b) => b.total - a.total)
    },
    deret: deretHarian_(rows, tz, fotoMap), // grafik saldo harian (modal desktop)
    katalog: KATALOG_KOPDOS,    // katalog belanja Kopdos Merah Putih
    resto: bacaSheetResto_(),   // urut termurah dulu; lihat modul infografis resto
    infaqMap: getInfaqMap_(),
    strukAlias: getStrukAlias_(),
    anggota: getAnggota(),
    bulanList: Object.keys(bulanSet).sort().reverse().map(k => ({ key: k, label: labelBulan_(k) }))
  };
}
