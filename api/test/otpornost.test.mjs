// Talas 4 „otpornost” (docs/PLAN-PRODUKCIJA.md, Faza 2b; docs/ARHITEKTURA.md, „Otpornost”):
// rokovi za upite i HTTP, 503/429 s Retry-After, „veliki crveni prekidač” (/api/config, režimi), stari keš kad baza
// ne odgovara, vruć brojač sviđanja (listing_likes_delta), outbox za push i Idempotency-Key.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ADMIN_URL, Klijent, ROOT, VIDEO, noviButik, novaBaza, okolina, pokreniApi, sleep } from './pomoc/okolina.mjs';

// Lažni Expo: `ponasanje()` vraća 'ok' | 'greska' (HTTP 500) | 'visi' (ne odgovara).
function laziExpo(ponasanje = () => 'ok') {
  const zahtjevi = [];
  const visi = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const p = ponasanje();
      if (p === 'visi') { visi.push(res); return; }
      if (p === 'greska') { res.statusCode = 500; res.end('{}'); return; }
      const poruke = JSON.parse(b);
      zahtjevi.push(poruke);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: poruke.map(() => ({ status: 'ok' })) }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/push`,
    zahtjevi,
    poruke: () => zahtjevi.flat(),
    close: () => { for (const r of visi) r.destroy(); server.closeAllConnections?.(); return new Promise((r) => server.close(r)); },
  })));
}

async function cekajDa(fn, ms = 5000, opis = 'uslov') {
  const kraj = Date.now() + ms;
  while (Date.now() < kraj) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error(`Nije ispunjeno za ${ms} ms: ${opis}`);
}

const adminKlijent = async () => {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  c.on('error', () => {});
  await c.connect();
  return c;
};

/* ---------- 1. rokovi ---------- */

describe('rokovi: statement_timeout, idle_in_transaction, 503 s Retry-After', () => {
  let o; let kupac; let oglasId;
  before(async () => {
    o = await okolina({ PG_STATEMENT_TIMEOUT_MS: '400', PG_IDLE_TX_TIMEOUT_MS: '700' });
    const b = await noviButik(o.baza, { butik: 'Butik Rok', email: 'rok@test.ba' });
    const bk = o.klijent(); await bk.prijavi(b.email, b.password);
    oglasId = (await bk.objavi({ title: 'Rok' })).body.oglas.id;
    kupac = o.klijent(); await kupac.registruj('rok-kupac@test.ba', 'Rok Kupac');
  });
  after(async () => { await o?.stop(); });

  test('upit koji čeka zaključanu tabelu duže od roka → 503 s porukom i Retry-After (nikad 500), pa opet 200', async () => {
    await kupac.get('/api/me'); // sesija u kešu, da zahtjev ispod čeka samo na listings
    const c = await o.baza.pool.connect();
    try {
      await c.query('begin');
      await c.query('lock table listings in access exclusive mode');
      const t = Date.now();
      const r = await kupac.get(`/api/listings/${oglasId}`);
      assert.equal(r.status, 503, JSON.stringify(r.body));
      assert.equal(r.body.greska, 'Server je trenutno preopterećen. Pokušaj ponovo za trenutak.');
      const ra = Number(r.headers.get('retry-after'));
      assert.ok(ra >= 5 && ra <= 10, `Retry-After ${ra}`);
      assert.ok(Date.now() - t < 3000, 'odgovor stiže ubrzo poslije roka (400 ms), ne čeka bravu');
    } finally {
      await c.query('rollback');
      c.release();
    }
    assert.equal((await kupac.get(`/api/listings/${oglasId}`)).status, 200);
    assert.match(o.api.log(), /Baza ne odgovara na vrijeme \(503\)/);
  });

  test('veze API-ja imaju statement_timeout i idle_in_transaction_session_timeout iz okoline', async () => {
    // Postavke iz `options` se vide u pg_settings samo unutar te veze, pa ih provjeravamo kroz db.js sa istom okolinom.
    const kod = `
      const { pool, qPosao, zatvoriBazu } = await import('./api/src/db.js');
      const a = (await pool.query('show statement_timeout')).rows[0].statement_timeout;
      const b = (await pool.query('show idle_in_transaction_session_timeout')).rows[0].idle_in_transaction_session_timeout;
      const p = (await qPosao('show statement_timeout')).rows[0].statement_timeout;
      const c = await pool.connect();
      c.on('error', () => {});
      await c.query('begin');
      await new Promise((r) => setTimeout(r, 1000));
      let prekinuto = false;
      try { await c.query('select 1'); } catch (e) { prekinuto = true; }
      c.release(true);
      console.log(JSON.stringify({ a, b, p, prekinuto }));
      await zatvoriBazu();`;
    const out = await new Promise((resolve, reject) => {
      const ch = spawn(process.execPath, ['--input-type=module', '-e', kod], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, DATABASE_URL: o.baza.url, PG_STATEMENT_TIMEOUT_MS: '400', PG_IDLE_TX_TIMEOUT_MS: '700', PG_STATEMENT_TIMEOUT_POSAO_MS: '90000' },
      });
      let s = '';
      ch.stdout.on('data', (d) => { s += d; });
      ch.stderr.on('data', (d) => { s += d; });
      ch.on('exit', (code) => (code === 0 ? resolve(s) : reject(new Error(s))));
    });
    const v = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{"a"')).pop());
    assert.deepEqual(v, { a: '400ms', b: '700ms', p: '90s', prekinuto: true });
  });
});

/* ---------- 1b. HTTP rokovi: spor upload prolazi, veza bez podataka se zatvara ---------- */

describe('HTTP rokovi (connectionTimeout je rok neaktivnosti)', () => {
  let o; let b;
  before(async () => {
    o = await okolina({ HTTP_CONNECTION_TIMEOUT_MS: '1500' });
    b = await noviButik(o.baza, { butik: 'Spori Upload', email: 'spori.upload@test.ba' });
  });
  after(async () => { await o?.stop(); });

  test('upload koji traje ~4 s (podaci teku svakih 400 ms) prolazi; veza koja ništa ne šalje se zatvara', async () => {
    const bk = o.klijent(); await bk.prijavi(b.email, b.password);
    const video = await readFile(VIDEO);
    const granica = 'xxKOMODOxx';
    const dio = (ime, v) => `--${granica}\r\nContent-Disposition: form-data; name="${ime}"\r\n\r\n${v}\r\n`;
    const glava = Buffer.from(`${dio('title', 'Spor upload')}${dio('price', '50')}${dio('category', 'Torbe')}--${granica}\r\nContent-Disposition: form-data; name="video"; filename="a.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
    const rep = Buffer.from(`\r\n--${granica}--\r\n`);
    const tijelo = Buffer.concat([glava, video, rep]);
    const komada = 10;
    const vel = Math.ceil(tijelo.length / komada);
    const t = Date.now();
    const status = await new Promise((resolve, reject) => {
      const r = http.request({
        host: '127.0.0.1', port: o.api.port, method: 'POST', path: '/api/listings',
        headers: { 'content-type': `multipart/form-data; boundary=${granica}`, 'content-length': tijelo.length, cookie: bk.cookieHeader() },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', reject);
      (async () => {
        for (let k = 0; k < komada; k += 1) {
          r.write(tijelo.subarray(k * vel, (k + 1) * vel));
          await sleep(400);
        }
        r.end();
      })();
    });
    assert.equal(status, 201);
    assert.ok(Date.now() - t >= 3500, 'upload je stvarno trajao duže od roka neaktivnosti');

    const zatvoreno = await new Promise((resolve) => {
      const s = net.connect(o.api.port, '127.0.0.1');
      const t0 = Date.now();
      s.on('close', () => resolve(Date.now() - t0));
      s.on('error', () => {});
      setTimeout(() => { s.destroy(); resolve(-1); }, 6000);
    });
    assert.ok(zatvoreno > 1000 && zatvoreno < 5000, `neaktivna veza zatvorena poslije ${zatvoreno} ms`);
  });
});

