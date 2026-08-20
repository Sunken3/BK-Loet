// Cloudflare Worker för BK Loet.
// Serverar de statiska filerna (index.html, data.json, images/ ...) via ASSETS
// och hanterar två dynamiska rutter:
//   POST /api/medlem  → sparar en stödmedlem i D1 och delar ut löpnummer
//   GET  /admin       → lösenordsskyddad lista över alla stödmedlemmar (+ CSV)
//
// Statiska filer matchas automatiskt först; bara rutter utan matchande fil
// (som /api/medlem och /admin) når koden nedan.

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

    // Allt annat: låt de statiska filerna svara.
    return env.ASSETS.fetch(request);
  }
};

/* ============ POST /api/medlem ============ */

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
    const row = await env.DB
      .prepare(
        'INSERT INTO medlemmar (fornamn, efternamn, epost, stad, visa_pa_webben, skapad) ' +
        'VALUES (?, ?, ?, ?, ?, ?) RETURNING nummer'
      )
      .bind(fornamn, efternamn, epost, stad, visa, new Date().toISOString())
      .first();

    const nummer = row.nummer;
    // Skicka tillbaka det sparade förnamnet så att tack-rutan visar exakt
    // det namn som lagrats (inte något som kunde ha ändrats i webbläsaren).
    return json({ nummer, medlemsnummer: String(nummer).padStart(3, '0'), fornamn });
  } catch {
    return json({ error: 'Kunde inte spara just nu. Försök igen.' }, 500);
  }
}

/* ============ GET /api/medlemmar (publik) ============ */
// Öppen lista som sponsorsidan hämtar. Returnerar ENDAST de medlemmar som
// kryssat i att de vill synas — och bara namn, stad och nummer (aldrig e-post).

async function handleMedlemmar(request, env) {
  if (!env.DB) return jsonNoStore([]);
  try {
    const { results } = await env.DB
      .prepare(
        'SELECT nummer, fornamn, efternamn, stad FROM medlemmar ' +
        'WHERE visa_pa_webben = 1 ORDER BY nummer ASC'
      )
      .all();
    const list = (results || []).map(r => ({
      nummer: r.nummer,
      medlemsnummer: String(r.nummer).padStart(3, '0'),
      fornamn: r.fornamn,
      efternamn: r.efternamn,
      stad: r.stad || ''
    }));
    return jsonNoStore(list);
  } catch {
    return jsonNoStore([]);
  }
}

/* ============ GET /admin ============ */

async function handleAdmin(request, env, url) {
  if (!authOk(request, env)) {
    return new Response('Åtkomst nekad.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="BK Loet admin", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }

  if (!env.DB) {
    return textResponse('Databasen är inte konfigurerad ännu.', 500);
  }

  const { results } = await env.DB
    .prepare('SELECT nummer, fornamn, efternamn, epost, stad, visa_pa_webben, skapad FROM medlemmar ORDER BY nummer ASC')
    .all();

  if (url.searchParams.get('export') === 'csv') {
    return csvResponse(results || []);
  }
  return htmlResponse(results || []);
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

function csvResponse(rows) {
  const head = ['Medlemsnummer', 'Förnamn', 'Efternamn', 'Stad', 'E-post', 'Visa på webben', 'Datum'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      nr(r.nummer),
      r.fornamn,
      r.efternamn,
      r.stad,
      r.epost,
      r.visa_pa_webben ? 'Ja' : 'Nej',
      datum(r.skapad)
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
    .replace(/"/g, '&quot;');
}

function htmlResponse(rows) {
  const antal = rows.length;
  const visaAntal = rows.filter(r => r.visa_pa_webben).length;

  const trs = rows.map(r => `
        <tr>
          <td class="nr">${nr(r.nummer)}</td>
          <td>${esc(r.fornamn)} ${esc(r.efternamn)}</td>
          <td>${esc(r.stad)}</td>
          <td><a href="mailto:${esc(r.epost)}">${esc(r.epost)}</a></td>
          <td class="mitt">${r.visa_pa_webben ? '<span class="ja">Ja</span>' : '<span class="nej">Nej</span>'}</td>
          <td class="mitt">${esc(datum(r.skapad))}</td>
        </tr>`).join('');

  const tomt = `<tr><td colspan="6" class="tomt">Inga stödmedlemmar ännu.</td></tr>`;

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
  .wrap { max-width:900px; margin:0 auto; }
  h1 { font-size:1.6rem; margin:0 0 0.25rem; }
  .sub { color:var(--muted); margin:0 0 1.5rem; font-size:0.9rem; }
  .stats { display:flex; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap; }
  .stat { background:#fff; border:1px solid var(--line); border-radius:12px; padding:1rem 1.5rem; }
  .stat b { display:block; font-size:2rem; line-height:1; }
  .stat span { color:var(--muted); font-size:0.8rem; text-transform:uppercase; letter-spacing:0.08em; }
  .toolbar { margin-bottom:1rem; }
  .btn { display:inline-block; background:var(--navy); color:#fff; text-decoration:none; padding:0.6rem 1.1rem; border-radius:8px; font-weight:600; font-size:0.9rem; }
  .btn:hover { background:#12306e; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { text-align:left; padding:0.75rem 1rem; border-bottom:1px solid var(--line); font-size:0.9rem; }
  th { background:var(--navy); color:#fff; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; }
  tr:last-child td { border-bottom:none; }
  td.nr { font-variant-numeric:tabular-nums; font-weight:700; }
  td.mitt { text-align:center; }
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
    <p class="sub">BK Loet — automatisk lista över alla som blivit stödmedlem via webben.</p>
    <div class="stats">
      <div class="stat"><b>${antal}</b><span>Totalt</span></div>
      <div class="stat"><b>${visaAntal}</b><span>Vill synas på webben</span></div>
    </div>
    <div class="toolbar">
      <a class="btn" href="/admin?export=csv">⬇ Exportera CSV</a>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>Nr</th><th>Namn</th><th>Stad</th><th>E-post</th><th>Visa på webben</th><th>Datum</th></tr>
        </thead>
        <tbody>${antal ? trs : tomt}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
