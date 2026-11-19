// Prijave sadržaja (korisnici) i administracija (nalozi iz ADMIN_EMAILS): prijave, nalozi, novi butik, gašenje.
import { q } from '../db.js';
import { createShop } from '../nalog.js';
import { mediaUrls } from '../video.js';
import {
  MIN, REPORT_REASONS, VIDEO_COLS, bad, currentUser, forgetUser, isAdmin, isId, limited, myConversation,
  removeListingFiles,
} from '../app.js';

async function adminUser(req, reply) {
  const user = await currentUser(req);
  if (!isAdmin(user)) { bad(reply, 404, 'Ne postoji.'); return null; }
  return user;
}

export default function rute(app) {
  /* ---------- prijave sadržaja ---------- */

  app.get('/api/report-reasons', async () => ({ razlozi: REPORT_REASONS }));

  app.post('/api/reports', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da prijaviš sadržaj.');
    if (await limited(`report:${user.id}`, 20, 60 * MIN)) return bad(reply, 429, 'Previše prijava. Pokušaj kasnije.');
    const body = req.body || {};
    const reason = REPORT_REASONS.includes(body.reason) ? body.reason : 'Ostalo';
    if (isId(body.listingId)) {
      const l = await q('select 1 from listings where id = $1 and deleted_at is null', [Number(body.listingId)]);
      if (l.rowCount === 0) return bad(reply, 404, 'Ovaj oglas ne postoji ili je obrisan.');
      await q('insert into reports(reporter_id, listing_id, reason) values ($1, $2, $3)', [user.id, Number(body.listingId), reason]);
      return reply.code(201).send({ ok: true });
    }
    if (isId(body.conversationId)) {
      // Prijavljuje se posljednja poruka sagovornika u tom razgovoru.
      const conv = await myConversation(user.id, body.conversationId);
      if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
      const m = await q(
        'select id from messages where conversation_id = $1 and sender_id <> $2 order by id desc limit 1',
        [conv.id, user.id],
      );
      if (m.rowCount === 0) return bad(reply, 400, 'U ovom razgovoru nema poruke sagovornika koju bi prijavio.');
      await q('insert into reports(reporter_id, message_id, reason) values ($1, $2, $3)', [user.id, m.rows[0].id, reason]);
      return reply.code(201).send({ ok: true });
    }
    return bad(reply, 400, 'Nije navedeno šta se prijavljuje.');
  });

  /* ---------- administracija ---------- */

  app.get('/api/admin/reports', async (req, reply) => {
    if (!(await adminUser(req, reply))) return reply;
    const res = await q(
      `select r.id, r.reason, r.created_at, rep.shop_name as reporter,
              l.id as listing_id, l.title, l.video_path, l.video_provider, l.video_status, l.bunny_guid, l.video_res,
              lu.shop_name as shop_name, lu.id as shop_id,
              m.id as message_id, m.body, mu.shop_name as sender_name, mu.id as sender_id
         from reports r
         join users rep on rep.id = r.reporter_id
         left join listings l on l.id = r.listing_id
         left join users lu on lu.id = l.user_id
         left join messages m on m.id = r.message_id
         left join users mu on mu.id = m.sender_id
        where r.resolved_at is null
        order by r.created_at limit 200`,
    );
    return {
      prijave: res.rows.map((r) => ({
        id: r.id, reason: r.reason, at: r.created_at, reporter: r.reporter,
        listing: r.listing_id ? { id: r.listing_id, title: r.title, videoUrl: mediaUrls(r).videoUrl, shopName: r.shop_name, userId: r.shop_id } : null,
        message: r.message_id ? { id: r.message_id, body: r.body, senderName: r.sender_name, userId: r.sender_id } : null,
      })),
    };
  });

  // action: "odbaci" (prijava nije osnovana) ili "ukloni" (briše oglas ili poruku).
  app.post('/api/admin/reports/:id/resolve', async (req, reply) => {
    if (!(await adminUser(req, reply))) return reply;
    if (!isId(req.params.id)) return bad(reply, 404, 'Ova prijava ne postoji.');
    const rep = await q('select * from reports where id = $1 and resolved_at is null', [Number(req.params.id)]);
    if (rep.rowCount === 0) return bad(reply, 404, 'Ova prijava ne postoji ili je već riješena.');
    const r = rep.rows[0];
    if ((req.body || {}).action === 'ukloni') {
      if (r.listing_id) {
        const del = await q(`update listings set deleted_at = now() where id = $1 and deleted_at is null returning ${VIDEO_COLS}`, [r.listing_id]);
        await removeListingFiles(del.rows);
        await q('update reports set resolved_at = now() where listing_id = $1 and resolved_at is null', [r.listing_id]);
      } else {
        await q("update messages set body = '(poruka je uklonjena)' where id = $1", [r.message_id]);
        await q('update reports set resolved_at = now() where message_id = $1 and resolved_at is null', [r.message_id]);
      }
    }
    await q('update reports set resolved_at = now() where id = $1', [r.id]);
    return { ok: true };
  });

  app.get('/api/admin/users', async (req, reply) => {
    if (!(await adminUser(req, reply))) return reply;
    const res = await q(
      `select u.id, u.shop_name, u.handle, u.email, u.role, u.suspended_at, u.created_at,
              (select count(*) from listings l where l.user_id = u.id and l.deleted_at is null) as oglasa
         from users u order by (u.role = 'butik') desc, u.created_at desc limit 500`,
    );
    return {
      nalozi: res.rows.map((u) => ({
        id: u.id, name: u.shop_name, handle: u.handle, email: u.email, role: u.role,
        suspended: u.suspended_at !== null, listings: Number(u.oglasa),
      })),
    };
  });

  app.post('/api/admin/shops', async (req, reply) => {
    if (!(await adminUser(req, reply))) return reply;
    const body = req.body || {};
    try {
      const shop = await createShop({ name: body.name, email: body.email, phone: body.phone });
      return reply.code(201).send({ butik: shop });
    } catch (err) {
      return bad(reply, 400, err.message);
    }
  });

  // Gašenje naloga: korisnik se odjavljuje, a njegovi oglasi i profil nestaju iz aplikacije.
  app.post('/api/admin/users/:id/suspend', async (req, reply) => {
    const admin = await adminUser(req, reply);
    if (!admin) return reply;
    if (!isId(req.params.id)) return bad(reply, 404, 'Ovaj nalog ne postoji.');
    const id = Number(req.params.id);
    if (id === admin.id) return bad(reply, 400, 'Ne možeš ugasiti svoj nalog.');
    const suspended = (req.body || {}).suspended !== false;
    const res = await q(
      'update users set suspended_at = case when $1 then now() else null end where id = $2 returning id',
      [suspended, id],
    );
    if (res.rowCount === 0) return bad(reply, 404, 'Ovaj nalog ne postoji.');
    if (suspended) await q('delete from sessions where user_id = $1', [id]);
    forgetUser(id);
    return { ok: true, suspended };
  });
}