/* ---------- 2–3. režim rada, /api/config, Retry-After na 429, stari keš ---------- */

describe('režim rada („veliki crveni prekidač”) i Retry-After', () => {
  let o; let admin; let kupac; let shop; let oglasId;
  before(async () => {
    o = await okolina();
    admin = o.klijent(); await admin.registruj('admin@test.ba', 'Administrator');
    kupac = o.klijent(); await kupac.registruj('rezim-kupac@test.ba', 'Rezim Kupac');
    const b = await noviButik(o.baza, { butik: 'Butik Rezim', email: 'rezim@test.ba' });
    shop = o.klijent(); await shop.prijavi(b.email, b.password);
    oglasId = (await shop.objavi({ title: 'Rezim jedan' })).body.oglas.id;
    await shop.objavi({ title: 'Rezim dva' });
  });
  after(async () => {
    await admin?.post('/api/admin/rezim', { rezim: null }).catch(() => {});
    await o?.stop();
  });

  test('GET /api/config: javno, keširano 30 s, normalni intervali; zaglavlje X-Komodo-Rezim na API odgovorima', async () => {
    const r = await o.klijent().get('/api/config');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    assert.equal(r.headers.get('set-cookie'), null);
    assert.deepEqual(r.body, {
      rezim: 'normalno',
      intervali: { likes: 30000, me: 60000, profil: 30000, chat: 4000, views: 30000, config: 600000 },
      licniFeed: true, pregledi: true,
    });
    assert.equal((await o.klijent().get('/api/categories')).headers.get('x-komodo-rezim'), 'normalno');
  });

  test('admin prekidač: samo administrator; stedi → duži intervali; hitno → Za tebe = Novo, pregledi se ne broje', async () => {
    assert.equal((await kupac.post('/api/admin/rezim', { rezim: 'hitno' })).status, 404);
    assert.equal((await o.klijent().get('/api/admin/rezim')).status, 404);
    assert.equal((await admin.post('/api/admin/rezim', { rezim: 'nesto' })).status, 400);

    const s = await admin.post('/api/admin/rezim', { rezim: 'stedi' });
    assert.equal(s.status, 200);
    assert.equal(s.body.rezim, 'stedi');
    assert.equal(s.body.okolina, 'normalno');
    const cs = (await o.klijent().get('/api/config')).body;
    assert.equal(cs.rezim, 'stedi');
    assert.ok(cs.intervali.likes > 30000 && cs.intervali.me > 60000 && cs.intervali.chat > 4000);

    assert.equal((await admin.post('/api/admin/rezim', { rezim: 'hitno' })).body.rezim, 'hitno');
    const ch = await o.klijent().get('/api/config');
    assert.equal(ch.headers.get('x-komodo-rezim'), 'hitno');
    assert.deepEqual([ch.body.licniFeed, ch.body.pregledi, ch.body.intervali.chat], [false, false, 15000]);
    // „Za tebe” = prva strana „Novo” (najnoviji prvi) i kraj:true, i za prijavljenog kupca.
    const zt = await kupac.get('/api/feed?kartica=zatebe&izuzmi=1,2,3');
    assert.equal(zt.status, 200);
    assert.equal(zt.body.kraj, true);
    assert.deepEqual(zt.body.oglasi.map((x) => x.title), ['Rezim dva', 'Rezim jedan']);
    // Pregledi: odgovor ok, a u bazi ništa.
    assert.equal((await kupac.post('/api/views', { ids: [oglasId] })).status, 200);
    assert.equal((await o.baza.q('select count(*)::int as n from listing_views')).rows[0].n, 0);

    // null → nazad na KOMODO_REZIM iz okoline (normalno); red u bazi nestaje.
    assert.equal((await admin.post('/api/admin/rezim', { rezim: null })).body.rezim, 'normalno');
    assert.equal((await o.baza.q("select count(*)::int as n from app_settings where key = 'rezim'")).rows[0].n, 0);
    assert.equal((await kupac.post('/api/views', { ids: [oglasId] })).status, 200);
    assert.equal((await o.baza.q('select count(*)::int as n from listing_views')).rows[0].n, 1);
  });

  test('svaki 429 nosi Retry-After', async () => {
    let r;
    for (let k = 0; k < 32; k += 1) r = await kupac.post('/api/views', { ids: [oglasId] });
    assert.equal(r.status, 429);
    const ra = Number(r.headers.get('retry-after'));
    assert.ok(ra >= 30 && ra <= 60, `Retry-After ${ra}`);
  });

  test('baza ne prima veze: javni feed i „Za tebe” za neprijavljene služe zadnji keš (X-Komodo-Zastarjelo), prijavljeni 503', async () => {
    const anon = o.klijent();
    const prije = await anon.get('/api/listings?category=Haljine');
    assert.equal(prije.status, 200);
    assert.equal(prije.headers.get('x-komodo-zastarjelo'), null);
    const zt = await anon.get('/api/feed?kartica=zatebe');
    assert.equal(zt.status, 200);
    const novi = o.klijent(); await novi.registruj('rezim-novi@test.ba', 'Rezim Novi');
    await sleep(5200); // istekao keš javnog feeda (5 s); novi još nije čitao /api/me, pa mu sesija nije u kešu
    const a = await adminKlijent();
    try {
      await a.query(`alter database ${o.baza.name} allow_connections false`);
      await a.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [o.baza.name]);
      const r = await anon.get('/api/listings?category=Haljine');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.headers.get('x-komodo-zastarjelo'), '1');
      assert.deepEqual(r.body.oglasi.map((x) => x.id), prije.body.oglasi.map((x) => x.id));
      const z = await anon.get('/api/feed?kartica=zatebe');
      assert.equal(z.status, 200);
      assert.deepEqual(z.body.oglasi.map((x) => x.id).sort(), zt.body.oglasi.map((x) => x.id).sort());
      const me = await novi.get('/api/me');
      assert.equal(me.status, 503, JSON.stringify(me.body));
      assert.ok(Number(me.headers.get('retry-after')) >= 5);
      const h = await anon.get('/api/health');
      assert.equal(h.status, 503);
      assert.ok(h.headers.get('retry-after'));
    } finally {
      await a.query(`alter database ${o.baza.name} allow_connections true`);
      await a.end();
    }
    await cekajDa(async () => (await anon.get('/api/listings?category=Haljine')).headers.get('x-komodo-zastarjelo') === null, 8000, 'oporavak');
    assert.equal((await novi.get('/api/me')).status, 200);
  });
});

