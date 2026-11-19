import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { migrate, pool, q } from './db.js';
import { mailOn, sendMail } from './mail.js';
import { checkPassword, createShop, hashPassword, insertUser, validEmail } from './nalog.js';
import { bunnyOn, bunnyState, deleteFromBunny, mediaUrls, uploadToBunny } from './video.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = path.join(ROOT, 'web');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'api', 'uploads');
const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '127.0.0.1';
const PROD = process.env.NODE_ENV === 'production';
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB || 100);
const APP_URL = (process.env.APP_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean);
const SESSION_DAYS = 30;
const MIN = 60 * 1000;

export const CATEGORIES = [
  'Haljine', 'Jakne i kaputi', 'Majice i košulje', 'Pantalone',
  'Obuća', 'Torbe', 'Nakit', 'Ostalo',
];
const REPORT_REASONS = ['Neprimjeren sadržaj', 'Prevara ili lažan oglas', 'Uvredljiva poruka', 'Ostalo'];
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/* ---------- pomoćne funkcije ---------- */

function bad(reply, code, greska) {
  return reply.code(code).send({ greska });
}

// "65", "64,90", "64.9" ili broj -> feninzi (cijeli broj). null ako nije ispravno.
function parsePrice(value) {
  const text = String(value ?? '').replace(/\s/g, '').replace(/km$/i, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(parseFloat(text) * 100);
  return cents > 0 ? cents : null;
}

// Lista linkova s profila: najviše 5, svaki http(s). Vraća null ako neki nije ispravan.
function normalizeLinks(input) {
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

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function isId(value) {
  return /^\d{1,9}$/.test(String(value ?? ''));
}

function isAdmin(u) {
  return !!u && ADMIN_EMAILS.includes(u.email);
}

// Ograničenje učestalosti u bazi (tabela rate_limits), zajedničko za sve procese.
// Fiksni prozor: prvi pokušaj otvara prozor od `windowMs`; kad istekne, brojanje kreće ispočetka.
// Vraća true ako je ključ prešao `max` pokušaja u trenutnom prozoru.
async function limited(key, max, windowMs) {
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
function boundedSet(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.shop_name, handle: u.handle, role: u.role,
    phone: u.phone, links: u.links, city: u.city,
    verified: u.email_verified_at !== null, admin: isAdmin(u), pushEnabled: u.push_enabled !== false,
  };
}

function publicListing(r) {
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
  };
}

const LISTING_SELECT = `
  select l.id, l.user_id, l.title, l.price_cents, l.category, l.video_path, l.created_at, l.sold, l.views,
         l.video_provider, l.video_status, l.bunny_guid, l.video_res, l.likes_count,
         u.shop_name, u.handle,
         exists(select 1 from likes k where k.listing_id = l.id and k.user_id = $1) as liked,
         (l.user_id = $1) as mine
    from listings l
    join users u on u.id = l.user_id
   where l.deleted_at is null and u.suspended_at is null
     and (l.video_status <> 'error' or l.user_id = $1)`;

const VIDEO_COLS = 'video_path, video_provider, bunny_guid';

// Izvršava fn(client) u jednoj transakciji i vraća njen rezultat.
async function inTransaction(fn) {
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

// Briše snimke obrisanih oglasa: lokalni fajl i, ako postoji, snimak na Bunnyju.
async function removeListingFiles(rows, log = app.log) {
  for (const r of rows) {
    if (r.video_path) await unlink(path.join(UPLOADS_DIR, r.video_path)).catch(() => {});
    if (r.bunny_guid) await deleteFromBunny(r.bunny_guid).catch((err) => log.warn(err, 'Snimak na Bunnyju nije obrisan'));
  }
}

/* ---------- aplikacija ---------- */

// Svaki uspješan zahtjev se ne zapisuje (skupo pri hiljadama zahtjeva u sekundi); LOG_REQUESTS=1 ga uključuje.
// Greške se i dalje bilježe (setErrorHandler).
const app = Fastify({
  logger: true, bodyLimit: 64 * 1024, trustProxy: PROD,
  logController: new LogController({ disableRequestLogging: process.env.LOG_REQUESTS !== '1' }),
});

await mkdir(UPLOADS_DIR, { recursive: true });
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1, fields: 10 } });
await app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/media/', decorateReply: false, maxAge: '7d' });
await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', index: false });

// index.html dobija oznaku verzije na /app.js i /style.css (otisak sadržaja), pa keš u Nginxu i
// pregledniku nikad ne služi stari app.js uz novi index.html. Računa se jednom pri startu.
const verzija = createHash('sha1')
  .update(readFileSync(path.join(WEB_DIR, 'app.js')))
  .update(readFileSync(path.join(WEB_DIR, 'style.css')))
  .digest('hex').slice(0, 10);
const INDEX_HTML = readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
  .replace('href="/style.css"', `href="/style.css?v=${verzija}"`)
  .replace('src="/app.js"', `src="/app.js?v=${verzija}"`);
function sendIndex(reply) {
  return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(INDEX_HTML);
}
app.get('/', (req, reply) => sendIndex(reply));
app.get('/index.html', (req, reply) => sendIndex(reply));

// Keš prijava: token → korisnik (ili null), 15 sekundi, u memoriji svakog procesa posebno.
// Kod odjave, promjene lozinke, brisanja i gašenja naloga, izmjene profila i potvrde emaila keš se
// poništava odmah, ali samo u procesu koji je obradio zahtjev. Ostali procesi (src/index.js) mogu
// do 15 s vidjeti staro stanje (npr. odjavljena sesija još radi, stari naziv profila) — to je prihvaćeno.
// Vraćeni objekat je zajednički za više zahtjeva i ne smije se mijenjati.
const USER_TTL = 15 * 1000;
const USER_CACHE_MAX = 50000;
const userCache = new Map();

async function currentUser(req) {
  const token = req.cookies.sid;
  if (!token) return null;
  const hit = userCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const res = await q(
    `select u.* from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now() and u.suspended_at is null`,
    [token],
  );
  const user = res.rows[0] || null;
  boundedSet(userCache, token, { user, exp: Date.now() + USER_TTL }, USER_CACHE_MAX);
  return user;
}

function forgetToken(token) {
  if (token) userCache.delete(token);
}

// Poništava sve keširane sesije jednog korisnika (rijetke radnje, pa je prolaz kroz mapu prihvatljiv).
function forgetUser(userId) {
  for (const [token, hit] of userCache) {
    if (hit.user && hit.user.id === userId) userCache.delete(token);
  }
}

