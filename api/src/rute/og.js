// Pregled linka pri dijeljenju (docs/SPEC-V1.md, F-02): Open Graph oznake za /?o=<id> i /?b=<handle> i
// sličica oglasa na našoj adresi (/og/<id>.jpg).
//
// Botovi (Viber, WhatsApp, Facebook, Instagram, iMessage) ne izvršavaju JS, pa server u <head> odgovora na
// GET / ubacuje oznake (ogIndex, koristi ga staticki.js). Na Bunnyju je uključeno „Block direct url file access”
// i ne isključuje se, pa og:image NIKAD ne pokazuje na Bunny: /og/<id>.jpg preuzme thumbnail.jpg sa
// serverske strane (s Refererom APP_URL), sačuva ga na disk (UPLOADS_DIR/og/<id>.jpg) i služi s kešom.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { q } from '../db.js';
import { bunnyOn, mediaUrls } from '../video.js';
import { APP_URL, LISTING_SELECT, UPLOADS_DIR, VISIBLE_SQL, WEB_DIR, boundedSet, isId, publicListing } from '../app.js';

const CACHE_TTL = 60 * 1000; // keš HTML-a i podataka o oglasu u memoriji (po procesu)
const NEG_TTL = 10 * 1000;
const CACHE_MAX = 5000;
const OG_DIR = path.join(UPLOADS_DIR, 'og');
const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT = 5000;
const MAX_PARALLEL = 8; // istovremenih preuzimanja sa Bunnyja po procesu (uz jedno po id-u)
const FAIL_TTL = 30 * 1000; // poslije neuspjeha ne pitamo Bunny ponovo 30 s
// Samo za probu s lažnim Bunny serverom (kao BUNNY_API_BASE u video.js); inače se ne postavlja.
const THUMB_BASE = (process.env.OG_THUMB_BASE || '').replace(/\/$/, '');

mkdirSync(OG_DIR, { recursive: true });

