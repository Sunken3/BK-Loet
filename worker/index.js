// Cloudflare Worker för BK Loet.
// Serverar de statiska filerna (index.html, data.json, images/ ...) via ASSETS
// och hanterar några dynamiska rutter:
//   POST /api/medlem        → sparar en obekräftad anmälan
//   GET  /api/medlemmar     → publik lista över bekräftade stödmedlemmar
//   GET  /admin             → lösenordsskyddad lista över anmälningar och medlemmar (+ CSV)
//   POST /admin/bekrafta    → markerar en anmälan som betald och delar ut medlemsnummer
//   POST /admin/ta-bort     → tar bort en obekräftad anmälan
//
// Statiska filer matchas automatiskt först; bara rutter utan matchande fil
// (som /api/medlem och /admin) når koden nedan.

// Obekräftade anmälningar äldre än så här rensas bort när /admin öppnas.
const RENSA_EFTER_DAGAR = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/medlem') {
      if (request.method !== 'POST') return textResponse('Method Not Allowed', 405);
      return handleMedlem(request, env);
    }

    if (url.pathname === '/api/medlemmar') {
      if (request.method !== 'GET') return textResponse('Method Not Allowed', 405);
      return handleMedlemmar(request, env);
    }

    if (url.pathname === '/admin') {
      if (request.method !== 'GET') return textResponse('Method Not Allowed', 405);
      return handleAdmin(request, env, url);
    }

    if (url.pathname === '/admin/bekrafta' || url.pathname === '/admin/ta-bort') {
      if (request.method !== 'POST') return textResponse('Method Not Allowed', 405);
      return handleAdminAction(request, env, url);
    }

    // Allt annat: låt de statiska filerna svara.
    return env.ASSETS.fetch(request);
  }
};

/* ============ POST /api/medlem ============ */
// Sparar anmälan som obekräftad (betald IS NULL). Klubben ser betalarens namn
// i Swish och bekräftar på /admin — först då delas medlemsnummer ut.

