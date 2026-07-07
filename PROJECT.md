# PROJECT.md — Kodomo: Pencatat Amalan

## What this is

**Kodomo** ("Pencatat Amalan" — deed/karma tracker) is a single-page Google Apps Script (GAS)
web app that lets a fixed group of ~39 named people (friends, coworkers, or a community —
the names in `DEFAULT_ANGGOTA` are Indonesian first names, e.g. `Ajeng`, `Budek Yudha`,
`Wesh`) log "Pahala" (good deeds / merit points) and "Dosa" (bad deeds / demerit points)
against each other, plus transfer merit points between people. It renders a live leaderboard
(net balance = pahala − dosa) and a scrolling history feed.

Think of it as a lighthearted, honor-system point-tracking app for a closed social group —
there is no login, no per-user account, and no verification that the person submitting an
entry for "Budek Yudha" actually is Budek Yudha. It's built for fun/social accountability,
not for anything security- or compliance-sensitive. Everything is in Bahasa Indonesia (the
UI copy, variable names for domain concepts like `nama`/`tipe`/`nominal`/`keterangan`, code
comments). A future engineer/agent should assume Indonesian is the working language of this
codebase's *domain vocabulary*, even if code style (camelCase, JSDoc) is conventional
JS/GAS style.

Who it's for: whoever runs this out of a personal Google account, deployed as a
"Anyone, even anonymous" web app, and shares the link with their friend group. There is no
sign-up flow — the group is fully enumerated up front in code and stored in a sheet.

## Tech stack (and why)

This is about as minimal a stack as a interactive web app can have:

- **Google Apps Script (V8 runtime)** — the entire backend. Chosen because it gives you a
  free, zero-ops server + database (Google Sheets) + hosting (HtmlService) in one product,
  with no build step, no deploy pipeline, no server to patch. Ideal for a small hobby/social
  tool with no budget and no dedicated infra person.
- **Google Sheets as the database** — `SpreadsheetApp` is the only persistence layer. Two
  sheets: `Transaksi` (append-only transaction log: Timestamp, Nama, Tipe Amalan, Nominal,
  Keterangan) and `Anggota` (the roster of names, one per row). This is a deliberate choice
  to make the data trivially human-readable/editable by a non-engineer (open the sheet,
  eyeball or fix a row) — there's no admin UI, so the spreadsheet *is* the admin UI.
