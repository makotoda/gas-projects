# GAPS.md — Honest audit of weaknesses

Ordered most severe → least severe. This is a small (~5 file) hobby project, so "severity"
is calibrated to that context — nothing here is enterprise-critical, but some items are
genuinely bad practice regardless of scale.

---

## 1. [SECURITY — HIGH] Hardcoded, live-looking API key committed in plaintext

**Where:** [harga.gs.js:4](harga.gs.js:4) and [harga.gs.js:13](harga.gs.js:13)
```js
headers: {"X-CMC_PRO_API_KEY": "9f95________________REDACTED____"}
```
**Why it matters:** A CoinMarketCap Pro API key is hardcoded in two places in a file that
gets pushed verbatim to the live Apps Script project on every `clasp push`. Anyone with
"view" access to the Apps Script project (e.g. if it's ever shared, transferred, or the
project visibility changes) can read this key and use it against the owner's CoinMarketCap
quota/billing. Since this repo also has no `.git`, there's no way to know if this key has
already been exposed elsewhere (pasted into a chat, screenshot, etc.) — treat it as
compromised.
**Suggested fix (single task):**
1. Rotate/revoke this key in the CoinMarketCap dashboard immediately.
2. Delete `harga.gs.js` entirely (it has zero callers from `Code.js` or `Index.html` — it's
   dead code; confirm with a repo-wide search for `getPAXG`/`getXAUT` before deleting).
3. If the gold-price feature is actually wanted later, re-add it using
   `PropertiesService.getScriptProperties()` to store the key out-of-band instead of in
   source.

---

## 2. [SECURITY — MEDIUM] No server-side validation that a submitted name is a real roster member

