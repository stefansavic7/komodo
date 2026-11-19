// Pozadinski poslovi: slanje snimaka na Bunny Stream i provjera obrade, email butiku za nepročitane
// poruke i čišćenje starih podataka. Pokreće ih src/server.js (pokreniPoslove) samo u procesu s
// KOMODO_JOBS različitim od '0' (s više procesa to je prvi radnik, vidi src/index.js).
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { q } from './db.js';
import { sendMail } from './mail.js';
import { bunnyOn, bunnyState, deleteFromBunny, uploadToBunny } from './video.js';
import { APP_URL, MIN, UPLOADS_DIR, app, cleanLine } from './app.js';

/* ---------- snimci na Bunny Stream ---------- */

// Snimak se prvo sačuva na disk, pa se u pozadini šalje na Bunny. Dok Bunny ne završi obradu,
// svi gledaju snimak s našeg servera, pa je oglas vidljiv odmah poslije objave.
const uploading = new Set();

export async function sendToBunny(listingId) {
  if (uploading.has(listingId)) return;
  uploading.add(listingId);
  try {
    const res = await q(
      `select id, title, video_path from listings
        where id = $1 and video_provider = 'bunny' and bunny_guid is null and deleted_at is null`,
      [listingId],
    );
    const l = res.rows[0];
    if (!l) return;
    const guid = await uploadToBunny(path.join(UPLOADS_DIR, l.video_path), l.title);
    // `bunny_guid is null`: s više procesa isti snimak može izuzetno poslati i drugi proces; višak se briše.
    const upd = await q(
      'update listings set bunny_guid = $1 where id = $2 and deleted_at is null and bunny_guid is null returning id',
      [guid, l.id],
    );
    if (upd.rowCount === 0) await deleteFromBunny(guid).catch(() => {}); // oglas je obrisan ili već poslan
  } catch (err) {
    app.log.warn(err, `Slanje snimka oglasa ${listingId} na Bunny nije uspjelo, pokušaću ponovo`);
  } finally {
    uploading.delete(listingId);
  }
}

// Svakih 20 sekundi: pošalji snimke koji još nisu poslani i provjeri one koji se obrađuju.
async function checkVideos() {
  if (!bunnyOn) return;
  // Lokalni snimci oglasa koje je Bunny obradio prije više od pola sata više ne trebaju.
  const done = await q(
    `select id, video_path from listings
      where video_provider = 'bunny' and video_status = 'ready' and video_path is not null
        and ready_at < now() - interval '30 minutes'
      limit 50`,
  );
  for (const l of done.rows) {
    await unlink(path.join(UPLOADS_DIR, l.video_path)).catch(() => {});
    await q('update listings set video_path = null where id = $1', [l.id]);
  }
  const pending = await q(
    `select id, bunny_guid, video_path, created_at < now() - interval '10 minutes' as stale from listings
      where video_provider = 'bunny' and video_status = 'processing' and deleted_at is null
      order by id limit 20`,
  );
  for (const l of pending.rows) {
    // Svjež oglas šalje proces koji ga je primio; ovdje se ponovo šalju samo oni kojima to nije uspjelo.
    if (!l.bunny_guid) { if (l.stale) sendToBunny(l.id).catch(() => {}); continue; }
    try {
      const st = await bunnyState(l.bunny_guid);
      if (st.state === 'ready') {
        await q(
          "update listings set video_status = 'ready', video_res = $1, ready_at = now() where id = $2",
          [st.res, l.id],
        );
      } else if (st.state === 'error') {
        await q("update listings set video_status = 'error' where id = $1", [l.id]);
      }
    } catch (err) {
      app.log.warn(err, `Provjera snimka oglasa ${l.id} na Bunnyju nije uspjela`);
    }
  }
}

/* ---------- email butiku za poruku koju nije pročitao 15 minuta ---------- */

