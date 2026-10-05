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
 */

const fs = require('fs');
const path = require('path');

const SEASON_ID = 2026;
const DIVISION_ID = 2;
const TITLE = 'Nordallsvenskan';

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const ENDPOINT =
  `https://bits.swebowl.se/MiscFrontApiConnector/GetStandings` +
  `?divisionId=${DIVISION_ID}&seasonId=${SEASON_ID}`;

// 2026 -> "Säsong 2026/27"
function seasonLabel(seasonId) {
  return `Säsong ${seasonId}/${String((seasonId + 1) % 100).padStart(2, '0')}`;
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

async function fetchStandings() {
  const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`BITS responded ${res.status} ${res.statusText}`);

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      'BITS returned an empty table — check SEASON_ID/DIVISION_ID (new season?) ' +
      'before letting this overwrite data.json.'
    );
  }

  return rows.map((r) => {
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
  const lag = await fetchStandings();

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
    return;
  }

  if (checkOnly) {
    console.log('\n--check: data.json not written.');
    return;
  }

  const { start, end } = findTabellBlock(text);
  const updated = text.slice(0, start) + renderBlock(tabell) + text.slice(end);

  JSON.parse(updated); // throw rather than write broken JSON
  fs.writeFileSync(DATA_FILE, updated);
  console.log('\ndata.json updated.');
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
