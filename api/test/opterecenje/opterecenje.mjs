// Generator opterećenja za Komodo API (vidi README.md u ovom folderu).
// node test/opterecenje/opterecenje.mjs endpoint <ime> <istovremeno> <sekundi>   — jedna ruta, što brže
// node test/opterecenje/opterecenje.mjs mix <korisnika> <sekundi>                — realno ponašanje korisnika
//
// Okruženje:
//   BASE_URL     adresa API-ja (zadano http://127.0.0.1:3910; može i https://server)
//   LMIN, LMAX   raspon id-jeva oglasa (zadano 1–10000, kao napuni-bazu.mjs)
//   UMIN, UMAX   raspon id-jeva kupaca sa sesijom 'tok'||id (zadano 101–10100);
//                klijent šalje sid=tok<id>, a u bazi je sha256 heks tog tokena (napuni-bazu.mjs, migracija 010)
//   BUTIKA       broj butika butik1…butikN (zadano 100)
//   VIRAL        id oglasa za like_viral (zadano LMIN)
//   LIGHT=1      lakši klijent (tajmeri iz docs/SKALIRANJE.md); bez toga stari tajmeri
//   FEED=1       (uz LIGHT=1) klijent v1: strane iz /api/feed?kartica=zatebe s izuzmi, sviđanja svakih 30 s (B-01)
//   START_S      (uz LIGHT=1) korisnici otvaraju aplikaciju u nasumičnom trenutku 0–START_S s (zadano 30)
//   PROZORI=1    uz izvještaj p95 po prozorima od 15 s
// Izlazni kod 1 ako je bilo grešaka (5xx ili prekinuta veza).
import http from 'node:http';
import https from 'node:https';

