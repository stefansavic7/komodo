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
//   LIGHT=1      lakši klijent (tajmeri iz docs/SKALIRANJE.md); bez toga stari tajmeri
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
function rec(x) {
  const s = stats.get(x.name) || { n: 0, err: 0, ms: [] };
  s.n += 1; if (x.status === 0 || x.status >= 500) s.err += 1; s.ms.push(x.ms);
  stats.set(x.name, s);
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
  view: (u) => req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/view`, { user: u, ip: `10.${rnd(0, 250)}.${rnd(0, 250)}.${rnd(1, 250)}` }),
  conversations: (u) => req('GET', '/api/conversations', { user: u }),
  shop: () => req('GET', `/api/listings?shop=butik${rnd(1, BUTIKA)}`),
};

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

// Lakša verzija klijenta (prijedlog): sviđanja samo za oglas na ekranu svakih 15 s, pregledi skupljeni
// u jedan zahtjev svakih 30 s, /api/me svakih 60 s, nova strana svakih 20 videa, sviđanje svakog 10. videa.
async function vuserLight(u, end) {
  const ip = `10.${u % 250}.${Math.floor(u / 250) % 250}.${(u % 7) + 1}`;
  const o = { user: u, ip };
  await sleep(rnd(0, 15000));
  rec(await req('GET', '/api/me', o));
  rec(await req('GET', '/api/listings', o));
  let tLikes = Date.now() + 15000, tMe = Date.now() + 60000, tViews = Date.now() + 30000, tVideo = Date.now() + 8000, seen = 0;
  while (Date.now() < end) {
    const now = Date.now();
    if (now >= tLikes) { rec(await req('GET', `/api/likes?ids=${rnd(LISTING_MIN, LISTING_MAX)}`, o)); tLikes += 15000; }
    if (now >= tMe) { rec(await req('GET', '/api/me', o)); tMe += 60000; }
    if (now >= tViews) { rec(await req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/view`, o)); tViews += 30000; }
    if (now >= tVideo) {
      if (Math.random() < 0.1) rec(await req('POST', `/api/listings/${rnd(LISTING_MIN, LISTING_MAX)}/like`, o));
      seen += 1;
      if (seen % 20 === 0) rec(await req('GET', `/api/listings?before=${rnd(LISTING_MIN + 100, LISTING_MAX)}`, o));
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
else if (mode === 'mix' && Number(a) > 0 && Number(b) > 0) greske = await mix(Number(a), Number(b));
else {
  console.error('Upotreba: opterecenje.mjs endpoint <' + Object.keys(ENDPOINTS).join('|') + '> <istovremeno> <sekundi>');
  console.error('          opterecenje.mjs mix <korisnika> <sekundi>');
  process.exit(2);
}
process.exit(greske > 0 ? 1 : 0);