// Uređaj (kolačić `did`): za brojanje pregleda neprijavljenih i ograničenje registracija po uređaju.
// Ako ga nema, server ga napravi i postavi u odgovoru.
function deviceId(req, reply) {
  const did = req.cookies.did;
  if (did && /^[A-Za-z0-9_-]{16,64}$/.test(did)) return did;
  const fresh = randomBytes(16).toString('base64url');
  reply.setCookie('did', fresh, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 365 * 24 * 3600,
  });
  return fresh;
}

async function startSession(reply, userId) {
  const token = randomBytes(32).toString('hex');
  await q(
    `insert into sessions(token, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [token, userId, SESSION_DAYS],
  );
  reply.setCookie('sid', token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_DAYS * 24 * 3600,
  });
}

async function emailToken(userId, kind, hours) {
  const token = randomBytes(24).toString('hex');
  await q('delete from email_tokens where user_id = $1 and kind = $2', [userId, kind]);
  await q(
    `insert into email_tokens(token, user_id, kind, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [token, userId, kind, hours],
  );
  return token;
}

async function sendVerification(log, user) {
  const token = await emailToken(user.id, 'potvrda', 72);
  await sendMail(log, {
    to: user.email,
    subject: 'Potvrdi email za Komodo',
    text: `Zdravo ${user.shop_name},\n\npotvrdi email dodirom na link:\n${APP_URL}/api/auth/verify?token=${token}\n\nLink vrijedi 3 dana. Ako nisi ti napravio nalog, zanemari ovu poruku.\n\nKomodo`,
  });
}

app.get('/api/health', async () => {
  await q('select 1');
  return { status: 'ok' };
});

app.get('/api/categories', async () => ({ kategorije: CATEGORIES }));

/* ---------- nalog ---------- */

app.post('/api/auth/register', async (req, reply) => {
  // Mobilni operateri dijele jednu IP adresu na mnogo ljudi (CGNAT), pa je ograničenje po IP široko,
  // a uže je po uređaju (kolačić `did`).
  if (await limited(`reg:ip:${req.ip}`, 60, 60 * MIN)) return bad(reply, 429, 'Previše novih naloga s ove adrese. Pokušaj za sat vremena.');
  if (await limited(`reg:did:${deviceId(req, reply)}`, 5, 60 * MIN)) return bad(reply, 429, 'Previše novih naloga s ovog uređaja. Pokušaj za sat vremena.');
  const body = req.body || {};
  const email = clean(body.email, 200).toLowerCase();
  const password = String(body.password ?? '');
  const name = clean(body.name, 40);
  if (!validEmail(email)) return bad(reply, 400, 'Upiši ispravnu email adresu.');
  if (password.length < 8) return bad(reply, 400, 'Lozinka mora imati najmanje 8 znakova.');
  if (name.length < 2) return bad(reply, 400, 'Upiši svoje ime.');
  const exists = await q('select 1 from users where email = $1', [email]);
  if (exists.rowCount > 0) return bad(reply, 409, 'Nalog s ovom email adresom već postoji. Prijavi se.');
  const passwordHash = await hashPassword(password);
  // Istovremene registracije: zauzet email → 409, zauzet handle → novi pokušaj (insertUser).
  let user;
  try {
    // Bez podešenog emaila (razvoj) nalog je odmah potvrđen.
    user = await insertUser(name, async (handle) => (await q(
      `insert into users(email, password_hash, shop_name, handle, role, email_verified_at)
       values ($1, $2, $3, $4, 'kupac', $5) returning *`,
      [email, passwordHash, name, handle, mailOn ? null : new Date()],
    )).rows[0]);
  } catch (err) {
    if (err.code === 'EMAIL_ZAUZET') return bad(reply, 409, 'Nalog s ovom email adresom već postoji. Prijavi se.');
    throw err;
  }
  if (mailOn) await sendVerification(req.log, user);
  await startSession(reply, user.id);
  return reply.code(201).send({ korisnik: publicUser(user) });
});

app.post('/api/auth/login', async (req, reply) => {
  const body = req.body || {};
  const email = clean(body.email, 200).toLowerCase();
  const password = String(body.password ?? '');
  const tooMany = await limited(`login:ip:${req.ip}:${email}`, 10, 15 * MIN);
  if (await limited(`login:email:${email}`, 30, 15 * MIN) || tooMany) {
    return bad(reply, 429, 'Previše pokušaja prijave. Pokušaj ponovo za 15 minuta.');
  }
  const res = await q('select * from users where email = $1', [email]);
  const user = res.rows[0];
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return bad(reply, 401, 'Email ili lozinka nisu tačni.');
  }
  if (user.suspended_at) return bad(reply, 403, 'Ovaj nalog je ugašen. Javi nam se ako misliš da je greška.');
  await startSession(reply, user.id);
  return { korisnik: publicUser(user) };
});

app.post('/api/auth/logout', async (req, reply) => {
  if (req.cookies.sid) {
    await q('delete from sessions where token = $1', [req.cookies.sid]);
    forgetToken(req.cookies.sid);
  }
  reply.clearCookie('sid', { path: '/' });
  return { ok: true };
});

app.get('/api/auth/verify', async (req, reply) => {
  const res = await q(
    `delete from email_tokens where token = $1 and kind = 'potvrda' and expires_at > now() returning user_id`,
    [clean(req.query.token, 100)],
  );
  if (res.rowCount === 0) return reply.redirect('/?potvrda=istekla');
  await q('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [res.rows[0].user_id]);
  forgetUser(res.rows[0].user_id);
  return reply.redirect('/?potvrda=ok');
});

app.post('/api/auth/resend', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se.');
  if (user.email_verified_at) return { ok: true };
  if (await limited(`resend:${user.id}`, 3, 60 * MIN)) return bad(reply, 429, 'Link je već poslan. Provjeri poštu, pa pokušaj ponovo za sat vremena.');
  await sendVerification(req.log, user);
  return { ok: true };
});

// Uvijek odgovara isto, da se ne može provjeriti postoji li nalog s tom adresom.
app.post('/api/auth/forgot', async (req, reply) => {
  const email = clean((req.body || {}).email, 200).toLowerCase();
  const tooMany = await limited(`forgot:ip:${req.ip}`, 20, 60 * MIN);
  if (await limited(`forgot:email:${email}`, 3, 60 * MIN) || tooMany) {
    return bad(reply, 429, 'Previše zahtjeva. Pokušaj ponovo za sat vremena.');
  }
  const res = await q('select * from users where email = $1 and suspended_at is null', [email]);
  if (res.rowCount > 0) {
    const token = await emailToken(res.rows[0].id, 'lozinka', 1);
    await sendMail(req.log, {
      to: email,
      subject: 'Nova lozinka za Komodo',
      text: `Zdravo ${res.rows[0].shop_name},\n\nnovu lozinku postavljaš na linku:\n${APP_URL}/?lozinka=${token}\n\nLink vrijedi 1 sat. Ako nisi ti tražio novu lozinku, zanemari ovu poruku.\n\nKomodo`,
    });
  }
  return { ok: true };
});