/* ---------- 3b. režim iz okoline i širenje na sve radnike ---------- */

describe('režim: KOMODO_REZIM iz okoline i promjena u klasteru (WORKERS=2) stiže na sve radnike', () => {
  let baza; let child; let port; const lines = [];
  before(async () => {
    baza = await novaBaza();
    port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    child = spawn(process.execPath, [path.join('api', 'src', 'index.js')], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: baza.url, PORT: String(port), HOST: '127.0.0.1',
        NODE_ENV: 'development', WORKERS: '2', SMTP_URL: '', ADMIN_EMAILS: 'admin@test.ba', KOMODO_REZIM: 'stedi',
        BUNNY_LIBRARY_ID: '', BUNNY_API_KEY: '', BUNNY_CDN_HOST: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (c) => { for (const l of c.toString().split('\n')) if (l) lines.push(l); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const end = Date.now() + 30000;
    while (lines.filter((l) => /Server listening/.test(l)).length < 2) {
      if (Date.now() > end || child.exitCode !== null) throw new Error(`Klaster se nije pokrenuo:\n${lines.join('\n')}`);
      await sleep(50);
    }
  });
  after(async () => {
    if (child && child.exitCode === null) {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await gone;
    }
    await baza?.drop();
  });

  // Svaki zahtjev novom vezom, da ih cluster rasporedi na oba radnika.
  const rezimi = async (n) => {
    const out = new Set();
    for (let k = 0; k < n; k += 1) {
      const r = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { connection: 'close' } });
      out.add((await r.json()).rezim);
    }
    return [...out];
  };

  test('zadano stedi iz okoline; admin → hitno: svih 12 odgovora (oba radnika) odmah hitno', async () => {
    assert.deepEqual(await rezimi(8), ['stedi']);
    const admin = new Klijent(`http://127.0.0.1:${port}`);
    await admin.registruj('admin@test.ba', 'Administrator');
    const r = await admin.post('/api/admin/rezim', { rezim: 'hitno' });
    assert.equal(r.status, 200);
    assert.equal(r.body.okolina, 'stedi');
    await sleep(100); // poruka primarnom procesu i nazad
    assert.deepEqual(await rezimi(12), ['hitno']);
    await admin.post('/api/admin/rezim', { rezim: null });
    await sleep(100);
    assert.deepEqual(await rezimi(12), ['stedi']);
  });
});