async function notifyUnread() {
  const res = await q(
    `select c.id, s.email, s.shop_name, k.shop_name as customer,
            (select m.body from messages m where m.conversation_id = c.id order by m.id desc limit 1) as body
       from conversations c
       join users s on s.id = c.shop_id
       join users k on k.id = c.customer_id
      where c.last_message_at < now() - interval '15 minutes'
        and c.last_message_at > now() - interval '1 day'
        and c.shop_read_at < c.last_message_at
        and (c.email_notified_at is null or c.email_notified_at < c.last_message_at)
        and (select m.sender_id from messages m where m.conversation_id = c.id order by m.id desc limit 1) = c.customer_id
        and s.suspended_at is null
      limit 50`,
  );
  for (const r of res.rows) {
    await q('update conversations set email_notified_at = now() where id = $1', [r.id]);
    await sendMail(app.log, {
      to: r.email,
      subject: `Nova poruka od kupca na Komodu: ${cleanLine(r.customer, 40)}`,
      text: `Zdravo ${cleanLine(r.shop_name, 40)},\n\n${cleanLine(r.customer, 40)} ti je pisao na Komodu:\n\n„${r.body}”\n\nOdgovori ovdje: ${APP_URL}/?poruke=${r.id}\n\nKomodo`,
    });
  }
}

/* ---------- čišćenje ---------- */

// Istekle sesije i tokeni, stara ograničenja i pregledi stariji od 30 dana (u serijama, da ne zaključa tabelu).
async function cleanup() {
  await q('delete from sessions where expires_at < now()');
  await q('delete from email_tokens where expires_at < now()');
  // Dnevne granice (reg:ip:dan) žive 24 h; ostale najviše sat.
  await q(`delete from rate_limits where window_start < now() - interval '2 hours'
             and (key not like '%:dan:%' or window_start < now() - interval '25 hours')`);
  await q("delete from known_devices where seen_at < now() - interval '180 days'");
  await removeOrphanUploads();
  for (let k = 0; k < 20; k += 1) {
    const res = await q(
      `delete from listing_views where ctid in (
         select ctid from listing_views where day < current_date - 30 limit 5000)`,
    );
    if (res.rowCount < 5000) break;
  }
}

// S-05: snimci u UPLOADS_DIR stariji od 2 sata koje ne spominje nijedan oglas (proces je pao usred
// slanja ili poslije upisa fajla, a prije upisa oglasa). Gledaju se samo imena koja pravi server.
const UPLOAD_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$/;
async function removeOrphanUploads() {
  const names = (await readdir(UPLOADS_DIR).catch(() => [])).filter((n) => UPLOAD_NAME.test(n));
  const old = [];
  for (const n of names) {
    const st = await stat(path.join(UPLOADS_DIR, n)).catch(() => null);
    if (st && st.isFile() && st.mtimeMs < Date.now() - 2 * 60 * MIN) old.push(n);
  }
  for (let k = 0; k < old.length; k += 1000) {
    const batch = old.slice(k, k + 1000);
    const used = new Set((await q('select video_path from listings where video_path = any($1::text[])', [batch])).rows.map((r) => r.video_path));
    for (const n of batch) {
      if (!used.has(n)) {
        await unlink(path.join(UPLOADS_DIR, n)).catch(() => {});
        app.log.info(`Obrisan snimak bez oglasa: ${n}`);
      }
    }
  }
}

/* ---------- pokretanje ---------- */

// Pokreće sve poslove i vraća tajmere (src/server.js ih gasi pri zaustavljanju).
export function pokreniPoslove() {
  const timers = [];
  app.log.info(bunnyOn ? 'Snimci idu na Bunny Stream.' : 'Snimci se čuvaju lokalno (Bunny nije podešen).');
  const every = (ms, fn, text) => {
    timers.push(setInterval(() => { fn().catch((err) => app.log.error(err, text)); }, ms));
  };
  cleanup().catch((err) => app.log.error(err, 'Čišćenje nije uspjelo'));
  every(20 * 1000, checkVideos, 'Provjera snimaka nije uspjela');
  every(MIN, notifyUnread, 'Slanje emaila o nepročitanim porukama nije uspjelo');
  every(10 * MIN, cleanup, 'Čišćenje nije uspjelo');
  return timers;
}