**Where:** [Code.js:89-121](Code.js:89) (`submitAmalan`)
**Why it matters:** The `<select>` dropdowns in `Index.html` are cosmetic only. Because the
web app is `access: ANYONE_ANONYMOUS` / `executeAs: USER_DEPLOYING`
([appsscript.json](appsscript.json)), any visitor can open devtools and call
`google.script.run.submitAmalan({nama: 'arbitrary string', tipe: 'Pahala', nominal: 1})`
directly, bypassing the roster entirely. The server accepts any non-empty trimmed string as
`nama`. This lets anyone inject fake entries/fake leaderboard members, or spam the
`Transaksi` sheet with junk rows with no rate limit beyond the 10s lock (which only
serializes, doesn't throttle).
**Suggested fix (single task):** In `submitAmalan`, after trimming `nama` (and `tujuan` for
transfers), check membership against `getAnggota()` and throw a clear error
(`'Nama tidak dikenal.'`) if not found. Same for `tujuan`.

---

## 3. [TECH DEBT / DEAD CODE — MEDIUM] `harga.gs.js` is entirely unrelated to this app

**Where:** [harga.gs.js](harga.gs.js) (whole file)
**Why it matters:** Beyond the leaked key (#1), this file has no relationship to the
Kodomo app — different domain (gold token prices), no callers, not referenced by
`Index.html` or `Code.js`. Its presence is confusing for anyone auditing "what does this app
do," and because there's no `.claspignore`, it gets pushed and becomes a live
(if unused) function in the production Apps Script project — meaning when a user
authorizes the script, Google will ask for "Connect to an external service" (UrlFetchApp)
permission scope that the actual Kodomo app doesn't need, unnecessarily widening the
permission footprint of the whole project.
**Suggested fix:** Delete the file (see fix for #1 — same action covers both).

---

## 4. [SCALABILITY — MEDIUM, will become HIGH with growth] Full sheet scan on every read and every write

**Where:** [Code.js:124-185](Code.js:124) (`getDashboardData`), called both on page load and
after every `submitAmalan`.
**Why it matters:** `getDashboardData()` reads the *entire* `Transaksi` sheet
(`sheet.getRange(2, 1, last - 1, 5).getValues()`), then iterates all rows in memory to
build the leaderboard, every single time — including immediately after every single
submission. There's no pagination, no caching (e.g. `CacheService`), no incremental
aggregation. For a small friend group this is fine for a long time, but:
- Apps Script has a 6-minute execution limit per invocation; a large sheet (thousands of
  rows) will eventually make `getDashboardData()` slow enough to feel laggy, and in the
  worst case time out.
- Every `.recent` array is built with `.push()` per row per person and then `.slice(-5)` —
  wasteful for people with thousands of transactions, but not currently a real risk given
  probable data volume.
**Suggested fix (scoped for later, not urgent today):** Add `CacheService.getScriptCache()`
memoization of the leaderboard aggregate keyed off `sheet.getLastRow()`, invalidated on
write. Not worth doing until the sheet actually grows large — flagging so nobody is
surprised later.

---

## 5. [FRAGILE EDGE CASE — MEDIUM] Self-healing sheet bootstrap can silently reset the roster

**Where:** [Code.js:59-67](Code.js:59) (`getSheet_`) calling [Code.js:37-57](Code.js:37)
(`setupSheets`)
**Why it matters:** If the `Anggota` sheet is ever accidentally renamed, deleted, or the
spreadsheet is duplicated without both sheets, the very next read (`getAnggota` or
`getDashboardData`) will silently call `setupSheets()`, which recreates `Anggota` **and
reseeds it with the hardcoded `DEFAULT_ANGGOTA` list** — silently discarding any manual
roster edits (additions/removals of people) made directly in the sheet since the last
deploy. There's no warning, confirmation, or backup before this happens — it's a silent
data-loss footgun triggered by an innocuous mistake like a rename.
**Suggested fix (single task):** In `getSheet_`, throw a descriptive error instead of
auto-calling `setupSheets()` when a sheet is unexpectedly missing post-initial-setup, or at
minimum log a warning via `Logger.log` so the owner can notice in the Apps Script execution
log. Reserve the current auto-create behavior for `setupSheets()` being run explicitly by a
human the first time.

---

## 6. [MISSING TEST COVERAGE — MEDIUM] Zero automated tests for the only two functions that matter

**Where:** No test file exists anywhere in the project.
**Why it matters:** `submitAmalan` (money/points math + transfer decomposition + locking)
and `getDashboardData` (leaderboard sort + balance math) are the entire business logic of
this app, and both are completely untested. Specific untested behaviors that are easy to
break silently on a future edit:
- Transfer creates exactly 2 rows in one batch write (`Code.js:109-112`) — an off-by-one
  here would corrupt the ledger.
- `parseNominal_` rejects `0`, negative, and non-numeric input (`Code.js:82-86`) — but note
  it also rejects `NaN`-producing input via falsy-check, which is correct but non-obvious
  (`!nominal` is true for `NaN`, `0`, and any falsy value alike — works here, but fragile if
  someone "cleans up" this line without understanding why).
- Leaderboard sort order (`b.saldo - a.saldo`) and `recent` slicing (`slice(-5).reverse()`)
  — easy to get backwards (oldest-first vs newest-first) on a refactor with no test to catch
  it.
**Suggested fix (single task, scoped small):** Since this is Apps Script (no native test
runner), the pragmatic first step is a single manual QA checklist documented in CLAUDE.md
(already added — see there) rather than investing in a full test harness for a 5-file hobby
app. If real automated tests are wanted later, consider extracting the pure functions
(`parseNominal_`, the aggregation logic in `getDashboardData`) into a shape that can be
tested with a plain Node test runner + a mocked `SpreadsheetApp`, since GAS itself has no
first-party unit test tooling.

---

## 7. [INCONSISTENCY — LOW] Client-side validation duplicated and not authoritative

**Where:** [Index.html:712-722](Index.html:712) duplicates the exact same checks
(`nama` required, `tujuan` required + not-self for Transfer, `nominal > 0`) that
[Code.js:82-104](Code.js:82) also performs server-side.
**Why it matters:** Not wrong — defense in depth is fine — but the two copies can drift.
E.g. `Index.html` doesn't enforce a max nominal value or the 120-char `keterangan` limit
server-side (the `maxlength="120"` is purely an HTML attribute, trivially bypassed via
`google.script.run`). If someone changes a validation rule in one place and forgets the
other, behavior silently diverges between "using the form" and "calling the RPC directly."
**Suggested fix:** Low priority given app size; if touched, enforce `keterangan.length <=
120` and a sane nominal upper bound server-side in `submitAmalan`/`parseNominal_` to close
the gap, since server-side is the only validation that actually matters for security.

---

## 8. [TOOLING GAP — LOW] CLAUDE.md instructs `clasp push`/`clasp pull`, but neither `clasp` nor `node` is installed

**Where:** [CLAUDE.md](CLAUDE.md) (original content) instructs running `clasp push`/`clasp
pull`, but as of this audit, `clasp`, `node`, and `npx` are all absent from PATH in both the
bash and PowerShell shells on this machine.
**Why it matters:** Any agent picking up this project and literally following the existing
CLAUDE.md instructions will fail at the first step with a "command not found" error and may
waste time debugging environment issues instead of realizing the tool simply isn't
installed yet.
**Suggested fix (single task):** Before your first `clasp` command in a fresh environment,
run `npm install -g @google/clasp` (requires Node.js/npm to be installed first — check with
`node --version`; install Node via nvm or the official installer if missing), then
`clasp login` to authenticate. Documented now in CLAUDE.md.

---

## 9. [MINOR / COSMETIC] `harga.gs.js` naming and `.clasp.json` extension mapping is confusing

**Where:** [.clasp.json:4-6](.clasp.json:4) lists both `.js` and `.gs` as recognized script
extensions, and the file is literally named `harga.gs.js` (both extensions at once).
**Why it matters:** It's unclear what this file becomes on the Apps Script side after a
push (`harga`, `harga.gs`, or something else) without actually testing it — this is a minor
footgun for anyone renaming/reorganizing files in this project, since GAS filenames must be
unique after extension stripping and a collision would silently overwrite the wrong file on
push.
**Suggested fix:** Moot if `harga.gs.js` is deleted per fix #1/#3. If any new `.js` file is
added in the future, use a single clean extension (`Foo.js`) and avoid double-extension
filenames like `name.gs.js`.

---

## 10. [HALF-FINISHED / DESIGN GAP] No admin/UI path to manage the roster after first deploy

**Where:** `DEFAULT_ANGGOTA` ([Code.js:19-26](Code.js:19)) only seeds `Anggota` on first
run via `setupSheets()`. There is no in-app way to add/remove a person — it must be done by
directly editing the `Anggota` sheet in Google Sheets.
**Why it matters:** Not a bug, but clearly an unfinished corner: the rest of the app
(the whole point of Kodomo) is designed around a self-service web UI, yet roster
management — a pretty core piece of onboarding a new person to the group — requires going
around the app entirely into the spreadsheet. Combined with gap #5 (silent reseed), this is
a rough edge that will confuse a non-technical group admin.
**Suggested fix (larger, not scoped for a single small task):** Add a lightweight
"Kelola Anggota" admin view (could even just be a second tab in the existing UI) that calls
new `addAnggota(nama)` / `removeAnggota(nama)` server functions.
