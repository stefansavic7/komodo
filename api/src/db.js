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
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL) || 10,
  // Baza ne prima vezu: zahtjev dobija grešku za 5 s umjesto da čeka zauvijek (/api/health tada vraća 503).
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
  options: `-c timezone=${process.env.PG_TIMEZONE || 'Europe/Sarajevo'}`,
});

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
