# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the site locally

Browsers block `fetch()` of local files, so `index.html` cannot be opened directly. Start a local server first:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Architecture

This is a zero-dependency static site. There is no build step, no framework, and no package manager.

- **`data.json`** is the single source of truth for all content. Every text, number, and list on the page is read from here.
- **`index.html`** fetches `data.json` at runtime and renders the entire page via plain JavaScript (`init()` → `render*()` functions). The HTML body contains only `<div id="app">` — everything else is injected by JS.
- Styles are inline `<style>` in `index.html` using CSS custom properties (`--navy`, `--gold`, etc.).

**Content-only changes** (players, sponsors, table standings, club info) → edit `data.json` only.  
**Layout or style changes** → edit the CSS/JS in `index.html`.

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
| `tabell` | League standings — list teams in order (1st → last); set `kvalplatser` for promotion spots |

## Deployment

The site is published via **Cloudflare Pages** connected to the GitHub repo **Sunken3/BK-Loet**.  
Live URL: `bkloet.anton-sandberg99.workers.dev`

Workflow: push/merge to `main` on GitHub → Cloudflare Pages redeploys automatically within ~30 seconds. No manual deploy step needed.

## Sponsor display sizing

Sponsor grid column width scales with tier:  
`huvud` → full-width · `guld` → 280 px min · `silver` → 240 px min · `brons` → 200 px min
