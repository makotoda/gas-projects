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

/*
 * Utilities.formatDate menyeberang ke Java, dan dasbor dulu memanggilnya
 * beberapa kali untuk SETIAP baris Transaksi (±3 per baris). Dua pemformat
 * bermemo di bawah memangkasnya tanpa mengubah hasil sedikit pun.
 */

/** formatDate ber-memo per menit — aman untuk pola yang paling halus menit. */
function pemformatMenit_(tz, pola) {
  const memo = {};
  return t => {
    const k = Math.floor(t.getTime() / 60000);
    return memo[k] || (memo[k] = Utilities.formatDate(t, tz, pola));
  };
}

/**
 * Kunci hari 'yyyy-MM-dd'. Satu formatDate juga memberi tahu jam berapa di hari
 * itu, jadi batas tengah malam berikutnya diketahui dan baris lain di hari yang
 * sama (baris sheet urut waktu) tidak perlu diformat lagi.
 * ponytail: hari dianggap 24 jam — benar untuk Asia/Bangkok (tanpa DST); di zona
 * ber-DST, jam terakhir hari transisi bisa salah hari. Kembali ke formatDate per baris kalau zona berubah.
 */
function pemformatHari_(tz) {
  let kunci = '', mulai = 0, akhir = -1;
  return t => {
    const ms = t.getTime();
    if (ms >= mulai && ms < akhir) return kunci;
    const s = Utilities.formatDate(t, tz, 'yyyy-MM-dd HH:mm:ss.SSS');
    const lewat = ((+s.slice(11, 13) * 60 + +s.slice(14, 16)) * 60 + +s.slice(17, 19)) * 1000 + +s.slice(20, 23);
    kunci = s.slice(0, 10);
    mulai = ms - lewat;
    akhir = mulai + 86400000;
    return kunci;
  };
}

/**
 * Saldo kumulatif tiap orang per hari untuk DERET_HARI hari terakhir.
 * Saldo hari pertama sudah memperhitungkan SELURUH transaksi sebelum jendela
 * ini, jadi titik terakhir grafik selalu sama dengan angka di leaderboard.
 * Dipakai grafik garis di modal Total Pahala/Dosa (tampilan desktop).
 */
function deretHarian_(rows, tz, fotoMap) {
  const hariDari = pemformatHari_(tz);
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
  const hariDari = pemformatHari_(tz);
  const waktuDari = pemformatMenit_(tz, 'dd MMM yyyy • HH:mm');
  // Item riwayat dibuat untuk tiap baris, tapi yang dikirim ke klien hanya
  // puluhan terakhir — jadi `waktu` baru diformat untuk yang terkirim saja.
  const isiWaktu = daftar => {
    daftar.forEach(x => { if (x.waktu === null) x.waktu = waktuDari(new Date(x.t)); });
    return daftar;
  };
  const saldoMap = {};
  const infaqMap = {}; // nama → total infaq ke KAS
  const bulanSet = {}; // 'yyyy-MM' yang punya transaksi (utk pemilih laporan)
  const history = [];

  rows.forEach(r => {
    const [ts, nama, tipe, nominal, ket] = r;
    const nm = String(nama).trim();
    const val = Number(nominal) || 0;
    if (!nm || !val) return;
    if (ts instanceof Date) bulanSet[hariDari(ts).slice(0, 7)] = true; // 'yyyy-MM'

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
      waktu: ts instanceof Date ? null : String(ts), // null → diformat isiWaktu saat terkirim
      nama: nm,
      tipe: isDosa ? 'Dosa' : 'Pahala',
      nominal: val,
      keterangan: String(ket || ''),
      t: ts instanceof Date ? ts.getTime() : 0 // urutan sisip top-up menunggu
    };

    history.push(item);
    saldoMap[nm].recent.push(item);
  });

  // Top-up yang menunggu persetujuan tampil di riwayat (bertanda ⏳) tapi
  // BUKAN transaksi: tidak masuk saldo, total, maupun jumlah transaksi.
  const topupMenunggu = daftarTopUpMenunggu_();
  const tundaRiwayat = topupMenunggu.map(x => ({
    waktu: Utilities.formatDate(new Date(x.t), tz, 'dd MMM yyyy • HH:mm'),
    nama: x.nama, tipe: 'Pahala', nominal: x.nominal, keterangan: x.keterangan,
    menunggu: true, t: x.t
  }));

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
      recent: isiWaktu(sisipMenunggu_(o.recent.slice(-40).reverse(), // buffer utk panel (client paginasi 10 + filter KAS)
        tundaRiwayat.filter(x => x.nama === o.nama)))
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
    history: isiWaktu(sisipMenunggu_(history.slice(-30).reverse(), tundaRiwayat).slice(0, 30)), // 30 terbaru
    kas: {
      saldo: kasData ? kasData.pahala - kasData.dosa : 0,
      history: kasData ? isiWaktu(kasData.recent.slice(-30).reverse()) : [],
      leaderboard: Object.keys(infaqMap)
        .map(nm => ({ nama: nm, foto: fotoMap[nm] || '', total: infaqMap[nm] }))
        .sort((a, b) => b.total - a.total)
    },
    deret: deretHarian_(rows, tz, fotoMap), // grafik saldo harian (modal desktop)
    katalog: KATALOG_KOPDOS,    // katalog belanja Kopdos Merah Putih
    pesanan: daftarPesananMenunggu_(), // invoice Grab yang belum dibagi (Pesanan.js)
    invoiceGagal: daftarInvoiceGagal_(), // invoice email yang gagal dibaca otomatis (PesananEmail.js)
    topupMenunggu: topupMenunggu, // top-up yang menunggu notifikasi bank (TopUp.js)
    resto: bacaSheetResto_(),   // urut termurah dulu; lihat modul infografis resto
    infaqMap: getInfaqMap_(),
    strukAlias: getStrukAlias_(),
    anggota: getAnggota(),
    bulanList: Object.keys(bulanSet).sort().reverse().map(k => ({ key: k, label: labelBulan_(k) }))
  };
}

/**
 * Sisipkan top-up menunggu ke daftar riwayat (terbaru dulu) menurut waktunya,
 * tanpa mengubah urutan baris sheet yang sudah ada — baris yang dicatat admin
 * dengan stempel waktu mundur tetap di posisinya.
 */
function sisipMenunggu_(daftar, tunda) {
  const hasil = daftar.slice();
  tunda.slice().sort((a, b) => a.t - b.t).forEach(x => {
    const i = hasil.findIndex(h => h.t && h.t <= x.t);
    hasil.splice(i < 0 ? hasil.length : i, 0, x);
  });
  return hasil;
}
