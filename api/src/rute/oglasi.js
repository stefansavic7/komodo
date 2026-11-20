// Oglasi: lista (/api/listings), jedan oglas, objava s videom, izmjena i brisanje. Feed (/api/feed) i
// zajednička strana oglasa s kešom su u src/rute/feed.js; ovaj fajl registruje i te rute.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { q } from '../db.js';
import { bunnyOn } from '../video.js';
import {
  CATEGORIES, LISTING_SELECT, MAX_VIDEO_MB, MIN, SIZES, UPLOADS_DIR, VIDEO_COLS, VIDEO_EXT, bad,
  clean, cleanLine, currentUser, inTransaction, isId, limited, parsePrice, publicListing, removeListingFiles,
} from '../app.js';
import { sendToBunny } from '../poslovi.js';
import { obavijestiOSnizenju } from '../snizenje.js';
import feed, { ocistiKesFeeda, stranaOglasa } from './feed.js';

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

// Veličine po kategoriji (docs/SPEC-V1.md, F-03): odjeća + UNI, obuća 35–46, torbe i nakit samo UNI.
const ERR_VEL = 'Veličina nije ispravna za ovu kategoriju.';
const ERR_VEL_NEMA = 'Izaberi bar jednu veličinu.';
function dozvoljeneVelicine(category) {
  if (category === 'Obuća') return SIZES.slice(7);
  if (category === 'Torbe' || category === 'Nakit') return ['UNI'];
  return SIZES.slice(0, 7);
}
// raw: undefined (nije poslano), csv string ili niz. Vraća { sizes } (null = nije poslano, ostaje staro) ili { greska }.
export function provjeriVelicine(category, raw) {
  const dozv = dozvoljeneVelicine(category);
  const samoUni = dozv.length === 1;
  if (raw === undefined || raw === null) return { sizes: samoUni ? ['UNI'] : null };
  let lista;
  if (Array.isArray(raw)) lista = raw;
  else if (typeof raw === 'string') lista = raw.split(',');
  else return { greska: ERR_VEL };
  if (lista.length > 12) return { greska: ERR_VEL };
  const out = [];
  for (const v of lista) {
    if (typeof v !== 'string') return { greska: ERR_VEL };
    const t = v.trim().toUpperCase();
    if (t === '') continue;
    if (!dozv.includes(t)) return { greska: ERR_VEL };
    if (!out.includes(t)) out.push(t);
  }
  if (out.length === 0) return samoUni ? { sizes: ['UNI'] } : { greska: ERR_VEL_NEMA };
  return { sizes: out.sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b)) };
}

const DROP_MS = 7 * 24 * 3600 * 1000;

