// Poruke kupac–butik: otvaranje razgovora, spisak razgovora, čitanje i slanje poruka, blokiranje.
import { q } from '../db.js';
import { MIN, UNREAD_SQL, VISIBLE_SQL, bad, clean, cleanLine, currentUser, isId, limited, myConversation } from '../app.js';
import { pushNewMessage } from './push.js';

async function blockState(userId, otherId) {
  const res = await q(
    `select blocker_id from blocks
      where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
    [userId, otherId],
  );
  return { mine: res.rows.some((r) => r.blocker_id === userId), any: res.rowCount > 0 };
}

export default function rute(app) {
  // Kupac otvara razgovor s butikom (ili nastavlja postojeći). Butik ne može započeti razgovor.
  app.post('/api/conversations', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da pošalješ poruku.');
    if (user.role !== 'kupac') return bad(reply, 403, 'Razgovor započinje kupac. Butik odgovara na poruke koje dobije.');
    const body = req.body || {};
    const shopRes = await q(
      "select id from users where handle = $1 and role = 'butik' and suspended_at is null",
      [clean(body.shop, 40).toLowerCase()],
    );
    if (shopRes.rowCount === 0) return bad(reply, 404, 'Ovaj butik ne postoji.');
    let listingId = null;
    if (isId(body.listingId)) {
      // R-04: oglas u obradi ili obrisan se ne veže za razgovor (kupac ga ne smije vidjeti).
      const l = await q(`select l.id from listings l where l.id = $2 and l.user_id = $3 and l.deleted_at is null and ${VISIBLE_SQL}`, [user.id, Number(body.listingId), shopRes.rows[0].id]);
      if (l.rowCount > 0) listingId = l.rows[0].id;
    }
    const res = await q(
      `insert into conversations(customer_id, shop_id, listing_id) values ($1, $2, $3)
       on conflict (customer_id, shop_id)
       do update set listing_id = coalesce(excluded.listing_id, conversations.listing_id)
       returning id`,
      [user.id, shopRes.rows[0].id, listingId],
    );
    return { razgovor: res.rows[0].id };
  });

  app.get('/api/conversations', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da vidiš poruke.');
    const res = await q(
      `select c.id, c.last_message_at, o.shop_name as other_name, l.title as listing_title,
              (select m.body from messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
              ${UNREAD_SQL} as unread
         from conversations c
         join users o on o.id = case when c.customer_id = $1 then c.shop_id else c.customer_id end
         left join listings l on l.id = c.listing_id and l.deleted_at is null and ${VISIBLE_SQL}
        where (c.customer_id = $1 or c.shop_id = $1) and c.last_message_at is not null
        order by c.last_message_at desc limit 100`,
      [user.id],
    );
    return {
      razgovori: res.rows.map((r) => ({
        id: r.id, name: r.other_name, listingTitle: r.listing_title,
        last: r.last_body, at: r.last_message_at, unread: r.unread === true,
      })),
    };
  });

  app.get('/api/conversations/:id/messages', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da vidiš poruke.');
    const conv = await myConversation(user.id, req.params.id);
    if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
    const after = isId(req.query.after) ? Number(req.query.after) : 0;
    const msgs = await q(
      'select id, sender_id, body, created_at from messages where conversation_id = $1 and id > $2 order by id limit 300',
      [conv.id, after],
    );
    const mineCol = conv.customer_id === user.id ? 'customer_read_at' : 'shop_read_at';
    await q(`update conversations set ${mineCol} = now() where id = $1`, [conv.id]);
    const otherId = conv.customer_id === user.id ? conv.shop_id : conv.customer_id;
    const other = await q('select shop_name, handle, role from users where id = $1', [otherId]);
    const block = await blockState(user.id, otherId);
    let listing = null;
    if (conv.listing_id) {
      const l = await q(`select l.id, l.title, l.price_cents, l.sizes from listings l where l.id = $2 and l.deleted_at is null and ${VISIBLE_SQL}`, [user.id, conv.listing_id]);
      if (l.rowCount > 0) listing = { id: l.rows[0].id, title: l.rows[0].title, price: l.rows[0].price_cents / 100, sizes: l.rows[0].sizes || [] };
    }
    return {
      sagovornik: { name: other.rows[0].shop_name, handle: other.rows[0].handle, butik: other.rows[0].role === 'butik' },
      oglas: listing,
      blokirao: block.mine,
      blokirano: block.any,
      poruke: msgs.rows.map((m) => ({ id: m.id, body: m.body, mine: m.sender_id === user.id, at: m.created_at })),
    };
  });

  app.post('/api/conversations/:id/messages', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se da pošalješ poruku.');
    if (!user.email_verified_at) return bad(reply, 403, 'Potvrdi email da bi slao poruke. Link ti je stigao na email, a novi tražiš u profilu.');
    if (await limited(`msg:${user.id}`, 30, MIN)) return bad(reply, 429, 'Šalješ previše poruka. Sačekaj minut.');
    const conv = await myConversation(user.id, req.params.id);
    if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
    const otherId = conv.customer_id === user.id ? conv.shop_id : conv.customer_id;
    if ((await blockState(user.id, otherId)).any) return bad(reply, 403, 'Ne možeš pisati u ovom razgovoru jer je blokiran.');
    const text = clean((req.body || {}).body, 1000);
    if (!text) return bad(reply, 400, 'Upiši poruku.');
    const ins = await q(
      'insert into messages(conversation_id, sender_id, body) values ($1, $2, $3) returning id, created_at',
      [conv.id, user.id, text],
    );
    const mineCol = conv.customer_id === user.id ? 'customer_read_at' : 'shop_read_at';
    await q(`update conversations set last_message_at = now(), ${mineCol} = now() where id = $1`, [conv.id]);
    // F-06: kontakt = kupac je pisao iz oglasa (jednom po kupcu i oglasu; otvaranje bez poruke se ne broji).
    if (conv.customer_id === user.id && conv.listing_id) {
      await q('insert into listing_contacts(listing_id, customer_id) values ($1, $2) on conflict do nothing', [conv.listing_id, user.id]);
    }
    pushNewMessage(req.log, otherId, cleanLine(user.shop_name, 40), text, conv.id).catch(() => {});
    return reply.code(201).send({ poruka: { id: ins.rows[0].id, body: text, mine: true, at: ins.rows[0].created_at } });
  });

  // Blokiranje sagovornika: dok traje, niko od dvoje ne može pisati u razgovoru.
  app.post('/api/conversations/:id/block', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se.');
    const conv = await myConversation(user.id, req.params.id);
    if (!conv) return bad(reply, 404, 'Ovaj razgovor ne postoji.');
    const otherId = conv.customer_id === user.id ? conv.shop_id : conv.customer_id;
    if ((req.body || {}).blocked === false) {
      await q('delete from blocks where blocker_id = $1 and blocked_id = $2', [user.id, otherId]);
    } else {
      await q('insert into blocks(blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [user.id, otherId]);
    }
    const block = await blockState(user.id, otherId);
    return { blokirao: block.mine, blokirano: block.any };
  });
}
