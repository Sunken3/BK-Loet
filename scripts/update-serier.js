#!/usr/bin/env node
/**
 * Pulls the standings of the other national leagues from BITS into
 * tabeller/<season>.json, for the "Övriga serier" tab in tabell.html.
 *
 *   node scripts/update-serier.js           update tabeller/
 *   node scripts/update-serier.js --check   print what would change, write nothing
 *
 * Which leagues: Elitserien (men and women), every Allsvenskan, every Div 1
 * (incl. women's "D Div 1 …") and every Div 2 — see groupOf(). Nordallsvenskan
 * is left out: it has its own tab (data.json + tabeller.json).
 *
 * Seasons FIRST_SEASON … the current one. The current season is worked out from
 * today's date (a BITS season runs 1 July – 30 June), so there is nothing to
 * bump. A finished season never changes, so its file is fetched once and then
 * left alone; only the current season is refetched on every run.
 *
 * Files:
 *   tabeller/index.json   { saesonger: [{ saesongId, saesong, pagaende, antal }] }, newest first
 *   tabeller/2025.json    { saesongId, saesong, pagaende, uppdaterad, serier: [
 *                            { divisionId, namn, grupp, streck, lag: [{ namn, lagId, klubbId, … }] } ] }
 */

const fs = require('fs');
const path = require('path');
const { bitsFetch } = require('./bits-fetch');

const FIRST_SEASON = 2012;
const NORDALLSVENSKAN = 2; // own tab, not listed here
const BASE = 'https://bits.swebowl.se/MiscFrontApiConnector';
const DIR = path.join(__dirname, '..', 'tabeller');
const PAUSE_MS = 300;

// Display order of the groups on the page.
const GROUPS = ['Elitserien', 'Allsvenskan', 'Division 1', 'Division 1 Damer', 'Division 2'];

// BITS division name -> group, or null for leagues we don't show
// (Div 3 and below, local leagues, youth, qualifiers).
function groupOf(name) {
  const n = name.trim();
  if (/^Elitserien\b/i.test(n)) return 'Elitserien';
  if (/allsvenskan$/i.test(n)) return 'Allsvenskan';
  if (/^D Div 1\b/i.test(n)) return 'Division 1 Damer';
  if (/^Div 1\b/i.test(n)) return 'Division 1';
  if (/^Div 2\b/i.test(n)) return 'Division 2';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function currentSeason() {
  const [y, m] = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
    .split('-')
    .map(Number);
  return m >= 7 ? y : y - 1;
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

// 2025 -> "Säsong 2025/26"
function seasonLabel(id) {
  return `Säsong ${id}/${String((id + 1) % 100).padStart(2, '0')}`;
}

async function getJson(url) {
  const res = await bitsFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function fetchStandings(divisionId, seasonId) {
  const rows = await getJson(`${BASE}/GetStandings?divisionId=${divisionId}&seasonId=${seasonId}`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const lag = rows.map((r) => {
    const diff = Number(r.standingsDiff) || 0;
    return {
      namn: r.standingsTeamName,
      // For the team's page on BITS (seriespel?…&clubId=…&teamId=…).
      lagId: r.standingsTeamId,
      klubbId: r.clubTeamClubId,
      matcher: r.standingsMatches,
      vinster: r.standingsWin,
      oavgjorda: r.standingsDraw,
      forluster: r.standingsLoss,
      skillnad: diff > 0 ? `+${diff}` : String(diff),
      poang: r.standingsPoints,
    };
  });
  const streck = rows
    .map((r, i) => (r.standingsIsLastPositionBeforeDivider ? i + 1 : null))
    .filter((p) => p !== null && p < rows.length);
  return { lag, streck };
}

async function fetchSeason(seasonId, current) {
  const divisions = await getJson(`${BASE}/Division?seasonId=${seasonId}`);
  if (!Array.isArray(divisions) || divisions.length === 0) {
    throw new Error(`BITS returned no divisions for ${seasonId}`);
  }
  const wanted = divisions
    .map((d, order) => ({ id: Number(d.divisionId), namn: d.divisionName.trim(), grupp: groupOf(d.divisionName), order }))
    .filter((d) => d.grupp && d.id !== NORDALLSVENSKAN);

  const serier = [];
  for (const d of wanted) {
    await sleep(PAUSE_MS);
    const s = await fetchStandings(d.id, seasonId);
    // Leagues BITS lists but never played (no table) are skipped.
    if (!s) continue;
    serier.push({ divisionId: d.id, namn: d.namn, grupp: d.grupp, order: d.order, ...s });
  }
  // Group order first, then the order BITS lists them in (roughly north → south).
  serier.sort((a, b) => GROUPS.indexOf(a.grupp) - GROUPS.indexOf(b.grupp) || a.order - b.order);
  for (const s of serier) delete s.order;

  return {
    saesongId: seasonId,
    saesong: seasonLabel(seasonId),
    pagaende: current,
    uppdaterad: today(),
    serier,
  };
}

const fileFor = (id) => path.join(DIR, `${id}.json`);
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

async function main() {
  const checkOnly = process.argv.includes('--check');
  const current = currentSeason();
  if (!checkOnly) fs.mkdirSync(DIR, { recursive: true });

  let changed = 0;
  for (let id = current; id >= FIRST_SEASON; id--) {
    const isCurrent = id === current;
    const existing = readJson(fileFor(id));
    // A finished season is fetched once. One stored while it was still running
    // is fetched one last time, so the file ends up holding the final table.
    // Files saved before lagId/klubbId were stored are refetched once.
    const harIds = existing && existing.serier.every((s) => s.lag.every((l) => 'lagId' in l));
    if (existing && !isCurrent && !existing.pagaende && harIds) continue;

    const season = await fetchSeason(id, isCurrent);
    console.log(`${season.saesong}: ${season.serier.length} serier`);
    if (season.serier.length === 0) {
      console.log('  no tables — skipped (nothing written)');
      continue;
    }

    // Compare without the date, so a quiet week is not a commit.
    const same = existing && JSON.stringify({ ...existing, uppdaterad: null }) === JSON.stringify({ ...season, uppdaterad: null });
    if (same) {
      console.log('  unchanged');
      continue;
    }
    changed++;
    if (!checkOnly) fs.writeFileSync(fileFor(id), JSON.stringify(season) + '\n');
  }

  // index.json lists the seasons that have a file.
  const seasons = [];
  for (let id = current; id >= FIRST_SEASON; id--) {
    const s = checkOnly ? null : readJson(fileFor(id));
    if (s) seasons.push({ saesongId: id, saesong: s.saesong, pagaende: s.pagaende, antal: s.serier.length });
  }
  if (!checkOnly) {
    const indexFile = path.join(DIR, 'index.json');
    const next = JSON.stringify({ saesonger: seasons }, null, 2) + '\n';
    const prev = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
    if (next !== prev) fs.writeFileSync(indexFile, next);
  }

  console.log(checkOnly ? `\n--check: ${changed} season file(s) would change.` : `\n${changed} season file(s) written.`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