/* ---------- oznake u HTML-u ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Isti oblik kao fmtKM u web/js/osnova.js: „89,90 KM”, „1.200 KM”.
function fmtKM(n) {
  const dec = Math.round(n * 100) % 100 !== 0;
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 })} KM`;
}

function mnozina(n, a, b, c) {
  if (n % 10 === 1 && n % 100 !== 11) return a;
  if (n % 10 >= 2 && n % 10 <= 4 && ![12, 13, 14].includes(n % 100)) return b;
  return c;
}

// Jedan red bez prelaza u novi red, skraćen na `max` znakova.
function line(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const DEFAULT = {
  title: 'Komodo — video oglasi butika iz Banje Luke',
  description: 'Snimi i prodaj. Video oglasi butika iz tvog grada.',
  image: `${APP_URL}/og-komodo.png`,
  url: `${APP_URL}/`,
  size: true,
};

function tags(o) {
  const t = [
    ['property', 'og:title', o.title],
    ['property', 'og:description', o.description],
    ['property', 'og:image', o.image],
    ...(o.size ? [['property', 'og:image:width', '1200'], ['property', 'og:image:height', '630']] : []),
    ['property', 'og:url', o.url],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Komodo'],
    ['property', 'og:locale', 'bs_BA'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', o.title],
    ['name', 'twitter:description', o.description],
    ['name', 'twitter:image', o.image],
  ];
  return t.map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}">`).join('\n');
}

function ogHtml(indexHtml, o) {
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(o.title)}</title>`)
    .replace('</head>', () => `${tags(o)}\n</head>`);
}

async function oglasOg(id) {
  const res = await q(`${LISTING_SELECT} and l.id = $2`, [0, Number(id)]);
  const r = res.rows[0];
  if (!r) return null;
  const l = publicListing(r);
  const u = (await q('select city, address from users where id = $1', [r.user_id])).rows[0] || {};
  const mjesto = line(u.address || u.city, 60);
  const cijena = l.sold ? 'Prodato'
    : l.oldPrice ? `${fmtKM(l.price)} (bilo ${fmtKM(l.oldPrice)})` : fmtKM(l.price);
  const rep = ` · ${cijena}`;
  return {
    title: `${line(l.title, Math.max(10, 70 - rep.length))}${rep}`,
    description: `${line(l.shopName, 60)}${mjesto ? ` · ${mjesto}` : ''}. Pogledaj video na Komodu.`,
    image: l.posterUrl ? `${APP_URL}/og/${l.id}.jpg` : DEFAULT.image,
    size: !l.posterUrl,
    url: `${APP_URL}/?o=${l.id}`,
  };
}

async function butikOg(handle) {
  const res = await q(
    `select u.shop_name, u.handle, u.city, u.address,
            (select count(*) from listings l
              where l.user_id = u.id and l.deleted_at is null and ${VISIBLE_SQL}) as oglasa,
            (select l.id from listings l
              where l.user_id = u.id and l.deleted_at is null and l.video_provider = 'bunny'
                and l.video_status = 'ready' and l.bunny_guid is not null
              order by l.id desc limit 1) as poster_id
       from users u where u.handle = $2 and u.role = 'butik' and u.suspended_at is null`,
    [0, handle],
  );
  const s = res.rows[0];
  if (!s) return null;
  const n = Number(s.oglasa);
  const mjesto = line(s.address || s.city, 60);
  const dio = [n > 0 ? `${n} ${mnozina(n, 'oglas', 'oglasa', 'oglasa')}` : '', mjesto].filter(Boolean).join(' · ');
  const poster = bunnyOn && s.poster_id;
  return {
    title: `${line(s.shop_name, 50)} na Komodu`,
    description: `${dio ? `${dio}. ` : ''}Pogledaj snimke proizvoda.`,
    image: poster ? `${APP_URL}/og/${s.poster_id}.jpg` : DEFAULT.image,
    size: !poster,
    url: `${APP_URL}/?b=${encodeURIComponent(s.handle)}`,
  };
}

// Gotov HTML za zahtjev. Keš po ključu o:<id> / b:<handle> (60 s, najviše 5.000 ključeva); istovremeni
// zahtjevi za isti ključ čekaju isti upit. Nepoznat, obrisan, u obradi ili ugašen → zadane oznake.
const htmlCache = new Map();
export async function ogIndex(indexHtml, query) {
  const one = (v) => (typeof v === 'string' ? v : '');
  const o = one(query?.o);
  const b = one(query?.b).toLowerCase().slice(0, 60);
  let key = 'default';
  if (isId(o)) key = `o:${Number(o)}`;
  else if (b) key = `b:${b}`;
  if (key === 'default') return htmlCache.get(key)?.html ?? setDefault(ogHtml(indexHtml, DEFAULT));
  const hit = htmlCache.get(key);
  if (hit && hit.until > Date.now()) return hit.html;
  const entry = { html: null, until: Date.now() + CACHE_TTL };
  entry.html = (key[0] === 'o' ? oglasOg(key.slice(2)) : butikOg(key.slice(2)))
    .then((og) => {
      // Nepoznat oglas kratko (10 s): novi oglas čiji je link odmah podijeljen ne ostaje „opšti” cijelu minutu.
      if (!og) entry.until = Date.now() + NEG_TTL;
      return ogHtml(indexHtml, og || DEFAULT);
    })
    .catch(() => { entry.until = 0; return ogHtml(indexHtml, DEFAULT); });
  boundedSet(htmlCache, key, entry, CACHE_MAX);
  return entry.html;
}
// R2-03: brisanje i izmjena oglasa, gašenje butika i brisanje naloga poništavaju keš pregleda linka (HTML i
// podatke o oglasu za /og/<id>.jpg) zajedno s kešom feeda (ocistiKesFeeda u src/rute/feed.js, svi procesi).
// Zadani HTML ('default') ne zavisi od podataka i ostaje.
export function ocistiKesOgOvdje() {
  for (const k of htmlCache.keys()) if (k !== 'default') htmlCache.delete(k);
  metaCache.clear();
}
function setDefault(html) {
  htmlCache.set('default', { html, until: Infinity });
  return html;
}

/* ---------- sličica /og/<id>.jpg ---------- */