export default function rute(app) {
  feed(app);

  // Pretraga, profil butika, „Sviđa mi se” i stari klijenti (feed redom id desc). Logika je zajednička s
  // karticom „Novo” (src/rute/feed.js, stranaOglasa).
  app.get('/api/listings', async (req) => {
    const user = await currentUser(req);
    return stranaOglasa(user, req.query);
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
    let sizes = [];
    if (!problem) {
      const v = provjeriVelicine(category, fields.sizes);
      if (v.greska) problem = v.greska; else sizes = v.sizes || [];
    }
    if (problem) {
      if (videoFile) await unlink(path.join(UPLOADS_DIR, videoFile)).catch(() => {});
      return bad(reply, 400, problem);
    }

    const ins = await q(
      `with ins as (
         insert into listings(user_id, title, price_cents, category, video_path, video_provider, video_status, sizes)
         values ($1, $2, $3, $4, $5, $6, $7, $9) returning id),
       s as (insert into listing_scores(listing_id, base_score) select id, 1 from ins where $8)
       select id from ins`,
      // Gotov snimak (bez Bunnyja) odmah dobija početnu ocjenu svježeg oglasa (svježina 1 × kvalitet 1);
      // tačnu računa posao base_score (src/poslovi.js) u roku od 5 minuta. Ocjena je u listing_scores (012).
      [user.id, title, priceCents, category, videoFile, bunnyOn ? 'bunny' : 'local', bunnyOn ? 'processing' : 'ready', !bunnyOn, sizes],
    );
    if (bunnyOn) sendToBunny(ins.rows[0].id).catch(() => {});
    ocistiKesFeeda(); // svi procesi (poruka preko src/index.js)
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
    const vel = body.sizes !== undefined && !Array.isArray(body.sizes) ? { greska: ERR_VEL } : provjeriVelicine(category, body.sizes);
    if (vel.greska) return bad(reply, 400, vel.greska);
    const sold = body.sold === true;
    const id = Number(req.params.id);
    // Sniženje (F-07): ≥ 5 % niže upisuje staru cijenu; povećanje na staru cijenu ili iznad briše precrtavanje.
    let okini = null;
    const upd = await inTransaction(async (c) => {
      const cur = await c.query(
        `select price_cents, category, sizes, old_price_cents, price_dropped_at, video_status,
                price_set_at <= now() - interval '72 hours' as cijena_stara
           from listings where id = $1 and user_id = $2 and deleted_at is null for update`,
        [id, user.id],
      );
      if (cur.rowCount === 0) return null;
      const r = cur.rows[0];
      let sizes = vel.sizes;
      if (sizes === null) {
        // Nije poslano: ostaje staro, osim kad promjena kategorije čini staro neispravnim.
        const dozv = dozvoljeneVelicine(category);
        sizes = r.sizes.every((v) => dozv.includes(v)) ? r.sizes : [];
      }
      const pad = priceCents * 100 <= r.price_cents * 95;
      const aktivno = r.old_price_cents && r.price_dropped_at && Date.now() - new Date(r.price_dropped_at).getTime() < DROP_MS;
      let oldCents = r.old_price_cents;
      let mode = 'keep';
      if (pad) {
        oldCents = aktivno ? Math.max(r.old_price_cents, r.price_cents) : r.price_cents;
        mode = 'now';
      } else if (oldCents && priceCents >= oldCents) {
        oldCents = null;
        mode = 'clear';
      }
      const res = await c.query(
        `update listings set title = $1, price_cents = $2, category = $3, sold = $4, sizes = $5,
                sold_at = case when $4 and not sold then now() when not $4 then null else sold_at end,
                old_price_cents = $6,
                price_dropped_at = case $7 when 'now' then now() when 'clear' then null else price_dropped_at end,
                price_set_at = case when price_cents <> $2 then now() else price_set_at end
          where id = $8 returning id`,
        [title, priceCents, category, sold, sizes, oldCents, mode, id],
      );
      // R2-07: push samo ako je cijena prije ove izmjene važila bar 72 h (zaštita od „digni pa spusti”);
      // precrtana cijena (old_price_cents) se upisuje po starom pravilu.
      if (pad && !sold && r.video_status === 'ready' && r.cijena_stara) okini = { oldCents, newCents: priceCents };
      return res;
    });
    if (!upd) return bad(reply, 404, 'Ovaj oglas ne postoji ili nije tvoj.');
    ocistiKesFeeda();
    const res = await q(`${LISTING_SELECT} and l.id = $2`, [user.id, upd.rows[0].id]);
    if (okini) {
      // Push u pozadini: PATCH ne čeka slanje.
      const info = { listingId: id, shopId: user.id, shopName: user.shop_name, title, ...okini };
      setImmediate(() => { obavijestiOSnizenju(req.log, info).catch((err) => req.log.warn(err, 'Obavještenje o sniženju')); });
    }
    return { oglas: publicListing(res.rows[0]), obavijesteno: !!okini };
  });

  app.delete('/api/listings/:id', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da obrišeš oglas.');
    if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj oglas ne postoji.');
    const res = await q(
      `with d as (
         update listings set deleted_at = now()
          where id = $1 and user_id = $2 and deleted_at is null returning ${VIDEO_COLS}),
       s as (delete from listing_scores where listing_id in (select id from d))
       select * from d`,
      [Number(req.params.id), user.id],
    );
    if (res.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili nije tvoj.');
    ocistiKesFeeda();
    await removeListingFiles(res.rows);
    return { ok: true };
  });
}
