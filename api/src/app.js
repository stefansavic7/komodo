// Zajednički kontekst API-ja: podešavanja iz okoline, Fastify instanca s pluginovima, keš prijava i
// pomoćne funkcije koje koristi više ruta. Rute su u src/rute/*.js, pozadinski poslovi u src/poslovi.js,
// a src/server.js ih sve spaja i pokreće. Pregled: docs/ARHITEKTURA.md.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { pool, q } from './db.js';
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
export const REPORT_REASONS = ['Neprimjeren sadržaj', 'Prevara ili lažan oglas', 'Uvredljiva poruka', 'Ostalo'];
export const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/* ---------- pomoćne funkcije ---------- */

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
  const res = await q(
    `insert into rate_limits(key, window_start, hits) values ($1, now(), 1)
     on conflict (key) do update set
       hits = case when rate_limits.window_start <= now() - make_interval(secs => $2) then 1 else rate_limits.hits + 1 end,
       window_start = case when rate_limits.window_start <= now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning hits`,
    [key, windowMs / 1000],
  );
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
         l.video_provider, l.video_status, l.bunny_guid, l.video_res, l.likes_count,
         l.sizes, l.sold_at, l.old_price_cents, l.price_dropped_at,
         u.shop_name, u.handle,
         exists(select 1 from likes k where k.listing_id = l.id and k.user_id = $1) as liked,
         (l.user_id = $1) as mine
    from listings l
    join users u on u.id = l.user_id
   where l.deleted_at is null and u.suspended_at is null
     and ${VISIBLE_SQL}`;

export const VIDEO_COLS = 'video_path, video_provider, bunny_guid';

// Izvršava fn(client) u jednoj transakciji i vraća njen rezultat.
export async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
});

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
await app.register(multipart, { limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1, fields: 10 } });
await app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/media/', decorateReply: false, maxAge: '7d' });
await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', index: false });

// Briše snimke obrisanih oglasa: lokalni fajl i, ako postoji, snimak na Bunnyju.
export async function removeListingFiles(rows, log = app.log) {
  for (const r of rows) {
    if (r.video_path) await unlink(path.join(UPLOADS_DIR, r.video_path)).catch(() => {});
    if (r.bunny_guid) await deleteFromBunny(r.bunny_guid).catch((err) => log.warn(err, 'Snimak na Bunnyju nije obrisan'));
  }
}

/* ---------- prijava (sesije) ---------- */

// Keš prijava: token → korisnik (ili null), 15 sekundi, u memoriji svakog procesa posebno.
// Kod odjave, promjene lozinke, brisanja i gašenja naloga, izmjene profila i potvrde emaila keš se
// poništava odmah, ali samo u procesu koji je obradio zahtjev. Ostali procesi (src/index.js) mogu
// do 15 s vidjeti staro stanje (npr. odjavljena sesija još radi, stari naziv profila) — to je prihvaćeno.
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
  const res = await q(
    `select u.* from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now() and u.suspended_at is null`,
    [hashToken(token)],
  );
  const user = res.rows[0] || null;
  boundedSet(userCache, token, { user, exp: Date.now() + USER_TTL }, USER_CACHE_MAX);
  return user;
}

export function forgetToken(token) {
  if (token) userCache.delete(token);
}

// Poništava sve keširane sesije jednog korisnika (rijetke radnje, pa je prolaz kroz mapu prihvatljiv).
export function forgetUser(userId) {
  for (const [token, hit] of userCache) {
    if (hit.user && hit.user.id === userId) userCache.delete(token);
  }
}

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