app.post('/api/auth/reset', async (req, reply) => {
  const body = req.body || {};
  const password = String(body.password ?? '');
  if (password.length < 8) return bad(reply, 400, 'Lozinka mora imati najmanje 8 znakova.');
  const res = await q(
    `delete from email_tokens where token = $1 and kind = 'lozinka' and expires_at > now() returning user_id`,
    [clean(body.token, 100)],
  );
  if (res.rowCount === 0) return bad(reply, 400, 'Link je istekao ili je već iskorišten. Zatraži novi.');
  const userId = res.rows[0].user_id;
  await q(
    'update users set password_hash = $1, email_verified_at = coalesce(email_verified_at, now()) where id = $2',
    [await hashPassword(password), userId],
  );
  await q('delete from sessions where user_id = $1', [userId]);
  forgetUser(userId);
  await startSession(reply, userId);
  const user = await q('select * from users where id = $1', [userId]);
  return { korisnik: publicUser(user.rows[0]) };
});

app.get('/api/me', async (req) => {
  const user = await currentUser(req);
  if (!user) return { korisnik: null, neprocitano: 0 };
  return { korisnik: publicUser(user), neprocitano: await unreadCount(user.id) };
});

app.patch('/api/me', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da izmijeniš profil.');
  const body = req.body || {};
  const isShop = user.role === 'butik';
  const shopName = clean(body.name ?? user.shop_name, 40);
  const phone = isShop ? clean(body.phone ?? user.phone, 30) : user.phone;
  const links = !isShop || body.links === undefined ? user.links : normalizeLinks(body.links);
  const pushEnabled = typeof body.pushEnabled === 'boolean' ? body.pushEnabled : user.push_enabled;
  if (shopName.length < 2) return bad(reply, 400, isShop ? 'Upiši naziv butika.' : 'Upiši svoje ime.');
  if (phone && !/^[0-9+ /()-]{6,30}$/.test(phone)) return bad(reply, 400, 'Telefon upiši brojevima, npr. 065 123 456.');
  if (links === null) return bad(reply, 400, 'Link nije ispravan. Upiši ga kao instagram.com/moj.butik, najviše 5 linkova.');
  const res = await q(
    'update users set shop_name = $1, phone = $2, links = $3::jsonb, push_enabled = $4 where id = $5 returning *',
    [shopName, phone, JSON.stringify(links), pushEnabled, user.id],
  );
  forgetUser(user.id); // i push prekidač (pushEnabled) ide ovuda
  return { korisnik: publicUser(res.rows[0]) };
});

app.post('/api/me/password', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da promijeniš lozinku.');
  const body = req.body || {};
  const next = String(body.next ?? '');
  if (!(await checkPassword(String(body.current ?? ''), user.password_hash))) return bad(reply, 400, 'Trenutna lozinka nije tačna.');
  if (next.length < 8) return bad(reply, 400, 'Nova lozinka mora imati najmanje 8 znakova.');
  await q('update users set password_hash = $1 where id = $2', [await hashPassword(next), user.id]);
  await q('delete from sessions where user_id = $1 and token <> $2', [user.id, req.cookies.sid]);
  forgetUser(user.id);
  return { ok: true };
});

// Mobilna aplikacija prijavljuje Expo push token uređaja za trenutnu prijavu.
app.post('/api/me/push-token', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se.');
  const token = clean((req.body || {}).token, 200);
  if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) return bad(reply, 400, 'Token nije ispravan.');
  await q(
    `insert into push_tokens(token, user_id, session_token) values ($1, $2, $3)
     on conflict (token) do update set user_id = excluded.user_id, session_token = excluded.session_token, created_at = now()`,
    [token, user.id, req.cookies.sid],
  );
  return { ok: true };
});

// Trajno brisanje naloga: oglasi, snimci, poruke i sviđanja idu s njim.
app.post('/api/me/delete', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da obrišeš nalog.');
  if (!(await checkPassword(String((req.body || {}).password ?? ''), user.password_hash))) {
    return bad(reply, 400, 'Lozinka nije tačna.');
  }
  const files = await q(`select ${VIDEO_COLS} from listings where user_id = $1 and deleted_at is null`, [user.id]);
  // Sviđanja korisnika nestaju kaskadno, pa se u istoj transakciji umanjuje likes_count tih oglasa.
  await inTransaction(async (c) => {
    await c.query('select id from users where id = $1 for update', [user.id]);
    // Redovi oglasa se zaključavaju po redu id-ja, da se dva istovremena brisanja ne zaglave.
    await c.query(
      `select id from listings where id in (select listing_id from likes where user_id = $1)
        order by id for no key update`,
      [user.id],
    );
    await c.query(
      `update listings l set likes_count = l.likes_count - 1
         from likes k where k.listing_id = l.id and k.user_id = $1`,
      [user.id],
    );
    await c.query('delete from users where id = $1', [user.id]);
  });
  forgetUser(user.id);
  await removeListingFiles(files.rows);
  reply.clearCookie('sid', { path: '/' });
  return { ok: true };
});

/* ---------- butici ---------- */

app.get('/api/shops/:handle', async (req, reply) => {
  const res = await q(
    `select u.shop_name, u.handle, u.phone, u.links, u.city,
            (select count(*) from listings l where l.user_id = u.id and l.deleted_at is null) as oglasa
       from users u where u.handle = $1 and u.role = 'butik' and u.suspended_at is null`,
    [String(req.params.handle).toLowerCase()],
  );
  const s = res.rows[0];
  if (!s) return bad(reply, 404, 'Ovaj butik ne postoji.');
  return {
    butik: {
      shopName: s.shop_name, handle: s.handle, phone: s.phone,
      links: s.links, city: s.city, listings: Number(s.oglasa),
    },
  };
});

/* ---------- oglasi ---------- */

// Keš javnog feeda: osnovni redovi oglasa (bez liked/mine) po normalizovanim parametrima, 5 sekundi,
// u memoriji svakog procesa. Istovremeni zahtjevi za isti ključ čekaju isti upit.
const FEED_TTL = 5 * 1000;
const FEED_CACHE_MAX = 2000;
const feedCache = new Map();

