// Backend: popravke sigurnosnih nalaza iz docs/SIGURNOST.md (S-01 … S-13, S-18). Svaki test ponavlja dokaz
// iz revizije i provjerava da više ne prolazi. Dvije instance: razvoj (bez emaila) i „produkcija”
// (NODE_ENV=production, lažni SMTP, COOKIE_SECRET, iza proxyja).
import assert from 'node:assert/strict';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Klijent, LOZINKA, novaBaza, noviButik, okolina, pokreniApi, sleep } from './pomoc/okolina.mjs';
import { lazniSmtp } from './pomoc/smtp.mjs';

const ADMIN = 'admin.backend@test.ba';
let dev; // razvoj
let prod; // produkcija
let smtp;
let butik;
let shop;

const sha = (t) => createHash('sha256').update(t).digest('hex');

before(async () => {
  smtp = await lazniSmtp();
  dev = await okolina({ ADMIN_EMAILS: ADMIN, MAX_VIDEO_MB: '1', KOMODO_SCRYPT_V2: '1' });
  prod = await okolina({
    NODE_ENV: 'production', SMTP_URL: smtp.url, COOKIE_SECRET: 'tajna-za-testove-0123456789abcdef',
    APP_URL: 'https://komodo.test', ADMIN_EMAILS: ADMIN, MAIL_POTVRDA_SAT: '6',
  });
  butik = await noviButik(dev.baza, { butik: 'Butik Backend Sig', email: 'butik.bsig@test.ba' });
  shop = dev.klijent();
  await shop.prijavi(butik.email, butik.password);
});
after(async () => {
  await dev?.stop();
  await prod?.stop();
  await smtp?.close();
});

// Zahtjev „iza Nginxa”: X-Forwarded-For kao što ga šalje proxy.
function iza(k, ip) {
  return { headers: { 'x-forwarded-for': ip } };
}

