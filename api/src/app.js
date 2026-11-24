// Zajednički kontekst API-ja: podešavanja iz okoline, Fastify instanca s pluginovima, keš prijava i
// pomoćne funkcije koje koristi više ruta. Rute su u src/rute/*.js, pozadinski poslovi u src/poslovi.js,
// a src/server.js ih sve spaja i pokreće. Pregled: docs/ARHITEKTURA.md.
import cluster from 'node:cluster';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { pool, q, uTransakciji } from './db.js';
import { sendMail } from './mail.js';
import { cleanLine } from './nalog.js';
import { provjeriOkolinu } from './provjera.js';
import { bunnyOn, deleteFromBunny, mediaUrls } from './video.js';

export { cleanLine };

// Bez SMTP_URL i COOKIE_SECRET API u produkciji ne starta (S-01, S-07).
provjeriOkolinu();

/* ---------- podešavanja ---------- */

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB_DIR = path.join(ROOT, 'web');
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'api', 'uploads');
export const PORT = Number(process.env.PORT || 3002);
export const HOST = process.env.HOST || '127.0.0.1';
export const PROD = process.env.NODE_ENV === 'production';
export const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB || 100);
export const APP_URL = (process.env.APP_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const APP_ORIGIN = new URL(APP_URL).origin;
// Potpis kolačića `did` (S-07). U produkciji obavezan (provjera.js); u razvoju stalan razvojni ključ, da
// svi procesi (WORKERS) prihvataju isti potpis.
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'komodo-razvoj-nije-tajna-ne-koristiti-u-produkciji';
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean);
const SESSION_DAYS = 30;
export const MIN = 60 * 1000;

export const CATEGORIES = [
  'Haljine', 'Jakne i kaputi', 'Majice i košulje', 'Pantalone',
  'Obuća', 'Torbe', 'Nakit', 'Ostalo',
];
// Veličine (docs/SPEC-V1.md, F-03): odjeća + UNI, obuća 35–46. Redoslijed = redoslijed prikaza.
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'UNI',
  '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
// Filter veličina iz upita (`sizes=M,L`): najviše 6 poznatih vrijednosti, sortirano (za ključ keša); [] = bez filtera.
export function parseSizes(raw) {
  const out = [];
  for (const v of String(raw ?? '').slice(0, 200).split(',')) {
    const t = v.trim().toUpperCase();
    if (SIZES.includes(t) && !out.includes(t)) out.push(t);
    if (out.length === 6) break;
  }
  return out.sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b));
}
export const REPORT_REASONS = ['Neprimjeren sadržaj', 'Prevara ili lažan oglas', 'Uvredljiva poruka', 'Ostalo'];
export const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/* ---------- pomoćne funkcije ---------- */

// Broj milisekundi iz okoline; prazno ili neispravno → zadano (0 je dozvoljeno).
function msIzOkoline(ime, zadano) {
  const v = process.env[ime];
  return v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : zadano;
}

export function bad(reply, code, greska) {
  return reply.code(code).send({ greska });
}

