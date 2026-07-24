/**
 * Pengeluaran.gs — catat pengeluaran kas TPA (honor pengajar, konsumsi, ATK, dll).
 * Tampil sebagai tab "Pengeluaran" di halaman Infaq (satu modul keuangan kas: masuk lewat
 * Infaq, keluar lewat sini), tapi sheet & endpoint-nya terpisah dari Infaq karena datanya
 * beda subjek (bukan per siswa) dan beda skema kolom.
 */

/**
 * Baca semua baris Pengeluaran dengan tanggal/timestamp DIPAKSA jadi string yyyy-MM-dd /
 * yyyy-MM-dd HH:mm:ss. Kolom-kolom ini sudah diformat Teks Biasa lewat paksaFormatKolomTeks_,
 * tapi baris PERTAMA yang ditulis ke sheet yang BARU SAJA dibuat+diformat dalam sesi yang
 * sama (mis. tepat setelah migrasi database, lihat Migrasi.gs) kadang tetap kembali sebagai
 * objek Date asli, bukan string -- kalau objek Date itu lolos sampai ke return value RPC,
 * google.script.run GAGAL men-serialize seluruh respons dan client cuma menerima `null`
 * (bukan error yang jelas; ini akar dari laporan "gagal memuat data, console bersih").
 * Deteksi & perbaiki di sini sekali, supaya semua fungsi lain di file ini otomatis aman.
 */
function bacaSemuaPengeluaran_() {
  return bacaSemuaBaris_(SHEET.PENGELUARAN).map(function (p) {
    return Object.assign({}, p, {
      tanggal: p.tanggal instanceof Date ? Utilities.formatDate(p.tanggal, 'Asia/Jakarta', 'yyyy-MM-dd') : String(p.tanggal),
      timestamp: p.timestamp instanceof Date ? Utilities.formatDate(p.timestamp, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss') : String(p.timestamp)
    });
  });
}

/** Daftar pengeluaran dalam rentang tanggal (opsional filter kategori), terbaru dulu, dengan paginasi. */
function listPengeluaran(token, filter) {
  requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  filter = filter || {};

  var semua = bacaSemuaPengeluaran_().filter(function (p) {
    if (filter.tglMulai && p.tanggal < filter.tglMulai) return false;
    if (filter.tglSelesai && p.tanggal > filter.tglSelesai) return false;
    if (filter.kategori && p.kategori !== filter.kategori) return false;
    return true;
  });

  semua.sort(function (a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    return a.timestamp < b.timestamp ? 1 : -1;
  });

  var total = semua.length;
  var totalJumlah = semua.reduce(function (t, p) { return t + Number(p.jumlah); }, 0);
  var pageSize = Math.min(Math.max(Number(filter.pageSize) || 20, 5), 100);
  var page = Math.max(Number(filter.page) || 1, 1);
  var mulai = (page - 1) * pageSize;

  return {
    total: total,
    totalJumlah: totalJumlah,
    page: page,
    pageSize: pageSize,
    items: semua.slice(mulai, mulai + pageSize).map(function (p) {
      return {
        idPengeluaran: p.id, tanggal: p.tanggal, kategori: p.kategori,
        jumlah: Number(p.jumlah), keterangan: p.keterangan, dicatatOleh: p.dicatat_oleh
      };
    })
  };
}

function simpanPengeluaran(token, data) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  data = data || {};
  var tanggal = validasiTanggal_(data.tanggal || hariIniStr_());
  var kategori = validasiKategoriPengeluaran_(data.kategori);
  var jumlah = validasiNominal_(data.jumlah);
  var keterangan = (data.keterangan || '').toString().trim();

  return withLock_(function () {
    var id = alokasikanId_('PNG', 1)[0];
    tambahBaris_(SHEET.PENGELUARAN, {
      id: id, tanggal: tanggal, kategori: kategori, jumlah: jumlah, keterangan: keterangan,
      dicatat_oleh: sesi.username, timestamp: jamSekarangStr_()
    });
    catatLog_(sesi.username, 'catat_pengeluaran', tanggal + ' ' + kategori + ' ' + formatRupiah_(jumlah));
    return { ok: true, idPengeluaran: id };
  });
}

/** Hapus satu baris pengeluaran (mis. salah catat). Hard delete -- ini catatan kas, bukan
 * entitas yang perlu jejak soft-delete seperti siswa/kelas. */
function hapusPengeluaran(token, idPengeluaran) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN, PERAN.ADMIN]);
  wajibIsi_(idPengeluaran, 'ID pengeluaran');
  return withLock_(function () {
    var p = cariBarisById_(SHEET.PENGELUARAN, 'id', idPengeluaran);
    if (!p) throw new Error('Data pengeluaran tidak ditemukan.');
    getSheet_(SHEET.PENGELUARAN).deleteRow(p._row);
    catatLog_(sesi.username, 'hapus_pengeluaran', p.tanggal + ' ' + p.kategori + ' ' + formatRupiah_(Number(p.jumlah)));
    return { ok: true };
  });
}

// ---------- Helper rekap internal (dipakai Code.gs untuk dashboard, Laporan.gs untuk ekspor) ----------

function totalPengeluaranBulanIni_() {
  var info = bulanIniInfo_();
  var prefix = info.tahun + '-' + Utilities.formatString('%02d', info.bulan) + '-';
  var total = 0;
  bacaSemuaPengeluaran_().forEach(function (p) {
    if (p.tanggal.indexOf(prefix) === 0) total += Number(p.jumlah);
  });
  return total;
}

/** Rincian pengeluaran dalam rentang tanggal, terlama dulu (urutan ledger). Tidak difilter
 * per kelas -- pengeluaran memang tidak berelasi ke kelas tertentu (honor pengajar, ATK,
 * dst. adalah pengeluaran institusi, bukan pengeluaran "kelas A"). */
function rincianPengeluaranPeriode_(tglMulai, tglSelesai) {
  return bacaSemuaPengeluaran_()
    .filter(function (p) { return p.tanggal >= tglMulai && p.tanggal <= tglSelesai; })
    .map(function (p) {
      return {
        tanggal: p.tanggal, kategori: p.kategori, jumlah: Number(p.jumlah),
        keterangan: p.keterangan, dicatatOleh: p.dicatat_oleh
      };
    })
    .sort(function (a, b) { return a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0); });
}
