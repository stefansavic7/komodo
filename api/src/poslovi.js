// Pozadinski poslovi: slanje snimaka na Bunny Stream i provjera obrade, email butiku za nepročitane
// poruke, čišćenje starih podataka i ocjena oglasa za feed (base_score, svakih 5 min) i brojke za administraciju (daily_stats, svakih 15 min). Pokreće ih src/server.js (pokreniPoslove) samo u procesu s
// KOMODO_JOBS različitim od '0' (s više procesa to je prvi radnik, vidi src/index.js).
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
// Poslovi idu kroz poseban bazen s dužim rokom za upit (qPosao, PG_STATEMENT_TIMEOUT_POSAO_MS), ne kroz bazen API-ja.
import { poolPosao, qPosao as q, uTransakciji } from './db.js';
import { obradiOutbox } from './outbox.js';
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
        await q("update listings set video_status = 'ready', video_res = $1, ready_at = now() where id = $2", [st.res, l.id]);
        // Početna ocjena svježeg oglasa (F-01); tačnu računa posao base_score u roku od 5 minuta.
        await q(
          `insert into listing_scores as t (listing_id, base_score) values ($1, 1)
           on conflict (listing_id) do update set base_score = greatest(t.base_score, 1)`,
          [l.id],
        );
      } else if (st.state === 'error') {
        await q("update listings set video_status = 'error' where id = $1", [l.id]);
      }
    } catch (err) {
      app.log.warn(err, `Provjera snimka oglasa ${l.id} na Bunnyju nije uspjela`);
    }
  }
}

/* ---------- ocjena oglasa za „Za tebe” (docs/SPEC-V1.md, F-01, korak 1) ---------- */

// Ocjena je u zasebnoj tabeli listing_scores (migracija 012, R2-02), samo oglasi s ocjenom > 0. Posao čita
// listings bez zaključavanja i piše samo u listing_scores, pa se ne sudara sa sviđanjima i pregledima
// (update likes_count/views u listings). Ranije je ocjena bila u listings i svaka serija je zaključavala hiljade
// redova koje mijenjaju /like i /view (p95 do 1,4 s dok posao radi).
// Računaju se oglasi zadnjih 30 dana i svi koji još imaju ocjenu (da obrisani, ugašeni, stari i davno prodati
// izgube red). U serijama po id-ju; red se upisuje samo kad se ocjena promijeni za više od 1 % (svježina se za
// 5 min promijeni za 0,08 %, a redoslijed ne mijenja), a briše kad padne na 0.
const SCORE_BATCH = 1000;

const SCORE_SQL = `
  with c as (
    select listing_id, count(*)::float8 as n from listing_contacts where listing_id = any($1::int[]) group by listing_id
  ),
  n as (
    select l.id,
      (case
        when l.deleted_at is not null or l.video_status <> 'ready' or u.suspended_at is not null
          or l.created_at < now() - interval '30 days'
          or (l.sold and l.sold_at < now() - interval '3 days') then 0
        else power(0.5, extract(epoch from now() - l.created_at) / 3600 / 72)
           * least(3, greatest(0.5,
               ((l.likes_count + 3 * coalesce(c.n, 0) + 20 * $2::float8) / (l.views + 20)) / $2::float8))
           * (case when l.sold then 0.3 else 1 end)
           * (case when u.created_at > now() - interval '14 days' then 1.2 else 1 end)
       end)::real as s
      from listings l
      join users u on u.id = l.user_id
      left join c on c.listing_id = l.id
     where l.id = any($1::int[])
  ),
  del as (
    delete from listing_scores t using n where t.listing_id = n.id and n.s = 0 returning 1
  ),
  up as (
    insert into listing_scores as t (listing_id, base_score)
    select id, s from n where s > 0
    on conflict (listing_id) do update set base_score = excluded.base_score
     where abs(t.base_score - excluded.base_score) > 0.01 * greatest(t.base_score, excluded.base_score)
    returning 1
  )
  select (select count(*) from del)::int + (select count(*) from up)::int as n`;