// "65", "64,90", "64.9" ili broj -> feninzi (cijeli broj). null ako nije ispravno.
export function parsePrice(value) {
  const text = String(value ?? '').replace(/\s/g, '').replace(/km$/i, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(parseFloat(text) * 100);
  return cents > 0 ? cents : null;
}

// Lista linkova s profila: najviše 5, svaki http(s). Vraća null ako neki nije ispravan.
export function normalizeLinks(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const raw of input) {
    let text = String(raw ?? '').trim();
    if (!text) continue;
    if (text.length > 200 || /\s/.test(text)) return null;
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    let url;
    try { url = new URL(text); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out.length <= 5 ? out : null;
}

export function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

export function isId(value) {
  return /^\d{1,9}$/.test(String(value ?? ''));
}

// Administrator: adresa iz ADMIN_EMAILS i potvrđen email (S-01). Bez potvrde bi administrator postao ko
// god prvi registruje tu adresu.
export function isAdmin(u) {
  return !!u && u.email_verified_at !== null && u.email_verified_at !== undefined && ADMIN_EMAILS.includes(u.email);
}

// Ograničenje učestalosti u bazi (tabela rate_limits), zajedničko za sve procese.
// Fiksni prozor: prvi pokušaj otvara prozor od `windowMs`; kad istekne, brojanje kreće ispočetka.
// Vraća true ako je ključ prešao `max` pokušaja u trenutnom prozoru.
export async function limited(key, max, windowMs) {
  // Imenovane naredbe (ovdje, sviđanja, pregledi, jedan oglas): plan se pravi jednom po vezi; najčešći upiti API-ja.
  // Samo za upite s izričito navedenim kolonama (ne `*`), da izmjena šeme ne pokvari pripremljen plan.
  const res = await q({
    name: 'ogranicenje',
    text: `insert into rate_limits(key, window_start, hits) values ($1, now(), 1)
     on conflict (key) do update set
       hits = case when rate_limits.window_start <= now() - make_interval(secs => $2) then 1 else rate_limits.hits + 1 end,
       window_start = case when rate_limits.window_start <= now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning hits`,
    values: [key, windowMs / 1000],
  });
  return res.rows[0].hits > max;
}

// Ograničena mapa (keš): kad pređe `limit` unosa, izbacuju se najstariji upisani.
export function boundedSet(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.shop_name, handle: u.handle, role: u.role,
    phone: u.phone, links: u.links, city: u.city,
    verified: u.email_verified_at !== null, admin: isAdmin(u), pushEnabled: u.push_enabled !== false,
    // v1 (docs/SPEC-V1.md, F-04, F-05)
    address: u.address ?? '', hours: u.hours ?? null,
    followingCount: Number(u.following_count ?? 0),
  };
}

// Precrtana cijena (F-07): samo dok je sniženje mlađe od 7 dana i stara cijena veća od trenutne.
const DROP_DAYS = 7;
function oldPrice(r) {
  if (!r.old_price_cents || !r.price_dropped_at || r.old_price_cents <= r.price_cents) return null;
  if (Date.now() - new Date(r.price_dropped_at).getTime() > DROP_DAYS * 24 * 3600 * 1000) return null;
  return r.old_price_cents / 100;
}

export function publicListing(r) {
  return {
    id: r.id,
    title: r.title,
    price: r.price_cents / 100,
    category: r.category,
    ...mediaUrls(r),
    processing: r.video_status === 'processing',
    videoError: r.video_status === 'error',
    createdAt: r.created_at,
    shopName: r.shop_name,
    handle: r.handle,
    likes: Number(r.likes_count),
    liked: r.liked === true,
    mine: r.mine === true,
    sold: r.sold === true,
    views: r.mine === true ? r.views : undefined,
    // v1 (docs/SPEC-V1.md, F-03, F-07)
    sizes: Array.isArray(r.sizes) ? r.sizes : [],
    oldPrice: oldPrice(r),
    soldAt: r.sold === true && r.sold_at ? r.sold_at : null,
    // R2-07: samo vlasniku — da li bi sniženje sada poslalo push (cijena važi bar 72 h); forma izmjene to kaže.
    pushSnizenje: r.mine === true && r.price_set_at ? Date.now() - new Date(r.price_set_at).getTime() >= 72 * 3600 * 1000 : undefined,
  };
}

// Ko vidi oglas (docs/PLAN-PRODUKCIJA.md, odjeljak 4): kad je Bunny uključen, oglas čiji snimak nije
// gotov (obrada ili greška) vidi samo vlasnik; ostali ga vide tek kad je snimak na Bunnyju, da hiljade
// ljudi ne vuku isti fajl s našeg servera. Bez Bunnyja (razvoj) snimak je odmah gotov, pa ostaje staro
// pravilo: grešku vidi samo vlasnik. `$1` je id gledaoca (0 za neprijavljenog i za javni keš feeda, pa
// keš nikad ne sadrži oglas u obradi).
export const VISIBLE_SQL = bunnyOn
  ? "(l.video_status = 'ready' or l.user_id = $1)"
  : "(l.video_status <> 'error' or l.user_id = $1)";

export const LISTING_SELECT = `
  select l.id, l.user_id, l.title, l.price_cents, l.category, l.video_path, l.created_at, l.sold, l.views,
         l.video_provider, l.video_status, l.bunny_guid, l.video_res,
         (l.likes_count + coalesce((select sum(dd.delta) from listing_likes_delta dd where dd.listing_id = l.id), 0))::int as likes_count,
         l.sizes, l.sold_at, l.old_price_cents, l.price_dropped_at, l.price_set_at,
         u.shop_name, u.handle,
         exists(select 1 from likes k where k.listing_id = l.id and k.user_id = $1) as liked,
         (l.user_id = $1) as mine
    from listings l
    join users u on u.id = l.user_id
   where l.deleted_at is null and u.suspended_at is null
     and ${VISIBLE_SQL}`;

export const VIDEO_COLS = 'id, video_path, video_provider, bunny_guid';

// Izvršava fn(client) u jednoj transakciji i vraća njen rezultat.
export async function inTransaction(fn) {
  return uTransakciji(pool, fn);
}

/* ---------- aplikacija ---------- */

// Svaki uspješan zahtjev se ne zapisuje (skupo pri hiljadama zahtjeva u sekundi); LOG_REQUESTS=1 ga uključuje.
// Greške se i dalje bilježe (setErrorHandler u src/server.js).
export const app = Fastify({
  // Jedan proxy ispred (Nginx, koji sam upisuje X-Forwarded-For $remote_addr): vjeruje se samo direktnom
  // sagovorniku (hop 0), pa je req.ip zadnja adresa u X-Forwarded-For — ona koju je upisao proxy, ne ono
  // što je poslao klijent (S-02). Funkcija, jer `trustProxy: 1` u Fastify 5.12.8 izmjereno ne čita
  // zaglavlje uopšte (req.ip ostaje 127.0.0.1). Bez proxyja (razvoj) zaglavlje se ne gleda.
  logger: true, bodyLimit: 64 * 1024, trustProxy: PROD ? (addr, hop) => hop === 0 : false,
  logController: new LogController({ disableRequestLogging: process.env.LOG_REQUESTS !== '1' }),
  // Rokovi za HTTP (talas 4): veza bez ijednog bajta HTTP_CONNECTION_TIMEOUT_MS (zadano 120 s) se zatvara —
  // to je rok neaktivnosti, pa spor upload videa (110 MB na sporoj vezi) prolazi dok god podaci teku. Cijeli
  // zahtjev (zaglavlja + tijelo) mora stići za HTTP_REQUEST_TIMEOUT_MS (zadano 30 min, dovoljno za 110 MB pri
  // ~0,5 Mbit/s). Ispred je Nginx sa svojim rokovima (client_body_timeout, server/nginx-komodo.conf).
  // 0 isključuje rok.
  connectionTimeout: msIzOkoline('HTTP_CONNECTION_TIMEOUT_MS', 120 * 1000),
  requestTimeout: msIzOkoline('HTTP_REQUEST_TIMEOUT_MS', 30 * 60 * 1000),
});

/* ---------- režim rada („veliki crveni prekidač”, talas 4) ---------- */

// normalno | stedi | hitno. Izvor: red 'rezim' u app_settings (administrator, POST /api/admin/rezim), inače
// KOMODO_REZIM iz okoline. Svaki proces drži vrijednost u memoriji: učita je pri startu i svakih 30 s, a promjenu
// iz administracije dobija odmah preko javiSvima('rezim'). Šta režim radi: src/rute/rezim.js i docs/RUNBOOK.md.
export const REZIMI = ['normalno', 'stedi', 'hitno'];
const rezimIzOkoline = REZIMI.includes(process.env.KOMODO_REZIM) ? process.env.KOMODO_REZIM : 'normalno';
let rezimSada = rezimIzOkoline;
export function rezim() { return rezimSada; }
export function rezimOkoline() { return rezimIzOkoline; }
export function postaviRezimOvdje(r) { rezimSada = REZIMI.includes(r) ? r : rezimIzOkoline; }

/* ---------- preopterećenje: 503 i Retry-After ---------- */

export const PREOPTERECEN = 'Server je trenutno preopterećen. Pokušaj ponovo za trenutak.';
// Retry-After uz nasumičan pomak, da se klijenti poslije pada ne vrate svi u istoj sekundi.
export function retryAfter(osnovaSek) {
  return String(Math.round(osnovaSek * (1 + Math.random())));
}
export function preopterecen(reply) {
  reply.header('Retry-After', retryAfter(5));
  return reply.code(503).send({ greska: PREOPTERECEN });
}

await mkdir(UPLOADS_DIR, { recursive: true });
await app.register(cookie, { secret: COOKIE_SECRET });

// Svi odgovori: nosniff (S-11). Zahtjevi koji mijenjaju stanje sa zaglavljem Origin moraju doći s
// vlastite adrese (S-12): APP_URL ili isti host kao u zahtjevu. Bez Origin (curl, testovi, stari
// preglednici za isti sajt) prolaze; od CSRF-a ih i dalje štiti SameSite=Lax.
export function ownOrigin(origin, host) {
  if (origin === APP_ORIGIN) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!host && u.host === host;
  } catch {
    return false;
  }
}
// Hook s povratnim pozivom (ne async): poziva se za svaki zahtjev, pa bez dodatnog Promisea.
app.addHook('onRequest', (req, reply, done) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return done();
  const origin = req.headers.origin;
  if (origin !== undefined && !ownOrigin(origin, req.headers.host)) {
    reply.code(403).send({ greska: 'Zahtjev nije dozvoljen.' });
    return;
  }
  done();
});
// Svaki 429 i 503 nosi Retry-After (klijent web/js/osnova.js ga poštuje). Ruta koja zna tačan prozor ga
// postavlja sama; inače 429 → ~60 s, 503 → ~10 s. Odgovori API-ja nose i X-Komodo-Rezim: klijent po njemu vidi
// promjenu režima odmah, bez čekanja periodičnog /api/config.
// Isti hook (jedan, bez obećanja za obične zahtjeve) pamti odgovor zahtjeva s Idempotency-Key (idempotentno ispod).
app.addHook('onSend', (req, reply, payload, done) => {
  const code = reply.statusCode;
  if ((code === 429 || code === 503) && !reply.hasHeader('retry-after')) reply.header('Retry-After', retryAfter(code === 429 ? 30 : 5));
  if (req.url.startsWith('/api/')) reply.header('X-Komodo-Rezim', rezimSada);
  const args = req.komodoIdem;
  if (!args) { done(null, payload); return; }
  // Odgovor zahtjeva koji je zauzeo ključ: 2xx se sačuva, sve ostalo briše ključ.
  req.komodoIdem = null;
  const sql = code >= 200 && code < 300 && typeof payload === 'string'
    ? q('update idempotency_keys set status = $4, odgovor = $5 where user_id = $1 and ruta = $2 and kljuc = $3', [...args, code, payload])
    : q('delete from idempotency_keys where user_id = $1 and ruta = $2 and kljuc = $3', args);
  sql.then(() => done(null, payload), () => done(null, payload));
});
await app.register(multipart, { limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1, fields: 10 } });
await app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/media/', decorateReply: false, maxAge: '7d' });
await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', index: false, cacheControl: false });

