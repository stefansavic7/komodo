// Javni profil butika.
import { q } from '../db.js';
import { mediaUrls } from '../video.js';
import { VISIBLE_SQL, bad, currentUser } from '../app.js';

export default function rute(app) {
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
