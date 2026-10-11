// fetch() mot BITS med omförsök. BITS tappar ibland enstaka anslutningar
// ("fetch failed" utan HTTP-status), och ett enda sådant hack ska inte fälla
// hela veckokörningen. Försöker igen vid nätverksfel, 429 och 5xx — inte vid
// andra 4xx, de blir inte bättre av att upprepas.

const ATTEMPTS = 4;
const BASE_DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bitsFetch(url, options) {
  for (let attempt = 1; ; attempt++) {
    let reason;
    try {
      const res = await fetch(url, options);
      if (res.status !== 429 && res.status < 500) return res;
      reason = `HTTP ${res.status} ${res.statusText}`;
      if (attempt >= ATTEMPTS) return res;
    } catch (err) {
      // Node gömmer den riktiga orsaken (ECONNRESET, ETIMEDOUT …) i err.cause.
      const cause = err.cause && (err.cause.code || err.cause.message);
      reason = cause ? `${err.message} (${cause})` : err.message;
      if (attempt >= ATTEMPTS) throw new Error(reason);
    }
    const wait = BASE_DELAY_MS * 2 ** (attempt - 1);
    console.warn(`  ${reason} — försöker igen om ${wait / 1000} s (${attempt}/${ATTEMPTS - 1})`);
    await sleep(wait);
  }
}

module.exports = { bitsFetch };
