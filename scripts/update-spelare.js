#!/usr/bin/env node
/**
 * Updates each player's snitt, spelstyrka and alder in data.json from the BITS
 * licence register.
 *
 *   node scripts/update-spelare.js           update data.json
 *   node scripts/update-spelare.js --check   print the changes, write nothing
 *
 * One POST to GetAllPlayerSearch returns every licensed BK Loet player with
 * licenceAverage (snitt), licenceSkillLevel (spelstyrka) and a date of birth,
 * so this costs a single request no matter how many players are on the page.
 *
 * Players are matched on "firstName surName" against the `namn` field in
 * data.json. A player BITS doesn't know is left untouched and reported — the
 * script never blanks a value it couldn't confirm.
 *
 * The age is computed from the register's date of birth and only the resulting
 * number is written — the date itself is never stored, nor is the licence
 * number. (The licence number also encodes the birth date, but with a
 * two-digit year: "M250799ANT01" is 25/07/99. That is ambiguous for young
 * players — a 2015 birth year reads as 15 — so the date field is used instead.)
 *
 * Values are replaced in place in the raw text rather than by re-serialising
 * the player objects, so bild, bild_zoom, favoritklot and the rest keep their
 * exact formatting.
 */

const fs = require('fs');
const path = require('path');

const CLUB = 'BK Loet';
const DATA_FILE = path.join(__dirname, '..', 'data.json');
const ENDPOINT = 'https://bits.swebowl.se/MiscFrontApiConnector/GetAllPlayerSearch';

// 213.87 -> "213,87"
function svNumber(n) {
  return Number(n).toFixed(2).replace('.', ',');
}

// Completed years between a date of birth and today, in Swedish local time so
// a birthday flips on the right day here rather than in UTC.
function ageFrom(birthIso, now = new Date()) {
  const born = new Date(birthIso);
  if (Number.isNaN(born.getTime())) return null;

  const idag = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
  let years = idag.getFullYear() - born.getFullYear();
  const months = idag.getMonth() - born.getMonth();
  if (months < 0 || (months === 0 && idag.getDate() < born.getDate())) years--;

  // Anything outside this is a parsing problem, not a bowler.
  return years >= 5 && years <= 110 ? years : null;
}

async function fetchRoster() {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      search: CLUB,
      TakeOnlyActive: true,
      take: '200',
      skip: 0,
      page: 1,
      pageSize: '200',
      sort: [{ field: 'firstName', dir: 'asc' }],
    }),
  });
  if (!res.ok) throw new Error(`BITS responded ${res.status} ${res.statusText}`);

  const body = await res.json();
  const rows = Array.isArray(body.data) ? body.data : [];

  // `search` is a free-text match, so it can return other clubs too.
  const ours = rows.filter((r) => (r.clubName || '').trim() === CLUB);
  if (ours.length === 0) {
    throw new Error(
      `BITS returned no players for "${CLUB}" — refusing to touch data.json. ` +
      'Has the club name changed in the licence register?'
    );
  }
  return ours;
}

// Bounds of the player object that starts at the given "namn" match.
function playerBounds(text, namnIndex) {
  let start = text.lastIndexOf('{', namnIndex);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error('Unbalanced braces around a player object');
}

// Replaces every "<key>": "<value>" inside one player's object. Both the
// top-level spelstyrka and the copy some players carry under profil are hit,
// which is what keeps the two from drifting apart.
function setField(block, key, value) {
  const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`, 'g');
  if (!re.test(block)) return { block, hits: 0 };
  re.lastIndex = 0;
  let hits = 0;
  const out = block.replace(re, (_, prefix) => {
    hits++;
    return `${prefix}"${value}"`;
  });
  return { block: out, hits };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const roster = await fetchRoster();

  const byName = new Map(
    roster.map((r) => [`${(r.firstName || '').trim()} ${(r.surName || '').trim()}`.trim(), r])
  );

  let text = fs.readFileSync(DATA_FILE, 'utf8');
  const spelare = JSON.parse(text).spelare || [];

  const andrade = [];
  const saknas = [];
  const badAge = [];
  let oforandrade = 0;

  for (const p of spelare) {
    const b = byName.get(p.namn);
    if (!b) {
      saknas.push(p.namn);
      continue;
    }

    const nyttSnitt = svNumber(b.licenceAverage);
    const nyStyrka = svNumber(b.licenceSkillLevel);

    // An unreadable date of birth keeps the existing age rather than wiping it.
    const raknad = ageFrom(b.age);
    if (raknad === null) badAge.push(p.namn);
    const nyAlder = raknad === null ? p.alder : String(raknad);

    if (nyttSnitt === p.snitt && nyStyrka === p.spelstyrka && nyAlder === p.alder) {
      oforandrade++;
      continue;
    }

    andrade.push({
      namn: p.namn,
      snitt: [p.snitt, nyttSnitt],
      styrka: [p.spelstyrka, nyStyrka],
      alder: [p.alder, nyAlder],
    });

    // Locate this player's object by its exact namn value.
    const needle = `"namn": ${JSON.stringify(p.namn)}`;
    const at = text.indexOf(needle);
    if (at === -1) throw new Error(`Could not locate ${p.namn} in data.json`);

    const { start, end } = playerBounds(text, at);
    let block = text.slice(start, end);
    ({ block } = setField(block, 'snitt', nyttSnitt));
    ({ block } = setField(block, 'spelstyrka', nyStyrka));
    ({ block } = setField(block, 'alder', nyAlder));
    text = text.slice(0, start) + block + text.slice(end);
  }

  for (const { namn, snitt, styrka, alder } of andrade) {
    console.log(
      `  ${namn.padEnd(24)} snitt ${snitt[0].padStart(7)} -> ${snitt[1].padStart(7)}` +
      `   spelstyrka ${styrka[0].padStart(7)} -> ${styrka[1].padStart(7)}` +
      `   ålder ${alder[0].padStart(3)} -> ${alder[1].padStart(3)}`
    );
  }
  console.log(
    `${andrade.length} ändrade, ${oforandrade} oförändrade` +
    (saknas.length ? `, ${saknas.length} utan träff i BITS` : '')
  );

  if (saknas.length) {
    console.warn(`  ! Ingen BITS-licens hittades för: ${saknas.join(', ')} (värdena lämnas orörda)`);
  }
  if (badAge.length) {
    console.warn(`  ! Oläsbart födelsedatum för: ${badAge.join(', ')} (åldern lämnas orörd)`);
  }

  // Licensed players the site doesn't show — worth knowing, never added automatically
  // (a player card needs a photo, age and playing style that BITS does not have).
  const extra = [...byName.keys()].filter((n) => !spelare.some((p) => p.namn === n));
  if (extra.length) {
    console.log(`  i BITS men inte på Spelare-sidan: ${extra.join(', ')}`);
  }

  if (andrade.length === 0) {
    console.log('Unchanged — data.json left alone.');
    return;
  }
  if (checkOnly) {
    console.log('--check: data.json not written.');
    return;
  }

  JSON.parse(text); // throw rather than write broken JSON
  fs.writeFileSync(DATA_FILE, text);
  console.log('data.json updated.');
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
