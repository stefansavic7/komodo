// Vlastiti nalog: /api/me (čitanje i izmjena profila), promjena lozinke i trajno brisanje naloga.
import { q } from '../db.js';
import { checkPassword, hashPassword } from '../nalog.js';
import { ocistiKesFeeda } from './feed.js';
import {
  VIDEO_COLS, bad, cleanLine, currentUser, hashToken, forgetUser, inTransaction, normalizeLinks, publicUser,
  removeListingFiles, unreadCount,
} from '../app.js';

// Radno vrijeme (SPEC-V1, F-05): null ili { rd, sub, ned }, svaki [od, do] ("09:00") ili null (ne radi).
// Vraća normalizovan objekat, null (briše) ili undefined kad ulaz nije ispravan.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOURS_ERR = 'Radno vrijeme upiši kao 09:00–20:00, a zatvaranje mora biti poslije otvaranja.';
export function normalizeHours(input) {
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return undefined;
  const keys = Object.keys(input);
  if (keys.some((k) => !['rd', 'sub', 'ned'].includes(k))) return undefined;
  const out = {};
  for (const k of ['rd', 'sub', 'ned']) {
    const v = input[k];
    if (v === undefined || v === null) { out[k] = null; continue; }
    if (!Array.isArray(v) || v.length !== 2) return undefined;
    const [from, to] = v;
    if (typeof from !== 'string' || typeof to !== 'string' || !TIME_RE.test(from) || !TIME_RE.test(to)) return undefined;
    if (from >= to) return undefined; // bez rada preko ponoći
    out[k] = [from, to];
  }
  return out;
}

export default function rute(app) {
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
    const shopName = cleanLine(body.name ?? user.shop_name, 40);
    const phone = isShop ? cleanLine(body.phone ?? user.phone, 30) : user.phone;
    const links = !isShop || body.links === undefined ? user.links : normalizeLinks(body.links);
    // Adresa i radno vrijeme: samo butik; kupcu se polja ignorišu.
    let address = user.address ?? '';
    let hours = user.hours ?? null;
    if (isShop && body.address !== undefined) {
      if (typeof body.address !== 'string') return bad(reply, 400, 'Adresa nije ispravna.');
      address = body.address.replace(/\s+/g, ' ').trim();
      if (address.length > 120) return bad(reply, 400, 'Adresa može imati najviše 120 znakova.');
    }
    if (isShop && body.hours !== undefined) {
      hours = normalizeHours(body.hours);
      if (hours === undefined) return bad(reply, 400, HOURS_ERR);
    }
    const pushEnabled = typeof body.pushEnabled === 'boolean' ? body.pushEnabled : user.push_enabled;
    if (shopName.length < 2) return bad(reply, 400, isShop ? 'Upiši naziv butika.' : 'Upiši svoje ime.');
    if (phone && !/^[0-9+ /()-]{6,30}$/.test(phone)) return bad(reply, 400, 'Telefon upiši brojevima, npr. 065 123 456.');
    if (links === null) return bad(reply, 400, 'Link nije ispravan. Upiši ga kao instagram.com/moj.butik, najviše 5 linkova.');
    const res = await q(
      `update users set shop_name = $1, phone = $2, links = $3::jsonb, push_enabled = $4,
              address = $5, hours = $6::jsonb where id = $7 returning *`,
      [shopName, phone, JSON.stringify(links), pushEnabled, address, hours === null ? null : JSON.stringify(hours), user.id],
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
    await q('delete from sessions where user_id = $1 and token <> $2', [user.id, hashToken(req.cookies.sid)]);
    forgetUser(user.id);
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
    // Sviđanja korisnika se brišu u istoj transakciji, a brojač oglasa umanjuje preko listing_likes_delta.
    await inTransaction(async (c) => {
      // Praćenje: redovi follows nestaju kaskadno, pa se u istoj transakciji umanjuju brojači onih koje
      // to dira — followers_count butika koje je korisnik pratio i following_count njegovih pratilaca
      // (ako je butik). Redovi korisnika se zaključavaju jednim upitom po id-ju, kao za listings.
      await c.query(
        `select id from users
          where id = $1
             or id in (select shop_id from follows where user_id = $1)
             or id in (select user_id from follows where shop_id = $1)
          order by id for update`,
        [user.id],
      );
      await c.query(
        `update users u set followers_count = greatest(u.followers_count - 1, 0)
           from follows f where f.shop_id = u.id and f.user_id = $1`,
        [user.id],
      );
      await c.query(
        `update users u set following_count = greatest(u.following_count - 1, 0)
           from follows f where f.user_id = u.id and f.shop_id = $1`,
        [user.id],
      );
      // Talas 4 (vruć brojač): sviđanja korisnika se brišu ovdje (ne kaskadno), a za svako obrisano ide −1 u
      // listing_likes_delta; posao ga sabere u likes_count. Ne zaključava redove oglasa, a `returning` vraća samo
      // redove koje je ova naredba stvarno obrisala (istovremeni „ne sviđa mi se” istog reda se ne broji dvaput).
      await c.query(
        `with d as (delete from likes where user_id = $1 returning listing_id)
         insert into listing_likes_delta(listing_id, delta) select listing_id, -1 from d`,
        [user.id],
      );
      await c.query('delete from users where id = $1', [user.id]);
    });
    forgetUser(user.id);
    if (files.rows.length) ocistiKesFeeda(); // R2-03: oglasi obrisanog butika odmah nestaju iz feeda i OG keša
    await removeListingFiles(files.rows);
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });
}
