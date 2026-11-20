// Javni profil butika.
import { q } from '../db.js';
import { mediaUrls } from '../video.js';
import { MIN, VISIBLE_SQL, bad, currentUser, forgetUser, limited } from '../app.js';

const MAX_FOLLOWS = 500;

// Praćenje (SPEC-V1, F-04): jedna naredba (jedna transakcija) po obrascu LIKE_SQL. Red u follows se upiše
// (on conflict do nothing) ili obriše (returning), a followers_count butika i following_count korisnika
// mijenjaju se samo za red koji se stvarno promijenio, i to jednim update-om. Istovremeni zahtjevi čekaju
// jedan drugog na jedinstvenom ključu i na redu butika, pa broj u koloni uvijek odgovara broju redova.
// $1 korisnik, $2 handle, $3 'on' | 'off', $4 najviše praćenih.
const FOLLOW_SQL = `
  with s as (select id, followers_count from users
              where handle = $2 and role = 'butik' and suspended_at is null and id <> $1),
  was as (select 1 from follows where user_id = $1 and shop_id in (select id from s)),
  del as (delete from follows where user_id = $1 and shop_id in (select id from s) and $3 = 'off'
          returning 1),
  ins as (insert into follows(user_id, shop_id)
          select $1, id from s
           where $3 = 'on' and (select following_count from users where id = $1) < $4
          on conflict do nothing
          returning 1),
  d as (select (select count(*) from ins) - (select count(*) from del) as delta),
  upd as (update users set
            followers_count = followers_count + case when id <> $1 then (select delta from d) else 0 end,
            following_count = following_count + case when id = $1 then (select delta from d) else 0 end
           where (select delta from d) <> 0 and (id = $1 or id in (select id from s))
          returning id, followers_count)
  select exists(select 1 from s) as found,
         exists(select 1 from was) as was,
         (select count(*) from ins) as inserted,
         (select count(*) from del) as deleted,
         coalesce((select followers_count from upd where id <> $1), (select followers_count from s)) as followers`;

export default function rute(app) {
  // Praćenje butika: idempotentno, ulaz { following: true|false }. Samo na radnju korisnika.
  async function follow(req, reply, want) {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da pratiš butik.');
    if (want === undefined) {
      const body = req.body;
      if (!body || typeof body !== 'object' || typeof body.following !== 'boolean') {
        return bad(reply, 400, 'Polje following mora biti true ili false.');
      }
      want = body.following;
    }
    const handle = String(req.params.handle).toLowerCase().slice(0, 60);
    if (user.handle && user.handle === handle) return bad(reply, 400, 'Ne možeš pratiti svoj butik.');
    if (await limited(`follow:${user.id}`, 60, MIN)) return bad(reply, 429, 'Previše zahtjeva. Sačekaj minut.');
    const res = await q(FOLLOW_SQL, [user.id, handle, want ? 'on' : 'off', MAX_FOLLOWS]);
    const r = res.rows[0];
    if (!r.found) return bad(reply, 404, 'Ovaj butik ne postoji.');
    let following = want;
    if (following && Number(r.inserted) === 0 && !r.was) {
      // Nije upisano: ili je istovremeni zahtjev istog korisnika već upisao red, ili je dostignuta granica.
      const now = await q(
        `select 1 from follows f join users s on s.id = f.shop_id where f.user_id = $1 and s.handle = $2`,
        [user.id, handle],
      );
      if (!now.rowCount) return bad(reply, 400, `Možeš pratiti najviše ${MAX_FOLLOWS} butika.`);
    }
    if (Number(r.inserted) > 0 || Number(r.deleted) > 0) forgetUser(user.id); // following_count je u kešu prijava
    return { following, followers: Number(r.followers) };
  }
  app.post('/api/shops/:handle/follow', (req, reply) => follow(req, reply));
  // Isto što i { following: false }, za klijente koji vole DELETE.
  app.delete('/api/shops/:handle/follow', (req, reply) => follow(req, reply, false));

  // Butici koje korisnik prati (novije prvo, najviše 500). Klijent ga zove jednom po prijavi.
  app.get('/api/me/follows', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da vidiš koga pratiš.');
    const res = await q(
      `select u.handle, u.shop_name, u.city, u.address,
              (select count(*) from listings l
                where l.user_id = u.id and l.deleted_at is null and ${VISIBLE_SQL}) as oglasa
         from follows f join users u on u.id = f.shop_id
        where f.user_id = $1 and u.suspended_at is null
        order by f.created_at desc limit ${MAX_FOLLOWS}`,
      [user.id],
    );
    return {
      butici: res.rows.map((r) => ({
        handle: r.handle, shopName: r.shop_name, city: r.city, address: r.address, listings: Number(r.oglasa),
      })),
    };
  });

  // Polja v1 (docs/SPEC-V1.md, F-04, F-05): address, hours, followers, following, since, verified, posterUrl.
  // Broj oglasa i posterUrl računaju se po istom pravilu vidljivosti kao feed (oglas u obradi vidi samo vlasnik).
  app.get('/api/shops/:handle', async (req, reply) => {
    const user = await currentUser(req);
    const viewer = user ? user.id : 0;
    const res = await q(
      `select u.id, u.shop_name, u.handle, u.phone, u.links, u.city, u.address, u.hours,
              u.followers_count, u.created_at,
              (select count(*) from listings l
                where l.user_id = u.id and l.deleted_at is null and ${VISIBLE_SQL}) as oglasa,
              (select json_build_object('video_path', l.video_path, 'video_provider', l.video_provider,
                                        'video_status', l.video_status, 'bunny_guid', l.bunny_guid,
                                        'video_res', l.video_res)
                 from listings l
                where l.user_id = u.id and l.deleted_at is null and l.video_status = 'ready'
                order by l.id desc limit 1) as poster,
              exists(select 1 from follows f where f.user_id = $1 and f.shop_id = u.id) as following
         from users u where u.handle = $2 and u.role = 'butik' and u.suspended_at is null`,
      [viewer, String(req.params.handle).toLowerCase()],
    );
    const s = res.rows[0];
    if (!s) return bad(reply, 404, 'Ovaj butik ne postoji.');
    return {
      butik: {
        shopName: s.shop_name, handle: s.handle, phone: s.phone,
        links: s.links, city: s.city, listings: Number(s.oglasa),
        address: s.address, hours: s.hours,
        followers: Number(s.followers_count), following: s.following === true,
        since: s.created_at,
        // „Provjeren butik”: butike otvara samo tim nakon provjere radnje (SPEC-V1, odjeljak 7).
        verified: true,
        posterUrl: s.poster ? mediaUrls(s.poster).posterUrl : '',
      },
    };
  });
}
