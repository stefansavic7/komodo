// Odgođeni poslovi koji se ne gube (talas 4, outbox; tabela outbox iz migracije 013).
// Push o novoj poruci (src/rute/poruke.js) i o sniženju (src/snizenje.js) se prvo upisuju u bazu, u istoj
// naredbi/transakciji kao poruka, odnosno izmjena cijene. Ovaj posao (src/poslovi.js, svake sekunde, samo u
// radniku s poslovima — ali bezbjedno i u više procesa) ih šalje:
//   1. „zakupi” redove: `update … set run_at = now() + zakup, pokusaja + 1 … for update skip locked` — red koji je
//      jedan proces uzeo drugi ne vidi dok zakup (OUTBOX_ZAKUP_S, zadano 120 s) ne istekne;
//   2. pošalje ih (poruke u serijama do 100 po zahtjevu prema Expo-u) i označi sent_at;
//   3. greška → run_at = sada + čekanje koje raste (5 s, 10 s, 20 s … najviše 10 min, uz nasumičan pomak); poslije
//      OUTBOX_POKUSAJA (zadano 6) pokušaja red je „mrtav” (dead_at, greska) i više se ne pokušava.
// Proces koji padne usred slanja ne gubi ništa: zakup istekne i red se pošalje ponovo (najviše jednom više, ako je
// pao baš između prihvatanja kod Expo-a i upisa sent_at).
import { qPosao } from './db.js';
import { posaljiPushSeriju } from './rute/push.js';
import { rasporediSnizenje } from './snizenje.js';

export const OUTBOX_POKUSAJA = () => Math.max(1, Number(process.env.OUTBOX_POKUSAJA) || 6);
const ZAKUP_S = () => Math.max(5, Number(process.env.OUTBOX_ZAKUP_S) || 120);
const PO_ZAHTJEVU = 100;
const REDOVA_PO_PROLAZU = 500;

const ZAKUPI_SQL = `
  update outbox o set run_at = now() + make_interval(secs => $2), pokusaja = o.pokusaja + 1
   where o.id in (
     select id from outbox
      where sent_at is null and dead_at is null and run_at <= now() and vrsta = any($3::text[])
      order by run_at, id
      limit $1
      for update skip locked)
  returning o.id, o.vrsta, o.payload, o.pokusaja`;

// Čekanje prije sljedećeg pokušaja: 5 s · 2^(pokušaj − 1), najviše 10 min, +0–20 % nasumično.
export function cekanjeSek(pokusaja) {
  const osnova = Math.min(600, 5 * 2 ** Math.max(0, pokusaja - 1));
  return Math.round(osnova * (1 + Math.random() * 0.2));
}

async function poslano(ids) {
  if (ids.length) await qPosao('update outbox set sent_at = now(), greska = null where id = any($1::bigint[])', [ids]);
}

async function neuspjeh(log, redovi, err) {
  const poruka = String(err && err.message ? err.message : err).slice(0, 500);
  for (const r of redovi) {
    if (r.pokusaja >= OUTBOX_POKUSAJA()) {
      await qPosao('update outbox set dead_at = now(), greska = $2 where id = $1', [r.id, poruka]);
      log.error(`Outbox: red ${r.id} (${r.vrsta}) nije poslan ni poslije ${r.pokusaja} pokušaja, označen kao mrtav: ${poruka}`);
    } else {
      await qPosao('update outbox set run_at = now() + make_interval(secs => $2), greska = $3 where id = $1', [r.id, cekanjeSek(r.pokusaja), poruka]);
      log.warn(`Outbox: red ${r.id} (${r.vrsta}), pokušaj ${r.pokusaja} nije uspio, ponovo kasnije: ${poruka}`);
    }
  }
}