/* ---------- 4. vruć brojač ---------- */

describe('vruć brojač: sviđanja kroz listing_likes_delta', () => {
  let o; let oglasId; const kupci = [];
  before(async () => {
    o = await okolina({ KOMODO_JOBS: '1', KOMODO_SABIR_MS: '300' });
    const b = await noviButik(o.baza, { butik: 'Viralni Butik', email: 'viral@test.ba' });
    const bk = o.klijent(); await bk.prijavi(b.email, b.password);
    oglasId = (await bk.objavi({ title: 'Viralni oglas' })).body.oglas.id;
    // 300 kupaca sa sesijama direktno u bazi (registracija je ograničena po adresi).
    await o.baza.q(`insert into users(email, password_hash, shop_name, handle, role, email_verified_at)
                    select 'v' || g || '@t.ba', 'x', 'V ' || g, 'v' || g, 'kupac', now() from generate_series(1, 300) g`);
    const s = await o.baza.q("select id from users where email like 'v%@t.ba' order by id");
    for (const r of s.rows) {
      const tok = `viral${r.id}`;
      await o.baza.q("insert into sessions(token, user_id, expires_at) values (encode(sha256($1::bytea), 'hex'), $2, now() + interval '1 day')", [tok, r.id]);
      const k = o.klijent(); k.cookies.set('sid', tok); kupci.push(k);
    }
  });
  after(async () => { await o?.stop(); });

  const tacno = async () => (await o.baza.q(
    `select l.likes_count, (select count(*)::int from likes where listing_id = l.id) as redova,
            (select count(*)::int from listing_likes_delta where listing_id = l.id) as razlika
       from listings l where l.id = $1`, [oglasId])).rows[0];

  test('300 istovremenih sviđanja istog oglasa: red oglasa se ne mijenja po sviđanju, posao sabere, broj tačan', async () => {
    const rs = await Promise.all(kupci.map((k) => k.post(`/api/listings/${oglasId}/like`, { liked: true })));
    assert.ok(rs.every((r) => r.status === 200 && r.body.liked === true));
    // Odgovor svakog sviđanja je broj iz trenutka te naredbe (istovremena sviđanja koja još nisu potvrđena ne vidi).
    assert.ok(rs.every((r) => r.body.likes >= 1 && r.body.likes <= 300));
    // API odmah vidi tačan broj (likes_count + nesabrane razlike).
    assert.equal((await o.klijent().get(`/api/likes?ids=${oglasId}`)).body.svidjanja[oglasId].likes, 300);
    await cekajDa(async () => (await tacno()).razlika === 0, 5000, 'posao sabrao razlike');
    assert.deepEqual(await tacno(), { likes_count: 300, redova: 300, razlika: 0 });
    // Prekidač tamo-amo + „ne sviđa mi se”: i dalje tačno.
    await Promise.all(kupci.slice(0, 150).map((k) => k.post(`/api/listings/${oglasId}/like`)));
    await Promise.all(kupci.slice(100, 200).map((k) => k.post(`/api/listings/${oglasId}/like`, { liked: false })));
    assert.equal((await o.klijent().get(`/api/listings/${oglasId}`)).body.oglas.likes, 100);
    await cekajDa(async () => (await tacno()).razlika === 0, 5000, 'posao sabrao razlike');
    assert.deepEqual(await tacno(), { likes_count: 100, redova: 100, razlika: 0 });
  });

  test('brisanje naloga kupca umanjuje broj kroz razlike, i kad njegovo sviđanje još nije sabrano', async () => {
    const k = o.klijent(); await k.registruj('viral-brise@test.ba', 'Viral Brise');
    await k.post(`/api/listings/${oglasId}/like`, { liked: true });
    assert.equal((await k.post('/api/me/delete', { password: 'lozinka123' })).status, 200);
    await cekajDa(async () => (await tacno()).razlika === 0, 5000, 'posao sabrao razlike');
    assert.deepEqual(await tacno(), { likes_count: 100, redova: 100, razlika: 0 });
  });
});

