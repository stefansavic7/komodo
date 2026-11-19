// Sigurnosna pravila i opšte ponašanje: bez sesije 401, kolačići, lažna sesija, ograničenja veličine,
// statički fajlovi, razvojni email u zapisu, zdravlje servisa.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Klijent, novaBaza, noviButik, okolina, pokreniApi, sleep } from './pomoc/okolina.mjs';

let o;
let butik;
let shop;
let oglas;

before(async () => {
  o = await okolina();
  butik = await noviButik(o.baza, { butik: 'Butik Sigurnost', email: 'butik.sigurnost@test.ba' });
  shop = o.klijent();
  await shop.prijavi(butik.email, butik.password);
  oglas = (await shop.objavi({ title: 'Oglas sigurnost' })).body.oglas;
});
after(async () => { await o?.stop(); });

describe('bez sesije', () => {
  test('sve rute koje mijenjaju podatke ili čitaju lične podatke daju 401', async () => {
    const k = o.klijent();
    const rute = [
      ['patch', '/api/me', { name: 'Neko' }],
      ['post', '/api/me/password', { current: 'x', next: 'y12345678' }],
      ['post', '/api/me/delete', { password: 'x' }],
      ['post', '/api/me/push-token', { token: 'ExponentPushToken[abc]' }],
      ['post', '/api/auth/resend'],
      ['patch', `/api/listings/${oglas.id}`, { title: 'X', price: '1', category: 'Ostalo' }],
      ['del', `/api/listings/${oglas.id}`],
      ['post', `/api/listings/${oglas.id}/like`, { liked: true }],
      ['post', '/api/conversations', { shop: butik.handle }],
      ['get', '/api/conversations'],
      ['get', '/api/conversations/1/messages'],
      ['post', '/api/conversations/1/messages', { body: 'x' }],
      ['post', '/api/conversations/1/block', {}],
      ['post', '/api/reports', { listingId: oglas.id }],
    ];
    for (const [m, url, body] of rute) {
      const r = await k[m](url, body);
      assert.equal(r.status, 401, `${m} ${url}`);
      assert.equal(typeof r.body.greska, 'string');
    }
    assert.equal((await k.objavi()).status, 401);
  });

  test('javne rute rade bez sesije', async () => {
    const k = o.klijent();
    assert.equal((await k.get('/api/listings')).status, 200);
    assert.equal((await k.get(`/api/listings/${oglas.id}`)).status, 200);
    assert.equal((await k.get(`/api/shops/${butik.handle}`)).status, 200);
    assert.equal((await k.get('/api/categories')).status, 200);
  });

  test('/api/health vraća {ok, baza, verzija} i ništa više', async () => {
    const r = await o.klijent().get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.baza, true);
    assert.match(String(r.body.verzija), /^[0-9a-f]{10}$/);
    assert.deepEqual(Object.keys(r.body).sort(), ['baza', 'ok', 'verzija']);
  });
});

describe('zdravlje kad baza nije dostupna', () => {
  // Popravljeno (backend): api/src/db.js ima pool.on('error'), pa prekinuta veza ne obara proces.
  test('/api/health vraća 503 {ok:false, baza:false}, a API ne pada', async () => {
    const baza = await novaBaza();
    const api = await pokreniApi(baza);
    try {
      assert.equal((await fetch(`${api.url}/api/health`)).status, 200);
      await baza.drop(); // gasi i veze API-ja na tu bazu
      const r = await fetch(`${api.url}/api/health`);
      assert.equal(r.status, 503);
      assert.deepEqual(await r.json(), { ok: false, baza: false });
      await sleep(300);
      const opet = await fetch(`${api.url}/api/health`);
      assert.equal(opet.status, 503, 'API i dalje odgovara');
    } finally {
      await api.stop();
      await baza.drop().catch(() => {});
    }
  });
});