// Push o novoj poruci: tokeni se čitaju sada (ne pri upisu), uz ista pravila kao ranije (push_enabled, ugašen nalog).
async function porukeZaRedove(redovi) {
  const primaoci = [...new Set(redovi.map((r) => Number(r.payload.primalac)))];
  const res = await qPosao(
    `select t.user_id, t.token from push_tokens t join users u on u.id = t.user_id
      where t.user_id = any($1::int[]) and u.push_enabled and u.suspended_at is null`,
    [primaoci],
  );
  const tokeni = new Map();
  for (const r of res.rows) {
    if (!tokeni.has(r.user_id)) tokeni.set(r.user_id, []);
    tokeni.get(r.user_id).push(r.token);
  }
  return redovi.map((r) => (tokeni.get(Number(r.payload.primalac)) || []).map((to) => ({
    to, title: r.payload.naslov, body: r.payload.tekst, sound: 'default', channelId: 'poruke',
    data: { conversationId: r.payload.razgovor },
  })));
}

// Jedan prolaz. Vraća { snizenja, poslano, neuspjelo }.
export async function obradiOutbox(log) {
  const out = { snizenja: 0, poslano: 0, neuspjelo: 0 };
  // 1. Sniženja → redovi 'push' (po 100 poruka).
  const sn = await qPosao(ZAKUPI_SQL, [5, ZAKUP_S(), ['snizenje']]);
  for (const r of sn.rows) {
    try {
      await rasporediSnizenje(r.payload);
      await poslano([r.id]);
      out.snizenja += 1;
    } catch (err) {
      await neuspjeh(log, [r], err);
    }
  }
  // 2. Poruke i gotove serije: pakuju se u zahtjeve do 100 poruka; red se ne dijeli između dva zahtjeva.
  const res = await qPosao(ZAKUPI_SQL, [REDOVA_PO_PROLAZU, ZAKUP_S(), ['poruka', 'push']]);
  if (res.rowCount === 0) return out;
  res.rows.sort((a, b) => Number(a.id) - Number(b.id)); // update … returning ne čuva redoslijed podupita
  const zaPoruke = res.rows.filter((r) => r.vrsta === 'poruka');
  const porukeReda = new Map();
  if (zaPoruke.length) {
    const liste = await porukeZaRedove(zaPoruke);
    zaPoruke.forEach((r, k) => porukeReda.set(r.id, liste[k]));
  }
  for (const r of res.rows) if (r.vrsta === 'push') porukeReda.set(r.id, Array.isArray(r.payload.poruke) ? r.payload.poruke : []);

  const prazni = res.rows.filter((r) => porukeReda.get(r.id).length === 0).map((r) => r.id);
  await poslano(prazni); // nema kome (nema tokena, isključena obavještenja): gotovo
  let serija = [];
  let redovi = [];
  const posalji = async () => {
    if (!redovi.length) return;
    try {
      await posaljiPushSeriju(serija);
      await poslano(redovi.map((r) => r.id));
      out.poslano += serija.length;
    } catch (err) {
      out.neuspjelo += serija.length;
      await neuspjeh(log, redovi, err);
    }
    serija = [];
    redovi = [];
  };
  for (const r of res.rows) {
    const m = porukeReda.get(r.id);
    if (!m.length) continue;
    if (serija.length + m.length > PO_ZAHTJEVU) await posalji();
    serija = serija.concat(m);
    redovi.push(r);
  }
  await posalji();
  return out;
}

// Odmah poslije upisa (poruka, sniženje) proces koji je upisao red pokreće jedan prolaz sam, da push ne čeka
// sljedeći krug posla (do 1 s), i da radi i u procesima bez poslova (KOMODO_JOBS=0). Bezbjedno uz posao u drugom
// procesu (skip locked). Dok prolaz traje, novi pozivi samo traže još jedan prolaz poslije njega.
let radiOvdje = false;
let josJedan = false;
export function obradiUskoro(log) {
  if (radiOvdje) { josJedan = true; return; }
  radiOvdje = true;
  setImmediate(async () => {
    try {
      do {
        josJedan = false;
        await obradiOutbox(log);
      } while (josJedan);
    } catch (err) {
      log.warn(err, 'Outbox: prolaz nije uspio (posao pokušava ponovo)');
    } finally {
      radiOvdje = false;
    }
  });
}
