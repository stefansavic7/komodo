// Obavještenje o sniženju (docs/SPEC-V1.md, F-07): push kupcima koji su označili oglas.
// Talas 4: PATCH /api/listings/:id (src/rute/oglasi.js) u istoj transakciji s izmjenom cijene upisuje red
// 'snizenje' u outbox (zakaziSnizenje), pa se obavještenje ne gubi ni kad proces padne poslije odgovora butiku.
// Posao outboxa (src/outbox.js) zove rasporediSnizenje: u serijama zauzme kupce i za svaku seriju upiše red 'push'
// (najviše 100 poruka = jedan zahtjev prema Expo-u) — zauzimanje i upis su u istoj transakciji.
import { poolPosao, uTransakciji } from './db.js';

// Android kanal za sniženja (mobilni dio pravi kanal „snizenja”).
const KANAL = () => process.env.PUSH_SNIZENJA_KANAL || 'snizenja';
const KUPACA_PO_SERIJI = 100;        // kupaca koji se „zauzmu” u jednoj seriji
const SERIJA_NAJVISE = 50;           // najviše serija po jednom sniženju → najviše 5.000 kupaca po sniženju
const PO_ZAHTJEVU = 100;             // poruka u jednom redu 'push' (jedan zahtjev prema Expo-u)

function km(cents) {
  const n = cents / 100;
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })} KM`;
}

// Zauzima (atomski, preko likes.price_notified_at) sljedeću seriju kupaca koji smiju dobiti push i vraća njihove
// tokene. Kupac se zauzima samo ako ima token, uključena obavještenja, nije ugašen, nije butik i nije u
// blokiranju s butikom (bilo koji smjer); najviše jedan push po kupcu po oglasu u 24 h. `skip locked` čini da
// dva istovremena sniženja ne zauzmu iste kupce.
const ZAUZMI_SQL = `
  with t as (
    update likes set price_notified_at = now()
     where (listing_id, user_id) in (
       select k.listing_id, k.user_id
         from likes k join users u on u.id = k.user_id
        where k.listing_id = $1
          and (k.price_notified_at is null or k.price_notified_at < now() - interval '1 day')
          and u.push_enabled and u.suspended_at is null and u.id <> $2
          and exists (select 1 from push_tokens p where p.user_id = u.id)
          and not exists (select 1 from blocks b where (b.blocker_id = u.id and b.blocked_id = $2)
                                                    or (b.blocker_id = $2 and b.blocked_id = u.id))
        order by k.user_id
        limit $3
        for update of k skip locked)
    returning user_id)
  select p.token from push_tokens p join t on t.user_id = p.user_id`;

// U transakciji izmjene oglasa (klijent `c`): obavještenje čeka u outboxu.
// o: { listingId, shopId, shopName, title, oldCents, newCents }
export async function zakaziSnizenje(c, o) {
  await c.query("insert into outbox(vrsta, payload) values ('snizenje', $1::jsonb)", [JSON.stringify(o)]);
}

// Pretvara jedno sniženje u redove 'push'. Vraća broj zauzetih tokena. Ako proces padne usred posla, red
// 'snizenje' se ponovo obradi kad mu istekne zakup; već zauzeti kupci (price_notified_at) se ne zauzimaju dvaput.
export async function rasporediSnizenje(o) {
  const naslov = o.title.length > 50 ? `${o.title.slice(0, 49)}…` : o.title;
  const title = `Sniženje: ${naslov}`;
  const body = `${o.shopName}: ${km(o.oldCents)} → ${km(o.newCents)}`;
  let tokena = 0;
  for (let serija = 0; serija < SERIJA_NAJVISE; serija += 1) {
    const n = await uTransakciji(poolPosao(), async (c) => {
      const res = await c.query(ZAUZMI_SQL, [o.listingId, o.shopId, KUPACA_PO_SERIJI]);
      const messages = res.rows.map((r) => ({
        to: r.token, title, body, sound: 'default', channelId: KANAL(), data: { listingId: o.listingId },
      }));
      for (let i = 0; i < messages.length; i += PO_ZAHTJEVU) {
        await c.query("insert into outbox(vrsta, payload) values ('push', $1::jsonb)", [JSON.stringify({ poruke: messages.slice(i, i + PO_ZAHTJEVU) })]);
      }
      return res.rowCount;
    });
    if (n === 0) break;
    tokena += n;
  }
  return tokena;
}