/* ---------- 5. outbox ---------- */

describe('outbox: push o poruci se ne gubi', () => {
  let baza; const procesi = [];
  let expo;
  let rezim = 'ok';
  before(async () => {
    expo = await laziExpo(() => rezim);
    baza = await novaBaza();
  });
  after(async () => {
    for (const p of procesi) await p.stop().catch(() => {});
    await expo?.close();
    await baza?.drop();
  });
  const api = async (env) => {
    const a = await pokreniApi(baza, { EXPO_PUSH_URL: expo.url, ...env });
    procesi.push(a);
    return a;
  };
  const red = async (id) => (await baza.q('select pokusaja, sent_at is not null as poslano, dead_at is not null as mrtav, greska from outbox where id = $1', [id])).rows[0];

  let kupac; let b; let bk; let razgovor; let a1;
  test('poruka → red u outboxu u istoj naredbi → push stiže; samo kad primalac ima token', async () => {
    a1 = await api({ KOMODO_JOBS: '1', OUTBOX_MS: '200' });
    b = await noviButik(baza, { butik: 'Outbox Butik', email: 'outbox@test.ba' });
    bk = new Klijent(a1.url); await bk.prijavi(b.email, b.password);
    await bk.post('/api/me/push-token', { token: 'ExponentPushToken[butik1]' });
    kupac = new Klijent(a1.url); await kupac.registruj('outbox-kupac@test.ba', 'Outbox Kupac');
    razgovor = (await kupac.post('/api/conversations', { shop: b.handle })).body.razgovor;
    const r = await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Je li još dostupno?' });
    assert.equal(r.status, 201);
    await cekajDa(() => expo.poruke().length === 1, 5000, 'push stigao');
    assert.deepEqual(
      { to: expo.poruke()[0].to, title: expo.poruke()[0].title, body: expo.poruke()[0].body, channelId: expo.poruke()[0].channelId },
      { to: 'ExponentPushToken[butik1]', title: 'Outbox Kupac', body: 'Je li još dostupno?', channelId: 'poruke' },
    );
    const o = (await baza.q("select id from outbox where vrsta = 'poruka'")).rows;
    assert.equal(o.length, 1);
    await cekajDa(async () => (await red(o[0].id)).poslano, 3000, 'red označen kao poslan');
    // Kupac nema token: odgovor butika ne pravi red.
    await bk.post(`/api/conversations/${razgovor}/messages`, { body: 'Da, dostupno je.' });
    assert.equal((await baza.q("select count(*)::int as n from outbox where vrsta = 'poruka'")).rows[0].n, 1);
  });

  test('Expo vraća grešku: ponovni pokušaji s rastućim čekanjem, pa poslano jednom', async () => {
    rezim = 'greska';
    const prije = expo.poruke().length;
    await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Druga poruka' });
    const id = (await baza.q("select max(id) as id from outbox where vrsta = 'poruka'")).rows[0].id;
    await cekajDa(async () => (await red(id)).greska !== null, 5000, 'prvi pokušaj ne uspio');
    assert.match((await red(id)).greska, /500/);
    const runAt = (await baza.q('select extract(epoch from run_at - now()) as s from outbox where id = $1', [id])).rows[0].s;
    assert.ok(runAt > 2 && runAt < 7, `sljedeći pokušaj za ~5 s (${runAt})`);
    rezim = 'ok';
    await baza.q('update outbox set run_at = now() where id = $1', [id]); // ubrzaj čekanje
    await cekajDa(async () => (await red(id)).poslano, 5000, 'poslano poslije greške');
    assert.equal(expo.poruke().length, prije + 1);
  });

  test('poslije OUTBOX_POKUSAJA neuspjeha red je mrtav i više se ne šalje', async () => {
    await a1.stop();
    const a2 = await api({ KOMODO_JOBS: '1', OUTBOX_MS: '100', OUTBOX_POKUSAJA: '2' });
    rezim = 'greska';
    const k = new Klijent(a2.url); await k.prijavi('outbox-kupac@test.ba');
    await k.post(`/api/conversations/${razgovor}/messages`, { body: 'Treća poruka' });
    const id = (await baza.q("select max(id) as id from outbox where vrsta = 'poruka'")).rows[0].id;
    await cekajDa(async () => (await red(id)).greska !== null, 5000, 'prvi pokušaj završen');
    await baza.q('update outbox set run_at = now() where id = $1', [id]);
    await cekajDa(async () => (await red(id)).mrtav, 5000, 'mrtav red');
    assert.equal((await red(id)).pokusaja, 2);
    rezim = 'ok';
    await baza.q('update outbox set run_at = now() where id = $1', [id]);
    await sleep(500);
    assert.equal((await red(id)).poslano, false);
    await a2.stop();
  });

  test('proces pada usred slanja (Expo ne odgovara, SIGKILL): poslije restarta poruka stiže tačno jednom', async () => {
    rezim = 'visi';
    const a3 = await api({ KOMODO_JOBS: '1', OUTBOX_MS: '100', OUTBOX_ZAKUP_S: '5' });
    const k = new Klijent(a3.url); await k.prijavi('outbox-kupac@test.ba');
    const prije = expo.poruke().length;
    assert.equal((await k.post(`/api/conversations/${razgovor}/messages`, { body: 'Poruka prije pada' })).status, 201);
    const id = (await baza.q("select max(id) as id from outbox where vrsta = 'poruka'")).rows[0].id;
    await cekajDa(async () => (await red(id)).pokusaja >= 1, 5000, 'red zakupljen, slanje u toku');
    process.kill(a3.pid, 'SIGKILL');
    await sleep(300);
    procesi.splice(procesi.indexOf(a3), 1); // ugašen: stop() bi čekao izlaz koji je već prošao
    rezim = 'ok';
    await api({ KOMODO_JOBS: '1', OUTBOX_MS: '100', OUTBOX_ZAKUP_S: '5' });
    await cekajDa(async () => (await red(id)).poslano, 12000, 'poslano poslije restarta (kad istekne zakup)');
    await sleep(500);
    assert.equal(expo.poruke().filter((p) => p.body === 'Poruka prije pada').length, 1);
    assert.equal(expo.poruke().length, prije + 1);
  });

  test('dva procesa istovremeno: 300 redova, svaki poslan tačno jednom (for update skip locked)', async () => {
    rezim = 'ok';
    await api({ KOMODO_JOBS: '1', OUTBOX_MS: '100' });
    const prije = expo.poruke().length;
    // R3-07/R3-08: pri slanju se tokeni provjeravaju u push_tokens, pa probni tokeni moraju postojati.
    const v = (await baza.q("select u.id, s.token from users u join sessions s on s.user_id = u.id where u.email = 'outbox-kupac@test.ba' limit 1")).rows[0];
    await baza.q(`insert into push_tokens(token, user_id, session_token)
                  select 'ExponentPushToken[d' || g || ']', $1, $2 from generate_series(1, 300) g`, [v.id, v.token]);
    await baza.q(`insert into outbox(vrsta, payload)
                  select 'push', jsonb_build_object('poruke', jsonb_build_array(jsonb_build_object('to', 'ExponentPushToken[d' || g || ']', 'title', 't', 'body', 'b')))
                    from generate_series(1, 300) g`);
    await cekajDa(async () => (await baza.q('select count(*)::int as n from outbox where sent_at is null and dead_at is null')).rows[0].n === 0, 10000, 'sve poslano');
    await sleep(300);
    const nove = expo.poruke().slice(prije).map((p) => p.to);
    assert.equal(nove.length, 300);
    assert.equal(new Set(nove).size, 300);
    assert.ok(expo.zahtjevi.slice(-10).every((z) => z.length <= 100));
  });
});

