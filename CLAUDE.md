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
  - `POST /api/medlem` — validates, inserts into D1, returns a sequential `medlemsnummer` (D1 `AUTOINCREMENT`; first member = 1, shown zero-padded as "001"). Payment is **not** verified — a row is saved when the user clicks "Jag har swishat".
  - `GET /admin` — HTTP Basic Auth via the `ADMIN_PASSWORD` secret. Renders the member table; `?export=csv` downloads a CSV.
  - everything else → `env.ASSETS.fetch(request)` (the static site).
- **`wrangler.jsonc`** — Worker name (`bkloet`, must match the live subdomain), `main`, the `ASSETS` binding (`directory: "."`), and the `DB` D1 binding (paste the real `database_id`).
- **`.assetsignore`** — keeps source/docs/`.git` out of the uploaded static assets.
- **`schema.sql`** — the `medlemmar` table. Run once in the D1 console.
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

## Deployment

The site is published via **Cloudflare Pages** connected to the GitHub repo **Sunken3/BK-Loet**.  
Live URL: `bkloet.anton-sandberg99.workers.dev`

Workflow: push/merge to `main` on GitHub → Cloudflare Pages redeploys automatically within ~30 seconds. No manual deploy step needed.

## Sponsor display sizing

Sponsor grid column width scales with tier:  
`huvud` → full-width · `guld` → 280 px min · `silver` → 240 px min · `brons` → 200 px min