// Briše snimke obrisanih oglasa: lokalni fajl i, ako postoji, snimak na Bunnyju.
export async function removeListingFiles(rows, log = app.log) {
  for (const r of rows) {
    if (r.video_path) await unlink(path.join(UPLOADS_DIR, r.video_path)).catch(() => {});
    // Sličica za pregled linka (rute/og.js): UPLOADS_DIR/og/<id>.jpg
    if (r.id) await unlink(path.join(UPLOADS_DIR, 'og', `${r.id}.jpg`)).catch(() => {});
    if (r.bunny_guid) await deleteFromBunny(r.bunny_guid).catch((err) => log.warn(err, 'Snimak na Bunnyju nije obrisan'));
  }
}

/* ---------- poruke između procesa (cluster) ---------- */

// Keševi su u memoriji svakog procesa. Kad jedan proces nešto poništi (sesiju, korisnika, feed), javlja to
// ostalima: radnik → primarni proces (src/index.js) → svi ostali radnici. Bez clustera (npm run dev, testovi
// sa src/server.js) poruka se samo izvrši lokalno. Poruka: { komodo: { t: '<vrsta>', v: <vrijednost> } }.
const naPorukuFn = new Map();
export function naPoruku(vrsta, fn) {
  naPorukuFn.set(vrsta, fn);
}
export function javiSvima(vrsta, vrijednost) {
  if (cluster.isWorker && process.send && process.connected) {
    try { process.send({ komodo: { t: vrsta, v: vrijednost } }); } catch { /* primarni proces se gasi */ }
  }
}
process.on('message', (m) => {
  const fn = m && m.komodo && naPorukuFn.get(m.komodo.t);
  if (fn) fn(m.komodo.v);
});

