#!/usr/bin/env node
/**
 * Pulls the division's matches and their match facts from BITS into matcher.json.
 *
 *   node scripts/update-matcher.js           update matcher.json
 *   node scripts/update-matcher.js --check   print a summary, write nothing
 *
 * matcher.json is read only by tabell.html, and only once the visitor clicks a
 * team — it is not part of the data.json that every page loads.
 *
 * Endpoints (same host as the standings; no API key, not bot-protected):
 *   ListMatches             — every match in the division, played and upcoming
 *   GetMatchResults         — the per-player series results for one match
 *   GetMatchHeadResultInfo  — the per-series team totals for one match
 *
 * Only played matches get their facts fetched. Facts already in matcher.json
 * are reused, so a weekly run only requests what is new.
 *
 * New season: bump SEASON_ID (BITS counts 2026 = the 2026/2027 season).
 */

const fs = require('fs');
const path = require('path');

const SEASON_ID = 2026;
const DIVISION_ID = 2;

const OUT_FILE = path.join(__dirname, '..', 'matcher.json');
const BASE = 'https://bits.swebowl.se/MiscFrontApiConnector';

// Be gentle with BITS — this walks every played match on a cold run.
const DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

// "Kristoffer Svonni (M080486KRI01)" -> "Kristoffer Svonni"
// The licence number is a personal identifier we have no use for.
function cleanPlayerName(raw) {
  return String(raw || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function listMatches(type, order) {
  return getJson(
    `${BASE}/ListMatches?divisionId=${DIVISION_ID}&seasonId=${SEASON_ID}` +
    `&matchType=${type}&sortOrder=${order}`
  );
}

function trimMatch(m) {
  return {
    id: m.matchId,
    omgang: m.matchRoundId,
    datum: (m.matchDateTime || m.matchDate || '').slice(0, 10),
    tid: (m.matchDateTime || '').slice(11, 16),
    hemma: m.matchHomeTeamName,
    borta: m.matchAwayTeamName,
    hall: m.matchHallName ? m.matchHallName.trim() : '',
    oljeprofil: m.matchOilPatternName || '',
    spelad: !!m.matchHasBeenPlayed,
    // Only meaningful once played
    hemmaPoang: m.matchHasBeenPlayed ? m.matchHomeTeamResult : null,
    bortaPoang: m.matchHasBeenPlayed ? m.matchAwayTeamResult : null,
    hemmaKaglor: m.matchHasBeenPlayed ? m.matchHomeTeamScore : null,
    bortaKaglor: m.matchHasBeenPlayed ? m.matchAwayTeamScore : null,
  };
}

function trimPlayers(list) {
  return (list || []).map((p) => ({
    namn: cleanPlayerName(p.player),
    serier: [p.result1, p.result2, p.result3, p.result4].map((n) => Number(n) || 0),
    total: Number(p.totalResult) || 0,
    banpoang: Number(p.lanePoint) || 0,
  }));
}

async function fetchFacts(match, schemeId) {
  const scheme = String(schemeId || '').trim();
  const [results, head] = await Promise.all([
    getJson(`${BASE}/GetMatchResults?matchId=${match.id}&matchSchemeId=${scheme}`),
    getJson(`${BASE}/GetMatchHeadResultInfo?id=${match.id}`),
  ]);

  const serier = (head.homeHeadDetails || []).map((h, i) => {
    const a = (head.awayHeadDetails || [])[i] || {};
    return {
      serie: h.squadId,
      hemmaKaglor: h.teamScore,
      bortaKaglor: a.teamScore,
      hemmaPoang: h.teamRP,
      bortaPoang: a.teamRP,
    };
  });

  return {
    serier,
    spelare: {
      hemma: trimPlayers(results.playerListHome),
      borta: trimPlayers(results.playerListAway),
    },
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  // Reuse facts we already have — a weekly run then only fetches new matches.
  let existing = { matcher: [] };
  if (fs.existsSync(OUT_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    } catch {
      console.warn('Could not parse existing matcher.json — refetching everything.');
    }
  }
  const known = new Map(
    (existing.matcher || []).filter((m) => m.spelare).map((m) => [m.id, m])
  );

  const [played, upcoming] = await Promise.all([
    listMatches('played', 'desc'),
    listMatches('upcoming', 'asc'),
  ]);

  if (!Array.isArray(played) || !Array.isArray(upcoming)) {
    throw new Error('Unexpected response from ListMatches');
  }
  if (played.length === 0 && upcoming.length === 0) {
    throw new Error(
      'BITS returned no matches at all — check SEASON_ID/DIVISION_ID (new season?) ' +
      'before letting this overwrite matcher.json.'
    );
  }

  const matcher = [];
  let fetched = 0;
  let reused = 0;

  for (const raw of [...played, ...upcoming]) {
    const m = trimMatch(raw);

    if (!m.spelad) {
      matcher.push(m);
      continue;
    }

    const cached = known.get(m.id);
    if (cached && cached.spelare) {
      matcher.push({ ...m, serier: cached.serier, spelare: cached.spelare });
      reused++;
      continue;
    }

    if (checkOnly) {
      matcher.push(m);
      fetched++;
      continue;
    }

    try {
      const facts = await fetchFacts(m, raw.matchSchemeId);
      matcher.push({ ...m, ...facts });
      fetched++;
      await sleep(DELAY_MS);
    } catch (err) {
      // One unavailable match must not sink the whole run.
      console.warn(`  ! match ${m.id} (${m.hemma}-${m.borta}): ${err.message}`);
      matcher.push(m);
    }
  }

  // Newest first, upcoming last.
  matcher.sort((a, b) => {
    if (a.spelad !== b.spelad) return a.spelad ? -1 : 1;
    return a.spelad ? b.datum.localeCompare(a.datum) : a.datum.localeCompare(b.datum);
  });

  const out = {
    uppdaterad: today(),
    saesong: `Säsong ${SEASON_ID}/${String((SEASON_ID + 1) % 100).padStart(2, '0')}`,
    matcher,
  };

  const spelade = matcher.filter((m) => m.spelad).length;
  console.log(
    `${matcher.length} matcher (${spelade} spelade, ${matcher.length - spelade} kommande) — ` +
    `${fetched} hämtade, ${reused} återanvända`
  );

  // Compare without "uppdaterad", otherwise every weekly run is a commit even
  // when nothing has been played.
  const withoutDate = (o) => JSON.stringify({ ...o, uppdaterad: null });
  if (withoutDate(existing) === withoutDate(out)) {
    console.log('Unchanged — matcher.json left alone.');
    return;
  }

  if (checkOnly) {
    console.log('--check: matcher.json not written.');
    return;
  }

  const json = JSON.stringify(out, null, 1) + '\n';
  fs.writeFileSync(OUT_FILE, json);
  console.log(`matcher.json written (${(json.length / 1024).toFixed(1)} kB).`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
