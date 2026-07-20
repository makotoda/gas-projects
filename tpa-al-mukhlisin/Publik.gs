/**
 * Publik.gs — endpoint read-only tanpa login untuk halaman orang tua (?page=publik).
 * Hanya mengembalikan data SATU siswa hasil filter kelas+nama, dan mensyaratkan
 * kode_publik (PIN 4 digit) sebelum membuka rekapnya. Tidak pernah mengembalikan
 * no_hp_wali/catatan atau data siswa lain.
 */

function getKelasPublik() {
  return daftarKelasMentah_()
    .filter(function (k) { return k.aktif; })
    .sort(function (a, b) { return a.urutan - b.urutan; })
    .map(function (k) { return { idKelas: k.idKelas, namaKelas: k.namaKelas, jadwal: k.jadwal }; });
}

function getSiswaListPublik(idKelas) {
  wajibIsi_(idKelas, 'Kelas');
  return bacaSemuaBaris_(SHEET.SISWA)
    .filter(function (s) { return s.id_kelas === idKelas && s.status === STATUS_SISWA.AKTIF; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama), 'id'); })
    .map(function (s) { return { idSiswa: s.id_siswa, nama: s.nama }; });
}

/** Rekap satu siswa untuk satu bulan (default bulan berjalan), digerbangi kode_publik. */
function getRekapPublik(idSiswa, kodePublik, tahun, bulan) {
  wajibIsi_(idSiswa, 'Siswa');
  wajibIsi_(kodePublik, 'Kode');
  cekRateLimitPublik_(idSiswa);
  cekRateLimitGlobalPublik_();

  var siswa = cariBarisById_(SHEET.SISWA, 'id_siswa', idSiswa);
  if (!siswa || siswa.status !== STATUS_SISWA.AKTIF) {
    catatPinGagal_(idSiswa);
    catatPinGagalGlobal_();
    throw new Error('Siswa tidak ditemukan.');
  }
  if (String(siswa.kode_publik).trim() !== String(kodePublik).trim()) {
    catatPinGagal_(idSiswa);
    catatPinGagalGlobal_();
    throw new Error('Kode tidak sesuai.');
  }
  resetPinGagal_(idSiswa);

  var info = (tahun && bulan) ? { tahun: Number(tahun), bulan: Number(bulan) } : bulanIniInfo_();
  var jumlahHari = new Date(info.tahun, info.bulan, 0).getDate();
  var tglMulai = info.tahun + '-' + Utilities.formatString('%02d', info.bulan) + '-01';
  var tglSelesai = info.tahun + '-' + Utilities.formatString('%02d', info.bulan) + '-' + Utilities.formatString('%02d', jumlahHari);

  var rekapKehadiran = hitungRekapPeriode_([idSiswa], tglMulai, tglSelesai)[idSiswa];
  var riwayatKehadiran = riwayatKehadiranSiswa_(idSiswa, tglMulai, tglSelesai);
  var riwayatInfaq = riwayatInfaqSiswa_(idSiswa, tglMulai, tglSelesai);
  var totalInfaq = riwayatInfaq.reduce(function (t, r) { return t + r.jumlah; }, 0);
  var petaKelas = petaKelasById_();

  return {
    nama: siswa.nama,
    namaKelas: petaKelas[siswa.id_kelas] || '-',
    tahun: info.tahun,
    bulan: info.bulan,
    namaBulan: NAMA_BULAN_INDO[info.bulan - 1],
    kehadiran: { rekap: rekapKehadiran, riwayat: riwayatKehadiran },
    infaq: { riwayat: riwayatInfaq, total: totalInfaq }
  };
}

// ---------- Rate-limit percobaan kode PIN (gerbang ringan, bukan login sungguhan) ----------
// Dua lapis: per-siswa (cegah brute-force satu PIN) DAN global (cegah "menyapu" banyak
// siswa dengan sedikit tebakan tiap siswa supaya tidak kena limit per-siswa).

function cekRateLimitPublik_(idSiswa) {
  var jumlah = Number(CacheService.getScriptCache().get('pin_gagal_' + idSiswa) || '0');
  if (jumlah >= 10) {
    throw new Error('Terlalu banyak percobaan kode yang salah. Coba lagi dalam beberapa menit.');
  }
}

function catatPinGagal_(idSiswa) {
  var cache = CacheService.getScriptCache();
  var jumlah = Number(cache.get('pin_gagal_' + idSiswa) || '0') + 1;
  cache.put('pin_gagal_' + idSiswa, String(jumlah), 15 * 60);
}

function resetPinGagal_(idSiswa) {
  CacheService.getScriptCache().remove('pin_gagal_' + idSiswa);
}

function cekRateLimitGlobalPublik_() {
  var jumlah = Number(CacheService.getScriptCache().get('pin_gagal_global') || '0');
  if (jumlah >= 40) {
    throw new Error('Terlalu banyak percobaan kode yang salah dari halaman ini. Coba lagi dalam beberapa menit.');
  }
}

function catatPinGagalGlobal_() {
  var cache = CacheService.getScriptCache();
  var jumlah = Number(cache.get('pin_gagal_global') || '0') + 1;
  cache.put('pin_gagal_global', String(jumlah), 15 * 60);
}
