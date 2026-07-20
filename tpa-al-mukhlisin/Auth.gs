/**
 * Auth.gs — login kustom, hashing password, sesi, verifikasi peran, rate-limit,
 * dan manajemen akun admin (khusus super_admin).
 */

var SESSION_TTL_DETIK = 21600; // 6 jam — batas maksimum CacheService di Apps Script
var BATAS_GAGAL_LOGIN = 5;
var JEDA_GAGAL_LOGIN_DETIK = 15 * 60;
var MAKS_ADMIN_BIASA = 4;

// ---------- Hashing ----------

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt, Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function buatSalt_() {
  return Utilities.getUuid();
}

// ---------- Sesi (CacheService, token acak, kedaluwarsa otomatis) ----------

function createSession_(admin) {
  var token = Utilities.getUuid();
  var payload = JSON.stringify({
    idAdmin: admin.id_admin,
    username: admin.username,
    nama: admin.nama,
    peran: admin.peran
  });
  CacheService.getScriptCache().put('sesi_' + token, payload, SESSION_TTL_DETIK);
  return token;
}

function getSession_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('sesi_' + token);
  return raw ? JSON.parse(raw) : null;
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove('sesi_' + token);
}

function requireSession_(token) {
  var sesi = getSession_(token);
  if (!sesi) {
    throw new Error('Sesi tidak valid atau sudah kedaluwarsa. Silakan login kembali.');
  }
  return sesi;
}

/** Pastikan sesi valid DAN perannya termasuk yang diizinkan. Panggil di awal tiap fungsi sensitif. */
function requireRole_(token, daftarPeranDiizinkan) {
  var sesi = requireSession_(token);
  if (daftarPeranDiizinkan.indexOf(sesi.peran) === -1) {
    throw new Error('Anda tidak memiliki akses untuk aksi ini.');
  }
  return sesi;
}

// ---------- Rate limit percobaan login ----------

function cekRateLimit_(username) {
  var jumlah = Number(CacheService.getScriptCache().get('gagal_' + username) || '0');
  if (jumlah >= BATAS_GAGAL_LOGIN) {
    throw new Error('Terlalu banyak percobaan login gagal. Coba lagi dalam beberapa menit.');
  }
}

function catatPercobaanGagal_(username) {
  var cache = CacheService.getScriptCache();
  var jumlah = Number(cache.get('gagal_' + username) || '0') + 1;
  cache.put('gagal_' + username, String(jumlah), JEDA_GAGAL_LOGIN_DETIK);
}

function resetPercobaanGagal_(username) {
  CacheService.getScriptCache().remove('gagal_' + username);
}

// ---------- Endpoint: login & logout ----------

function login(username, password) {
  username = wajibIsi_(username, 'Username').toLowerCase().slice(0, 100);
  password = wajibIsi_(password, 'Password');

  cekRateLimit_(username);

  var admin = cariBarisById_(SHEET.ADMIN, 'username', username);
  if (!admin || admin.aktif !== true) {
    catatPercobaanGagal_(username);
    catatLog_(username, 'login_gagal', 'Username tidak ditemukan / nonaktif');
    throw new Error('Username atau password salah.');
  }

  if (hashPassword_(password, admin.salt) !== admin.password_hash) {
    catatPercobaanGagal_(username);
    catatLog_(username, 'login_gagal', 'Password salah');
    throw new Error('Username atau password salah.');
  }

  resetPercobaanGagal_(username);
  withLock_(function () {
    timpaBaris_(SHEET.ADMIN, admin._row, Object.assign({}, admin, { terakhir_login: jamSekarangStr_() }));
  });

  var token = createSession_(admin);
  catatLog_(username, 'login_berhasil', '');

  return { token: token, nama: admin.nama, peran: admin.peran, username: admin.username };
}

function logout(token) {
  var sesi = getSession_(token);
  destroySession_(token);
  if (sesi) catatLog_(sesi.username, 'logout', '');
  return { ok: true };
}

/** Dipanggil client saat load untuk memvalidasi token yang tersimpan di sessionStorage. */
function whoAmI(token) {
  var sesi = requireSession_(token);
  return { nama: sesi.nama, peran: sesi.peran, username: sesi.username };
}

function gantiPasswordSendiri(token, passwordLama, passwordBaru) {
  var sesi = requireSession_(token);
  wajibIsi_(passwordLama, 'Password lama');
  wajibIsi_(passwordBaru, 'Password baru');
  if (String(passwordBaru).length < 8) {
    throw new Error('Password baru minimal 8 karakter.');
  }
  return withLock_(function () {
    var admin = cariBarisById_(SHEET.ADMIN, 'id_admin', sesi.idAdmin);
    if (!admin) throw new Error('Akun tidak ditemukan.');
    if (hashPassword_(passwordLama, admin.salt) !== admin.password_hash) {
      throw new Error('Password lama tidak sesuai.');
    }
    var salt = buatSalt_();
    timpaBaris_(SHEET.ADMIN, admin._row, Object.assign({}, admin, {
      password_hash: hashPassword_(passwordBaru, salt), salt: salt
    }));
    catatLog_(sesi.username, 'ganti_password_sendiri', '');
    return { ok: true };
  });
}

