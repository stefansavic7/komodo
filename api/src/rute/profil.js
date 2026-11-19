// Vlastiti nalog: /api/me (čitanje i izmjena profila), promjena lozinke i trajno brisanje naloga.
import { q } from '../db.js';
import { checkPassword, hashPassword } from '../nalog.js';
import {
  VIDEO_COLS, bad, cleanLine, currentUser, hashToken, forgetUser, inTransaction, normalizeLinks, publicUser,
  removeListingFiles, unreadCount,
} from '../app.js';

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
}
