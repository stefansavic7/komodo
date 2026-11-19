// Puni PRAZNU probnu bazu podacima za test opterećenja i istovremenosti. SAMO ZA LOKALNU PROBU.
//
//   node api/test/opterecenje/napuni-bazu.mjs postgres://postgres@127.0.0.1:55432/komodo_load_proba
//   node api/test/opterecenje/napuni-bazu.mjs <url> --kupaca 10000 --butika 100 --oglasa 10000 --svidjanja 300000
//
// Zadano: 100 butika (id 1–100, handle butik1…butik100, butikN@proba.ba), 10.000 kupaca
// (id 101–10100, kupacN@proba.ba), 10.000 oglasa, ~300.000 sviđanja. Svi nalozi imaju lozinku
// `lozinka123` i sesiju za koju klijent šalje token 'tok'||id (kolačić sid=tok123 je prijava korisnika 123); u bazi se čuva
// sha256 heks tog tokena (S-18, migracija 010).
//
// Zaštita: odbija bazu koja nije na localhost/127.0.0.1, bazu čije ime ne sadrži „load”, „test” ili
// „proba”, i bazu u kojoj već ima korisnika. Ako šema ne postoji, primijeni migracije iz api/migrations.
import { scryptSync } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.KOMODO_ROOT || path.join(HERE, '..', '..', '..'));
const LOKALNO = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const ZADANO = { kupaca: 10000, butika: 100, oglasa: 10000, svidjanja: 300000 };
const KATEGORIJE = ['Haljine', 'Jakne i kaputi', 'Majice i košulje', 'Pantalone', 'Obuća', 'Torbe', 'Nakit', 'Ostalo'];

export function provjeriUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('DATABASE_URL nije ispravan.'); }
  if (!LOKALNO.has(u.hostname)) {
    throw new Error(`Odbijeno: baza ${u.hostname} nije lokalna. Ova skripta je samo za lokalnu probnu bazu, nikad za produkciju.`);
  }
  const ime = u.pathname.slice(1);
  if (!/load|test|proba/i.test(ime)) {
    throw new Error(`Odbijeno: ime baze „${ime}” ne sadrži load, test ili proba. Napravi posebnu probnu bazu.`);
  }
}

async function migracije(c) {
  await c.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
  const dir = path.join(ROOT, 'api', 'migrations');
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await c.query('begin');
    await c.query(await readFile(path.join(dir, name), 'utf8'));
    await c.query('insert into schema_migrations(name) values ($1)', [name]);
    await c.query('commit');
  }
}

// Puni bazu na `url`. Vraća broj napravljenih redova po tabeli.
export async function napuni(url, opcije = {}, log = console.log) {
  provjeriUrl(url);
  const o = { ...ZADANO, ...opcije };
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await migracije(c);
    const ima = Number((await c.query('select count(*) from users')).rows[0].count);
    if (ima > 0) throw new Error(`Odbijeno: u bazi već ima ${ima} korisnika. Skripta puni samo praznu bazu.`);

    // Ista lozinka za sve (lozinka123), jedan hash — dovoljno za probu, a brzo.
    const salt = Buffer.from('komodoprobnasol1');
    const hash = `${salt.toString('hex')}:${scryptSync('lozinka123', salt, 64).toString('hex')}`;
    const B = o.butika;
    const K = o.kupaca;

    log(`Butici: ${B}, kupci: ${K}…`);
    await c.query(
      `insert into users(id, email, password_hash, shop_name, handle, role, email_verified_at, phone)
       select g, 'butik' || g || '@proba.ba', $1, 'Butik ' || g, 'butik' || g, 'butik', now(), '065 000 ' || lpad(g::text, 3, '0')
         from generate_series(1, $2::int) g`,
      [hash, B],
    );
    await c.query(
      `insert into users(id, email, password_hash, shop_name, handle, role, email_verified_at)
       select $2::int + g, 'kupac' || g || '@proba.ba', $1, 'Kupac ' || g, 'kupac' || g, 'kupac', now()
         from generate_series(1, $3::int) g`,
      [hash, B, K],
    );
    await c.query(`select setval(pg_get_serial_sequence('users', 'id'), (select max(id) from users))`);
    await c.query(
      `insert into sessions(token, user_id, expires_at) select encode(sha256(convert_to('tok' || id, 'UTF8')), 'hex'), id, now() + interval '30 days' from users`,
    );

    log(`Oglasi: ${o.oglasa}…`);
    await c.query(
      `insert into listings(id, user_id, title, price_cents, category, video_path, video_provider, video_status, created_at)
       select g, 1 + (g % $2::int), 'Proizvod ' || g || ' butik' || (1 + (g % $2::int)),
              500 + ((g * 7919) % 30000), ($3::text[])[1 + (g % 8)], 'dummy.mp4', 'local', 'ready',
              now() - make_interval(secs => ($1::int - g))
         from generate_series(1, $1::int) g`,
      [o.oglasa, B, KATEGORIJE],
    );
    await c.query(`select setval(pg_get_serial_sequence('listings', 'id'), (select max(id) from listings))`);

    if (o.svidjanja > 0 && o.oglasa > 0 && K > 0) {
      log(`Sviđanja: ~${o.svidjanja}…`);
      await c.query(
        `insert into likes(user_id, listing_id)
         select $2::int + 1 + floor(random() * $3::int)::int, 1 + floor(random() * $4::int)::int
           from generate_series(1, $1::int)
         on conflict do nothing`,
        [o.svidjanja, B, K, o.oglasa],
      );
      await c.query(
        `update listings l set likes_count = n.broj
           from (select listing_id, count(*)::int as broj from likes group by listing_id) n
          where l.id = n.listing_id`,
      );
    }
    await c.query('analyze');
    const broj = async (t) => Number((await c.query(`select count(*) from ${t}`)).rows[0].count);
    const out = { users: await broj('users'), listings: await broj('listings'), likes: await broj('likes'), sessions: await broj('sessions') };
    log(`Gotovo: ${JSON.stringify(out)}`);
    return out;
  } finally {
    await c.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--') && /^postgres/.test(a)) || process.env.DATABASE_URL;
  const opt = {};
  for (let k = 0; k < args.length; k += 1) {
    const m = /^--(kupaca|butika|oglasa|svidjanja)$/.exec(args[k]);
    if (m) opt[m[1]] = Number(args[k += 1]);
  }
  if (!url) {
    console.error('Upotreba: node api/test/opterecenje/napuni-bazu.mjs postgres://postgres@127.0.0.1:55432/komodo_load_proba [--kupaca N --butika N --oglasa N --svidjanja N]');
    process.exit(1);
  }
  try {
    await napuni(url, opt);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