/* ---------- prijava (sesije) ---------- */

// Keš prijava: token → korisnik (ili null), 15 sekundi, u memoriji svakog procesa posebno.
// Kod odjave, promjene lozinke, brisanja i gašenja naloga, izmjene profila i potvrde emaila keš se
// poništava odmah u procesu koji je obradio zahtjev, a ostali procesi dobijaju poruku (javiSvima, R-01)
// i poništavaju ga za nekoliko milisekundi. Zahtjev koji u tom razmaku upiše nešto s id-jem obrisanog
// korisnika dobija 401, ne 500 (onRoute ispod).
// Vraćeni objekat je zajednički za više zahtjeva i ne smije se mijenjati.
const USER_TTL = 15 * 1000;
const USER_CACHE_MAX = 50000;
const userCache = new Map();

// U bazi je sha256 tokena (S-18): ko dođe do kopije baze, nema važeće kolačiće.
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export async function currentUser(req) {
  const token = req.cookies.sid;
  if (!token || token.length > 200) return null;
  const hit = userCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  // Namjerno bez imenovane naredbe: `u.*` u pripremljenom planu bi pukao kad migracija doda kolonu u users.
  const res = await q(
    `select u.* from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now() and u.suspended_at is null`,
    [hashToken(token)],
  );
  const user = res.rows[0] || null;
  boundedSet(userCache, token, { user, exp: Date.now() + USER_TTL }, USER_CACHE_MAX);
  return user;
}