describe('S-01 administrator samo s potvrđenim emailom', () => {
  test('registracija adrese iz ADMIN_EMAILS bez potvrde: admin false, /api/admin 404; poslije potvrde admin', async () => {
    const k = prod.klijent();
    const r = await k.post('/api/auth/register', { email: ADMIN, password: 'napadac123', name: 'Napadac' }, iza(k, '10.1.0.1'));
    assert.equal(r.status, 201);
    assert.equal(r.body.korisnik.admin, false);
    assert.equal(r.body.korisnik.verified, false);
    assert.equal((await k.get('/api/admin/users')).status, 404);
    const token = await smtp.cekaj(ADMIN, /#potvrda=([a-f0-9]+)/);
    assert.equal((await k.post('/api/auth/verify', { token })).status, 200);
    await sleep(50);
    // keš prijava je poništen u ovom procesu
    assert.equal((await k.get('/api/me')).body.korisnik.admin, true);
    assert.equal((await k.get('/api/admin/users')).status, 200);
  });

  test('produkcija bez SMTP_URL ili COOKIE_SECRET ne starta, s jasnom porukom', async () => {
    const baza = await novaBaza();
    try {
      await assert.rejects(
        pokreniApi(baza, { NODE_ENV: 'production', SMTP_URL: '', COOKIE_SECRET: 'x'.repeat(32) }),
        /SMTP_URL/,
      );
      await assert.rejects(
        pokreniApi(baza, { NODE_ENV: 'production', SMTP_URL: 'smtp://127.0.0.1:1', COOKIE_SECRET: '' }),
        /COOKIE_SECRET/,
      );
    } finally {
      await baza.drop();
    }
  });
});

describe('S-02 IP adresa iza proxyja', () => {
  test('produkcija: uzima se adresa koju je upisao proxy (zadnja), ne ono što je klijent poslao', async () => {
    const k = prod.klijent();
    const r = await k.post('/api/auth/register', { email: 's02@test.ba', password: LOZINKA, name: 'S Nula Dva' },
      iza(k, '10.7.1.1, 198.51.100.7'));
    assert.equal(r.status, 201);
    const keys = (await prod.baza.q("select key from rate_limits where key like 'reg:ip:%'")).rows.map((x) => x.key);
    assert.ok(keys.includes('reg:ip:198.51.100.7'));
    assert.ok(!keys.some((x) => x.includes('10.7.1.1')), keys.join(','));
  });

  test('razvoj (bez proxyja): X-Forwarded-For se ne gleda', async () => {
    const k = dev.klijent();
    await k.post('/api/auth/register', { email: 's02dev@test.ba', password: LOZINKA, name: 'S Dev' }, iza(k, '10.9.9.9'));
    const keys = (await dev.baza.q("select key from rate_limits where key like 'reg:ip:%'")).rows.map((x) => x.key);
    assert.ok(!keys.some((x) => x.includes('10.9.9.9')));
    assert.ok(keys.includes('reg:ip:127.0.0.1'));
  });
});

describe('S-03 registracije i email kvota', () => {
  test('201. registracija s iste adrese u danu → 429', async () => {
    await prod.baza.q("insert into rate_limits(key, window_start, hits) values ('reg:ip:dan:203.0.113.9', now(), 200)");
    const k = prod.klijent();
    const r = await k.post('/api/auth/register', { email: 's03dan@test.ba', password: LOZINKA, name: 'Dan' }, iza(k, '203.0.113.9'));
    assert.equal(r.status, 429);
    assert.match(r.body.greska, /danas/);
  });

  test('budžet emailova za potvrdu: nalog nastaje, email se ne šalje; „Pošalji ponovo” 429', async () => {
    // MAIL_POTVRDA_SAT=6: popuni budžet do kraja, pa registruj još jednog.
    await prod.baza.q(`insert into rate_limits(key, window_start, hits) values ('mail:potvrda:sat', now(), 6)
                       on conflict (key) do update set hits = 6, window_start = now()`);
    const k = prod.klijent();
    const r = await k.post('/api/auth/register', { email: 's03budzet@test.ba', password: LOZINKA, name: 'Budzet' }, iza(k, '10.3.0.3'));
    assert.equal(r.status, 201);
    await sleep(300);
    assert.equal(smtp.poruke.filter((p) => p.to.includes('s03budzet@test.ba')).length, 0);
    const again = await k.post('/api/auth/resend');
    assert.equal(again.status, 429);
    await prod.baza.q("delete from rate_limits where key = 'mail:potvrda:sat'");
  });
});

describe('S-04 zaključavanje tuđeg naloga', () => {
  test('31 pogrešna prijava s drugih adresa: vlasnik s poznatog uređaja ulazi, nepoznat uređaj 429', async () => {
    const vlasnik = prod.klijent();
    await vlasnik.post('/api/auth/register', { email: 'zrtva@test.ba', password: LOZINKA, name: 'Zrtva' }, iza(vlasnik, '10.4.0.1'));
    assert.equal((await vlasnik.post('/api/auth/login', { email: 'zrtva@test.ba', password: LOZINKA }, iza(vlasnik, '10.4.0.1'))).status, 200);
    await vlasnik.post('/api/auth/logout');
    for (let i = 0; i < 31; i += 1) {
      const n = prod.klijent();
      const r = await n.post('/api/auth/login', { email: 'zrtva@test.ba', password: 'pogresna1' }, iza(n, `10.7.${i}.1`));
      assert.equal(r.status, i < 29 ? 401 : 429, `pokušaj ${i + 1}`); // + 1 uspješna prijava vlasnika = 31
    }
    const nepoznat = prod.klijent();
    assert.equal((await nepoznat.post('/api/auth/login', { email: 'zrtva@test.ba', password: LOZINKA }, iza(nepoznat, '10.4.9.9'))).status, 429);
    const ok = await vlasnik.post('/api/auth/login', { email: 'zrtva@test.ba', password: LOZINKA }, iza(vlasnik, '10.4.0.2'));
    assert.equal(ok.status, 200);
  });

  test('lažan (nepotpisan) did ne važi kao poznat uređaj', async () => {
    const row = (await prod.baza.q("select did from known_devices kd join users u on u.id = kd.user_id where u.email = 'zrtva@test.ba' limit 1")).rows[0];
    const k = prod.klijent();
    k.cookies.set('did', row.did); // pravi id, ali bez potpisa
    const r = await k.post('/api/auth/login', { email: 'zrtva@test.ba', password: LOZINKA }, iza(k, '10.4.8.8'));
    assert.equal(r.status, 429);
  });
});

describe('S-05 prekinut ili prevelik snimak', () => {
  test('prevelik snimak (MAX_VIDEO_MB=1): 413 i nijedan fajl na disku', async () => {
    const prije = (await readdir(dev.api.uploads)).length;
    const veliki = path.join(os.tmpdir(), `veliki-${process.pid}.mp4`);
    const buf = Buffer.alloc(3 * 1024 * 1024);
    buf.write('ftypisom', 4, 'latin1');
    await writeFile(veliki, buf);
    for (let i = 0; i < 3; i += 1) {
      const r = await shop.objavi({ title: 'Prevelik' }, { video: veliki });
      assert.equal(r.status, 413);
    }
    await sleep(200);
    assert.equal((await readdir(dev.api.uploads)).length, prije);
  });

  test('prekinuto slanje: djelimičan fajl se briše', async () => {
    const prije = (await readdir(dev.api.uploads)).length;
    const boundary = '----komodo' + randomBytes(4).toString('hex');
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPrekid\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="a.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    await new Promise((resolve) => {
      const req = http.request(`${dev.url}/api/listings`, {
        method: 'POST',
        headers: { cookie: shop.cookieHeader(), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': 900000 },
      });
      req.on('error', () => resolve());
      req.on('response', (res) => { res.resume(); resolve(); });
      req.write(head);
      req.write(Buffer.alloc(200000));
      setTimeout(() => { req.destroy(); resolve(); }, 400);
    });
    // fajl je postojao dok je slanje trajalo, a poslije prekida nestaje
    let n;
    for (let i = 0; i < 40; i += 1) {
      n = (await readdir(dev.api.uploads)).length;
      if (n === prije) break;
      await sleep(100);
    }
    assert.equal(n, prije);
  });

  test('31. objava istog butika u satu → 429 (prije čitanja snimka)', async () => {
    const id = (await dev.baza.q('select id from users where email = $1', [butik.email])).rows[0].id;
    await dev.baza.q(`insert into rate_limits(key, window_start, hits) values ($1, now(), 30)
                      on conflict (key) do update set hits = 30, window_start = now()`, [`upload:${id}`]);
    const r = await shop.objavi({ title: 'Trideset prva' });
    assert.equal(r.status, 429);
    await dev.baza.q('delete from rate_limits where key = $1', [`upload:${id}`]);
  });
});

