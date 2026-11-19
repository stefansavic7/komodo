// Sviđanja (označavanje i svježi brojevi) i pregledi oglasa. Ugovor: docs/SKALIRANJE.md.
import { q } from '../db.js';
import { bunnyOn } from '../video.js';
import { MIN, bad, currentUser, deviceId, isId, limited } from '../app.js';

// Oglas u obradi (Bunny uključen) vidi samo vlasnik (docs/PLAN-PRODUKCIJA.md, odj. 4): ostali ga ne mogu
// označiti, ne vide mu broj i ne broje se pregledi. Bez Bunnyja svaki snimak je odmah gotov.
const READY_FOR = bunnyOn ? "(video_status = 'ready' or user_id = $1)" : 'true';

// Sviđanje: s tijelom {liked: true|false} postavlja to stanje (idempotentno), bez tijela radi kao prekidač.
// Jedna naredba (dakle jedna transakcija): red u likes se upiše (on conflict do nothing) ili obriše
// (returning), a likes_count se mijenja samo za red koji se stvarno promijenio. Istovremeni zahtjevi čekaju
// jedan drugog na jedinstvenom ključu i na redu oglasa, pa broj u koloni uvijek odgovara broju redova.
const LIKE_SQL = `
  with l as (select id, likes_count from listings where id = $2 and deleted_at is null and ${READY_FOR}),
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

// Pregledi: jedan po oglasu, po gledaocu (prijavljeni korisnik ili uređaj), po danu.
// Vlasnikovi pregledi se ne broje. Jedan upit: upis u listing_views i povećanje views za nove redove.
// S-07: neprijavljeni gledalac je uređaj s potpisanim kolačićem `did`. Uređaj koji ga tek dobija (nema ga
// ili je lažan) se ne broji i ne upisuje ništa u bazu — broji se od sljedećeg zahtjeva. Uz to granica po
// IP adresi, jer kolačić može odbaciti.
async function countViews(req, reply, ids) {
  const user = await currentUser(req);
  const did = user ? null : deviceId(req, reply);
  if (!user && req.freshDevice) return { ok: true };
  const viewer = user ? `u${user.id}` : `d${did}`;
  if (await limited(`views:${viewer}`, 30, MIN)) return bad(reply, 429, 'Previše zahtjeva. Sačekaj minut.');
  if (!user && await limited(`views:ip:${req.ip}`, 600, MIN)) return bad(reply, 429, 'Previše zahtjeva. Sačekaj minut.');
  if (ids.length === 0) return { ok: true };
  await q(
    `with novi as (
       insert into listing_views(listing_id, viewer)
       select l.id, $2 from listings l
        where l.id = any($1::int[]) and l.deleted_at is null and l.user_id <> $3${bunnyOn ? " and l.video_status = 'ready'" : ''}
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

export default function rute(app) {
  // Svježi brojevi sviđanja za oglase koji su već na ekranu: /api/likes?ids=1,2,3
  app.get('/api/likes', async (req) => {
    const user = await currentUser(req);
    const ids = String(req.query.ids ?? '').split(',').filter(isId).slice(0, 100).map(Number);
    if (ids.length === 0) return { svidjanja: {} };
    const res = await q(
      `select l.id, l.likes_count,
              exists(select 1 from likes k where k.user_id = $1 and k.listing_id = l.id) as liked
         from listings l where l.id = any($2::int[]) and l.deleted_at is null
          and ${READY_FOR.replace(/video_status|user_id/g, (c) => `l.${c}`)}`,
      [user ? user.id : 0, ids],
    );
    const out = {};
    for (const r of res.rows) out[r.id] = { likes: r.likes_count, liked: r.liked === true };
    return { svidjanja: out };
  });

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
}