function forgetTokenHere(token) {
  if (token) userCache.delete(token);
}
// Poništava sve keširane sesije jednog korisnika (rijetke radnje, pa je prolaz kroz mapu prihvatljiv).
function forgetUserHere(userId) {
  for (const [token, hit] of userCache) {
    if (hit.user && hit.user.id === userId) userCache.delete(token);
  }
}
naPoruku('token', forgetTokenHere);
naPoruku('user', (id) => forgetUserHere(Number(id)));

export function forgetToken(token) {
  if (!token) return;
  forgetTokenHere(token);
  javiSvima('token', String(token).slice(0, 200));
}

export function forgetUser(userId) {
  forgetUserHere(userId);
  javiSvima('user', userId);
}

// R-01: upis s id-jem korisnika kojeg više nema (obrisan nalog, a sesija je još bila u kešu nekog procesa)
// pada na stranom ključu (23503). Tada se sesija provjerava u bazi mimo keša: ako više ne važi, odgovor je
// 401 umjesto 500. Važi za sve /api/ rute (sviđanje, pregled, poruka, praćenje…), pa ih ne treba mijenjati.
async function sessionGone(req) {
  const token = req.cookies && req.cookies.sid;
  if (!token || token.length > 200) return false;
  const res = await q(
    `select 1 from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now() and u.suspended_at is null`,
    [hashToken(token)],
  );
  return res.rowCount === 0;
}
app.addHook('onRoute', (route) => {
  if (!String(route.url || '').startsWith('/api/')) return;
  const handler = route.handler;
  route.handler = async function zasticeno(req, reply) {
    try {
      return await handler.call(this, req, reply);
    } catch (err) {
      if (err && err.code === '23503' && !reply.sent) {
        if (await sessionGone(req).catch(() => false)) {
          forgetToken(req.cookies.sid);
          return bad(reply, 401, 'Sesija je istekla. Prijavi se ponovo.');
        }
        // R2-06: sesija važi, a nestao je butik ili oglas na koji upis pokazuje (npr. praćenje butika koji
        // upravo briše nalog: upis čeka zaključan red butika i poslije brisanja pada na stranom ključu).
        const c = String(err.constraint || '');
        if (/_shop_id_fkey$/.test(c)) return bad(reply, 404, 'Ovaj butik ne postoji.');
        if (/_listing_id_fkey$/.test(c)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
      }
      throw err;
    }
  };
});

// Uređaj (kolačić `did`, potpisan COOKIE_SECRET-om, S-07): za brojanje pregleda neprijavljenih,
// ograničenje registracija po uređaju i poznate uređaje pri prijavi (S-04).
// knownDeviceId: id iz ispravno potpisanog kolačića ili null (ne postavlja kolačić).
export function knownDeviceId(req) {
  const raw = req.cookies.did;
  if (!raw || raw.length > 200) return null;
  const un = req.unsignCookie(raw);
  if (un.valid && /^[A-Za-z0-9_-]{16,64}$/.test(un.value)) return un.value;
  return null;
}

// deviceId: kao knownDeviceId, a ako ga nema (ili potpis nije ispravan) server napravi novi, postavi ga u
// odgovoru i označi zahtjev s req.freshDevice = true (takav uređaj se još ne broji kao gledalac).
export function deviceId(req, reply) {
  const known = knownDeviceId(req);
  if (known) return known;
  if (req.freshDeviceId) return req.freshDeviceId;
  const fresh = randomBytes(16).toString('base64url');
  reply.setCookie('did', fresh, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 365 * 24 * 3600, signed: true,
  });
  req.freshDevice = true;
  req.freshDeviceId = fresh;
  return fresh;
}