function feedRows(key, sql, params) {
  const hit = feedCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.rows;
  const rows = q(sql, params).then((r) => r.rows);
  boundedSet(feedCache, key, { rows, exp: Date.now() + FEED_TTL }, FEED_CACHE_MAX);
  rows.catch(() => { if (feedCache.get(key)?.rows === rows) feedCache.delete(key); });
  return rows;
}

app.get('/api/listings', async (req) => {
  const user = await currentUser(req);
  const { category, before } = req.query;
  const shop = req.query.shop ? String(req.query.shop).toLowerCase() : '';
  const liked = req.query.liked === '1';
  // Oglase sa snimkom u grešci vidi samo vlasnik, pa vlastiti butik i lista sviđanja idu mimo keša.
  const direct = liked || (user && shop && shop === user.handle);
  const params = [direct && user ? user.id : 0];
  const norm = {};
  let where = '';
  const add = (sql, value) => { params.push(value); where += sql.replace('?', `$${params.length}`); };
  if (category && CATEGORIES.includes(category)) { add(' and l.category = ?', category); norm.c = category; }
  if (shop) { add(' and u.handle = ?', shop); norm.s = shop; }
  if (liked) where += ' and l.id in (select k.listing_id from likes k where k.user_id = $1)';
  const search = clean(req.query.q, 60);
  if (search) {
    // Unija dva podupita, da baza koristi trigram indekse na listings.title i users.shop_name
    // (s `or` preko spoja ih ne koristi i za rijetku riječ pregleda cijelu tabelu).
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    where += ` and l.id in (select t.id from listings t where t.title ilike $${n}
                union select t.id from listings t join users s on s.id = t.user_id where s.shop_name ilike $${n})`;
    norm.q = search;
  }
  const min = parsePrice(req.query.min);
  const max = parsePrice(req.query.max);
  if (min !== null) { add(' and l.price_cents >= ?', min); norm.min = min; }
  if (max !== null) { add(' and l.price_cents <= ?', max); norm.max = max; }
  const filters = where;
  const filterParams = [...params];
  if (isId(before)) { add(' and l.id < ?', Number(before)); norm.b = Number(before); }
  const sql = `${LISTING_SELECT}${where} order by l.id desc limit 20`;

  let rows;
  if (direct) {
    rows = (await q(sql, params)).rows;
  } else {
    rows = await feedRows(JSON.stringify(norm), sql, params);
    let likedIds = new Set();
    if (user && rows.length > 0) {
      const lk = await q(
        'select listing_id from likes where user_id = $1 and listing_id = any($2::int[])',
        [user.id, rows.map((r) => r.id)],
      );
      likedIds = new Set(lk.rows.map((r) => r.listing_id));
    }
    rows = rows.map((r) => ({ ...r, liked: likedIds.has(r.id), mine: !!user && r.user_id === user.id }));
  }
  const out = { oglasi: rows.map(publicListing) };
  // Ugovor: ukupan broj (butika, odnosno sviđanja) samo na prvoj stranici.
  if ((shop || liked) && !isId(before)) {
    const total = await q(
      `select count(*) as n from listings l join users u on u.id = l.user_id
        where l.deleted_at is null and u.suspended_at is null
          and (l.video_status <> 'error' or l.user_id = $1)${filters}`,
      filterParams,
    );
    out.ukupno = Number(total.rows[0].n);
  }
  return out;
});

// Svježi brojevi sviđanja za oglase koji su već na ekranu: /api/likes?ids=1,2,3
app.get('/api/likes', async (req) => {
  const user = await currentUser(req);
  const ids = String(req.query.ids ?? '').split(',').filter(isId).slice(0, 100).map(Number);
  if (ids.length === 0) return { svidjanja: {} };
  const res = await q(
    `select l.id, l.likes_count,
            exists(select 1 from likes k where k.user_id = $1 and k.listing_id = l.id) as liked
       from listings l where l.id = any($2::int[]) and l.deleted_at is null`,
    [user ? user.id : 0, ids],
  );
  const out = {};
  for (const r of res.rows) out[r.id] = { likes: r.likes_count, liked: r.liked === true };
  return { svidjanja: out };
});

