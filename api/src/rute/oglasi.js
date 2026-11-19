// Oglasi: feed (s kešom javnog feeda), jedan oglas, objava s videom, izmjena i brisanje.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { q } from '../db.js';
import { bunnyOn } from '../video.js';
import {
  CATEGORIES, LISTING_SELECT, MAX_VIDEO_MB, MIN, UPLOADS_DIR, VIDEO_COLS, VIDEO_EXT, VISIBLE_SQL, bad,
  boundedSet, clean, cleanLine, currentUser, isId, limited, parsePrice, publicListing, removeListingFiles,
} from '../app.js';
import { sendToBunny } from '../poslovi.js';

// Keš javnog feeda: osnovni redovi oglasa (bez liked/mine) po normalizovanim parametrima, 5 sekundi,
// u memoriji svakog procesa. Istovremeni zahtjevi za isti ključ čekaju isti upit.
const FEED_TTL = 5 * 1000;
const FEED_CACHE_MAX = 2000;
const feedCache = new Map();

// S-11: provjera sadržaja snimka po prvim bajtovima (klijent sam bira mimetype). MP4/MOV: kutija na
// pomaku 4 (`ftyp`, a stariji QuickTime može početi s `moov`, `wide`, `mdat`, `free`); WebM: EBML zaglavlje.
const MP4_BOXES = new Set(['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip']);
async function looksLikeVideo(file, ext) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    if (bytesRead < 8) return false;
    if (ext === 'webm') return buf.readUInt32BE(0) === 0x1a45dfa3;
    return MP4_BOXES.has(buf.toString('latin1', 4, 8));
  } finally {
    await fh.close();
  }
}

function feedRows(key, sql, params) {
  const hit = feedCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.rows;
  const rows = q(sql, params).then((r) => r.rows);
  boundedSet(feedCache, key, { rows, exp: Date.now() + FEED_TTL }, FEED_CACHE_MAX);
  rows.catch(() => { if (feedCache.get(key)?.rows === rows) feedCache.delete(key); });
  return rows;
}

export default function rute(app) {
  app.get('/api/listings', async (req) => {
    const user = await currentUser(req);
    const { category, before } = req.query;
    const shop = req.query.shop ? String(req.query.shop).toLowerCase() : '';
    const liked = req.query.liked === '1';
    // Javni keš sadrži samo ono što vide svi (VISIBLE_SQL s $1 = 0: bez oglasa u obradi i u grešci).
    // Mimo keša idu: lista sviđanja, vlastiti profil butika i svaki zahtjev prijavljenog butika — butik
    // mora odmah vidjeti oglas koji je upravo objavio (i svoj oglas u obradi). Butika je ~200, pa to ne
    // opterećuje bazu.
    const direct = liked || (user && ((shop && shop === user.handle) || user.role === 'butik'));
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
            and ${VISIBLE_SQL}${filters}`,
        filterParams,
      );
      out.ukupno = Number(total.rows[0].n);
    }
    return out;
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
    // S-05: ograničenje objava po butiku, prije čitanja tijela (do 100 MB).
    if (await limited(`upload:${user.id}`, 30, 60 * MIN)) return bad(reply, 429, 'Previše objava. Pokušaj ponovo za sat vremena.');

    const fields = {};
    let videoFile = null;
    let problem = null;
    // S-05: fajl koji se upravo piše (partial) ili je upisan (videoFile) briše se i kad slanje pukne
    // (prevelik snimak → FST_REQ_FILE_TOO_LARGE, prekinuta veza → aborted); greška ide dalje rukovaocu.
    let partial = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const ext = VIDEO_EXT[part.mimetype];
          if (part.fieldname !== 'video' || !ext || videoFile) {
            if (!ext) problem = 'Video mora biti MP4, MOV ili WebM.';
            part.file.resume();
            continue;
          }
          const name = `${randomUUID()}.${ext}`;
          partial = path.join(UPLOADS_DIR, name);
          await pipeline(part.file, createWriteStream(partial));
          partial = null;
          videoFile = name;
          if (part.file.truncated) problem = `Video je prevelik. Najviše ${MAX_VIDEO_MB} MB.`;
          else if (!(await looksLikeVideo(path.join(UPLOADS_DIR, name), ext))) problem = 'Video mora biti MP4, MOV ili WebM.';
        } else {
          fields[part.fieldname] = part.value;
        }
      }
    } catch (err) {
      if (partial) await unlink(partial).catch(() => {});
      if (videoFile) await unlink(path.join(UPLOADS_DIR, videoFile)).catch(() => {});
      throw err;
    }

    const title = cleanLine(fields.title, 60);
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
    feedCache.clear(); // ovaj proces odmah; ostali procesi za najviše FEED_TTL
    const res = await q(`${LISTING_SELECT} and l.id = $2`, [user.id, ins.rows[0].id]);
    return reply.code(201).send({ oglas: publicListing(res.rows[0]) });
  });

  // Izmjena oglasa: naziv, cijena, kategorija i oznaka „prodato”. Video se ne mijenja.
  app.patch('/api/listings/:id', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da izmijeniš oglas.');
    if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
    const body = req.body || {};
    const title = cleanLine(body.title, 60);
    const priceCents = parsePrice(body.price);
    const category = clean(body.category, 40);
    if (title.length < 2) return bad(reply, 400, 'Upiši naziv, npr. Crna saten haljina, M.');
    if (priceCents === null) return bad(reply, 400, 'Upiši cijenu u KM brojem, npr. 65 ili 64,90.');
    if (!CATEGORIES.includes(category)) return bad(reply, 400, 'Izaberi kategoriju.');
    const upd = await q(
      `update listings set title = $1, price_cents = $2, category = $3, sold = $4,
              sold_at = case when $4 and not sold then now() when not $4 then null else sold_at end
        where id = $5 and user_id = $6 and deleted_at is null returning id`,
      [title, priceCents, category, body.sold === true, Number(req.params.id), user.id],
    );
    if (upd.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili nije tvoj.');
    feedCache.clear();
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
    feedCache.clear();
    await removeListingFiles(res.rows);
    return { ok: true };
  });
}
