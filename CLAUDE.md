# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the site locally

Browsers block `fetch()` of local files, so `index.html` cannot be opened directly. Start a local server first:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Architecture

The site itself is a zero-dependency static site (no build step, no framework, no package manager). The one exception is the stödmedlem sign-up flow, which is served by a Cloudflare **Worker** (`worker/index.js`, config in `wrangler.jsonc`) with a **D1** database. The Worker serves the static files via its `ASSETS` binding and adds two dynamic routes (see below). Note: this is deployed as a **Worker with static assets** (URL ends in `.workers.dev`), NOT Cloudflare Pages — so `functions/`-style Pages Functions do **not** apply here.

- **`data.json`** is the single source of truth for all content. Every text, number, and list on the page is read from here.
- **`index.html`** fetches `data.json` at runtime and renders the entire page via plain JavaScript (`init()` → `render*()` functions). The HTML body contains only `<div id="app">` — everything else is injected by JS.
- Styles are inline `<style>` in `index.html` using CSS custom properties (`--navy`, `--gold`, etc.).

**Content-only changes** (players, sponsors, table standings, club info) → edit `data.json` only.  
**Layout or style changes** → edit the CSS/JS in `index.html`.

## Stödmedlem sign-up (backend)

The "Bli stödmedlem" button opens a modal (`renderMedlemModal` / `attachMembershipModal` in `index.html`): förnamn, efternamn, e-post, stad + a consent checkbox → "Swisha" (enabled only when all filled and e-post valid) posts to the backend → QR step.