app.get('/api/listings/:id', async (req, reply) => {
  if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
  const user = await currentUser(req);
  const res = await q(`${LISTING_SELECT} and l.id = $2`, [user ? user.id : 0, Number(req.params.id)]);
  if (res.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili je obrisan.');
  return { oglas: publicListing(res.rows[0]) };
});

app.post('/api/listings', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da objaviš oglas.');
  if (user.role !== 'butik') return bad(reply, 403, 'Oglase objavljuju samo butici. Javi nam se da ti otvorimo butik.');
  if (!req.isMultipart()) return bad(reply, 400, 'Oglas se šalje kao obrazac s videom.');

  const fields = {};
  let videoFile = null;
  let problem = null;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const ext = VIDEO_EXT[part.mimetype];
      if (part.fieldname !== 'video' || !ext || videoFile) {
        if (!ext) problem = 'Video mora biti MP4, MOV ili WebM.';
        part.file.resume();
        continue;
      }
      const name = `${randomUUID()}.${ext}`;
      await pipeline(part.file, createWriteStream(path.join(UPLOADS_DIR, name)));
      videoFile = name;
      if (part.file.truncated) problem = `Video je prevelik. Najviše ${MAX_VIDEO_MB} MB.`;
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  const title = clean(fields.title, 60);
  const priceCents = parsePrice(fields.price);
  const category = clean(fields.category, 40);
  if (!problem && !videoFile) problem = 'Dodaj video proizvoda.';
  if (!problem && title.length < 2) problem = 'Upiši naziv, npr. Crna saten haljina, M.';
  if (!problem && priceCents === null) problem = 'Upiši cijenu u KM brojem, npr. 65 ili 64,90.';
  if (!problem && !CATEGORIES.includes(category)) problem = 'Izaberi kategoriju.';
  if (problem) {
    if (videoFile) await unlink(path.join(UPLOADS_DIR, videoFile)).catch(() => {});
    return bad(reply, 400, problem);
  }

  const ins = await q(
    `insert into listings(user_id, title, price_cents, category, video_path, video_provider, video_status)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [user.id, title, priceCents, category, videoFile, bunnyOn ? 'bunny' : 'local', bunnyOn ? 'processing' : 'ready'],
  );
  if (bunnyOn) sendToBunny(ins.rows[0].id).catch(() => {});
  const res = await q(`${LISTING_SELECT} and l.id = $2`, [user.id, ins.rows[0].id]);
  return reply.code(201).send({ oglas: publicListing(res.rows[0]) });
});

// Izmjena oglasa: naziv, cijena, kategorija i oznaka „prodato”. Video se ne mijenja.
app.patch('/api/listings/:id', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da izmijeniš oglas.');
  if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
  const body = req.body || {};
  const title = clean(body.title, 60);
  const priceCents = parsePrice(body.price);
  const category = clean(body.category, 40);
  if (title.length < 2) return bad(reply, 400, 'Upiši naziv, npr. Crna saten haljina, M.');
  if (priceCents === null) return bad(reply, 400, 'Upiši cijenu u KM brojem, npr. 65 ili 64,90.');
  if (!CATEGORIES.includes(category)) return bad(reply, 400, 'Izaberi kategoriju.');
  const upd = await q(
    `update listings set title = $1, price_cents = $2, category = $3, sold = $4
      where id = $5 and user_id = $6 and deleted_at is null returning id`,
    [title, priceCents, category, body.sold === true, Number(req.params.id), user.id],
  );
  if (upd.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili nije tvoj.');
  const res = await q(`${LISTING_SELECT} and l.id = $2`, [user.id, upd.rows[0].id]);
  return { oglas: publicListing(res.rows[0]) };
});

app.delete('/api/listings/:id', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da obrišeš oglas.');
  if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
  const res = await q(
    `update listings set deleted_at = now()
      where id = $1 and user_id = $2 and deleted_at is null returning ${VIDEO_COLS}`,
    [Number(req.params.id), user.id],
  );
  if (res.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili nije tvoj.');
  await removeListingFiles(res.rows);
  return { ok: true };
});

// Sviđanje: s tijelom {liked: true|false} postavlja to stanje (idempotentno), bez tijela radi kao prekidač.
// Jedna naredba (dakle jedna transakcija): red u likes se upiše (on conflict do nothing) ili obriše
// (returning), a likes_count se mijenja samo za red koji se stvarno promijenio. Istovremeni zahtjevi čekaju
// jedan drugog na jedinstvenom ključu i na redu oglasa, pa broj u koloni uvijek odgovara broju redova.
const LIKE_SQL = `
  with l as (select id, likes_count from listings where id = $2 and deleted_at is null),
  del as (delete from likes where user_id = $1 and listing_id in (select id from l) and $3 <> 'on'
          returning 1),
  ins as (insert into likes(user_id, listing_id)
          select $1, id from l where $3 = 'on' or ($3 = 'toggle' and not exists (select 1 from del))
          on conflict do nothing
          returning 1),
  d as (select (select count(*) from ins) - (select count(*) from del) as delta),
  upd as (update listings set likes_count = likes_count + (select delta from d)
           where id in (select id from l) and (select delta from d) <> 0
          returning likes_count)
  select exists(select 1 from l) as found,
         ($3 = 'on' or ($3 = 'toggle' and not exists (select 1 from del))) as liked,
         coalesce((select likes_count from upd), (select likes_count from l)) as likes`;

app.post('/api/listings/:id/like', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da označiš oglas.');
  if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.liked !== undefined && typeof body.liked !== 'boolean') return bad(reply, 400, 'Polje liked mora biti true ili false.');
  const mode = body.liked === true ? 'on' : body.liked === false ? 'off' : 'toggle';
  const res = await q(LIKE_SQL, [user.id, Number(req.params.id), mode]);
  const r = res.rows[0];
  if (!r.found) return bad(reply, 404, 'Ovaj oglas ne postoji ili je obrisan.');
  return { liked: r.liked, likes: r.likes };
});

// Pregledi: jedan po oglasu, po gledaocu (prijavljeni korisnik ili uređaj), po danu.
// Vlasnikovi pregledi se ne broje. Jedan upit: upis u listing_views i povećanje views za nove redove.
async function countViews(req, reply, ids) {
  const user = await currentUser(req);
  const viewer = user ? `u${user.id}` : `d${deviceId(req, reply)}`;
  if (await limited(`views:${viewer}`, 30, MIN)) return bad(reply, 429, 'Previše zahtjeva. Sačekaj minut.');
  if (ids.length === 0) return { ok: true };
  await q(
    `with novi as (
       insert into listing_views(listing_id, viewer)
       select l.id, $2 from listings l
        where l.id = any($1::int[]) and l.deleted_at is null and l.user_id <> $3
       on conflict do nothing
       returning listing_id
     )
     update listings l set views = l.views + n.broj
       from (select listing_id, count(*)::int as broj from novi group by listing_id) n
      where l.id = n.listing_id`,
    [ids, viewer, user ? user.id : 0],
  );
  return { ok: true };
}

app.post('/api/views', async (req, reply) => {
  const raw = (req.body || {}).ids;
  if (!Array.isArray(raw) || raw.length > 50 || !raw.every((v) => Number.isInteger(v) && v > 0 && v < 2 ** 31)) {
    return bad(reply, 400, 'Pošalji spisak oglasa kao {"ids": [1, 2, 3]}, najviše 50.');
  }
  return countViews(req, reply, [...new Set(raw)]);
});

app.post('/api/listings/:id/view', async (req, reply) => {
  if (!isId(req.params.id)) return { ok: true };
  return countViews(req, reply, [Number(req.params.id)]);
});

/* ---------- poruke ---------- */

const UNREAD_SQL = `exists(select 1 from messages m
   where m.conversation_id = c.id and m.sender_id <> $1
     and m.created_at > case when c.customer_id = $1 then c.customer_read_at else c.shop_read_at end)`;

async function unreadCount(userId) {
  const res = await q(
    `select count(*) as n from conversations c
      where (c.customer_id = $1 or c.shop_id = $1) and ${UNREAD_SQL}`,
    [userId],
  );
  return Number(res.rows[0].n);
}

async function myConversation(userId, id) {
  if (!isId(id)) return null;
  const res = await q(
    'select * from conversations where id = $1 and (customer_id = $2 or shop_id = $2)',
    [Number(id), userId],
  );
  return res.rows[0] || null;
}

async function blockState(userId, otherId) {
  const res = await q(
    `select blocker_id from blocks
      where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
    [userId, otherId],
  );
  return { mine: res.rows.some((r) => r.blocker_id === userId), any: res.rowCount > 0 };
}

// Kupac otvara razgovor s butikom (ili nastavlja postojeći). Butik ne može započeti razgovor.
app.post('/api/conversations', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da pošalješ poruku.');
  if (user.role !== 'kupac') return bad(reply, 403, 'Razgovor započinje kupac. Butik odgovara na poruke koje dobije.');
  const body = req.body || {};
  const shopRes = await q(
    "select id from users where handle = $1 and role = 'butik' and suspended_at is null",
    [clean(body.shop, 40).toLowerCase()],
  );
  if (shopRes.rowCount === 0) return bad(reply, 404, 'Ovaj butik ne postoji.');
  let listingId = null;
  if (isId(body.listingId)) {
    const l = await q('select id from listings where id = $1 and user_id = $2 and deleted_at is null', [Number(body.listingId), shopRes.rows[0].id]);
    if (l.rowCount > 0) listingId = l.rows[0].id;
  }
  const res = await q(
    `insert into conversations(customer_id, shop_id, listing_id) values ($1, $2, $3)
     on conflict (customer_id, shop_id)
     do update set listing_id = coalesce(excluded.listing_id, conversations.listing_id)
     returning id`,
    [user.id, shopRes.rows[0].id, listingId],
  );
  return { razgovor: res.rows[0].id };
});

