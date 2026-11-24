import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Nedostaje DATABASE_URL u api/.env (vidi api/env.primjer).');
}

// Veza po procesu: s više procesa (src/index.js) ukupno ih je WORKERS × PG_POOL.
// Vremenska zona sesije: current_date (listing_views.day, statistika) je lokalni dan u Banjoj Luci, i kad
// server baze nije podešen tako (laptop). PG_TIMEZONE ga mijenja.
//
// Rokovi (talas 4, docs/ARHITEKTURA.md „Otpornost”): svaki upit API-ja ima statement_timeout (PG_STATEMENT_TIMEOUT_MS,
// zadano 5 s; uključuje i čekanje na zaključan red), a transakcija koja miruje duže od
// PG_IDLE_TX_TIMEOUT_MS (zadano 10 s) se prekida, da zaboravljena transakcija ne drži zaključane redove. Upit koji
// istekne javlja grešku 57014, a rukovalac greškama (src/server.js) od nje pravi 503 s Retry-After, nikad 500.
// Pozadinski poslovi (src/poslovi.js, outbox, migracije) idu kroz poseban mali bazen s dužim rokom (poolPosao).
function opcije(statementMs) {
  return [
    `-c timezone=${process.env.PG_TIMEZONE || 'Europe/Sarajevo'}`,
    `-c statement_timeout=${statementMs}`,
    `-c idle_in_transaction_session_timeout=${Number(process.env.PG_IDLE_TX_TIMEOUT_MS) || 10000}`,
  ].join(' ');
}
export const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 5000;
export const STATEMENT_TIMEOUT_POSAO_MS = Number(process.env.PG_STATEMENT_TIMEOUT_POSAO_MS) || 120000;

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL) || 10,
  // Baza ne prima vezu: zahtjev dobija grešku za 5 s umjesto da čeka zauvijek (/api/health tada vraća 503).
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
  options: opcije(STATEMENT_TIMEOUT_MS),
});

// Bazen za pozadinske poslove: pravi se tek pri prvom upitu (u radniku s poslovima; u ostalima samo ako ruta
// zove posao, npr. sendToBunny), najviše 3 veze, rok PG_STATEMENT_TIMEOUT_POSAO_MS (zadano 2 min).
let posaoPool = null;
export function poolPosao() {
  if (!posaoPool) {
    posaoPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
      options: opcije(STATEMENT_TIMEOUT_POSAO_MS),
    });
    posaoPool.on('error', (err) => {
      console.error(JSON.stringify({ level: 50, time: Date.now(), pid: process.pid, msg: `Veza s bazom (poslovi) je prekinuta: ${err.message}` }));
    });
  }
  return posaoPool;
}
export function qPosao(text, params) {
  return poolPosao().query(text, params);
}
export async function zatvoriBazu() {
  await pool.end();
  if (posaoPool) await posaoPool.end();
}

// Transakcija na vezi iz bazena `p`: fn(client) između begin i commit (rollback pri grešci). Veza dobija
// rukovaoca greške dok je izvan bazena: kad baza prekine transakciju u mirovanju (idle_in_transaction_session_timeout)
// ili vezu, pg emituje 'error' na klijentu, a bez rukovaoca bi to oborilo proces. Pokvarena veza se ne vraća u bazen.
export async function uTransakciji(p, fn) {
  const client = await p.connect();
  let pokvarena = null;
  const naGresku = (err) => { pokvarena = err; };
  client.on('error', naGresku);
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.off('error', naGresku);
    client.release(pokvarena || undefined);
  }
}

// Greške koje znače „baza trenutno ne odgovara ili je preopterećena” (ne greška u kodu ni u podešavanju), R3-03:
//   57014 istekao rok upita (statement_timeout, i čekanje na bravu), 25P03 prekinuta transakcija u mirovanju,
//   57P01/57P02/57P03 baza se gasi ili još ne prima veze, 53300 previše veza, 08xxx greške veze;
//   mrežne: ECONNREFUSED (baza ne sluša), ECONNRESET/EPIPE (veza prekinuta), ETIMEDOUT; pg poruke za istekao rok
//   za dobijanje veze iz bazena i prekinutu vezu.
// Namjerno NISU tu: 55000 (object_not_in_prerequisite_state — npr. currval prije nextval: greška u kodu; izuzetak je
// samo 55000 s porukom „is not currently accepting connections” pri spajanju, baza zatvorena za veze) i
// ENOTFOUND/EAI_AGAIN (pogrešno ime servera baze: greška podešavanja). One ostaju 500 i `error` u logu, da ih nadzor
// vidi, a javni feed za njih ne služi stari keš. API za ove iz liste vraća 503 s Retry-After, a javni feed zadnji keš
// (src/rute/feed.js).
const NE_ODGOVARA_KODOVI = new Set(['57014', '25P03', '57P01', '57P02', '57P03', '53300']);
const NE_ODGOVARA_MREZA = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);
export function bazaNeOdgovara(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (NE_ODGOVARA_KODOVI.has(code) || /^08[0-9A-Z]{3}$/.test(code)) return true;
  if (NE_ODGOVARA_MREZA.has(code)) return true;
  const msg = String(err.message || '');
  // 55000 pri spajanju: „database … is not currently accepting connections” (baza zatvorena za veze — održavanje,
  // `allow_connections false`). Samo ta poruka; ostale 55000 su greške u kodu.
  if (code === '55000') return /is not currently accepting connections/i.test(msg);
  if (code) return false; // drugi SQLSTATE ili sistemski kod: stvarna greška
  return /timeout exceeded when trying to connect|Connection terminated|connection timeout|Client has encountered a connection error/i.test(msg);
}

// Veza u mirovanju koju baza prekine (restart, administrator) javlja grešku na poolu. Bez ovog rukovaoca
// Node to smatra neobrađenom greškom i proces pada; ovako se veza odbaci, a sljedeći upit otvori novu.
pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 50, time: Date.now(), pid: process.pid, msg: `Veza s bazom je prekinuta: ${err.message}` }));
});

export function q(text, params) {
  return pool.query(text, params);
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Pokreće sve .sql fajlove iz api/migrations koji još nisu primijenjeni, po abecedi.
// Svaka migracija ide u svojoj transakciji i upisuje se u tabelu schema_migrations.
export async function migrate(log) {
  await q(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const done = new Set((await q('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Migracija (npr. pravljenje indeksa) smije trajati duže od roka za upite API-ja.
      await client.query('set local statement_timeout = 0');
      await client.query(sql);
      await client.query('insert into schema_migrations(name) values ($1)', [name]);
      await client.query('commit');
      log.info(`Migracija primijenjena: ${name}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migracija ${name} nije uspjela: ${err.message}`);
    } finally {
      client.release();
    }
  }
}
