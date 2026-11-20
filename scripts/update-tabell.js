#!/usr/bin/env node
/**
 * Pulls the league standings from BITS into data.json ("tabell").
 *
 *   node scripts/update-tabell.js           update data.json
 *   node scripts/update-tabell.js --check   print the table, write nothing
 *
 * Only the "tabell" block is rewritten — the rest of data.json is left byte
 * for byte as it was, so the diff stays small and hand-formatting survives.
 *
 * New season: bump SEASON_ID (BITS counts 2026 = the 2026/2027 season).
 * DIVISION_ID 2 = Nordallsvenskan.
 *
 * Also keeps tabeller.json — the final tables of earlier seasons
 * (FIRST_ARCHIVE_SEASON … SEASON_ID − 1) that tabell.html lets you pick.
 * A finished season never changes, so only seasons missing from the file are
 * fetched; after a SEASON_ID bump the season that just ended is added.
 */

const fs = require('fs');
const path = require('path');
const { bitsFetch } = require('./bits-fetch');

const SEASON_ID = 2026;
const DIVISION_ID = 2;
const TITLE = 'Nordallsvenskan';

// BITS has division 2 back to 2010, but 2010/11 and 2011/12 hold 15–18 teams
// and look like a merged league — not the same Nordallsvenskan.
const FIRST_ARCHIVE_SEASON = 2012;

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const ARCHIVE_FILE = path.join(__dirname, '..', 'tabeller.json');
const endpoint = (seasonId) =>
  `https://bits.swebowl.se/MiscFrontApiConnector/GetStandings` +
  `?divisionId=${DIVISION_ID}&seasonId=${seasonId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 2026 -> "Säsong 2026/27"
function seasonLabel(seasonId) {
  return `Säsong ${seasonId}/${String((seasonId + 1) % 100).padStart(2, '0')}`;
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

// Returns { lag, streck }. streck = the positions BITS draws a line under
// (e.g. [1, 6, 8]), so tables with a different number of teams get theirs right.
async function fetchStandings(seasonId) {
  const res = await bitsFetch(endpoint(seasonId), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`BITS responded ${res.status} ${res.statusText}`);

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      'BITS returned an empty table — check SEASON_ID/DIVISION_ID (new season?) ' +
      'before letting this overwrite data.json.'
    );
  }

  const lag = rows.map((r) => {
    const diff = Number(r.standingsDiff) || 0;
    return {
      namn: r.standingsTeamName,
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

// tabeller.json: { titel, saesonger: [{ saesongId, saesong, streck, lag }] },
// newest season first. Only seasons missing from the file are fetched.
async function updateArchive(checkOnly) {
  let archive = { titel: TITLE, saesonger: [] };
  if (fs.existsSync(ARCHIVE_FILE)) archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));

  // Keep only seasons inside the range (e.g. after FIRST_ARCHIVE_SEASON is raised).
  const kept = archive.saesonger.filter(
    (s) => s.saesongId >= FIRST_ARCHIVE_SEASON && s.saesongId < SEASON_ID
  );
  const have = new Set(kept.map((s) => s.saesongId));
  const missing = [];
  for (let id = SEASON_ID - 1; id >= FIRST_ARCHIVE_SEASON; id--) {
    if (!have.has(id)) missing.push(id);
  }

  console.log(`\nArchive (tabeller.json): ${kept.length} seasons stored, ${missing.length} missing.`);
  if (missing.length === 0 && kept.length === archive.saesonger.length) {
    console.log('Unchanged — tabeller.json left alone.');
    return;
  }

  const added = [];
  for (const id of missing) {
    const { lag, streck } = await fetchStandings(id);
    added.push({ saesongId: id, saesong: seasonLabel(id), streck, lag });
    console.log(`  + ${seasonLabel(id)}: ${lag.length} lag, etta ${lag[0].namn}`);
    await sleep(250);
  }

  if (checkOnly) {
    console.log('--check: tabeller.json not written.');
    return;
  }
  const next = {
    titel: TITLE,
    saesonger: [...kept, ...added].sort((a, b) => b.saesongId - a.saesongId),
  };
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(next, null, 2) + '\n');
  console.log('tabeller.json updated.');
}

// Locate the "tabell" block in the raw text by counting braces, so everything
// outside it can be left untouched.
function findTabellBlock(text) {
  const start = text.indexOf('\n  "tabell": {');
  if (start === -1) throw new Error('Could not find "tabell" in data.json');

  let depth = 0;
  let i = text.indexOf('{', start);
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('Unbalanced braces in the "tabell" block');

  return { start: start + 1, end: i + 1 };
}

function renderBlock(tabell) {
  const teams = tabell.lag
    .map((l) =>
      [
        '      {',
        `        "namn": ${JSON.stringify(l.namn)},`,
        `        "matcher": ${l.matcher},`,
        `        "vinster": ${l.vinster},`,
        `        "oavgjorda": ${l.oavgjorda},`,
        `        "forluster": ${l.forluster},`,
        `        "skillnad": ${JSON.stringify(l.skillnad)},`,
        `        "poang": ${l.poang}`,
        '      }',
      ].join('\n')
    )
    .join(',\n');

  return [
    '  "tabell": {',
    `    "titel": ${JSON.stringify(tabell.titel)},`,
    `    "saesong": ${JSON.stringify(tabell.saesong)},`,
    `    "uppdaterad": ${JSON.stringify(tabell.uppdaterad)},`,
    `    "kvalplatser": ${tabell.kvalplatser},`,
    '    "lag": [',
    teams,
    '    ]',
    '  }',
  ].join('\n');
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const { lag } = await fetchStandings(SEASON_ID);

  const text = fs.readFileSync(DATA_FILE, 'utf8');
  const current = JSON.parse(text).tabell;

  const tabell = {
    titel: TITLE,
    saesong: seasonLabel(SEASON_ID),
    uppdaterad: today(),
    kvalplatser: current.kvalplatser, // set by hand; BITS says nothing about it
    lag,
  };

  console.log(`${tabell.titel} — ${tabell.saesong}`);
  for (const [i, l] of lag.entries()) {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${l.namn.padEnd(16)} ` +
      `${l.matcher}  ${l.vinster}-${l.oavgjorda}-${l.forluster}  ` +
      `${l.skillnad.padStart(4)}  ${String(l.poang).padStart(2)}p`
    );
  }

  // Compare without "uppdaterad", otherwise every weekly run is a commit even
  // when nothing has been played.
  const withoutDate = (t) => JSON.stringify({ ...t, uppdaterad: null });
  if (withoutDate(current) === withoutDate(tabell)) {
    console.log('\nUnchanged — data.json left alone.');
  } else if (checkOnly) {
    console.log('\n--check: data.json not written.');
  } else {
    const { start, end } = findTabellBlock(text);
    const updated = text.slice(0, start) + renderBlock(tabell) + text.slice(end);

    JSON.parse(updated); // throw rather than write broken JSON
    fs.writeFileSync(DATA_FILE, updated);
    console.log('\ndata.json updated.');
  }

  await updateArchive(checkOnly);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