export async function izracunajOcjene() {
  // r_avg: prosjek (sviđanja + 3·kontakti) / pregledi za oglase zadnjih 30 dana s bar 20 pregleda; 0,05 ako
  // takvih nema (ili su svi bez reakcija).
  const avg = await q(
    `select avg((l.likes_count + 3 * coalesce(c.n, 0))::float8 / l.views) as r
       from listings l
       left join lateral (select count(*) as n from listing_contacts k where k.listing_id = l.id) c on true
      where l.deleted_at is null and l.created_at > now() - interval '30 days' and l.views >= 20`,
  );
  const rAvg = Number(avg.rows[0].r) > 0 ? Number(avg.rows[0].r) : 0.05;
  // listings_fresh_idx (svježi) + listing_scores (s ocjenom, i obrisani).
  const ids = (await q(
    `select id from listings where deleted_at is null and created_at > now() - interval '30 days'
     union
     select listing_id from listing_scores
     order by 1`,
  )).rows.map((r) => r.id);
  let promijenjeno = 0;
  for (let k = 0; k < ids.length; k += SCORE_BATCH) {
    const res = await q(SCORE_SQL, [ids.slice(k, k + SCORE_BATCH), rAvg]);
    promijenjeno += Number(res.rows[0].n);
  }
  return { oglasa: ids.length, promijenjeno, rAvg };
}

/* ---------- brojke za administraciju (docs/SPEC-V1.md, F-09) ---------- */

// Za jedan dan jedna naredba: `insert … on conflict (day) do update`. Pregledi se broje po različitom
// gledaocu ('u…' prijavljen, 'd…' uređaj; isti čovjek prije i poslije prijave se broji dvaput), ostalo
// preko BRIN indeksa na created_at. Računaju se danas i juče (juče se još dopunjuje poslije ponoći).
const DAILY_SQL = `
  insert into daily_stats(day, active, active_users, active_devices, registrations, shops, listings, messages, conversations, updated_at)
  select d.day,
         v.u + v.dv, v.u, v.dv,
         (select count(*) from users where role = 'kupac' and created_at >= d.day and created_at < d.day + 1),
         (select count(*) from users where role = 'butik' and created_at >= d.day and created_at < d.day + 1),
         (select count(*) from listings where created_at >= d.day and created_at < d.day + 1),
         (select count(*) from messages where created_at >= d.day and created_at < d.day + 1),
         (select count(*) from conversations where created_at >= d.day and created_at < d.day + 1),
         now()
    from (select $1::date as day) d,
         lateral (select count(distinct viewer) filter (where viewer like 'u%') as u,
                         count(distinct viewer) filter (where viewer like 'd%') as dv
                    from listing_views where day = d.day) v
  on conflict (day) do update set
    active = excluded.active, active_users = excluded.active_users, active_devices = excluded.active_devices,
    registrations = excluded.registrations, shops = excluded.shops, listings = excluded.listings,
    messages = excluded.messages, conversations = excluded.conversations, updated_at = excluded.updated_at`;

