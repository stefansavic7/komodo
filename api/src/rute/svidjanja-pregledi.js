// Sviđanja (označavanje i svježi brojevi) i pregledi oglasa. Ugovor: docs/SKALIRANJE.md.
import { q } from '../db.js';
import { bunnyOn } from '../video.js';
import { MIN, bad, currentUser, deviceId, isId, limited, rezim } from '../app.js';

// Oglas u obradi (Bunny uključen) vidi samo vlasnik (docs/PLAN-PRODUKCIJA.md, odj. 4): ostali ga ne mogu
// označiti, ne vide mu broj i ne broje se pregledi. Bez Bunnyja svaki snimak je odmah gotov.
const READY_FOR = bunnyOn ? "(video_status = 'ready' or user_id = $1)" : 'true';

// Sviđanje: s tijelom {liked: true|false} postavlja to stanje (idempotentno), bez tijela radi kao prekidač.
// Jedna naredba (dakle jedna transakcija): red u likes se upiše (on conflict do nothing) ili obriše
// (returning), a za red koji se stvarno promijenio upisuje se razlika (+1/−1) u listing_likes_delta. Istovremeni
// zahtjevi istog kupca čekaju jedan drugog na jedinstvenom ključu u likes, pa zbir razlika uvijek odgovara broju
// redova. Talas 4 („vruć brojač”): red oglasa u listings se više ne mijenja pri svakom sviđanju — hiljade kupaca
// koji označe isti viralni oglas ranije su čekali jedan drugog na tom jednom redu (izmjereno: 1.080 naspram 1.830
// sviđanja/s, docs/ARHITEKTURA.md). Posao sabirSvidjanja (src/poslovi.js) svake sekunde prebacuje razlike u
// likes_count. Broj u odgovoru = likes_count + nesabrane razlike + ova promjena (isti snimak baze).
const LIKE_SQL = `
  with l as (select id, likes_count from listings where id = $2 and deleted_at is null and ${READY_FOR}),
  del as (delete from likes where user_id = $1 and listing_id in (select id from l) and $3 <> 'on'
          returning 1),
  ins as (insert into likes(user_id, listing_id)
          select $1, id from l where $3 = 'on' or ($3 = 'toggle' and not exists (select 1 from del))
          on conflict do nothing
          returning 1),
  d as (select ((select count(*) from ins) - (select count(*) from del))::int as delta),
  dl as (insert into listing_likes_delta(listing_id, delta)
         select id, (select delta from d) from l where (select delta from d) <> 0)
  select exists(select 1 from l) as found,
         ($3 = 'on' or ($3 = 'toggle' and not exists (select 1 from del))) as liked,
         ((select likes_count from l)
           + coalesce((select sum(x.delta) from listing_likes_delta x where x.listing_id = $2), 0)
           + (select delta from d))::int as likes`;

// Pregledi: jedan po oglasu, po gledaocu (prijavljeni korisnik ili uređaj), po danu.
// Vlasnikovi pregledi se ne broje. Jedan upit: upis u listing_views i povećanje views za nove redove.
// S-07: neprijavljeni gledalac je uređaj s potpisanim kolačićem `did`. Uređaj koji ga tek dobija (nema ga
// ili je lažan) se ne broji i ne upisuje ništa u bazu — broji se od sljedećeg zahtjeva. Uz to granica po
// IP adresi, jer kolačić može odbaciti.
async function countViews(req, reply, ids) {
  // Hitni režim (talas 4): pregledi se ne broje (klijent ih tada ni ne šalje), bez ijednog upita.
  if (rezim() === 'hitno') return { ok: true };
  const user = await currentUser(req);
  const did = user ? null : deviceId(req, reply);
  if (!user && req.freshDevice) return { ok: true };
  const viewer = user ? `u${user.id}` : `d${did}`;
  if (await limited(`views:${viewer}`, 30, MIN)) return bad(reply, 429, 'Previše zahtjeva. Sačekaj minut.');
  if (!user && await limited(`views:ip:${req.ip}`, 600, MIN)) return bad(reply, 429, 'Previše zahtjeva. Sačekaj minut.');
  if (ids.length === 0) return { ok: true };
  await q({
    name: bunnyOn ? 'pregledi-bunny' : 'pregledi',
    text: `with novi as (
       insert into listing_views(listing_id, viewer)
       select l.id, $2 from listings l
        where l.id = any($1::int[]) and l.deleted_at is null and l.user_id <> $3${bunnyOn ? " and l.video_status = 'ready'" : ''}
       on conflict do nothing
       returning listing_id
     )
     update listings l set views = l.views + n.broj
       from (select listing_id, count(*)::int as broj from novi group by listing_id) n
      where l.id = n.listing_id`,
    values: [ids, viewer, user ? user.id : 0],
  });
  return { ok: true };
}

export default function rute(app) {
  // Svježi brojevi sviđanja za oglase koji su već na ekranu: /api/likes?ids=1,2,3
  app.get('/api/likes', async (req) => {
    const user = await currentUser(req);
    const ids = String(req.query.ids ?? '').split(',').filter(isId).slice(0, 100).map(Number);
    if (ids.length === 0) return { svidjanja: {} };
    const res = await q({
      name: 'svidjanja-ekran',
      text: `select l.id, (l.likes_count + coalesce((select sum(x.delta) from listing_likes_delta x where x.listing_id = l.id), 0))::int as likes_count,
              exists(select 1 from likes k where k.user_id = $1 and k.listing_id = l.id) as liked
         from listings l where l.id = any($2::int[]) and l.deleted_at is null
          and ${READY_FOR.replace(/video_status|user_id/g, (c) => `l.${c}`)}`,
      values: [user ? user.id : 0, ids],
    });
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
    // Imenovana naredba: plan se pravi jednom po vezi (talas 4 — čitanje nesabranih razlika ne smije poskupiti rutu).
    const res = await q({ name: 'svidjanje', text: LIKE_SQL, values: [user.id, Number(req.params.id), mode] });
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