export async function startSession(reply, userId) {
  const token = randomBytes(32).toString('hex');
  await q(
    `insert into sessions(token, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS],
  );
  reply.setCookie('sid', token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function emailToken(userId, kind, hours) {
  const token = randomBytes(24).toString('hex');
  await q('delete from email_tokens where user_id = $1 and kind = $2', [userId, kind]);
  await q(
    `insert into email_tokens(token, user_id, kind, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [token, userId, kind, hours],
  );
  return token;
}

// Email za potvrdu. Link nosi token u fragmentu (#potvrda=…), koji preglednik ne šalje serveru, pa ne
// ulazi u dnevnik Nginxa ni u Referer (S-06); web ga šalje POST /api/auth/verify.
// Globalni budžet (S-03): preko MAIL_POTVRDA_SAT emailova za potvrdu u satu nalog nastaje, a email se ne
// šalje (korisnik ga kasnije traži dugmetom „Pošalji ponovo”). Vraća true ako je email poslan.
export async function sendVerification(log, user) {
  if (await limited('mail:potvrda:sat', Number(process.env.MAIL_POTVRDA_SAT || 300), 60 * MIN)) {
    log.warn('Budžet emailova za potvrdu je potrošen (MAIL_POTVRDA_SAT); email nije poslan');
    return false;
  }
  const token = await emailToken(user.id, 'potvrda', 72);
  await sendMail(log, {
    to: user.email,
    subject: 'Potvrdi email za Komodo',
    text: `Zdravo ${cleanLine(user.shop_name, 40)},\n\npotvrdi email dodirom na link:\n${APP_URL}/#potvrda=${token}\n\nLink vrijedi 3 dana. Ako nisi ti napravio nalog, zanemari ovu poruku.\n\nKomodo`,
  });
  return true;
}

/* ---------- poruke (zajedničko za /api/me, poruke i prijave) ---------- */

export const UNREAD_SQL = `exists(select 1 from messages m
   where m.conversation_id = c.id and m.sender_id <> $1
     and m.created_at > case when c.customer_id = $1 then c.customer_read_at else c.shop_read_at end)`;

export async function unreadCount(userId) {
  const res = await q(
    `select count(*) as n from conversations c
      where (c.customer_id = $1 or c.shop_id = $1) and ${UNREAD_SQL}`,
    [userId],
  );
  return Number(res.rows[0].n);
}

export async function myConversation(userId, id) {
  if (!isId(id)) return null;
  const res = await q(
    'select * from conversations where id = $1 and (customer_id = $2 or shop_id = $2)',
    [Number(id), userId],
  );
  return res.rows[0] || null;
}

/* ---------- ključ protiv duplog slanja (Idempotency-Key, talas 4) ---------- */

// POST poruke i POST /api/listings: klijent šalje zaglavlje Idempotency-Key (jedan ključ po radnji korisnika;
// web/js/poruke.js i objava.js). Isti ključ istog korisnika za istu rutu u 24 h vraća sačuvan odgovor (isti
// status i tijelo, zaglavlje Idempotent-Replay: true) bez ponovnog upisa. Dok prvi zahtjev još radi, drugi dobija
// 409 s Retry-After. Čuvaju se samo uspješni odgovori (2xx); greška (400, 429, 5xx, prekinut upload) briše ključ,
// pa isti ključ smije pokušati ponovo. Bez zaglavlja ruta radi kao ranije. Tabela idempotency_keys (013),
// čišćenje starijih od 24 h u poslovi.js.
const IDEM_RE = /^[A-Za-z0-9_-]{8,100}$/;
const IDEM_ZAGLAVLJEN_MIN = 35; // zahtjev „u toku” duže od roka za cijeli zahtjev (30 min) je mrtav

async function procitajTijeloDoKraja(req) {
  // Ponovljena objava (multipart): tijelo se pročita i baci, da klijent dobije odgovor, a ne prekinutu vezu.
  if (!req.isMultipart || !req.isMultipart()) return;
  try {
    for await (const part of req.parts()) { if (part.file) part.file.resume(); }
  } catch { /* klijent je prekinuo */ }
}

export function idempotentno(ruta, handler) {
  return async function sKljucem(req, reply) {
    const kljuc = req.headers['idempotency-key'];
    if (kljuc === undefined) return handler.call(this, req, reply);
    if (typeof kljuc !== 'string' || !IDEM_RE.test(kljuc)) return bad(reply, 400, 'Zaglavlje Idempotency-Key nije ispravno.');
    const user = await currentUser(req);
    if (!user) return handler.call(this, req, reply);
    const args = [user.id, ruta, kljuc];
    for (let pokusaj = 0; pokusaj < 3; pokusaj += 1) {
      const ins = await q(
        'insert into idempotency_keys(user_id, ruta, kljuc) values ($1, $2, $3) on conflict do nothing returning 1', args,
      );
      if (ins.rowCount === 1) {
        req.komodoIdem = args;
        try {
          return await handler.call(this, req, reply);
        } catch (err) {
          req.komodoIdem = null;
          await q('delete from idempotency_keys where user_id = $1 and ruta = $2 and kljuc = $3', args).catch(() => {});
          throw err;
        }
      }
      const old = await q(
        `select status, odgovor, created_at < now() - interval '24 hours' as star,
                (status is null and created_at < now() - make_interval(mins => $4)) as zaglavljen
           from idempotency_keys where user_id = $1 and ruta = $2 and kljuc = $3`,
        [...args, IDEM_ZAGLAVLJEN_MIN],
      );
      if (old.rowCount === 0) continue; // upravo obrisan (greška prvog zahtjeva): pokušaj ponovo
      const r = old.rows[0];
      if (r.star || r.zaglavljen) {
        await q('delete from idempotency_keys where user_id = $1 and ruta = $2 and kljuc = $3', args);
        continue;
      }
      await procitajTijeloDoKraja(req);
      if (r.status === null) {
        reply.header('Retry-After', '2');
        return bad(reply, 409, 'Ova radnja je već u toku. Sačekaj trenutak.');
      }
      reply.header('Idempotent-Replay', 'true').header('Content-Type', 'application/json; charset=utf-8');
      return reply.code(r.status).send(r.odgovor);
    }
    await procitajTijeloDoKraja(req);
    reply.header('Retry-After', '2');
    return bad(reply, 409, 'Ova radnja je već u toku. Sačekaj trenutak.');
  };
}

