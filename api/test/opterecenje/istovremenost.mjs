// Test ispravnosti pri istovremenim zahtjevima (sviđanja, razgovori, poruke, registracije, prijave, pregledi).
//
// Bez podešavanja (preporučeno): napravi svježu bazu, napuni je (napuni-bazu.mjs, manje podataka),
// pokrene API s NODE_ENV=production (da API vjeruje zaglavlju X-Forwarded-For, pa svaki zahtjev
// izgleda kao drugi korisnik/IP), izvrši provjere, sve ugasi i obriše bazu:
//
//   cd api && npm run test:istovremenost
//
// Protiv već pokrenutog API-ja (preduslovi: baza napunjena skriptom napuni-bazu.mjs, API pokrenut
// s NODE_ENV=production ili iza proksija koji prosljeđuje X-Forwarded-For; skripta direktno čita i
// mijenja probnu bazu):
//
//   BASE_URL=http://127.0.0.1:3910 DATABASE_URL=postgres://postgres@127.0.0.1:55432/komodo_load node test/opterecenje/istovremenost.mjs
//
// Izlazni kod 1 ako ijedna provjera ne prođe.
import http from 'node:http';
import https from 'node:https';
import { sign } from '@fastify/cookie';
import pg from 'pg';
import { novaBaza, pokreniApi } from '../pomoc/okolina.mjs';
import { lazniSmtp } from '../pomoc/smtp.mjs';
import { napuni } from './napuni-bazu.mjs';

let base = process.env.BASE_URL;
let dbUrl = process.env.DATABASE_URL;
let cleanup = async () => {};
// Potpis kolačića `did` (S-07): isti ključ kao COOKIE_SECRET API-ja. Uz BASE_URL postavi COOKIE_SECRET
// na vrijednost kojom je pokrenut API.
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'test';

if (!base) {
  const baza = await novaBaza('komodo_test_istovremenost');
  console.log(`Svježa baza ${baza.name}, punim…`);
  await napuni(baza.url, { butika: 10, kupaca: 2200, oglasa: 300, svidjanja: 0 }, () => {});
  // Produkcija traži SMTP_URL i COOKIE_SECRET (S-01, S-07): lažni SMTP i probna tajna.
  const smtp = await lazniSmtp();
  const api = await pokreniApi(baza, { NODE_ENV: 'production', PG_POOL: '20', SMTP_URL: smtp.url, COOKIE_SECRET, KOMODO_JOBS: '1' });
  base = api.url;
  dbUrl = baza.url;
  cleanup = async () => { await api.stop(); await baza.drop(); await smtp.close(); };
  console.log(`API na ${base}\n`);
} else if (!dbUrl) {
  console.error('Uz BASE_URL treba i DATABASE_URL probne baze.');
  process.exit(1);
}

const db = new pg.Pool({ connectionString: dbUrl, max: 5 });
const target = new URL(base);
const lib = target.protocol === 'https:' ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: 3000 });
let ipn = 0;
let neuspjeha = 0;