Payment can't be verified automatically, so a sign-up is saved **unconfirmed** (`betald IS NULL`) and only becomes a member when someone presses **Bekräfta** on `/admin` after matching the name against the payer in the club's Swish. (There is deliberately no payment reference — the payer's name in Swish is enough.) The `medlemsnummer` is handed out at that moment (`MAX(medlemsnummer) + 1` in a single `UPDATE`), so abandoned or fake sign-ups never take a number. `nummer` (AUTOINCREMENT) is only an internal row id.

- **`worker/index.js`** — the whole Worker. Routes:
  - `POST /api/medlem` — validates (fornamn, efternamn, epost, **stad** all required), inserts an unconfirmed row, returns `{ fornamn }`.
  - `GET /api/medlemmar` — **public** list used by the Sponsorer page. Returns only **confirmed** members who consented (`visa_pa_webben = 1`), and only `medlemsnummer`/`fornamn`/`efternamn`/`stad` — never e-post. `Cache-Control: no-store`. Returns 500 (not an empty list) on DB errors.
  - `GET /admin` — HTTP Basic Auth via the `ADMIN_PASSWORD` secret (any username). Two tables: "Väntar på betalning" (oldest first, Bekräfta / Ta bort buttons) and "Stödmedlemmar". `?export=csv` downloads both. Unconfirmed rows older than 30 days (`RENSA_EFTER_DAGAR`) are deleted on each visit. DB errors are shown as text, not a crash.
  - `POST /admin/bekrafta`, `POST /admin/ta-bort` — form posts from `/admin` (field `id` = `nummer`), Basic Auth **plus** a same-origin check (`Origin` / `Sec-Fetch-Site`), since the browser resends Basic Auth on cross-site posts. Ta bort only deletes unconfirmed rows.
  - `GET /admin/diplom?id=` — Basic Auth; returns the filled-in diploma PDF for a **confirmed** member (`nummer` = `id`), as an attachment named `Diplom 001 Förnamn Efternamn.pdf`. After a successful Bekräfta the redirect carries `&diplom=<id>` and `/admin` starts that download itself (then strips the query with `history.replaceState`); every member row also has a "Diplom" link.
  - everything else → `env.ASSETS.fetch(request)` (the static site).
- **`worker/diplom.js`** — `skapaDiplom()`: loads `worker/diplom/mall.pdf` and draws name, medlemsnummer (3 digits) and medlemsår (year of `betald`, Stockholm time) with pdf-lib. `mall.pdf` is the club's `BK_LOET_Diplom.pdf` (PowerPoint export, kept out of git because the repo is public) with the three placeholder text runs deleted from the page content stream. The original uses Georgia Bold; we embed **Gelasio Bold** (OFL, `worker/diplom/OFL.txt`), which is metric-compatible, so the measured centre points (`NAMN`/`NUMMER`/`AR`) line up. Long names shrink to fit `maxBredd`. To change the design: export a new PDF, delete the placeholder runs again, re-measure the centres.
- **`worker/vendor/pdf-lib.js`** — pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 bundled into one ESM file with esbuild, so the Worker still needs no `package.json`/npm install. `wrangler.jsonc` has a `rules` entry that imports `*.pdf`/`*.ttf` as Data modules (they live in `worker/`, which `.assetsignore` keeps out of the public assets).
- **`sponsorer.html`** fetches `/api/medlemmar` on load and renders the "Våra stödmedlemmar" list (`renderStodmedlemmar`); tolerates the endpoint being absent (empty state).
- **`wrangler.jsonc`** — Worker name (`bkloet`, must match the live subdomain), `main`, the `ASSETS` binding (`directory: "."`), and the `DB` D1 binding (paste the real `database_id`).
- **`.assetsignore`** — keeps source/docs/`.git` out of the uploaded static assets.
- **`schema.sql`** — the `medlemmar` table (incl. `stad`, `betald`, `medlemsnummer`). Run once in the D1 console. The live DB was created earlier and is upgraded by hand in the D1 console with **`migration-add-stad.sql`** (done 2026-11-15) and then **`migration-betalning.sql`** (done 2026-11-15; the live DB also has an unused `referens` column from an earlier version of that migration). The Worker can't run migrations itself — a missing column makes `/admin` show the SQL error.
- **`swish`** key in `data.json` — `belopp`, `nummer` (optional Swish number shown in the modal), `qr_bild` (path to the QR image, default `images/swish-qr.png`).
- One-time Cloudflare setup (create D1, paste `database_id`, set `ADMIN_PASSWORD` secret) is documented in **`MEDLEMSKAP-SETUP.md`**.

## data.json structure

| Key | Purpose |
|-----|---------|
| `klubb` | Club name, city, league, season |
| `kontakt` | Email, phone, social links |
| `om_oss` | About-section text and key stats |
| `bildspel` | Hero slideshow slides (type `"emblem"` or `"text"`) |
| `spelare` | Player cards (initialer, nummer, roll, snitt, matcher) |
| `sponsorer` | Sponsors grouped by `niva`: `"Huvudsponsor"` / `"Guldsponsor"` / `"Silversponsor"` / `"Bronssponsor"` |
| `medlemskap` | Membership tiers (set `"featured": true` for the highlighted card) |
| `swish` | Stödmedlem payment: `belopp`, `nummer` (optional), `qr_bild` |
| `tabell` | League standings — list teams in order (1st → last); set `kvalplatser` for promotion spots |

## The standings table updates itself

`tabell` in `data.json` is maintained by **`scripts/update-tabell.js`** — don't hand-edit it.

The script reads `https://bits.swebowl.se/MiscFrontApiConnector/GetStandings?divisionId=2&seasonId=2026`,
the endpoint the BITS frontend uses itself. It needs no API key and is not bot-protected — unlike the
HTML page at `bits.swebowl.se/seriespel`, which blocks plain `fetch`/`curl` and can only be read
through a real browser.

- `node scripts/update-tabell.js --check` — print the table, write nothing.
- `node scripts/update-tabell.js` — rewrites **only** the `tabell` block in `data.json` (brace
  counting, not `JSON.stringify` of the whole file), so the rest keeps its formatting.
- Writes nothing when the table is unchanged, so no empty commits.
- **New season:** bump `SEASON_ID` at the top of the script (BITS counts `2026` = the 2026/2027
  season). The script refuses to write if BITS returns an empty table. `kvalplatser` is set by hand —
  BITS says nothing about it.

**`.github/workflows/update-tabell.yml`** runs the script every Sunday at 18:00 Swedish time and
commits the result. GitHub crons run in UTC, so two schedules (16:00 and 17:00 UTC) are registered and
the workflow skips any run that starts before 18:00 in Sweden — that keeps the time right across the DST
switch. GitHub delays scheduled runs near the top of the hour, sometimes by over an hour, and can drop
them entirely, so the guard is `>= 18` (not `== 18`) and a backup schedule runs at 19:23 UTC. Extra runs
are harmless: the scripts write nothing when nothing changed. Can also be run by hand: Actions tab → "Uppdatera tabell" → Run workflow. Requires the repo's
*Settings → Actions → General → Workflow permissions* to be set to **Read and write permissions**.

The same workflow also runs **`scripts/update-matcher.js`** and **`scripts/update-spelare.js`** (both
below) and commits `data.json` and `matcher.json` together.

## Player stats update themselves

`snitt`, `spelstyrka`, `alder` and `licens` on every player in `data.json` come from the BITS licence
register via **`scripts/update-spelare.js`** — don't hand-edit those fields. `licens` is used only for
the "Statistik på BITS" link at the bottom of the expanded Spelarprofil in `spelare.html`; the script
adds it after `namn` the first time it sees a player. Everything else on a player
card (photo, playing style, favourite ball, highest series/match) is maintained by hand and the script
never touches it.

- `node scripts/update-spelare.js --check` — print the changes, write nothing.
- `node scripts/update-spelare.js` — writes `data.json`.
- One POST to `GetAllPlayerSearch` with `search: "BK Loet"` returns the whole club — one request no
  matter how many players are on the page. `licenceAverage` → `snitt`, `licenceSkillLevel` →
  `spelstyrka`, formatted with a Swedish decimal comma; `age` (a full date of birth) → `alder`.
- Players are matched on `"firstName surName"` against `namn`. **The name in `data.json` must match
  the licence register exactly** — a player BITS doesn't recognise is reported and left untouched, never
  blanked.
- Values are replaced in place in the raw text, not by re-serialising the player objects, so `bild`,
  `bild_zoom`, `favoritklot` and the rest keep their exact formatting. A player carrying a duplicate
  `spelstyrka` under `profil` gets both copies updated, so the two cannot drift apart.
- The script refuses to write if the register returns no BK Loet players at all.
- `GetAllPlayerSearch` (the only POST) has failed with `ECONNRESET` from GitHub's runners while
  working fine locally. The workflow step is `continue-on-error`, so a failure there still lets the
  table and matches commit — if player stats look stale, run the script locally and push.
- Licensed players who aren't on the Spelare page are listed in the output but never added
  automatically — a player card needs a photo and playing style that BITS does not have.

**Age and personal data.** `alder` is computed from the register's date of birth in Europe/Stockholm
time, and **only the resulting number is stored** — never the date. (The licence number *is* stored,
as `licens`, for the BITS link — BITS shows it publicly in that URL.) A
date that won't parse, or that yields an age outside 5–110, leaves the existing `alder` alone and is
reported. The licence number encodes the same birth date but with a two-digit year (`M250799ANT01` is
25/07/99), which is ambiguous for young players — a 2015 birth year reads as `15` — so the date field
is used instead. Because ages are recomputed weekly, birthdays take care of themselves.

Only `spelare.html` renders these fields. `renderPlayer`/`renderPlayers` in `index.html` is dead
code — defined, never called, and referencing fields (`initialer`, `nummer`, `matcher`) that no longer
exist in `data.json`.

## matcher.json — matches and match facts

`matcher.json` holds every match in the division for the season, and the full match facts for the ones
already played. It is generated by **`scripts/update-matcher.js`** — don't hand-edit it.

It is **not** part of `data.json`: only `tabell.html` reads it, and only once the visitor clicks a
team. That keeps it off the critical path for every other page.

- `node scripts/update-matcher.js --check` — print a summary, write nothing.
- `node scripts/update-matcher.js` — writes `matcher.json`.
- Match facts already in the file are reused, so a weekly run only requests matches played since the
  last one. A cold run fetches every played match (two requests each, 250 ms apart).
- Writes nothing when the result is unchanged, so no empty commits.
- Each player row keeps the BITS licence number as `licens`, used only to link the name to
  `bits.swebowl.se/player-detail?licenseNumber=…&queryTypeId=4` (BITS shows it publicly there).
  Cached match facts without `licens` are refetched once.
- **New season:** bump `SEASON_ID`, same as in `update-tabell.js`. The script refuses to write if BITS
  returns no matches at all.

Endpoints used, all on the same unprotected host as the standings:

| Endpoint | Gives |
|---|---|
| `ListMatches` | every match in the division, played and upcoming |
| `GetMatchResults` | per-player series results for one match (needs `matchSchemeId` from `ListMatches`) |
| `GetMatchHeadResultInfo` | per-series team totals for one match |

**In `tabell.html`:** every team name is a button (`renderTable` → `.js-lag`). Clicking one opens a
modal (`renderMatchModal` / `attachMatchModal`) listing that team's matches; clicking a played match
swaps the modal to the match facts — score, pins, per-series totals and both teams' player tables.
Each player name in those tables links to the player's page on BITS (new tab), and the two team names
above the score link to the club's page (`club-detail?seasonId=…&clubId=…&activeTabId=2`, using
`hemmaKlubbId`/`bortaKlubbId` and the top-level `saesongId` in `matcher.json`).
`matcher.json` is fetched lazily on the first team click and cached for the rest of the visit.

## Deployment

The site is published via **Cloudflare Pages** connected to the GitHub repo **Sunken3/BK-Loet**.  
Live URL: `bkloet.anton-sandberg99.workers.dev`

Workflow: push/merge to `main` on GitHub → Cloudflare Pages redeploys automatically within ~30 seconds. No manual deploy step needed.

## Sponsor display sizing

Sponsor grid column width scales with tier:  
`huvud` → full-width · `guld` → 280 px min · `silver` → 240 px min · `brons` → 200 px min
