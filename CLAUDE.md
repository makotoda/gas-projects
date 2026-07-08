# Project: Google Apps Script — Kodomo (Pencatat Amalan)

Project ini adalah Google Apps Script yang disinkronkan via clasp.

## Aturan asli (preserved)
- Setelah selesai mengubah code, selalu jalankan `clasp push` untuk sinkron ke Apps Script.
- Sebelum mulai mengedit, jalankan `clasp pull` dulu untuk menarik versi terbaru dari server.
- File .js di sini adalah file .gs di editor Apps Script.

## What this project is
A tiny (5-file) Google Apps Script web app: friends log "Pahala"/"Dosa" (merit/demerit)
points and transfers against each other; a Google Sheet is the database; one `Index.html`
is the entire frontend. No build step, no framework, no package.json. Full narrative
context lives in **[PROJECT.md](PROJECT.md)** — read it before making non-trivial changes.
Known weaknesses/security issues live in **[GAPS.md](GAPS.md)** — check it before touching
`submitAmalan`, `harga.gs.js`, or anything roster-related.

## Commands

There is no build/test/lint tooling in this repo — everything below is `clasp`.

```bash
# One-time setup (clasp/node are NOT currently installed on this machine — check first)
node --version                     # verify Node/npm exist; install if missing
npm install -g @google/clasp       # install clasp CLI
clasp login                        # authenticate with the Google account that owns the script

# Day-to-day
clasp pull                         # ALWAYS run before editing — pulls latest from the live Apps Script editor
clasp push                         # ALWAYS run after finishing an edit — pushes local files live
clasp open                         # opens the Apps Script editor in a browser, for manual test runs
```

There is no automated test command — see "Manual QA checklist" below. There is no lint
command — none is configured; match existing style by hand.

**Deploying a new web app version** (only needed when you want the *live URL* to reflect
changes — `clasp push` alone updates the underlying script but not an existing deployment):
via `clasp open` → Deploy > Manage deployments > edit the existing deployment > New version.
Do this deliberately, not casually — it's user-visible and affects everyone with the link.

## Manual QA checklist (no automated tests exist — run this after touching Code.js)

1. `clasp push`, open the web app URL, confirm the page loads and dropdowns populate.
2. Submit a "Pahala" entry → confirm it appears at the top of Riwayat and the leaderboard
   balance updates correctly.
3. Submit a "Dosa" entry → confirm balance goes down, not up.
4. Submit a "Transfer" → confirm **two** rows land in the `Transaksi` sheet (sender Dosa +
   recipient Pahala) and both people's balances update correctly. Confirm transfer-to-self
   is blocked (client shows a toast error before any RPC call).
5. Submit with nominal = 0 or blank → confirm rejected client-side (toast) AND re-verify
   server-side by calling `submitAmalan` directly from the Apps Script editor with a bad
   payload — the client check alone is not the real guard.
6. Click a leaderboard row → confirm the "5 transaksi terakhir" panel expands/collapses and
   shows the correct newest-first order.

## Conventions this codebase actually follows

- **Bahasa Indonesia for all domain vocabulary**, English for generic code idioms. Function
  names like `submitAmalan`, `getDashboardData` are in English; parameters/fields (`nama`,
  `tipe`, `nominal`, `keterangan`, `tujuan`) are in Indonesian and match the sheet column
  headers and UI copy exactly. **Do not translate these to English** — they're a contract
  between the sheet schema, the server functions, and the client JS. If you add a new field,
  follow this same Indonesian-domain-noun convention.
- **Trailing underscore = private/internal helper** (`getSheet_`, `parseNominal_`). These are
  not called from the client and are GAS's informal convention for "not part of the public
  API surface" (GAS has no real module privacy). Keep using this convention for any new
  internal-only helper.
- **Server functions always return the full recomputed dashboard**, not a delta or an ack.
  `submitAmalan` ends with `return getDashboardData();` — follow this pattern for any new
  mutating function so the client can do a single `render(data)` call.
- **Errors are thrown as plain `Error` objects with Indonesian user-facing messages**
  (e.g. `throw new Error('Nominal harus angka lebih dari 0.')`), caught client-side via
  `.withFailureHandler(err => toast(err.message, 'err'))`. Keep error messages
  short, in Indonesian, and directly user-displayable — they are shown verbatim in the UI,
  not logged and translated elsewhere.
