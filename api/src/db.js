import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Nedostaje DATABASE_URL u api/.env (vidi api/env.primjer).');
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

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