describe('S-06 token u fragmentu, ne u upitu', () => {
  test('email za novu lozinku i za potvrdu nose #lozinka= i #potvrda=; POST /api/auth/verify je jednokratan', async () => {
    const k = prod.klijent();
    await k.post('/api/auth/register', { email: 's06@test.ba', password: LOZINKA, name: 'Fragment' }, iza(k, '10.6.0.1'));
    const potvrda = smtp.poruke.find((p) => p.to.includes('s06@test.ba')).text;
    assert.match(potvrda, /https:\/\/komodo\.test\/#potvrda=[a-f0-9]{48}/);
    assert.doesNotMatch(potvrda, /\?token=/);
    const token = /#potvrda=([a-f0-9]+)/.exec(potvrda)[1];
    const r = await prod.klijent().post('/api/auth/verify', { token });
    assert.deepEqual(r.body, { ok: true });
    const opet = await prod.klijent().post('/api/auth/verify', { token });
    assert.equal(opet.status, 400);
    assert.match(opet.body.greska, /istekao/);
    assert.equal((await prod.klijent().post('/api/auth/verify', {})).status, 400);

    await prod.klijent().post('/api/auth/forgot', { email: 's06@test.ba' }, { headers: { 'x-forwarded-for': '10.6.0.2' } });
    const lozinka = await smtp.cekaj('s06@test.ba', /(https:\/\/komodo\.test\/#lozinka=[a-f0-9]{48})/);
    assert.ok(lozinka);
    assert.ok(!smtp.poruke.some((p) => p.to.includes('s06@test.ba') && /\?lozinka=/.test(p.text)));
  });

  test('stari link GET /api/auth/verify?token= i dalje radi', async () => {
    const k = prod.klijent();
    await k.post('/api/auth/register', { email: 's06stari@test.ba', password: LOZINKA, name: 'Stari Link' }, iza(k, '10.6.0.3'));
    const token = await smtp.cekaj('s06stari@test.ba', /#potvrda=([a-f0-9]+)/);
    const r = await k.get(`/api/auth/verify?token=${token}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/?potvrda=ok');
  });
});

describe('S-07 pregledi i potpisan did', () => {
  test('100 zahtjeva bez kolačića i 100 s izmišljenim did: pregledi i rate_limits se ne mijenjaju', async () => {
    const oglas = (await shop.objavi({ title: 'Za S-07' })).body.oglas;
    const views = async () => (await dev.baza.q('select views from listings where id = $1', [oglas.id])).rows[0].views;
    const limiti = async () => Number((await dev.baza.q("select count(*) from rate_limits where key like 'views:%'")).rows[0].count);
    const l0 = await limiti();
    for (let i = 0; i < 100; i += 1) await new Klijent(dev.url).post(`/api/listings/${oglas.id}/view`);
    for (let i = 0; i < 100; i += 1) {
      const k = new Klijent(dev.url);
      k.cookies.set('did', `izmisljen-uredjaj-${String(i).padStart(4, '0')}`);
      await k.post('/api/views', { ids: [oglas.id] });
    }
    assert.equal(await views(), 0);
    assert.equal((await dev.baza.q('select count(*) from listing_views where listing_id = $1', [oglas.id])).rows[0].count, '0');
    assert.equal(await limiti(), l0);
    // Uređaj s potpisanim kolačićem se broji od drugog zahtjeva.
    const k = dev.klijent();
    await k.post('/api/views', { ids: [oglas.id] });
    assert.match(k.cookies.get('did'), /\./, 'kolačić je potpisan');
    await k.post('/api/views', { ids: [oglas.id] });
    assert.equal(await views(), 1);
  });
});

describe('S-09 push token se ne preotima', () => {
  test('drugi nalog prijavi tuđi token → user_id ostaje', async () => {
    const a = dev.klijent();
    const ua = await a.registruj('s09a@test.ba', 'Push A');
    const b = dev.klijent();
    await b.registruj('s09b@test.ba', 'Push B');
    const token = 'ExponentPushToken[zrtvinUredjaj123]';
    assert.equal((await a.post('/api/me/push-token', { token })).status, 200);
    assert.equal((await b.post('/api/me/push-token', { token })).status, 200);
    const row = (await dev.baza.q('select user_id from push_tokens where token = $1', [token])).rows[0];
    assert.equal(row.user_id, ua.id);
  });
});

describe('S-11 sadržaj snimka i nosniff', () => {
  test('tekstualni fajl s oznakom video/mp4 → 400, bez fajla na disku', async () => {
    const lazni = path.join(os.tmpdir(), `lazni-${process.pid}.mp4`);
    await writeFile(lazni, '<html><script>alert(document.domain)</script></html>');
    const prije = (await readdir(dev.api.uploads)).length;
    const r = await shop.objavi({ title: 'Lažni video' }, { video: lazni });
    assert.equal(r.status, 400);
    assert.match(r.body.greska, /MP4, MOV ili WebM/);
    assert.equal((await readdir(dev.api.uploads)).length, prije);
  });

  test('/api/… i /media/… šalju X-Content-Type-Options: nosniff', async () => {
    const oglas = (await shop.objavi({ title: 'Za nosniff' })).body.oglas;
    assert.equal((await fetch(`${dev.url}/api/health`)).headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(dev.url + oglas.videoUrl)).headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('S-12 provjera Origin', () => {
  test('POST/PATCH/DELETE s tuđim Origin → 403; vlastiti Origin i bez Origin prolaze', async () => {
    const zlo = { headers: { origin: 'https://zlo.ba' } };
    assert.equal((await shop.post('/api/auth/logout', {}, zlo)).status, 403);
    assert.equal((await shop.patch('/api/me', { name: 'Zlo' }, zlo)).status, 403);
    assert.equal((await shop.del('/api/listings/1', zlo)).status, 403);
    assert.equal((await shop.post('/api/listings/1/like', { liked: true }, { headers: { origin: 'null' } })).status, 403);
    assert.equal((await shop.get('/api/me', zlo)).status, 200, 'GET se ne provjerava');
    const own = { headers: { origin: dev.url } };
    assert.equal((await shop.patch('/api/me', { name: 'Butik Backend Sig' }, own)).status, 200);
    assert.equal((await shop.patch('/api/me', { name: 'Butik Backend Sig' })).status, 200);
    // produkcija: APP_URL je dozvoljen iako Host nije isti
    const k = prod.klijent();
    assert.equal((await k.post('/api/auth/logout', {}, { headers: { origin: 'https://komodo.test' } })).status, 200);
    assert.equal((await k.post('/api/auth/logout', {}, { headers: { origin: 'https://komodo.test.zlo.ba' } })).status, 403);
  });
});

describe('S-13 kontrolni znakovi u jednorednim poljima', () => {
  test('ime i naslov bez novih redova i znakova za smjer teksta', async () => {
    const k = dev.klijent();
    const u = await k.registruj('s13@test.ba', 'Ana\r\nBcc: zrtva@primjer.ba‮​');
    assert.equal(u.name, 'Ana Bcc: zrtva@primjer.ba');
    const r = await shop.objavi({ title: 'Haljina\n\nVaš nalog će biti ugašen⁦' });
    assert.equal(r.body.oglas.title, 'Haljina Vaš nalog će biti ugašen');
  });
});

describe('S-18 sesije i lozinke', () => {
  test('u bazi je sha256 tokena, ne sam token', async () => {
    const k = dev.klijent();
    const u = await k.registruj('s18@test.ba', 'Sesija');
    const sid = k.cookies.get('sid');
    const rows = (await dev.baza.q('select token from sessions where user_id = $1', [u.id])).rows.map((x) => x.token);
    assert.deepEqual(rows, [sha(sid)]);
    // ukraden red iz baze kao kolačić ne radi
    const lopov = new Klijent(dev.url);
    lopov.cookies.set('sid', rows[0]);
    assert.equal((await lopov.get('/api/me')).body.korisnik, null);
  });

  test('bez KOMODO_SCRYPT_V2 lozinka se piše u starom zapisu (povratak na prethodnu verziju)', async () => {
    const k = prod.klijent();
    await k.post('/api/auth/register', { email: 's18prod@test.ba', password: LOZINKA, name: 'Stari Zapis' }, iza(k, '10.18.0.1'));
    const h = (await prod.baza.q("select password_hash from users where email = 's18prod@test.ba'")).rows[0].password_hash;
    assert.match(h, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  test('KOMODO_SCRYPT_V2=1: stari scrypt zapis radi i prepisuje se u novi (N=2^15) pri prijavi', async () => {
    const k = dev.klijent();
    const u = await k.registruj('s18stari@test.ba', 'Stari Hash');
    const salt = randomBytes(16);
    const stari = `${salt.toString('hex')}:${scryptSync(LOZINKA, salt, 64).toString('hex')}`;
    await dev.baza.q('update users set password_hash = $1 where id = $2', [stari, u.id]);
    await dev.klijent().prijavi('s18stari@test.ba');
    let hash;
    for (let i = 0; i < 30; i += 1) {
      hash = (await dev.baza.q('select password_hash from users where id = $1', [u.id])).rows[0].password_hash;
      if (hash.startsWith('s2:')) break;
      await sleep(50);
    }
    assert.match(hash, /^s2:32768:8:1:[a-f0-9]{32}:[a-f0-9]{128}$/);
    await dev.klijent().prijavi('s18stari@test.ba');
  });
});