/* ---------- 6. Idempotency-Key ---------- */

describe('Idempotency-Key: poruka i objava', () => {
  let o; let kupac; let drugi; let bk; let razgovor;
  before(async () => {
    o = await okolina();
    const b = await noviButik(o.baza, { butik: 'Idem Butik', email: 'idem@test.ba' });
    bk = o.klijent(); await bk.prijavi(b.email, b.password);
    kupac = o.klijent(); await kupac.registruj('idem-kupac@test.ba', 'Idem Kupac');
    drugi = o.klijent(); await drugi.registruj('idem-drugi@test.ba', 'Idem Drugi');
    razgovor = (await kupac.post('/api/conversations', { shop: b.handle })).body.razgovor;
  });
  after(async () => { await o?.stop(); });
  const poruka = (k, body, kljuc) => k.post(`/api/conversations/${razgovor}/messages`, { body }, kljuc ? { headers: { 'idempotency-key': kljuc } } : {});
  const broj = async () => (await o.baza.q('select count(*)::int as n from messages')).rows[0].n;

  test('isti ključ dvaput → isti odgovor, jedna poruka; drugi ključ → nova poruka; bez ključa kao ranije', async () => {
    const a = await poruka(kupac, 'Zdravo', 'kljuc-poruka-0001');
    const b = await poruka(kupac, 'Zdravo', 'kljuc-poruka-0001');
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.deepEqual(b.body, a.body);
    assert.equal(b.headers.get('idempotent-replay'), 'true');
    assert.equal(await broj(), 1);
    assert.equal((await poruka(kupac, 'Zdravo', 'kljuc-poruka-0002')).body.poruka.id > a.body.poruka.id, true);
    assert.equal((await poruka(kupac, 'Zdravo')).status, 201);
    assert.equal(await broj(), 3);
  });

  test('istovremeno 10× isti ključ → tačno jedna poruka; ostali dobiju isti odgovor ili 409 s Retry-After', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => poruka(kupac, 'Dupli dodir', 'kljuc-istovremeno-1')));
    assert.equal(await broj(), 4);
    const ok = rs.filter((r) => r.status === 201);
    assert.ok(ok.length >= 1);
    assert.ok(ok.every((r) => r.body.poruka.id === ok[0].body.poruka.id));
    for (const r of rs.filter((x) => x.status !== 201)) {
      assert.equal(r.status, 409);
      assert.equal(r.headers.get('retry-after'), '2');
    }
  });

  test('ključ je po korisniku; greška (400) se ne pamti; neispravan ključ → 400; stariji od 24 h ne važi', async () => {
    // Isti ključ drugog korisnika (drugi nema pristup razgovoru → 404, ali ne dobija tuđi sačuvan odgovor).
    assert.equal((await poruka(drugi, 'Zdravo', 'kljuc-poruka-0001')).status, 404);
    assert.equal((await poruka(kupac, '', 'kljuc-prazno-01')).status, 400);
    assert.equal((await poruka(kupac, 'Sad ima teksta', 'kljuc-prazno-01')).status, 201);
    assert.equal((await poruka(kupac, 'x', 'kratak')).status, 400);
    assert.equal((await poruka(kupac, 'x', 'ima razmak u sebi')).status, 400);
    const n = await broj();
    await o.baza.q("update idempotency_keys set created_at = now() - interval '25 hours' where kljuc = 'kljuc-poruka-0001'");
    assert.equal((await poruka(kupac, 'Zdravo', 'kljuc-poruka-0001')).headers.get('idempotent-replay'), null);
    assert.equal(await broj(), n + 1);
  });

  test('objava: isti ključ dvaput → jedan oglas, isti odgovor', async () => {
    const fd = async () => {
      const f = new FormData();
      f.append('title', 'Idem oglas'); f.append('price', '40'); f.append('category', 'Torbe');
      f.append('video', new Blob([await readFile(VIDEO)], { type: 'video/mp4' }), 'a.mp4');
      return f;
    };
    const h = { 'idempotency-key': 'objava-kljuc-0001' };
    const a = await bk.zahtjev('POST', '/api/listings', { body: await fd(), headers: h });
    const b = await bk.zahtjev('POST', '/api/listings', { body: await fd(), headers: h });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.body.oglas.id, a.body.oglas.id);
    assert.equal((await o.baza.q("select count(*)::int as n from listings where title = 'Idem oglas'")).rows[0].n, 1);
  });
});