- **`HtmlService` + a single `Index.html`** — the entire frontend is one file: inline
  `<style>`, inline `<script>`, no framework, no bundler, no npm dependency. Fits GAS's
  single-file-serving model (`doGet` returns exactly one HTML file). Chosen because GAS's
  HTML service does not support module bundling or a build step out of the box, so
  "everything in one file" is the path of least resistance, not necessarily an active choice
  to avoid frameworks — but it works fine at this scale.
  Vanilla JS with `google.script.run` (GAS's RPC bridge) is the only way the browser talks to
  the backend — no REST API, no fetch() calls to a separate endpoint.
- **`clasp`** (Google's CLI, referenced by `.clasp.json`) — used to sync local files to the
  Apps Script project (`scriptId` in `.clasp.json`) via `clasp push`/`clasp pull`. This is
  the *only* reason this project exists as local files at all; without clasp you'd edit
  directly in the Apps Script web editor.
- **`LockService`** — used in `submitAmalan` to serialize writes. Correct and necessary
  choice given GAS has no transactions and concurrent web requests can race on
  `getLastRow()` + append.

No test framework, no linter, no CI, no package.json — none of the usual JS tooling is
present. This is normal for a GAS project of this size but means all of the below is enforced
by convention/discipline only, not tooling.

## Architecture

```
Browser (Index.html, vanilla JS)
   │  google.script.run.<fn>(...)   (RPC over Apps Script's HTML sandbox bridge)
   ▼
Code.js  (server-side GAS functions — this is "Code.gs" once pushed)
   │  doGet()            → serves Index.html (web app entry point)
   │  getDashboardData()  → reads sheet, aggregates, returns JSON-able object
   │  submitAmalan(data)  → validates + LockService + writes rows, then returns
   │                        getDashboardData() (so client always re-renders from
   │                        the fresh server-computed state, not an optimistic guess)
   │  getAnggota()        → reads roster for <select> dropdowns
   │  setupSheets()       → one-time bootstrap, idempotent (checks getSheetByName first)
   ▼
Google Spreadsheet (bound to this Apps Script project)
   ├── Sheet "Transaksi": append-only ledger — Timestamp | Nama | Tipe Amalan | Nominal | Keterangan
   └── Sheet "Anggota":   roster — Nama (one name per row)
```

`harga.gs.js` is a **separate, unrelated file** in the same project (see Gotchas below) that
fetches gold-token prices (PAXG, XAUT) from CoinMarketCap. It is not wired into `doGet`,
`Index.html`, or any function called by the frontend. It appears to be either a leftover
from a different script that got copy-pasted into this project directory, or an
experiment that was never finished/removed. Treat it as dead code, but see
[GAPS.md](GAPS.md) for the security implication (hardcoded API key).

### Data flow for a typical write (submit a "Pahala" entry)

1. User picks name + type (Pahala/Dosa/Transfer) + nominal + optional note in the form.
2. Client-side JS does light validation (name chosen, nominal > 0, transfer target ≠ self)
   and disables the submit button.
3. `google.script.run.submitAmalan({...})` — a genuine RPC call, serialized to JSON,
   executed server-side under the Apps Script user's execution context
   (`executeAs: USER_DEPLOYING` — always runs as the account that deployed it, not the
   visitor, per `appsscript.json`).
4. Server acquires `LockService.getScriptLock()` (10s timeout), re-validates nominal
   server-side, appends 1 row (or 2 rows for a Transfer: a "Dosa" row for the sender and a
   "Pahala" row for the recipient — this is how transfers are modeled; there is no separate
   "Transfer" row type in the sheet, it's always decomposed into Pahala/Dosa pairs).
5. Releases lock, then **recomputes and returns the entire dashboard** (`getDashboardData()`)
   by reading the whole `Transaksi` sheet back out, aggregating in memory.
6. Client replaces the whole UI state (stats, leaderboard, history, dropdowns) from that
   response and shows a toast.

Every write round-trips through a full sheet read/aggregate. There is no incremental update
and no cache — see [GAPS.md](GAPS.md) for the scaling implication.

## Key design decisions (and inferred reasoning)

- **Transfers are decomposed into a Dosa+Pahala pair, not a third data type.** This keeps
  `getDashboardData()`'s aggregation logic simple (only two categories to sum), at the cost
  of the history feed showing transfers as two separate rows rather than one linked event.
  You can recognize a transfer only by the `Keterangan` text pattern (`'Transfer pahala ke
  ' + tujuan` / `'Transfer pahala dari ' + nama`), not a structured field. If you ever need
  to query/report on transfers specifically, you'll have to string-match `Keterangan`.
- **Server always returns full recomputed state after writes**, rather than the client
  optimistically updating the leaderboard itself. Simpler and avoids client/server drift,
  at the cost of a full-sheet re-read per submit.
- **No per-user auth; the name is just a value picked from a dropdown.** The roster
  (`Anggota` sheet) exists to constrain the UI's `<select>` options, but the server
  (`submitAmalan`) does not check that `data.nama` is actually in the roster — see Gotchas.
  This is presumably acceptable because the intended audience is a small trusted group and
  the "worst case" is someone logs a joke entry under a friend's name, which is arguably
  the whole point of an honor-system social app.
  `executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS` means literally anyone with the
  link can write to the sheet, running as the deploying user's Google identity — there is
  no Google account required to use the app at all.
- **`setupSheets()` / `getSheet_()` self-healing bootstrap.** Any read path
  (`getAnggota`, `getDashboardData`) that hits a missing sheet will silently call
  `setupSheets()` and recreate it. This means the app can never "crash" from a deleted
  sheet — it just re-seeds the default roster, which could silently wipe custom roster
  edits if a sheet is accidentally renamed/deleted. Convenient for first-run bootstrap, but
  a footgun for accidental resets (see Gotchas/GAPS).
- **`LockService.getScriptLock()`** around the entire read-modify-write in `submitAmalan`
  is a correct, deliberate defense against GAS's lack of DB transactions — two simultaneous
  submits can't interleave `getLastRow()`/append and corrupt the ledger.
- **Nominal input UX**: the client reformats the input field on every keystroke to insert
  Indonesian-locale thousands separators (`.`), then strips them back out
  (`nominalValue()`) before sending. This is a UI nicety with no server-side counterpart —
  the server just does `Number(raw)`, so it doesn't care about formatting either way.

## Critical paths — what matters most, what's safe to touch

**Load-bearing / change with care:**
- [Code.js](Code.js) `submitAmalan()` and `getDashboardData()` — the entire app's
  correctness lives here. Any change to the sheet's column order (`Timestamp, Nama, Tipe
  Amalan, Nominal, Keterangan`) must be mirrored in both functions and in `setupSheets()`'s
  header row, or the app silently misreads columns (no schema validation exists).
- The `Transaksi` sheet's column layout itself. It's a de facto schema with zero enforcement
  — treat column order as an unwritten API contract between `setupSheets()`,
  `submitAmalan()`, and `getDashboardData()`.
- `LockService` usage in `submitAmalan` — do not remove or "optimize away" this lock; it is
  the only thing preventing concurrent-write corruption.
- `.clasp.json`'s `scriptId` — this is the binding to the live Apps Script project/deployment.
  Never regenerate/change this unless you deliberately intend to retarget which Apps Script
  project gets pushed to.
- `appsscript.json`'s `webapp.access`/`executeAs` — controls who can use the app and under
  whose identity it runs. Changing `executeAs` to `USER_ACCESSING` would require each
  visitor to have a Google account and grant permissions individually — a materially
  different security/UX model, not a casual tweak.

**Safe to change casually:**
- [Index.html](Index.html) visual styling (`<style>` block) — purely cosmetic, isolated,
  no server coupling.
- `DEFAULT_ANGGOTA` — only affects first-run seeding; editing the live roster is done
  directly in the `Anggota` sheet in Google Sheets, not in code, once deployed.
- Toast copy, labels, emoji — cosmetic only.
- `harga.gs.js` — currently dead code with no callers; safe to delete or ignore (but see
  GAPS.md for why you should delete it rather than ignore it).

## Surprising / non-obvious things that will trip up a newcomer

1. **`harga.gs.js` has nothing to do with the app.** It's gold-price-fetching code
   (PAXG/XAUT via CoinMarketCap) sitting in the same clasp project as the Kodomo amalan
   app, with **a hardcoded, plaintext API key**. It will get pushed to the live Apps Script
   project on every `clasp push` alongside the real app. Do not assume every `.js`/`.gs`
   file in this repo is part of "the app" — check for actual callers first.
2. **File extensions are misleading.** `.clasp.json` maps `.js` files to `.gs` on the Apps
   Script side (`"scriptExtensions": [".js", ".gs"]`). So `Code.js` becomes `Code.gs` and
   `harga.gs.js` becomes... check what clasp actually names it on push (it likely keeps the
   base name before the last recognized extension — worth verifying with `clasp pull` on a
   clean checkout if you're unsure, since this can result in unexpected file names in the
   Apps Script editor, e.g. `harga.gs.gs` or `harga.gs`).
3. **`submitAmalan` does not validate that `data.nama` (or `data.tujuan`) is a real roster
   member.** The dropdown in the UI *looks* like the only way to pick a name, but any user
   can open devtools and call `google.script.run.submitAmalan({nama: 'anything', ...})`
   directly, and the server will happily record it — including a value that never appears
   in `Anggota`. It'll then show up in the leaderboard as a brand-new person.
4. **Timezone is `Asia/Bangkok`** in `appsscript.json`, not `Asia/Jakarta`, despite the
   entire app being in Bahasa Indonesia for what looks like an Indonesian friend group. They
   share the same UTC+7 offset (no daylight saving in either), so timestamps will display
   correctly for Indonesian users regardless, but don't assume the `timeZone` field reflects
   the actual locale — it was probably just left at whatever the Apps Script project
   defaulted to, or copied from a template.
5. **There is no `doPost`, no REST endpoint, no way to interact with this app except
   through the served `Index.html` page** (or directly via the Apps Script script editor's
   "Run" button on individual functions). If you're used to APIs being testable via curl,
   they're not, here — `google.script.run` only works from within the served HTML context.
6. **Nothing in this repo is under version control** (no `.git`). Any "let me check git
   history/blame" instinct will not work — the only record of intent is this file, GAPS.md,
   and CLAUDE.md.
7. **Local dev tooling (`node`, `npm`, `clasp`) is not installed on this machine** as of
   this audit — `clasp`, `node`, and `npx` are all absent from PATH in both the bash and
   PowerShell environments checked. CLAUDE.md's instructions to run `clasp push`/`clasp pull`
   assume tooling that isn't currently present; see GAPS.md.