// ---------- Endpoint: manajemen akun admin (super_admin saja) ----------

function listAdmin(token) {
  requireRole_(token, [PERAN.SUPER_ADMIN]);
  return bacaSemuaBaris_(SHEET.ADMIN).map(function (a) {
    return {
      idAdmin: a.id_admin, nama: a.nama, username: a.username,
      peran: a.peran, aktif: a.aktif, terakhirLogin: a.terakhir_login
    };
  });
}

function tambahAdmin(token, data) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN]);
  var nama = wajibIsi_(data && data.nama, 'Nama');
  var username = wajibIsi_(data && data.username, 'Username').toLowerCase().replace(/\s+/g, '');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    throw new Error('Username hanya boleh huruf kecil, angka, titik, garis bawah, atau strip (3-30 karakter).');
  }

  return withLock_(function () {
    var semuaAdmin = bacaSemuaBaris_(SHEET.ADMIN);
    if (semuaAdmin.some(function (a) { return a.username === username; })) {
      throw new Error('Username "' + username + '" sudah dipakai.');
    }
    var jumlahAdminBiasa = semuaAdmin.filter(function (a) { return a.peran === PERAN.ADMIN; }).length;
    if (jumlahAdminBiasa >= MAKS_ADMIN_BIASA) {
      throw new Error('Maksimum ' + MAKS_ADMIN_BIASA + ' admin pengelola sudah tercapai. Nonaktifkan salah satu dulu untuk menambah yang baru.');
    }

    var id = alokasikanId_('ADM', 1)[0];
    var passwordAwal = passwordAcak_(10);
    var salt = buatSalt_();
    tambahBaris_(SHEET.ADMIN, {
      id_admin: id, nama: nama, username: username,
      password_hash: hashPassword_(passwordAwal, salt), salt: salt,
      peran: PERAN.ADMIN, aktif: true, terakhir_login: ''
    });
    catatLog_(sesi.username, 'tambah_admin', 'Menambahkan admin ' + username);
    return { ok: true, idAdmin: id, username: username, passwordAwal: passwordAwal };
  });
}

function nonaktifkanAdmin(token, idAdmin) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN]);
  return withLock_(function () {
    var admin = cariBarisById_(SHEET.ADMIN, 'id_admin', idAdmin);
    if (!admin) throw new Error('Akun admin tidak ditemukan.');
    if (admin.peran === PERAN.SUPER_ADMIN) throw new Error('Akun super admin tidak bisa dinonaktifkan.');
    if (admin.username === sesi.username) throw new Error('Anda tidak bisa menonaktifkan akun sendiri.');
    timpaBaris_(SHEET.ADMIN, admin._row, Object.assign({}, admin, { aktif: false }));
    catatLog_(sesi.username, 'nonaktifkan_admin', admin.username);
    return { ok: true };
  });
}

function aktifkanAdmin(token, idAdmin) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN]);
  return withLock_(function () {
    var admin = cariBarisById_(SHEET.ADMIN, 'id_admin', idAdmin);
    if (!admin) throw new Error('Akun admin tidak ditemukan.');
    var jumlahAdminBiasaAktif = bacaSemuaBaris_(SHEET.ADMIN).filter(function (a) {
      return a.peran === PERAN.ADMIN && a.aktif === true && a.id_admin !== admin.id_admin;
    }).length;
    if (admin.peran === PERAN.ADMIN && jumlahAdminBiasaAktif >= MAKS_ADMIN_BIASA) {
      throw new Error('Maksimum ' + MAKS_ADMIN_BIASA + ' admin pengelola aktif sudah tercapai.');
    }
    timpaBaris_(SHEET.ADMIN, admin._row, Object.assign({}, admin, { aktif: true }));
    catatLog_(sesi.username, 'aktifkan_admin', admin.username);
    return { ok: true };
  });
}

function resetPasswordAdmin(token, idAdmin) {
  var sesi = requireRole_(token, [PERAN.SUPER_ADMIN]);
  return withLock_(function () {
    var admin = cariBarisById_(SHEET.ADMIN, 'id_admin', idAdmin);
    if (!admin) throw new Error('Akun admin tidak ditemukan.');
    var passwordBaru = passwordAcak_(10);
    var salt = buatSalt_();
    timpaBaris_(SHEET.ADMIN, admin._row, Object.assign({}, admin, {
      password_hash: hashPassword_(passwordBaru, salt), salt: salt
    }));
    catatLog_(sesi.username, 'reset_password', admin.username);
    return { ok: true, username: admin.username, passwordBaru: passwordBaru };
  });
}

function getLog(token, opts) {
  requireRole_(token, [PERAN.SUPER_ADMIN]);
  opts = opts || {};
  var semua = bacaSemuaBaris_(SHEET.LOG);
  semua.reverse();
  var batas = Math.min(opts.batas || 200, 500);
  return semua.slice(0, batas).map(function (l) {
    return { timestamp: l.timestamp, username: l.username, aksi: l.aksi, detail: l.detail };
  });
}