app.get('/api/conversations', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da vidiš poruke.');
  const res = await q(
    `select c.id, c.last_message_at, o.shop_name as other_name, l.title as listing_title,
            (select m.body from messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
            ${UNREAD_SQL} as unread
       from conversations c
       join users o on o.id = case when c.customer_id = $1 then c.shop_id else c.customer_id end
       left join listings l on l.id = c.listing_id
      where (c.customer_id = $1 or c.shop_id = $1) and c.last_message_at is not null
      order by c.last_message_at desc limit 100`,
    [user.id],
  );
  return {
    razgovori: res.rows.map((r) => ({
      id: r.id, name: r.other_name, listingTitle: r.listing_title,
      last: r.last_body, at: r.last_message_at, unread: r.unread === true,
    })),
  };
});

app.get('/api/conversations/:id/messages', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da vidiš poruke.');
  const conv = await myConversation(user.id, req.params.id);
  if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
  const after = isId(req.query.after) ? Number(req.query.after) : 0;
  const msgs = await q(
    'select id, sender_id, body, created_at from messages where conversation_id = $1 and id > $2 order by id limit 300',
    [conv.id, after],
  );
  const mineCol = conv.customer_id === user.id ? 'customer_read_at' : 'shop_read_at';
  await q(`update conversations set ${mineCol} = now() where id = $1`, [conv.id]);
  const otherId = conv.customer_id === user.id ? conv.shop_id : conv.customer_id;
  const other = await q('select shop_name, handle, role from users where id = $1', [otherId]);
  const block = await blockState(user.id, otherId);
  let listing = null;
  if (conv.listing_id) {
    const l = await q('select id, title, price_cents from listings where id = $1 and deleted_at is null', [conv.listing_id]);
    if (l.rowCount > 0) listing = { id: l.rows[0].id, title: l.rows[0].title, price: l.rows[0].price_cents / 100 };
  }
  return {
    sagovornik: { name: other.rows[0].shop_name, handle: other.rows[0].handle, butik: other.rows[0].role === 'butik' },
    oglas: listing,
    blokirao: block.mine,
    blokirano: block.any,
    poruke: msgs.rows.map((m) => ({ id: m.id, body: m.body, mine: m.sender_id === user.id, at: m.created_at })),
  };
});

app.post('/api/conversations/:id/messages', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da pošalješ poruku.');
  if (!user.email_verified_at) return bad(reply, 403, 'Potvrdi email da bi slao poruke. Link ti je stigao na email, a novi tražiš u profilu.');
  if (await limited(`msg:${user.id}`, 30, MIN)) return bad(reply, 429, 'Šalješ previše poruka. Sačekaj minut.');
  const conv = await myConversation(user.id, req.params.id);
  if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
  const otherId = conv.customer_id === user.id ? conv.shop_id : conv.customer_id;
  if ((await blockState(user.id, otherId)).any) return bad(reply, 403, 'Ne možeš pisati u ovom razgovoru jer je blokiran.');
  const text = clean((req.body || {}).body, 1000);
  if (!text) return bad(reply, 400, 'Upiši poruku.');
  const ins = await q(
    'insert into messages(conversation_id, sender_id, body) values ($1, $2, $3) returning id, created_at',
    [conv.id, user.id, text],
  );
  const mineCol = conv.customer_id === user.id ? 'customer_read_at' : 'shop_read_at';
  await q(`update conversations set last_message_at = now(), ${mineCol} = now() where id = $1`, [conv.id]);
  pushNewMessage(req.log, otherId, user.shop_name, text, conv.id).catch(() => {});
  return reply.code(201).send({ poruka: { id: ins.rows[0].id, body: text, mine: true, at: ins.rows[0].created_at } });
});

// Blokiranje sagovornika: dok traje, niko od dvoje ne može pisati u razgovoru.
app.post('/api/conversations/:id/block', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se.');
  const conv = await myConversation(user.id, req.params.id);
  if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
  const otherId = conv.customer_id === user.id ? conv.shop_id : conv.customer_id;
  if ((req.body || {}).blocked === false) {
    await q('delete from blocks where blocker_id = $1 and blocked_id = $2', [user.id, otherId]);
  } else {
    await q('insert into blocks(blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [user.id, otherId]);
  }
  const block = await blockState(user.id, otherId);
  return { blokirao: block.mine, blokirano: block.any };
});

/* ---------- prijave sadržaja ---------- */

app.get('/api/report-reasons', async () => ({ razlozi: REPORT_REASONS }));

app.post('/api/reports', async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return bad(reply, 401, 'Prijavi se da prijaviš sadržaj.');
  if (await limited(`report:${user.id}`, 20, 60 * MIN)) return bad(reply, 429, 'Previše prijava. Pokušaj kasnije.');
  const body = req.body || {};
  const reason = REPORT_REASONS.includes(body.reason) ? body.reason : 'Ostalo';
  if (isId(body.listingId)) {
    const l = await q('select 1 from listings where id = $1 and deleted_at is null', [Number(body.listingId)]);
    if (l.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili je obrisan.');
    await q('insert into reports(reporter_id, listing_id, reason) values ($1, $2, $3)', [user.id, Number(body.listingId), reason]);
    return reply.code(201).send({ ok: true });
  }
  if (isId(body.conversationId)) {
    // Prijavljuje se posljednja poruka sagovornika u tom razgovoru.
    const conv = await myConversation(user.id, body.conversationId);
    if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
    const m = await q(
      'select id from messages where conversation_id = $1 and sender_id <> $2 order by id desc limit 1',
      [conv.id, user.id],
    );
    if (m.rowCount === 0) return bad(reply, 400, 'U ovom razgovoru nema poruke sagovornika koju bi prijavio.');
    await q('insert into reports(reporter_id, message_id, reason) values ($1, $2, $3)', [user.id, m.rows[0].id, reason]);
    return reply.code(201).send({ ok: true });
  }
  return bad(reply, 400, 'Nije navedeno šta se prijavljuje.');
});