export async function izracunajDnevneBrojke() {
  const today = (await q("select to_char(current_date, 'YYYY-MM-DD') as d, to_char(current_date - 1, 'YYYY-MM-DD') as j")).rows[0];
  for (const day of [today.j, today.d]) await q(DAILY_SQL, [day]);
  return { dani: [today.j, today.d] };
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
  // Talas 4: ključevi protiv duplog slanja žive 24 h; poslani redovi outboxa 7 dana, mrtvi 30 dana (za uvid).
  await q("delete from idempotency_keys where created_at < now() - interval '24 hours'");
  await q(`delete from outbox where (sent_at is not null and created_at < now() - interval '7 days')
                                  or (dead_at is not null and created_at < now() - interval '30 days')`);
  await removeOrphanUploads();
  await removeStaleOg();
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

// Sličice pregleda linka (UPLOADS_DIR/og/<id>.jpg) oglasa koji više nisu vidljivi (obrisan ili ne postoji).
// Briše se samo ono što je starije od sat vremena; ako oglas ponovo bude traženo, sličica se opet pravi.
async function removeStaleOg() {
  const dir = path.join(UPLOADS_DIR, 'og');
  const names = (await readdir(dir).catch(() => [])).filter((n) => /^\d+\.jpg$/.test(n));
  for (let k = 0; k < names.length; k += 1000) {
    const batch = names.slice(k, k + 1000);
    const ids = batch.map((n) => Number(n.slice(0, -4)));
    const live = new Set((await q('select id from listings where id = any($1::bigint[]) and deleted_at is null', [ids])).rows.map((r) => String(r.id)));
    for (const n of batch) {
      if (live.has(n.slice(0, -4))) continue;
      const st = await stat(path.join(dir, n)).catch(() => null);
      if (st && st.mtimeMs < Date.now() - 60 * MIN) {
        await unlink(path.join(dir, n)).catch(() => {});
        app.log.info(`Obrisana sličica oglasa koji nije vidljiv: og/${n}`);
      }
    }
  }
}

/* ---------- vruć brojač: razlike sviđanja → listings.likes_count (talas 4) ---------- */

// Sviđanje upisuje +1/−1 u listing_likes_delta (src/rute/svidjanja-pregledi.js), a ovaj posao svake sekunde u jednoj
// transakciji obriše do 50.000 razlika i doda njihov zbir u likes_count (jedan update po oglasu, umjesto jednog po
// sviđanju). Ko čita broj, čita likes_count + još nesabrane razlike (isti snimak baze), pa je broj uvijek tačan.
// Redovi oglasa se zaključavaju po redu id-ja, a lock_timeout 200 ms čini da u sudaru s brojanjem pregleda ustukne
// ovaj posao (pokuša ponovo za sekundu), ne zahtjev korisnika.
const SABIR_SERIJA = 50000;
export async function saberiSvidjanja() {
  try {
    return await uTransakciji(poolPosao(), async (c) => {
      await c.query("set local lock_timeout = '200ms'");
      const d = await c.query(
        `with d as (delete from listing_likes_delta where id in (select id from listing_likes_delta order by id limit $1)
                    returning listing_id, delta)
         select listing_id, sum(delta)::int as n, count(*)::int as redova from d group by listing_id order by listing_id`,
        [SABIR_SERIJA],
      );
      const ids = [];
      const ns = [];
      let redova = 0;
      for (const r of d.rows) {
        redova += r.redova;
        if (r.n !== 0) { ids.push(r.listing_id); ns.push(r.n); }
      }
      if (ids.length) {
        await c.query('select id from listings where id = any($1::int[]) order by id for no key update', [ids]);
        await c.query(
          `update listings l set likes_count = l.likes_count + v.n
             from unnest($1::int[], $2::int[]) as v(id, n) where l.id = v.id`,
          [ids, ns],
        );
      }
      return { redova, oglasa: ids.length };
    });
  } catch (err) {
    if (err.code === '55P03') return { redova: 0, oglasa: 0, ceka: true }; // red oglasa zaključan: sljedeći put
    throw err;
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
  // Talas 4: razlike sviđanja (KOMODO_SABIR_MS, zadano 1 s) i outbox (OUTBOX_MS, zadano 1 s). Prolaz koji još traje
  // se ne pokreće ponovo (jedan po jedan), da spora baza ne nagomila istovremene prolaze.
  const jedanPoJedan = (fn) => { let radi = false; return async () => { if (radi) return; radi = true; try { await fn(); } finally { radi = false; } }; };
  every(Math.max(100, Number(process.env.KOMODO_SABIR_MS) || 1000), jedanPoJedan(saberiSvidjanja), 'Sabiranje sviđanja nije uspjelo');
  every(Math.max(100, Number(process.env.OUTBOX_MS) || 1000), jedanPoJedan(() => obradiOutbox(app.log)), 'Slanje iz outboxa nije uspjelo');
  every(10 * MIN, cleanup, 'Čišćenje nije uspjelo');
  const ocjene = () => izracunajOcjene().then((r) => {
    app.log.info(`base_score: ${r.oglasa} oglasa, promijenjeno ${r.promijenjeno}, r_avg ${r.rAvg.toFixed(4)}`);
  });
  ocjene().catch((err) => app.log.error(err, 'Računanje base_score nije uspjelo'));
  // KOMODO_SCORE_MS: samo za mjerenje (posao češće u prozoru testa opterećenja); zadano 5 minuta, najmanje 10 s.
  const scoreMs = Math.max(10 * 1000, Number(process.env.KOMODO_SCORE_MS) || 5 * MIN);
  every(scoreMs, ocjene, 'Računanje base_score nije uspjelo');
  const brojke = () => izracunajDnevneBrojke().then((r) => {
    app.log.info(`daily_stats: ${r.dani.join(', ')}`);
  });
  brojke().catch((err) => app.log.error(err, 'Računanje daily_stats nije uspjelo'));
  every(15 * MIN, brojke, 'Računanje daily_stats nije uspjelo');
  return timers;
}