async function handleMedlem(request, env) {
  if (!env.DB) {
    return json({ error: 'Databasen är inte konfigurerad ännu.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ogiltig begäran.' }, 400);
  }

  const fornamn = String(body.fornamn || '').trim();
  const efternamn = String(body.efternamn || '').trim();
  const epost = String(body.epost || '').trim();
  const stad = String(body.stad || '').trim();
  const visa = body.visa_pa_webben ? 1 : 0;

  if (!fornamn || !efternamn || !epost || !stad) {
    return json({ error: 'Förnamn, efternamn, e-post och stad är obligatoriska.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) {
    return json({ error: 'Ogiltig e-postadress.' }, 400);
  }
  if (fornamn.length > 100 || efternamn.length > 100 || epost.length > 200 || stad.length > 100) {
    return json({ error: 'Ett fält är för långt.' }, 400);
  }

  try {
    await env.DB
      .prepare(
        'INSERT INTO medlemmar (fornamn, efternamn, epost, stad, visa_pa_webben, skapad) ' +
        'VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(fornamn, efternamn, epost, stad, visa, new Date().toISOString())
      .run();
    // Skicka tillbaka det sparade förnamnet så att rutan visar exakt
    // det namn som lagrats (inte något som kunde ha ändrats i webbläsaren).
    return json({ fornamn });
  } catch (err) {
    console.error('POST /api/medlem:', err);
    return json({ error: 'Kunde inte spara just nu. Försök igen.' }, 500);
  }
}

/* ============ GET /api/medlemmar (publik) ============ */
// Öppen lista som sponsorsidan hämtar. Returnerar ENDAST bekräftade medlemmar
// som kryssat i att de vill synas — och bara namn, stad och nummer (aldrig e-post).

async function handleMedlemmar(request, env) {
  if (!env.DB) return jsonNoStore([]);
  try {
    const { results } = await env.DB
      .prepare(
        'SELECT medlemsnummer, fornamn, efternamn, stad FROM medlemmar ' +
        'WHERE betald IS NOT NULL AND visa_pa_webben = 1 ORDER BY medlemsnummer ASC'
      )
      .all();
    const list = (results || []).map(r => ({
      nummer: r.medlemsnummer,
      medlemsnummer: nr(r.medlemsnummer),
      fornamn: r.fornamn,
      efternamn: r.efternamn,
      stad: r.stad || ''
    }));
    return jsonNoStore(list);
  } catch (err) {
    // Sponsorsidan visar en tom lista vid fel, men felet ska synas i loggen
    // och som 500 — inte döljas som en tom lista.
    console.error('GET /api/medlemmar:', err);
    return jsonNoStore({ error: 'Kunde inte läsa listan.' }, 500);
  }
}

/* ============ GET /admin ============ */

async function handleAdmin(request, env, url) {
  if (!authOk(request, env)) return authRequired();

  if (!env.DB) {
    return textResponse('Databasen är inte konfigurerad ännu.', 500);
  }

  try {
    const grans = new Date(Date.now() - RENSA_EFTER_DAGAR * 864e5).toISOString();
    await env.DB
      .prepare('DELETE FROM medlemmar WHERE betald IS NULL AND skapad < ?')
      .bind(grans)
      .run();

    const { results } = await env.DB
      .prepare(
        'SELECT nummer, fornamn, efternamn, epost, stad, visa_pa_webben, skapad, ' +
        'betald, medlemsnummer FROM medlemmar'
      )
      .all();
    const rows = results || [];
    const vantar = rows.filter(r => !r.betald).sort((a, b) => String(a.skapad).localeCompare(String(b.skapad)));
    const medlemmar = rows.filter(r => r.betald).sort((a, b) => a.medlemsnummer - b.medlemsnummer);

    if (url.searchParams.get('export') === 'csv') {
      return csvResponse(medlemmar, vantar);
    }
    return htmlResponse(medlemmar, vantar, url.searchParams.get('meddelande'));
  } catch (err) {
    console.error('GET /admin:', err);
    return textResponse(
      'Kunde inte läsa databasen: ' + (err && err.message) +
      '\n\nHar migration-betalning.sql körts i D1-konsolen? Se MEDLEMSKAP-SETUP.md.',
      500
    );
  }
}

/* ============ POST /admin/bekrafta, /admin/ta-bort ============ */

async function handleAdminAction(request, env, url) {
  if (!authOk(request, env)) return authRequired();
  // Webbläsaren skickar Basic Auth-uppgifterna automatiskt, även när en annan
  // sajt postar hit. Godta därför bara formulär som kommer från /admin själv.
  if (!sammaUrsprung(request, url)) return textResponse('Förbjuden begäran.', 403);
  if (!env.DB) return textResponse('Databasen är inte konfigurerad ännu.', 500);

  let id;
  try {
    const form = await request.formData();
    id = parseInt(form.get('id'), 10);
  } catch {
    id = NaN;
  }
  if (!Number.isInteger(id)) return redirect('/admin?meddelande=fel');

  try {
    if (url.pathname === '/admin/bekrafta') {
      // Ett enda UPDATE: nästa lediga medlemsnummer räknas ut i samma sats,
      // och `betald IS NULL` gör att en redan bekräftad rad inte får ett nytt.
      const res = await env.DB
        .prepare(
          'UPDATE medlemmar SET betald = ?, ' +
          'medlemsnummer = (SELECT COALESCE(MAX(medlemsnummer), 0) + 1 FROM medlemmar) ' +
          'WHERE nummer = ? AND betald IS NULL'
        )
        .bind(new Date().toISOString(), id)
        .run();
      return redirect('/admin?meddelande=' + (res.meta.changes ? 'bekraftad' : 'fel'));
    }

    const res = await env.DB
      .prepare('DELETE FROM medlemmar WHERE nummer = ? AND betald IS NULL')
      .bind(id)
      .run();
    return redirect('/admin?meddelande=' + (res.meta.changes ? 'borttagen' : 'fel'));
  } catch (err) {
    console.error(url.pathname + ':', err);
    return redirect('/admin?meddelande=fel');
  }
}

function sammaUrsprung(request, url) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === url.origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

function authRequired() {
  return new Response('Åtkomst nekad.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="BK Loet admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}

function authOk(request, env) {
  const pass = env.ADMIN_PASSWORD;
  if (!pass) return false; // inget lösenord satt = ingen kommer in
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  const provided = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  return provided === pass;
}

/* ============ Hjälpare ============ */

function nr(n) {
  return String(n).padStart(3, '0');
}

function datum(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// Som json() men utan cachning, så nya stödmedlemmar syns direkt.
function jsonNoStore(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function csvResponse(medlemmar, vantar) {
  const head = ['Medlemsnummer', 'Status', 'Förnamn', 'Efternamn', 'Stad', 'E-post', 'Visa på webben', 'Anmäld', 'Betald'];
  const lines = [head.join(',')];
  for (const r of [...medlemmar, ...vantar]) {
    lines.push([
      r.betald ? nr(r.medlemsnummer) : '',
      r.betald ? 'Betald' : 'Väntar på betalning',
      r.fornamn,
      r.efternamn,
      r.stad,
      r.epost,
      r.visa_pa_webben ? 'Ja' : 'Nej',
      datum(r.skapad),
      datum(r.betald)
    ].map(csvCell).join(','));
  }
  // BOM så att Excel öppnar åäö korrekt
  const bomBody = '﻿' + lines.join('\r\n');
  return new Response(bomBody, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="stodmedlemmar.csv"'
    }
  });
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MEDDELANDEN = {
  bekraftad: { klass: 'ok', text: 'Betalningen är bekräftad och medlemmen har fått sitt nummer.' },
  borttagen: { klass: 'ok', text: 'Anmälan är borttagen.' },
  fel: { klass: 'fel', text: 'Det gick inte — anmälan kan redan vara bekräftad eller borttagen. Ladda om sidan.' }
};

function htmlResponse(medlemmar, vantar, meddelande) {
  const visaAntal = medlemmar.filter(r => r.visa_pa_webben).length;
  const visa = r => r.visa_pa_webben ? '<span class="ja">Ja</span>' : '<span class="nej">Nej</span>';

  const vantarRader = vantar.map(r => `
        <tr>
          <td class="namn">${esc(r.fornamn)} ${esc(r.efternamn)}</td>
          <td>${esc(r.stad)}</td>
          <td><a href="mailto:${esc(r.epost)}">${esc(r.epost)}</a></td>
          <td class="mitt">${visa(r)}</td>
          <td class="mitt">${esc(datum(r.skapad))}</td>
          <td class="knappar">
            <form method="post" action="/admin/bekrafta">
              <input type="hidden" name="id" value="${esc(r.nummer)}">
              <button class="btn-ok" type="submit">Bekräfta</button>
            </form>
            <form method="post" action="/admin/ta-bort" data-fraga="Ta bort anmälan från ${esc(r.fornamn)} ${esc(r.efternamn)}?" onsubmit="return confirm(this.dataset.fraga)">
              <input type="hidden" name="id" value="${esc(r.nummer)}">
              <button class="btn-ta-bort" type="submit">Ta bort</button>
            </form>
          </td>
        </tr>`).join('');

  const medlemRader = medlemmar.map(r => `
        <tr>
          <td class="nr">${nr(r.medlemsnummer)}</td>
          <td>${esc(r.fornamn)} ${esc(r.efternamn)}</td>
          <td>${esc(r.stad)}</td>
          <td><a href="mailto:${esc(r.epost)}">${esc(r.epost)}</a></td>
          <td class="mitt">${visa(r)}</td>
          <td class="mitt">${esc(datum(r.betald))}</td>
        </tr>`).join('');

  const m = MEDDELANDEN[meddelande];
  const banner = m ? `<div class="banner ${m.klass}">${esc(m.text)}</div>` : '';

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Stödmedlemmar — BK Loet</title>
<style>
  :root { --navy:#0a1f4d; --gold:#f5c518; --gray:#f4f5f7; --line:#e5e7eb; --muted:#6b7280; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:var(--navy); background:var(--gray); padding:2rem 1rem; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:1.6rem; margin:0 0 0.25rem; }
  h2 { font-size:1.1rem; margin:2rem 0 0.25rem; }
  .sub { color:var(--muted); margin:0 0 1.5rem; font-size:0.9rem; }
  .hjalp { color:var(--muted); margin:0 0 0.75rem; font-size:0.85rem; }
  .stats { display:flex; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap; }
  .stat { background:#fff; border:1px solid var(--line); border-radius:12px; padding:1rem 1.5rem; }
  .stat b { display:block; font-size:2rem; line-height:1; }
  .stat span { color:var(--muted); font-size:0.8rem; text-transform:uppercase; letter-spacing:0.08em; }
  .stat.vantar b { color:#b45309; }
  .toolbar { margin-bottom:1rem; }
  .btn { display:inline-block; background:var(--navy); color:#fff; text-decoration:none; padding:0.6rem 1.1rem; border-radius:8px; font-weight:600; font-size:0.9rem; }
  .btn:hover { background:#12306e; }
  .banner { padding:0.75rem 1rem; border-radius:8px; margin-bottom:1rem; font-size:0.9rem; font-weight:600; }
  .banner.ok { background:#dcfce7; color:#166534; }
  .banner.fel { background:#fee2e2; color:#991b1b; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { text-align:left; padding:0.75rem 1rem; border-bottom:1px solid var(--line); font-size:0.9rem; }
  th { background:var(--navy); color:#fff; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; }
  .vantar-tabell th { background:#b45309; }
  tr:last-child td { border-bottom:none; }
  td.nr { font-variant-numeric:tabular-nums; font-weight:700; }
  td.namn { font-weight:700; }
  td.mitt { text-align:center; }
  td.knappar { white-space:nowrap; }
  td.knappar form { display:inline; }
  .btn-ok, .btn-ta-bort { border:0; border-radius:6px; padding:0.4rem 0.8rem; font-weight:600; font-size:0.8rem; cursor:pointer; font-family:inherit; }
  .btn-ok { background:#16a34a; color:#fff; }
  .btn-ok:hover { background:#15803d; }
  .btn-ta-bort { background:transparent; color:var(--muted); }
  .btn-ta-bort:hover { color:#b91c1c; }
  .ja { background:#dcfce7; color:#166534; padding:0.15rem 0.6rem; border-radius:999px; font-size:0.8rem; font-weight:600; }
  .nej { color:var(--muted); font-size:0.8rem; }
  .tomt { text-align:center; color:var(--muted); padding:2rem; }
  a { color:var(--navy); }
  .table-scroll { overflow-x:auto; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Stödmedlemmar</h1>
    <p class="sub">BK Loet — anmälningar via webben. Stäm av mot Swish och bekräfta de som betalat.</p>
    ${banner}
    <div class="stats">
      <div class="stat vantar"><b>${vantar.length}</b><span>Väntar på betalning</span></div>
      <div class="stat"><b>${medlemmar.length}</b><span>Stödmedlemmar</span></div>
      <div class="stat"><b>${visaAntal}</b><span>Syns på webben</span></div>
    </div>

    <h2>Väntar på betalning</h2>
    <p class="hjalp">Jämför namnen med betalningarna i Swish och tryck Bekräfta. Äldst överst. Obekräftade anmälningar rensas efter ${RENSA_EFTER_DAGAR} dagar.</p>
    <div class="table-scroll">
      <table class="vantar-tabell">
        <thead>
          <tr><th>Namn</th><th>Stad</th><th>E-post</th><th>Visa på webben</th><th>Anmäld</th><th></th></tr>
        </thead>
        <tbody>${vantar.length ? vantarRader : '<tr><td colspan="6" class="tomt">Inga anmälningar väntar.</td></tr>'}</tbody>
      </table>
    </div>

    <h2>Stödmedlemmar</h2>
    <p class="hjalp">Medlemsnumret delas ut i den ordning betalningarna bekräftas.</p>
    <div class="toolbar">
      <a class="btn" href="/admin?export=csv">⬇ Exportera CSV</a>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>Nr</th><th>Namn</th><th>Stad</th><th>E-post</th><th>Visa på webben</th><th>Betald</th></tr>
        </thead>
        <tbody>${medlemmar.length ? medlemRader : '<tr><td colspan="6" class="tomt">Inga stödmedlemmar ännu.</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