function req(method, path, { user, body, ip, did } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'X-Forwarded-For': ip || `172.16.${(ipn >> 8) & 255}.${ipn++ & 255}` };
    const cookies = [];
    if (user) cookies.push(`sid=tok${user}`); // u bazi je sha256 heks tokena, klijent šalje sirovi
    if (did) cookies.push(`did=${encodeURIComponent(sign(did, COOKIE_SECRET))}`);
    if (cookies.length) headers.Cookie = cookies.join('; ');
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const r = lib.request({ host: target.hostname, port: target.port, method, path, headers, agent }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', (e) => resolve({ status: 0, body: { e: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}
const count = (rs) => rs.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
const ok = (cond, text) => { if (!cond) neuspjeha += 1; console.log(`${cond ? 'OK    ' : 'GREŠKA'} ${text}`); };
const n = async (sql, p) => Number((await db.query(sql, p)).rows[0].count);
// Direktno brisanje iz likes zaobilazi API, pa se likes_count poravnava ručno (i brišu nesabrane razlike).
const fixCount = (L) => db.query(`with x as (delete from listing_likes_delta where listing_id = $1)
  update listings set likes_count = (select count(*) from likes where listing_id = $1) where id = $1`, [L]);
// Talas 4 (vruć brojač): tačan broj = likes_count + razlike koje posao još nije sabrao (listing_likes_delta).
const likesCount = async (L) => (await db.query(
  'select (likes_count + coalesce((select sum(delta) from listing_likes_delta where listing_id = $1), 0))::int as n from listings where id = $1', [L],
)).rows[0].n;

const kupci = (await db.query("select id from users where role = 'kupac' and suspended_at is null order by id limit 2100")).rows.map((r) => r.id);
const oglasi = (await db.query('select id, user_id from listings where deleted_at is null order by id limit 3')).rows;
const shopRow = (await db.query("select id, handle from users where role = 'butik' and suspended_at is null order by id offset 1 limit 1")).rows[0]
  || (await db.query("select id, handle from users where role = 'butik' order by id limit 1")).rows[0];
if (kupci.length < 2100 || oglasi.length < 3 || !shopRow) {
  console.error('Probna baza nema dovoljno podataka (treba 2.100 kupaca, 3 oglasa, 1 butik). Napuni je skriptom napuni-bazu.mjs.');
  await db.end(); await cleanup(); process.exit(1);
}

try {
  // 1. 2.000 različitih kupaca istovremeno označi isti oglas
  {
    const L = oglasi[0].id;
    await db.query('delete from likes where listing_id = $1', [L]);
    await fixCount(L);
    const rs = await Promise.all(kupci.slice(0, 2000).map((u) => req('POST', `/api/listings/${L}/like`, { user: u, body: { liked: true } })));
    const c1 = await n('select count(*) from likes where listing_id = $1', [L]);
    const lc = await likesCount(L);
    ok(c1 === 2000 && lc === 2000 && rs.every((r) => r.status === 200), `2.000 istovremenih sviđanja istog oglasa ({liked:true}): u bazi ${c1}, likes_count ${lc}, odgovori ${JSON.stringify(count(rs))}`);
    const rs2 = await Promise.all(kupci.slice(0, 2000).map((u) => req('POST', `/api/listings/${L}/like`, { user: u, body: { liked: false } })));
    const c2 = await n('select count(*) from likes where listing_id = $1', [L]);
    const lc2 = await likesCount(L);
    const rs3 = await Promise.all(kupci.slice(0, 2000).map((u) => req('POST', `/api/listings/${L}/like`, { user: u })));
    const c3 = await n('select count(*) from likes where listing_id = $1', [L]);
    const lc3 = await likesCount(L);
    ok(c2 === 0 && lc2 === 0 && c3 === 2000 && lc3 === 2000 && [...rs2, ...rs3].every((r) => r.status === 200),
      `2.000 istovremenih {liked:false} pa 2.000 prekidača: redova ${c2}→${c3}, likes_count ${lc2}→${lc3}`);
  }

  // 2. Isti kupac 50 puta istovremeno dodirne srce (dupli dodir, loša mreža)
  {
    const L = oglasi[1].id;
    const U = kupci[2000];
    await db.query('delete from likes where listing_id = $1 and user_id = $2', [L, U]);
    await fixCount(L);
    const rs = await Promise.all(Array.from({ length: 50 }, () => req('POST', `/api/listings/${L}/like`, { user: U })));
    const rows = await n('select count(*) from likes where listing_id = $1 and user_id = $2', [L, U]);
    const all = await n('select count(*) from likes where listing_id = $1', [L]);
    const lc = await likesCount(L);
    ok(rows <= 1 && lc === all && rs.every((r) => r.status === 200), `50 istovremenih dodira jednog kupca (prekidač): redova ${rows} (0 ili 1 je ispravno), likes_count ${lc} = redova ${all}, odgovori ${JSON.stringify(count(rs))}`);
    const rs2 = await Promise.all(Array.from({ length: 50 }, () => req('POST', `/api/listings/${L}/like`, { user: U, body: { liked: true } })));
    const rows2 = await n('select count(*) from likes where listing_id = $1 and user_id = $2', [L, U]);
    const all2 = await n('select count(*) from likes where listing_id = $1', [L]);
    const lc2 = await likesCount(L);
    ok(rows2 === 1 && lc2 === all2 && rs2.every((r) => r.status === 200 && r.body.liked === true), `50 istovremenih {liked:true} jednog kupca: redova ${rows2}, likes_count ${lc2} = redova ${all2}`);
  }

  // 3. Kupac 200 puta istovremeno otvori razgovor s istim butikom; 4. 1.000 poruka istovremeno
  {
    const U = kupci[2001];
    await db.query('delete from conversations where customer_id = $1 and shop_id = $2', [U, shopRow.id]);
    const rs = await Promise.all(Array.from({ length: 200 }, () => req('POST', '/api/conversations', { user: U, body: { shop: shopRow.handle } })));
    const c = await n('select count(*) from conversations where customer_id = $1 and shop_id = $2', [U, shopRow.id]);
    const ids = new Set(rs.map((r) => r.body.razgovor));
    ok(c === 1 && ids.size === 1 && rs.every((r) => r.status === 200), `200 istovremenih otvaranja istog razgovora: razgovora u bazi ${c}, različitih id-jeva ${ids.size}, odgovori ${JSON.stringify(count(rs))}`);

    const conv = [...ids][0];
    const rs2 = await Promise.all(Array.from({ length: 1000 }, (_, k) => req('POST', `/api/conversations/${conv}/messages`, { user: k % 2 ? U : shopRow.id, body: { body: `poruka ${k}` } })));
    const m = await n('select count(*) from messages where conversation_id = $1', [conv]);
    const cc = count(rs2);
    ok(m === (cc[201] || 0) && m > 0 && m <= 60 && !cc[500] && !cc[0], `1.000 istovremenih poruka: sačuvano ${m} = broj odgovora 201 (najviše 60 = 2 × 30/min), odgovori ${JSON.stringify(cc)} (429 = namjerno ograničenje)`);
  }

  // 5. 20 istovremenih registracija s istim emailom
  {
    await db.query("delete from users where email = 'isti@proba.ba'");
    const rs = await Promise.all(Array.from({ length: 20 }, () => req('POST', '/api/auth/register', { body: { email: 'isti@proba.ba', password: 'lozinka123', name: 'Isti Email' } })));
    const c = await n("select count(*) from users where email = 'isti@proba.ba'");
    const cc = count(rs);
    ok(c === 1 && cc[201] === 1 && cc[409] === 19, `20 istovremenih registracija istog emaila: naloga ${c}, odgovori ${JSON.stringify(cc)} (očekivano 201 jednom i 409 ostalima)`);
  }

  // 6. 20 istovremenih registracija s istim imenom (različiti emailovi) — jedinstven handle
  {
    await db.query("delete from users where email like 'ime%@proba.ba'");
    const rs = await Promise.all(Array.from({ length: 20 }, (_, k) => req('POST', '/api/auth/register', { body: { email: `ime${k}@proba.ba`, password: 'lozinka123', name: 'Ana Anić' } })));
    const c = await n("select count(*) from users where email like 'ime%@proba.ba'");
    const h = await n("select count(distinct handle) from users where email like 'ime%@proba.ba'");
    ok(c === 20 && h === 20 && rs.every((r) => r.status === 201), `20 istovremenih registracija istog imena: naloga ${c}, različitih handle-ova ${h}, odgovori ${JSON.stringify(count(rs))}`);
  }

  // 7. Prijava: koliko prijava u sekundi (scrypt troši procesor)
  {
    const t = Date.now();
    const rs = await Promise.all(Array.from({ length: 200 }, (_, k) => req('POST', '/api/auth/login', { body: { email: `ime${k % 20}@proba.ba`, password: 'lozinka123' } })));
    const s = (Date.now() - t) / 1000;
    ok(rs.every((r) => r.status === 200 || r.status === 429), `200 istovremenih prijava: ${(200 / s).toFixed(0)} prijava/s, gotove za ${s.toFixed(1)} s, odgovori ${JSON.stringify(count(rs))}`);
  }

  // 8. Ista IP adresa (mobilni operater, CGNAT): 6 različitih ljudi pravi nalog
  {
    const ip = '100.64.1.1';
    await db.query("delete from users where email like 'cgnat%@proba.ba'");
    await db.query("delete from rate_limits where key like 'reg:ip:100.64.1.1'");
    const rs = [];
    for (let k = 0; k < 6; k += 1) rs.push(await req('POST', '/api/auth/register', { ip, body: { email: `cgnat${k}@proba.ba`, password: 'lozinka123', name: `Osoba ${k}` } }));
    ok(rs.every((r) => r.status === 201), `6 registracija s iste adrese (dijeljena IP): odgovori ${JSON.stringify(count(rs))}`);
  }

  // 9. Pregledi: 100 različitih ljudi iza iste IP adrese gleda isti oglas
  {
    const L = oglasi[2].id;
    const ip = '100.64.2.2';
    await db.query('delete from listing_views where listing_id = $1', [L]);
    await db.query("delete from rate_limits where key like 'views:%'");
    const views = async () => (await db.query('select views from listings where id = $1', [L])).rows[0].views;
    const before = await views();
    const ljudi = kupci.slice(100, 200);
    await Promise.all(ljudi.map((u) => req('POST', '/api/views', { ip, user: u, body: { ids: [L] } })));
    const after = await views();
    ok(after - before === 100, `100 prijavljenih iza iste IP adrese pogleda oglas (/api/views): izbrojano ${after - before}`);
    await Promise.all(ljudi.map((u) => req('POST', `/api/listings/${L}/view`, { ip, user: u })));
    const again = await views();
    ok(again === after, `isti 100 ljudi ponovo isti dan: dodatnih pregleda ${again - after} (očekivano 0)`);
    await Promise.all(Array.from({ length: 100 }, (_, k) => req('POST', '/api/views', { ip, did: `uredjaj-za-test-${String(k).padStart(4, '0')}`, body: { ids: [L] } })));
    const anon = await views();
    ok(anon - again === 100, `100 neprijavljenih uređaja iza iste IP adrese: izbrojano ${anon - again}`);
    await req('POST', '/api/views', { ip, user: oglasi[2].user_id, body: { ids: [L] } });
    const own = await views();
    ok(own === anon, `vlasnik pogleda svoj oglas: dodatnih pregleda ${own - anon} (očekivano 0)`);
  }

  // 10. Cijela baza: likes_count svakog oglasa = broj redova u likes — poslije sabiranja razlika (posao
  //     sabirSvidjanja u API-ju s poslovima, svake sekunde): tabela razlika mora se isprazniti.
  {
    const kraj = Date.now() + 15000;
    let ostalo = await n('select count(*) from listing_likes_delta');
    while (ostalo > 0 && Date.now() < kraj) {
      await new Promise((r) => setTimeout(r, 200));
      ostalo = await n('select count(*) from listing_likes_delta');
    }
    ok(ostalo === 0, `posao je sabrao sve razlike sviđanja (ostalo nesabranih: ${ostalo})`);
    const bad = await n('select count(*) from listings l where l.likes_count <> (select count(*) from likes k where k.listing_id = l.id)');
    ok(bad === 0, `likes_count se slaže s brojem redova u likes za sve oglase (neslaganja: ${bad})`);
  }
} finally {
  await db.end();
  await cleanup();
}

console.log(neuspjeha === 0 ? '\nSve provjere su prošle.' : `\nNeuspjelih provjera: ${neuspjeha}`);
process.exit(neuspjeha === 0 ? 0 : 1);
