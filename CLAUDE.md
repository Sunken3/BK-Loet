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

The "Bli stödmedlem" button opens a modal (`renderMedlemModal` / `attachMembershipModal` in `index.html`): förnamn, efternamn, e-post + a consent checkbox → "Swisha" (enabled only when name + valid e-post filled) → QR step → "Jag har swishat" posts to the backend.

- **`worker/index.js`** — the whole Worker. Routes:
  - `POST /api/medlem` — validates (fornamn, efternamn, epost, **stad** all required), inserts into D1, returns a sequential `medlemsnummer` (D1 `AUTOINCREMENT`; first member = 1, shown zero-padded as "001"). Payment is **not** verified — a row is saved when the user clicks "Jag har swishat".
  - `GET /api/medlemmar` — **public** list used by the Sponsorer page. Returns only members who consented (`visa_pa_webben = 1`), and only `nummer`/`fornamn`/`efternamn`/`stad` — never e-post. `Cache-Control: no-store` so new members appear immediately.
  - `GET /admin` — HTTP Basic Auth via the `ADMIN_PASSWORD` secret. Renders the member table (incl. Stad); `?export=csv` downloads a CSV.
  - everything else → `env.ASSETS.fetch(request)` (the static site).
- **`sponsorer.html`** fetches `/api/medlemmar` on load and renders the "Våra stödmedlemmar" list (`renderStodmedlemmar`); tolerates the endpoint being absent (empty state).
- **`wrangler.jsonc`** — Worker name (`bkloet`, must match the live subdomain), `main`, the `ASSETS` binding (`directory: "."`), and the `DB` D1 binding (paste the real `database_id`).
- **`.assetsignore`** — keeps source/docs/`.git` out of the uploaded static assets.
- **`schema.sql`** — the `medlemmar` table (incl. `stad`). Run once in the D1 console. **`migration-add-stad.sql`** adds `stad` to a database created before that column existed — run it once on the live DB.
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
the workflow aborts whichever one isn't 18:00 in Sweden — that keeps the time right across the DST
switch. Can also be run by hand: Actions tab → "Uppdatera tabell" → Run workflow. Requires the repo's
*Settings → Actions → General → Workflow permissions* to be set to **Read and write permissions**.

The same workflow also runs **`scripts/update-matcher.js`** (see below) and commits `data.json` and
`matcher.json` together.

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
- Player licence numbers from BITS are stripped — only the name is stored.
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
`matcher.json` is fetched lazily on the first team click and cached for the rest of the visit.

## Deployment

The site is published via **Cloudflare Pages** connected to the GitHub repo **Sunken3/BK-Loet**.  
Live URL: `bkloet.anton-sandberg99.workers.dev`

Workflow: push/merge to `main` on GitHub → Cloudflare Pages redeploys automatically within ~30 seconds. No manual deploy step needed.

## Sponsor display sizing

Sponsor grid column width scales with tier:  
`huvud` → full-width · `guld` → 280 px min · `silver` → 240 px min · `brons` → 200 px min