/* ---------- administracija (nalozi iz ADMIN_EMAILS) ---------- */

async function adminUser(req, reply) {
  const user = await currentUser(req);
  if (!isAdmin(user)) { bad(reply, 404, 'Ne postoji.'); return null; }
  return user;
}

app.get('/api/admin/reports', async (req, reply) => {
  if (!(await adminUser(req, reply))) return reply;
  const res = await q(
    `select r.id, r.reason, r.created_at, rep.shop_name as reporter,
            l.id as listing_id, l.title, l.video_path, l.video_provider, l.video_status, l.bunny_guid, l.video_res,
            lu.shop_name as shop_name, lu.id as shop_id,
            m.id as message_id, m.body, mu.shop_name as sender_name, mu.id as sender_id
       from reports r
       join users rep on rep.id = r.reporter_id
       left join listings l on l.id = r.listing_id
       left join users lu on lu.id = l.user_id
       left join messages m on m.id = r.message_id
       left join users mu on mu.id = m.sender_id
      where r.resolved_at is null
      order by r.created_at limit 200`,
  );
  return {
    prijave: res.rows.map((r) => ({
      id: r.id, reason: r.reason, at: r.created_at, reporter: r.reporter,
      listing: r.listing_id ? { id: r.listing_id, title: r.title, videoUrl: mediaUrls(r).videoUrl, shopName: r.shop_name, userId: r.shop_id } : null,
      message: r.message_id ? { id: r.message_id, body: r.body, senderName: r.sender_name, userId: r.sender_id } : null,
    })),
  };
});

// action: "odbaci" (prijava nije osnovana) ili "ukloni" (briše oglas ili poruku).
app.post('/api/admin/reports/:id/resolve', async (req, reply) => {
  if (!(await adminUser(req, reply))) return reply;
  if (!isId(req.params.id)) return bad(reply, 404, 'Ova prijava ne postoji.');
  const rep = await q('select * from reports where id = $1 and resolved_at is null', [Number(req.params.id)]);
  if (rep.rowCount === 0) return bad(reply, 404, 'Ova prijava ne postoji ili je već riješena.');
  const r = rep.rows[0];
  if ((req.body || {}).action === 'ukloni') {
    if (r.listing_id) {
      const del = await q(`update listings set deleted_at = now() where id = $1 and deleted_at is null returning ${VIDEO_COLS}`, [r.listing_id]);
      await removeListingFiles(del.rows);
      await q('update reports set resolved_at = now() where listing_id = $1 and resolved_at is null', [r.listing_id]);
    } else {
      await q("update messages set body = '(poruka je uklonjena)' where id = $1", [r.message_id]);
      await q('update reports set resolved_at = now() where message_id = $1 and resolved_at is null', [r.message_id]);
    }
  }
  await q('update reports set resolved_at = now() where id = $1', [r.id]);
  return { ok: true };
});

app.get('/api/admin/users', async (req, reply) => {
  if (!(await adminUser(req, reply))) return reply;
  const res = await q(
    `select u.id, u.shop_name, u.handle, u.email, u.role, u.suspended_at, u.created_at,
            (select count(*) from listings l where l.user_id = u.id and l.deleted_at is null) as oglasa
       from users u order by (u.role = 'butik') desc, u.created_at desc limit 500`,
  );
  return {
    nalozi: res.rows.map((u) => ({
      id: u.id, name: u.shop_name, handle: u.handle, email: u.email, role: u.role,
      suspended: u.suspended_at !== null, listings: Number(u.oglasa),
    })),
  };
});

app.post('/api/admin/shops', async (req, reply) => {
  if (!(await adminUser(req, reply))) return reply;
  const body = req.body || {};
  try {
    const shop = await createShop({ name: body.name, email: body.email, phone: body.phone });
    return reply.code(201).send({ butik: shop });
  } catch (err) {
    return bad(reply, 400, err.message);
  }
});

// Gašenje naloga: korisnik se odjavljuje, a njegovi oglasi i profil nestaju iz aplikacije.
app.post('/api/admin/users/:id/suspend', async (req, reply) => {
  const admin = await adminUser(req, reply);
  if (!admin) return reply;
  if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj nalog ne postoji.');
  const id = Number(req.params.id);
  if (id === admin.id) return bad(reply, 400, 'Ne možeš ugasiti svoj nalog.');
  const suspended = (req.body || {}).suspended !== false;
  const res = await q(
    'update users set suspended_at = case when $1 then now() else null end where id = $2 returning id',
    [suspended, id],
  );
  if (res.rowCount === 0) return bad(reply, 404, 'Ovaj nalog ne postoji.');
  if (suspended) await q('delete from sessions where user_id = $1', [id]);
  forgetUser(id);
  return { ok: true, suspended };
});

/* ---------- snimci na Bunny Stream ---------- */

// Snimak se prvo sačuva na disk, pa se u pozadini šalje na Bunny. Dok Bunny ne završi obradu,
// svi gledaju snimak s našeg servera, pa je oglas vidljiv odmah poslije objave.
const uploading = new Set();

async function sendToBunny(listingId) {
  if (uploading.has(listingId)) return;
  uploading.add(listingId);
  try {
    const res = await q(
      `select id, title, video_path from listings
        where id = $1 and video_provider = 'bunny' and bunny_guid is null and deleted_at is null`,
      [listingId],
    );
    const l = res.rows[0];
    if (!l) return;
    const guid = await uploadToBunny(path.join(UPLOADS_DIR, l.video_path), l.title);
    // `bunny_guid is null`: s više procesa isti snimak može izuzetno poslati i drugi proces; višak se briše.
    const upd = await q(
      'update listings set bunny_guid = $1 where id = $2 and deleted_at is null and bunny_guid is null returning id',
      [guid, l.id],
    );
    if (upd.rowCount === 0) await deleteFromBunny(guid).catch(() => {}); // oglas je obrisan ili već poslan
  } catch (err) {
    app.log.warn(err, `Slanje snimka oglasa ${listingId} na Bunny nije uspjelo, pokušaću ponovo`);
  } finally {
    uploading.delete(listingId);
  }
}