describe('sesija i kolačići', () => {
  test('kolačić sid je HttpOnly, SameSite=Lax, Path=/', async () => {
    const res = await fetch(`${o.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: butik.email, password: butik.password }),
    });
    const sid = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
    assert.ok(sid);
    assert.match(sid, /HttpOnly/i);
    assert.match(sid, /SameSite=Lax/i);
    assert.match(sid, /Path=\//);
  });

  test('izmišljen ili tuđ oblik tokena ne daje pristup', async () => {
    for (const sid of ['tok1', 'x'.repeat(64), "' or 1=1 --"]) {
      const k = new Klijent(o.url);
      k.cookies.set('sid', encodeURIComponent(sid));
      assert.equal((await k.get('/api/me')).body.korisnik, null);
      assert.equal((await k.post(`/api/listings/${oglas.id}/like`, { liked: true })).status, 401);
    }
  });

  test('lozinka i hash se nikad ne vraćaju', async () => {
    const k = o.klijent();
    const reg = await k.post('/api/auth/register', { email: 'tajna@test.ba', password: 'lozinka123', name: 'Tajna' });
    const me = await k.get('/api/me');
    for (const tijelo of [reg.body, me.body]) {
      const s = JSON.stringify(tijelo);
      assert.equal(/password|hash|lozinka123/i.test(s), false, s);
    }
  });

  test('push token: provjera oblika', async () => {
    const k = o.klijent();
    await k.registruj('push@test.ba', 'Push');
    assert.equal((await k.post('/api/me/push-token', { token: 'nije-token' })).status, 400);
    assert.equal((await k.post('/api/me/push-token', { token: 'ExponentPushToken[abc_DEF-123]' })).status, 200);
  });
});

describe('ulaz i greške', () => {
  test('tijelo veće od 64 KB: 413, bez greške 500', async () => {
    const k = o.klijent();
    const r = await k.post('/api/auth/login', { email: 'a@b.ba', password: 'x'.repeat(70 * 1024) });
    assert.equal(r.status, 413);
  });

  test('neispravan JSON: 400', async () => {
    const r = await o.klijent().zahtjev('POST', '/api/auth/login', { body: '{nije json', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400);
  });

  test('čudni parametri pretrage ne izazivaju 500', async () => {
    const k = o.klijent();
    for (const qs of [
      `q=${encodeURIComponent("'; drop table users; --")}`,
      `q=${encodeURIComponent('\\')}`,
      'min=abc&max=-1',
      'before=-5',
      'before=99999999999999',
      'category=%00',
      `shop=${encodeURIComponent('../../etc')}`,
    ]) {
      const r = await k.get(`/api/listings?${qs}`);
      assert.equal(r.status, 200, qs);
    }
    assert.equal((await k.get('/api/likes?ids=1,2,abc,-1,99999999999')).status, 200);
  });

  test('nepoznata API ruta 404 JSON; ostale putanje vraćaju aplikaciju', async () => {
    const api = await o.klijent().get('/api/nepostoji');
    assert.equal(api.status, 404);
    assert.equal(api.body.greska, 'Ne postoji.');
    const strana = await fetch(`${o.url}/neki/ekran`);
    assert.equal(strana.status, 200);
    const html = await strana.text();
    // Svaki lokalni skript i stil dobija oznaku verzije (ista kao u /api/health), da keš ne miješa verzije.
    const verzija = (await o.klijent().get('/api/health')).body.verzija;
    const skripte = [...html.matchAll(/<script src="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(skripte.length > 0);
    for (const src of skripte) {
      assert.ok(src.endsWith(`?v=${verzija}`), src);
      assert.equal((await fetch(o.url + src)).status, 200, src);
    }
    assert.match(html, new RegExp(`href="/style\\.css\\?v=${verzija}"`));
  });

  test('putanje van foldera sa snimcima se ne služe', async () => {
    // Sirov HTTP zahtjev, da klijent ne „počisti” putanju prije slanja.
    const http = await import('node:http');
    const raw = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: o.api.port, path: p }, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }).on('error', reject);
    });
    for (const p of [
      '/media/..%2f..%2fpackage.json', '/media/%2e%2e/%2e%2e/package.json', '/media/../api/package.json',
      '/media/..%2f..%2fapi%2fpackage.json', '/..%2fapi%2fpackage.json', '/media/%2e%2e%2f%2e%2e%2fapi%2fsrc%2fdb.js',
    ]) {
      const r = await raw(p);
      assert.equal(r.body.includes('"dependencies"') || r.body.includes('DATABASE_URL'), false, `${p} → ${r.status}`);
    }
  });
});

describe('razvoj bez emaila (SMTP_URL prazan)', () => {
  test('novi nalog je odmah potvrđen', async () => {
    const u = await o.klijent().registruj('odmah@test.ba', 'Odmah');
    assert.equal(u.verified, true);
  });

  test('link za novu lozinku se ispiše u zapisu API-ja i radi', async () => {
    await o.klijent().registruj('zapis@test.ba', 'Zapis');
    assert.equal((await o.klijent().post('/api/auth/forgot', { email: 'zapis@test.ba' })).status, 200);
    const red = await o.api.cekajLog(/zapis@test\.ba.*lozinka=/s);
    const token = /lozinka=([a-f0-9]+)/.exec(red)[1];
    const r = await o.klijent().post('/api/auth/reset', { token, password: 'novalozinka1' });
    assert.equal(r.status, 200);
  });
});