const metaCache = new Map(); // id → { until, row|null }
const inflight = new Map(); // id → Promise<boolean> (jedno preuzimanje po id-u)
const failed = new Map(); // id → until
let active = 0;
const waiting = [];
let zajednicka = null;

async function meta(id) {
  const hit = metaCache.get(id);
  if (hit && hit.until > Date.now()) return hit.row;
  const res = await q(
    `select l.id, l.video_path, l.video_provider, l.video_status, l.bunny_guid, l.video_res
       from listings l join users u on u.id = l.user_id
      where l.id = $2 and l.deleted_at is null and u.suspended_at is null and ${VISIBLE_SQL}`,
    [0, id],
  );
  const row = res.rows[0] || null;
  boundedSet(metaCache, id, { until: Date.now() + (row ? CACHE_TTL : NEG_TTL), row }, CACHE_MAX);
  return row;
}

async function slot() {
  if (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  active += 1;
}
function release() {
  active -= 1;
  waiting.shift()?.();
}

// Preuzme sličicu s Bunnyja, provjeri da je JPEG do 2 MB i upiši na disk (pa rename, da nepotpun fajl
// nikad ne bude viđen). URL se gradi iz id-a oglasa u bazi (video.js), ništa se ne uzima iz zahtjeva.
async function download(id, posterUrl, file) {
  await slot();
  try {
    const url = THUMB_BASE ? `${THUMB_BASE}/${new URL(posterUrl).pathname.split('/')[1]}/thumbnail.jpg` : posterUrl;
    const res = await fetch(url, {
      headers: { Referer: `${APP_URL}/`, Accept: 'image/jpeg', 'User-Agent': 'KomodoOG/1' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (res.status !== 200 || !res.body) throw new Error(`Bunny ${res.status}`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('prevelika sličica');
    const chunks = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.length;
      if (size > MAX_BYTES) throw new Error('prevelika sličica');
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new Error('nije JPEG');
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
  } finally {
    release();
  }
}

export default function rute(app) {
  app.get('/og/:file', async (req, reply) => {
    const m = /^(\d{1,9})\.jpg$/.exec(String(req.params.file));
    if (!m) return reply.code(404).send({ greska: 'Ne postoji.' });
    const id = Number(m[1]);
    const file = path.join(OG_DIR, `${id}.jpg`);

    const row = await meta(id);
    if (!row) {
      unlink(file).catch(() => {}); // oglas obrisan ili ugašen: ne držimo sličicu
      return reply.code(404).send({ greska: 'Ne postoji.' });
    }

    const sendFile = async () => {
      const st = await stat(file);
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      reply.header('ETag', etag).header('Cache-Control', 'public, max-age=3600');
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.type('image/jpeg').send(await readFile(file));
    };
    const poSlici = async () => { try { return await sendFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } };

    const cached = await poSlici();
    if (cached !== null) return cached;

    // Zajednička slika: lokalni snimak (razvoj), nedostupna ili neispravna sličica na Bunnyju.
    const zadano = async () => {
      zajednicka ??= await readFile(path.join(WEB_DIR, 'og-komodo.png'));
      return reply.type('image/png').header('Cache-Control', 'public, max-age=60').send(zajednicka);
    };
    const posterUrl = mediaUrls(row).posterUrl;
    if (!posterUrl) return zadano();
    if ((failed.get(id) || 0) > Date.now()) return zadano();

    let p = inflight.get(id);
    if (!p) {
      p = download(id, posterUrl, file)
        .then(() => true, (err) => { req.log.warn(`OG sličica ${id}: ${err.message}`); boundedSet(failed, id, Date.now() + FAIL_TTL, CACHE_MAX); return false; })
        .finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    if (!(await p)) return zadano();
    return (await poSlici()) ?? zadano();
  });
}
