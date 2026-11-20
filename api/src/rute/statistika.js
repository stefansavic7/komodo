// Statistika (docs/SPEC-V1.md, F-06 i F-09): GET /api/me/stats (butik) i GET /api/admin/stats (administrator).
// Oba odgovora su skupa (agregati nad listing_views, likes, listing_contacts), pa idu kroz keš u procesu s
// dijeljenjem istovremenih upita; klijent ih zove samo otvaranjem ekrana (bez tajmera).
// Registruje ih rute/prijave-admin.js (da server.js ostane netaknut).
import { q } from '../db.js';
import { mediaUrls } from '../video.js';
import { bad, boundedSet, currentUser, isAdmin } from '../app.js';

// Keš po (butik, period): SPEC kaže 5 min („Brojke se osvježavaju svakih 5 minuta”). STATS_CACHE_MS gazi (testovi).
const STATS_TTL = process.env.STATS_CACHE_MS !== undefined ? Number(process.env.STATS_CACHE_MS) : 5 * 60 * 1000;
const STATS_CACHE_MAX = 2000;
const statsCache = new Map();

// Admin brojke: globalni keš 60 s.
const ADMIN_TTL = process.env.ADMIN_STATS_CACHE_MS !== undefined ? Number(process.env.ADMIN_STATS_CACHE_MS) : 60 * 1000;
let adminCache = null;

// Jedan poziv baze: CTE `my` (id-jevi neobrisanih oglasa butika), pa agregati po `listing_id` preko primarnog
// ključa listing_views, likes_listing_idx i primarnog ključa listing_contacts. „Period” uključuje danas:
// listing_views.day > current_date - period; ostalo created_at >= current_date - (period - 1).
const STATS_SQL = `
  with my as (select id from listings where user_id = $1 and deleted_at is null),
  vd as (
    select lv.listing_id, lv.day from listing_views lv join my on my.id = lv.listing_id
     where lv.day > current_date - $2::int
  ),
  vl as (select listing_id, count(*)::int as n from vd group by listing_id),
  vday as (select day, count(*)::int as n from vd group by day),
  lk as (
    select k.listing_id, count(*)::int as n from likes k join my on my.id = k.listing_id
     where k.created_at >= current_date - ($2::int - 1) group by k.listing_id
  ),
  ct as (
    select c.listing_id, count(*)::int as n from listing_contacts c join my on my.id = c.listing_id
     where c.created_at >= current_date - ($2::int - 1) group by c.listing_id
  ),
  ol as (
    select l.id, l.title, l.price_cents, l.sold, l.created_at, l.video_path, l.video_provider, l.video_status,
           l.bunny_guid, l.video_res, coalesce(vl.n, 0) as views, coalesce(lk.n, 0) as likes,
           coalesce(ct.n, 0) as contacts, l.views as views_all, l.likes_count as likes_all
      from listings l
      join my on my.id = l.id
      left join vl on vl.listing_id = l.id
      left join lk on lk.listing_id = l.id
      left join ct on ct.listing_id = l.id
     order by coalesce(vl.n, 0) desc, l.id desc
     limit 500
  )
  select
    to_char(current_date - ($2::int - 1), 'YYYY-MM-DD') as od,
    to_char(current_date, 'YYYY-MM-DD') as "do",
    (select coalesce(sum(n), 0)::int from vl) as views,
    (select coalesce(sum(n), 0)::int from lk) as likes,
    (select coalesce(sum(n), 0)::int from ct) as contacts,
    (select count(*)::int from follows where shop_id = $1 and created_at >= current_date - ($2::int - 1)) as new_followers,
    (select followers_count from users where id = $1) as followers,
    (select coalesce(json_agg(json_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'views', coalesce(vday.n, 0)) order by d.day), '[]'::json)
       from (select current_date - g as day from generate_series($2::int - 1, 0, -1) g) d
       left join vday on vday.day = d.day) as dani,
    (select coalesce(json_agg(row_to_json(ol) order by ol.views desc, ol.id desc), '[]'::json) from ol) as oglasi`;

async function loadStats(shopId, period) {
  const r = (await q(STATS_SQL, [shopId, period])).rows[0];
  return {
    period, od: r.od, do: r.do,
    ukupno: { views: r.views, likes: r.likes, contacts: r.contacts, newFollowers: r.new_followers, followers: Number(r.followers || 0) },
    dani: r.dani,
    oglasi: r.oglasi.map((l) => ({
      id: l.id, title: l.title, price: l.price_cents / 100, ...mediaUrls(l), sold: l.sold === true,
      createdAt: l.created_at, views: l.views, likes: l.likes, contacts: l.contacts,
      viewsAll: l.views_all, likesAll: l.likes_all,
    })),
  };
}

// Istovremeni zahtjevi za isti ključ čekaju isti upit (isti obrazac kao feedCache).
function cached(map, key, ttl, limit, load) {
  const hit = map.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = load();
  boundedSet(map, key, { exp: Date.now() + ttl, p }, limit);
  p.catch(() => { if (map.get(key) && map.get(key).p === p) map.delete(key); });
  return p;
}

async function loadAdmin() {
  const [dani, ukupno, az] = await Promise.all([
    q(`select to_char(current_date - g, 'YYYY-MM-DD') as day, coalesce(s.active, 0) as active,
              coalesce(s.active_users, 0) as active_users, coalesce(s.active_devices, 0) as active_devices,
              coalesce(s.registrations, 0) as registrations, coalesce(s.shops, 0) as shops,
              coalesce(s.listings, 0) as listings, coalesce(s.messages, 0) as messages,
              coalesce(s.conversations, 0) as conversations
         from generate_series(0, 29) g
         left join daily_stats s on s.day = current_date - g
        order by g`),
    q(`select (select count(*) from users where role = 'kupac')::int as users,
              (select count(*) from users where role = 'butik')::int as shops,
              (select count(*) from listings where deleted_at is null)::int as listings`),
    q('select max(updated_at) as t from daily_stats'),
  ]);
  return {
    azurirano: az.rows[0].t,
    ukupno: ukupno.rows[0],
    dani: dani.rows.map((d) => ({
      day: d.day, active: d.active, activeUsers: d.active_users, activeDevices: d.active_devices,
      registrations: d.registrations, shops: d.shops, listings: d.listings, messages: d.messages,
      conversations: d.conversations,
    })),
  };
}

export default function rute(app) {
  app.get('/api/me/stats', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se.');
    if (user.role !== 'butik') return bad(reply, 403, 'Statistika je dostupna samo butiku.');
    const raw = req.query.period;
    const period = raw === undefined ? 7 : (raw === '7' ? 7 : (raw === '30' ? 30 : 0));
    if (!period) return bad(reply, 400, 'Period može biti 7 ili 30 dana.');
    return { statistika: await cached(statsCache, `${user.id}:${period}`, STATS_TTL, STATS_CACHE_MAX, () => loadStats(user.id, period)) };
  });

  app.get('/api/admin/stats', async (req, reply) => {
    const user = await currentUser(req);
    if (!isAdmin(user)) return bad(reply, 404, 'Ne postoji.');
    if (!adminCache || adminCache.exp <= Date.now()) {
      const p = loadAdmin();
      adminCache = { exp: Date.now() + ADMIN_TTL, p };
      p.catch(() => { if (adminCache && adminCache.p === p) adminCache = null; });
    }
    return { brojke: await adminCache.p };
  });
}