- **All sheet reads/writes go through `getSheet_(name)`**, never `ss.getSheetByName(name)`
  directly, so that a missing sheet self-heals via `setupSheets()`. Follow this pattern for
  any new sheet-backed feature (but see [GAPS.md](GAPS.md) #5 — this auto-heal behavior is
  a known footgun, don't extend it without reading that first).
- **One shared `LockService.getScriptLock()`** wraps the entire read-modify-write in
  `submitAmalan`. Any new function that reads-then-writes the `Transaksi` sheet must
  acquire this same lock pattern (`lock.waitLock(10000)` / `try { ... } finally {
  lock.releaseLock(); }`) or you reintroduce a race condition.
- **No CSS/JS framework, no separate files for style/script** — `Index.html` intentionally
  keeps `<style>` and `<script>` inline in the single served file, because GAS's
  `HtmlService.createHtmlOutputFromFile` serves exactly one file per `doGet`. If you want to
  split files, you'd need `HtmlService.createTemplateFromFile` + `<?!= include('file') ?>`
  patterns — that's a real architecture change, not a drop-in refactor. Don't split files
  without doing that properly.

## Gotchas — things that look like they should work one way but don't

- **`harga.gs.js` is dead code with a leaked API key, unrelated to this app** — do not
  assume it does anything for Kodomo, do not "fix" or extend it without first reading
  [GAPS.md](GAPS.md) #1. It should probably just be deleted after rotating the key.
- **The name dropdown does NOT restrict what the server accepts.** `submitAmalan` trusts
  `data.nama`/`data.tujuan` as-is; it does not check against `getAnggota()`. Don't assume
  "the UI only offers valid names" means the server enforces it too — it currently doesn't
  (see [GAPS.md](GAPS.md) #2).
- **Profile photos come from column B (`Foto`) of the `Anggota` sheet**, matched by exact
  name against leaderboard entries. The value must be a **direct image URL** (something an
  `<img src>` can load) or a **Google Drive share link** (auto-converted to a thumbnail URL
  by `normalizeFotoUrl_` in `Code.js`). Links to social-media *pages* (e.g.
  `instagram.com/p/...`) are HTML pages, not images — they will never render; the UI falls
  back to the person's initial. Non-http(s) values are ignored server-side.
- **Editing the roster is NOT done in code.** `DEFAULT_ANGGOTA` only seeds the `Anggota`
  sheet on first run. To add/remove a person on a live deployment, edit the `Anggota` sheet
  directly in Google Sheets — editing `DEFAULT_ANGGOTA` in `Code.js` and pushing does
  nothing to an already-initialized sheet.
- **A "missing sheet" doesn't error — it silently recreates and reseeds.** If you rename or
  delete `Anggota` or `Transaksi` for any reason (including by accident, e.g. while testing
  in the Sheets UI), the next page load/`getDashboardData()` call will silently recreate it
  via `setupSheets()`, **resetting `Anggota` back to the hardcoded default list** and wiping
  any custom roster edits. There is no confirmation prompt and no backup.
  Be careful before renaming/deleting sheets on the live spreadsheet.
- **`clasp push` pushes everything in the directory**, including `harga.gs.js` — there is no
  `.claspignore`. If you add scratch/experimental files to this folder, they will get pushed
  to the live Apps Script project unless you add a `.claspignore`.
- **The web app runs as the *deploying* user for every visitor** (`executeAs:
  USER_DEPLOYING` in [appsscript.json](appsscript.json)), not as each individual visitor.
  Combined with `access: ANYONE_ANONYMOUS`, this means there is no login at all — anyone
  with the URL can submit entries. Don't assume any request is authenticated; there is no
  concept of "the current user" server-side.
- **Transfers are NOT a distinct row type in the sheet.** A "Transfer" always writes as a
  `Dosa` row (sender) + `Pahala` row (recipient), distinguishable only by the `Keterangan`
  text prefix (`'Transfer pahala ke ...'` / `'Transfer pahala dari ...'`). If you need to
  query/report on transfers specifically, you must pattern-match `Keterangan`, not `Tipe
  Amalan`.
- **Node/npm/clasp are not currently installed on this machine** (verified during this
  audit — both bash and PowerShell). Don't assume `clasp push`/`clasp pull` will just work;
  install the toolchain first (see Commands above).

## Rules — do not change without care

- **Sheet column order** (`Timestamp, Nama, Tipe Amalan, Nominal, Keterangan` in
  `Transaksi`) is an unwritten schema shared by `setupSheets()`, `submitAmalan()`, and
  `getDashboardData()`. Changing column order/count requires updating all three in lockstep
  — there is no schema versioning or migration.
- **`.clasp.json`'s `scriptId`** binds this local directory to one specific live Apps
  Script project. Never regenerate or hand-edit this unless you deliberately intend to
  retarget a different Apps Script project.
- **`appsscript.json`'s `webapp.access`/`executeAs`** controls the entire security model
  (anonymous access, runs-as-deployer). Do not change this casually — it's a
  security-relevant decision, not a config tweak, and changing `executeAs` to
  `USER_ACCESSING` would require every visitor to have/authorize a Google account (a
  materially different UX).
- **`LockService` in `submitAmalan`** must not be removed — it's the only concurrency
  safety net given GAS has no database transactions.
- No files here are generated/auto-produced — everything (`Code.js`, `Index.html`,
  `harga.gs.js`, the two JSON config files) is hand-authored and safe to read directly as
  source of truth.

## Where to look next

- **[PROJECT.md](PROJECT.md)** — full architecture, data flow, tech stack rationale, and
  what's safe vs. load-bearing to change. Read this first for any non-trivial task.
- **[GAPS.md](GAPS.md)** — every known weakness (security, tech debt, missing tests, fragile
  edge cases), ranked by severity, each with a file path and a scoped fix. Check this before
  touching `submitAmalan`, the roster, or `harga.gs.js`.