const target = new URL(process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3910}`);
const lib = target.protocol === 'https:' ? https : http;
const BASE = { host: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80) };
const agent = new lib.Agent({ keepAlive: true, maxSockets: 4000 });
const LISTING_MIN = Number(process.env.LMIN || 1), LISTING_MAX = Number(process.env.LMAX || 10000);
const USER_MIN = Number(process.env.UMIN || 101), USER_MAX = Number(process.env.UMAX || 10100);
const BUTIKA = Number(process.env.BUTIKA || 100);
const VIRAL = Number(process.env.VIRAL || LISTING_MIN);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, path, { user, ip, body } = {}) {
  return new Promise((resolve) => {
    const t = process.hrtime.bigint();
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'X-Forwarded-For': ip || '10.0.0.1' };
    if (user) headers.Cookie = `sid=tok${user}`; // sirovi token; API ga u bazi traži kao sha256 heks
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const r = lib.request({ ...BASE, method, path, headers, agent }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - t) / 1e6, name: method + ' ' + path.split('?')[0].replace(/\d+/g, ':id') }));
    });
    r.on('error', () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - t) / 1e6, name: 'ERR' }));
    if (data) r.write(data);
    r.end();
  });
}

const stats = new Map();
// PROZORI=1: uz izvještaj i p95 po prozorima od 15 s (feed posebno, ostale rute zajedno).
const T_START = Date.now();
const prozori = new Map();
function rec(x) {
  const s = stats.get(x.name) || { n: 0, err: 0, ms: [] };
  s.n += 1; if (x.status === 0 || x.status >= 500) s.err += 1; s.ms.push(x.ms);
  stats.set(x.name, s);
  if (process.env.PROZORI === '1') {
    const w = Math.floor((Date.now() - T_START) / 15000);
    const k = `${/feed|listings$/.test(x.name) ? 'feed' : 'ostalo'}|${w}`;
    if (!prozori.has(k)) prozori.set(k, []);
    prozori.get(k).push(x.ms);
  }
}
function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; }
function report(secs) {
  let total = 0, errs = 0;
  const rows = [];
  for (const [name, s] of stats) {
    total += s.n; errs += s.err;
    rows.push(`${name.padEnd(40)} ${String(s.n).padStart(7)} zahtj. ${(s.n / secs).toFixed(0).padStart(6)}/s  p50 ${pct(s.ms, .5).toFixed(0).padStart(5)} ms  p95 ${pct(s.ms, .95).toFixed(0).padStart(5)} ms  p99 ${pct(s.ms, .99).toFixed(0).padStart(5)} ms  greške ${s.err}`);
  }
  rows.sort();
  console.log(rows.join('\n'));
  console.log(`UKUPNO ${total} zahtjeva, ${(total / secs).toFixed(0)}/s, greške ${errs}`);
  if (prozori.size) {
    for (const vrsta of ['feed', 'ostalo']) {
      const w = [...prozori.keys()].filter((k) => k.startsWith(`${vrsta}|`)).map((k) => Number(k.split('|')[1])).sort((a, b) => a - b);
      console.log(`p95 po 15 s (${vrsta}): ${w.map((i) => `${i * 15}s:${pct(prozori.get(`${vrsta}|${i}`), 0.95).toFixed(0)}/${prozori.get(`${vrsta}|${i}`).length}`).join(' ')}`);
    }
  }
  return errs;
}

const ids20 = () => Array.from({ length: 20 }, () => rnd(LISTING_MIN, LISTING_MAX)).join(',');
const ENDPOINTS = {
  feed_anon: () => req('GET', '/api/listings'),
  feed_user: (u) => req('GET', '/api/listings', { user: u, ip: `10.1.${u % 250}.${u % 200}` }),
  feed_page: (u) => req('GET', `/api/listings?before=${rnd(LISTING_MIN + 100, LISTING_MAX)}`, { user: u }),
  feed_category: (u) => req('GET', `/api/listings?category=${encodeURIComponent('Haljine')}&before=${rnd(LISTING_MIN + 500, LISTING_MAX)}`, { user: u }),
  search: (u) => req('GET', `/api/listings?q=${encodeURIComponent('butik' + rnd(1, BUTIKA))}`, { user: u }),
  likes_poll: (u) => req('GET', `/api/likes?ids=${ids20()}`, { user: u }),
  me: (u) => req('GET', '/api/me', { user: u }),
  like: (u) => req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/like`, { user: u }),
  // Vruć brojač (talas 4): hiljade različitih kupaca označavaju ISTI oglas (VIRAL, zadano LMIN). Prekidač, pa
  // svaki zahtjev stvarno mijenja red u likes i brojač — najgori slučaj za red oglasa u listings.
  like_viral: (u) => req('POST', `/api/listings/${VIRAL}/like`, { user: u }),
  view: (u) => req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/view`, { user: u, ip: `10.${rnd(0, 250)}.${rnd(0, 250)}.${rnd(1, 250)}` }),
  conversations: (u) => req('GET', '/api/conversations', { user: u }),
  shop: () => req('GET', `/api/listings?shop=butik${rnd(1, BUTIKA)}`),
  // F-01: /api/feed. izuzmi = 0–200 nasumičnih id-jeva (kao klijent poslije 0–10 strana).
  feed_zatebe_anon: () => req('GET', `/api/feed?izuzmi=${izuzmi(rnd(0, 10) * 20)}`),
  feed_zatebe: (u) => req('GET', `/api/feed?izuzmi=${izuzmi(rnd(0, 10) * 20)}`, { user: u, ip: `10.1.${u % 250}.${u % 200}` }),
  feed_zatebe_cat: (u) => req('GET', `/api/feed?category=${encodeURIComponent('Haljine')}&izuzmi=${izuzmi(rnd(0, 5) * 20)}`, { user: u }),
  feed_novo: (u) => req('GET', `/api/feed?kartica=novo&before=${rnd(LISTING_MIN + 100, LISTING_MAX)}`, { user: u }),
  feed_praceni: (u) => req('GET', '/api/feed?kartica=praceni', { user: u }),
};
function izuzmi(n) {
  return Array.from({ length: Math.min(200, n) }, () => rnd(LISTING_MIN, LISTING_MAX)).join(',');
}

async function endpoint(name, conc, secs) {
  const fn = ENDPOINTS[name];
  const end = Date.now() + secs * 1000;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (Date.now() < end) rec(await fn(rnd(USER_MIN, USER_MAX)));
  }));
  return report(secs);
}

// Jedan korisnik u feedu, po tajmerima starog klijenta (prije docs/SKALIRANJE.md):
// sviđanja svakih 5 s, /api/me svakih 30 s, novi video svakih ~8 s (pregled), nova strana svakih 20 videa,
// sviđanje otprilike svakog desetog videa.
async function vuser(u, end) {
  const ip = `10.${u % 250}.${Math.floor(u / 250) % 250}.${(u % 7) + 1}`;
  const o = { user: u, ip };
  await sleep(rnd(0, 5000));
  rec(await req('GET', '/api/me', o));
  rec(await req('GET', '/api/listings', o));
  let tLikes = Date.now() + 5000, tMe = Date.now() + 30000, tVideo = Date.now() + 8000, seen = 0;
  while (Date.now() < end) {
    const now = Date.now();
    if (now >= tLikes) { rec(await req('GET', `/api/likes?ids=${ids20()}`, o)); tLikes += 5000; }
    if (now >= tMe) { rec(await req('GET', '/api/me', o)); tMe += 30000; }
    if (now >= tVideo) {
      rec(await req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/view`, o));
      if (Math.random() < 0.1) rec(await req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/like`, o));
      seen += 1;
      if (seen % 20 === 0) rec(await req('GET', `/api/listings?before=${rnd(LISTING_MIN + 100, LISTING_MAX)}`, o));
      tVideo += rnd(6000, 10000);
    }
    await sleep(Math.max(50, Math.min(tLikes, tMe, tVideo) - Date.now()));
  }
}

// Lakša verzija klijenta (LIGHT=1): sviđanja samo za oglas na ekranu (15 s; s FEED=1 30 s), pregledi skupljeni u
// jedan zahtjev svakih 30 s, /api/me svakih 60 s, nova strana svakih 20 videa, sviđanje svakog 10. videa.
// Rasipanje kao pravi klijent (web/js/osnova.js, `tajmer`; nalaz iz docs/RECENZIJA-3.md, „Mjerenja”):
//   - korisnik otvara aplikaciju u nasumičnom trenutku 0–START_S s (zadano 30) — prva strana feeda i /api/me tada;
//   - prvi poziv svakog tajmera u nasumičnom trenutku 20–100 % intervala, svaki sljedeći interval ±20 %.
// Bez toga svi tajmeri 10.000 korisnika okidaju u istih 15 s i p95 mjeri sinhronizovane talase generatora, ne API.
// Sljedeća strana feeda dolazi poslije 20 videa (~160 s), pa mjerenje mora trajati ≥ 180 s (README.md).
const START_MS = Number(process.env.START_S ?? 30) * 1000;
const razmak = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4));
const prvi = (ms) => Math.round(ms * (0.2 + Math.random() * 0.8));
async function vuserLight(u, end) {
  const ip = `10.${u % 250}.${Math.floor(u / 250) % 250}.${(u % 7) + 1}`;
  const o = { user: u, ip };
  await sleep(rnd(0, START_MS));
  const FEED = process.env.FEED === '1';
  const LIKES_MS = FEED ? 30000 : 15000;
  const shown = [];
  const page = async () => {
    if (!FEED) return req('GET', shown.length ? `/api/listings?before=${rnd(LISTING_MIN + 100, LISTING_MAX)}` : '/api/listings', o);
    const r = await req('GET', `/api/feed${shown.length ? `?izuzmi=${shown.slice(-200).join(',')}` : ''}`, o);
    for (let k = 0; k < 20; k += 1) shown.push(rnd(LISTING_MIN, LISTING_MAX));
    return r;
  };
  rec(await req('GET', '/api/me', o));
  rec(await page());
  const t0 = Date.now();
  let tLikes = t0 + prvi(LIKES_MS), tMe = t0 + prvi(60000), tViews = t0 + prvi(30000), tVideo = t0 + rnd(6000, 10000), seen = 0;
  while (Date.now() < end) {
    const now = Date.now();
    if (now >= tLikes) { rec(await req('GET', `/api/likes?ids=${rnd(LISTING_MIN, LISTING_MAX)}`, o)); tLikes = Date.now() + razmak(LIKES_MS); }
    if (now >= tMe) { rec(await req('GET', '/api/me', o)); tMe = Date.now() + razmak(60000); }
    if (now >= tViews) { rec(await req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/view`, o)); tViews = Date.now() + razmak(30000); }
    if (now >= tVideo) {
      if (Math.random() < 0.1) rec(await req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/like`, o));
      seen += 1;
      if (seen % 20 === 0) rec(await page());
      tVideo += rnd(6000, 10000);
    }
    await sleep(Math.max(50, Math.min(tLikes, tMe, tViews, tVideo) - Date.now()));
  }
}

async function mix(n, secs) {
  const end = Date.now() + secs * 1000;
  const fn = process.env.LIGHT === '1' ? vuserLight : vuser;
  await Promise.all(Array.from({ length: n }, (_, k) => fn(USER_MIN + (k % (USER_MAX - USER_MIN + 1)), end)));
  return report(secs);
}

const [mode, a, b, c] = process.argv.slice(2);
let greske;
if (mode === 'endpoint' && ENDPOINTS[a] && Number(b) > 0 && Number(c) > 0) greske = await endpoint(a, Number(b), Number(c));
else if (mode === 'mix' && Number(a) > 0 && Number(b) > 0) {
  if (Number(b) < 180) console.error('Upozorenje: mix kraći od 180 s ne obuhvata sljedeće strane feeda (README.md); p95 nije uporediv.');
  greske = await mix(Number(a), Number(b));
}
else {
  console.error('Upotreba: opterecenje.mjs endpoint <' + Object.keys(ENDPOINTS).join('|') + '> <istovremeno> <sekundi>');
  console.error('          opterecenje.mjs mix <korisnika> <sekundi>');
  process.exit(2);
}
process.exit(greske > 0 ? 1 : 0);