// Svakih 20 sekundi: pošalji snimke koji još nisu poslani i provjeri one koji se obrađuju.
async function checkVideos() {
  if (!bunnyOn) return;
  // Lokalni snimci oglasa koje je Bunny obradio prije više od pola sata više ne trebaju.
  const done = await q(
    `select id, video_path from listings
      where video_provider = 'bunny' and video_status = 'ready' and video_path is not null
        and ready_at < now() - interval '30 minutes'
      limit 50`,
  );
  for (const l of done.rows) {
    await unlink(path.join(UPLOADS_DIR, l.video_path)).catch(() => {});
    await q('update listings set video_path = null where id = $1', [l.id]);
  }
  const pending = await q(
    `select id, bunny_guid, video_path, created_at < now() - interval '10 minutes' as stale from listings
      where video_provider = 'bunny' and video_status = 'processing' and deleted_at is null
      order by id limit 20`,
  );
  for (const l of pending.rows) {
    // Svjež oglas šalje proces koji ga je primio; ovdje se ponovo šalju samo oni kojima to nije uspjelo.
    if (!l.bunny_guid) { if (l.stale) sendToBunny(l.id).catch(() => {}); continue; }
    try {
      const st = await bunnyState(l.bunny_guid);
      if (st.state === 'ready') {
        await q(
          "update listings set video_status = 'ready', video_res = $1, ready_at = now() where id = $2",
          [st.res, l.id],
        );
      } else if (st.state === 'error') {
        await q("update listings set video_status = 'error' where id = $1", [l.id]);
      }
    } catch (err) {
      app.log.warn(err, `Provjera snimka oglasa ${l.id} na Bunnyju nije uspjela`);
    }
  }
}

/* ---------- push obavještenja (Expo) ---------- */

// Šalje push primaocu nove poruke. Ne zadržava odgovor pošiljaocu; greške samo bilježi.
async function pushNewMessage(log, recipientId, senderName, text, conversationId) {
  const res = await q(
    `select t.token from push_tokens t join users u on u.id = t.user_id
      where t.user_id = $1 and u.push_enabled and u.suspended_at is null`,
    [recipientId],
  );
  if (res.rowCount === 0) return;
  const body = text.length > 140 ? `${text.slice(0, 137)}…` : text;
  const messages = res.rows.map((r) => ({
    to: r.token, title: senderName, body, sound: 'default', channelId: 'poruke',
    data: { conversationId },
  }));
  try {
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10000),
    });
    const out = await resp.json().catch(() => ({}));
    const tickets = Array.isArray(out.data) ? out.data : [];
    for (let k = 0; k < tickets.length; k += 1) {
      if (tickets[k].status === 'error' && tickets[k].details?.error === 'DeviceNotRegistered') {
        await q('delete from push_tokens where token = $1', [messages[k].to]);
      }
    }
  } catch (err) {
    log.warn(err, 'Push obavještenje nije poslano');
  }
}

/* ---------- email butiku za poruku koju nije pročitao 15 minuta ---------- */

async function notifyUnread() {
  const res = await q(
    `select c.id, s.email, s.shop_name, k.shop_name as customer,
            (select m.body from messages m where m.conversation_id = c.id order by m.id desc limit 1) as body
       from conversations c
       join users s on s.id = c.shop_id
       join users k on k.id = c.customer_id
      where c.last_message_at < now() - interval '15 minutes'
        and c.last_message_at > now() - interval '1 day'
        and c.shop_read_at < c.last_message_at
        and (c.email_notified_at is null or c.email_notified_at < c.last_message_at)
        and (select m.sender_id from messages m where m.conversation_id = c.id order by m.id desc limit 1) = c.customer_id
        and s.suspended_at is null
      limit 50`,
  );
  for (const r of res.rows) {
    await q('update conversations set email_notified_at = now() where id = $1', [r.id]);
    await sendMail(app.log, {
      to: r.email,
      subject: `Nova poruka od kupca na Komodu: ${r.customer}`,
      text: `Zdravo ${r.shop_name},\n\n${r.customer} ti je pisao na Komodu:\n\n„${r.body}”\n\nOdgovori ovdje: ${APP_URL}/?poruke=${r.id}\n\nKomodo`,
    });
  }
}

/* ---------- greške i start ---------- */

app.setErrorHandler((err, req, reply) => {
  if (err.code === 'FST_REQ_FILE_TOO_LARGE') return bad(reply, 413, `Video je prevelik. Najviše ${MAX_VIDEO_MB} MB.`);
  if (err.statusCode && err.statusCode < 500) return bad(reply, err.statusCode, 'Zahtjev nije ispravan.');
  req.log.error(err);
  return bad(reply, 500, 'Greška na serveru. Pokušaj ponovo.');
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) return bad(reply, 404, 'Ne postoji.');
  return sendIndex(reply);
});

/* ---------- čišćenje ---------- */

// Istekle sesije i tokeni, stara ograničenja i pregledi stariji od 30 dana (u serijama, da ne zaključa tabelu).
async function cleanup() {
  await q('delete from sessions where expires_at < now()');
  await q('delete from email_tokens where expires_at < now()');
  await q("delete from rate_limits where window_start < now() - interval '2 hours'");
  for (let k = 0; k < 20; k += 1) {
    const res = await q(
      `delete from listing_views where ctid in (
         select ctid from listing_views where day < current_date - 30 limit 5000)`,
    );
    if (res.rowCount < 5000) break;
  }
}

/* ---------- start ---------- */

// S više procesa (src/index.js) migracije pokreće primarni proces (KOMODO_MIGRATE=0 u radnicima),
// a pozadinske poslove samo jedan radnik (KOMODO_JOBS=1). `npm run dev` pokreće sve u jednom procesu.
const JOBS = process.env.KOMODO_JOBS !== '0';
if (process.env.KOMODO_MIGRATE !== '0') await migrate(app.log);
await app.listen({ port: PORT, host: HOST });

const timers = [];
if (JOBS) {
  app.log.info(bunnyOn ? 'Snimci idu na Bunny Stream.' : 'Snimci se čuvaju lokalno (Bunny nije podešen).');
  const every = (ms, fn, text) => {
    timers.push(setInterval(() => { fn().catch((err) => app.log.error(err, text)); }, ms));
  };
  cleanup().catch((err) => app.log.error(err, 'Čišćenje nije uspjelo'));
  every(20 * 1000, checkVideos, 'Provjera snimaka nije uspjela');
  every(MIN, notifyUnread, 'Slanje emaila o nepročitanim porukama nije uspjelo');
  every(10 * MIN, cleanup, 'Čišćenje nije uspjelo');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    for (const t of timers) clearInterval(t);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
