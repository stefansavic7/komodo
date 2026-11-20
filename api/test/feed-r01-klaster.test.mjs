// R-01 (docs/RECENZIJA-1.md): keš prijava u klasteru (src/index.js, WORKERS=2). Poslije brisanja naloga,
// odjave i promjene lozinke stara sesija ne smije raditi ni na jednom radniku, a upis s id-jem obrisanog
// korisnika (sviđanje, poruka) daje 401, nikad 500.
//
// Svaki zahtjev ide novom TCP vezom (agent: false), pa ih cluster raspoređuje na oba radnika.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Klijent, LOZINKA, ROOT, noviButik, novaBaza, sleep } from './pomoc/okolina.mjs';

function slobodanPort() {
  const m = /^(\d+)-(\d+)$/.exec(process.env.KOMODO_TEST_PORTS || '');
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    const list = [];
    for (let p = lo; p <= hi; p += 1) list.push(p);
    return (async () => {
      for (const p of list.sort(() => Math.random() - 0.5)) {
        const ok = await new Promise((r) => {
          const s = net.createServer();
          s.once('error', () => r(false));
          s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
        });
        if (ok) return p;
      }
      throw new Error('Nema slobodnog porta u KOMODO_TEST_PORTS');
    })();
  }
  return new Promise((r) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
  });
}

// Zahtjev novom vezom; vraća { status, body }.
function zahtjev(port, method, url, sid, json) {
  return new Promise((resolve, reject) => {
    const data = json === undefined ? null : JSON.stringify(json);
    const headers = {};
    if (sid) headers.cookie = `sid=${sid}`;
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers, agent: false }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        resolve({ status: res.statusCode, body });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let baza;
let child;
let port;
let uploads;
const lines = [];
let url;

before(async () => {
  baza = await novaBaza();
  uploads = await mkdtemp(path.join(os.tmpdir(), 'komodo-r01-'));
  port = await slobodanPort();
  child = spawn(process.execPath, [path.join('api', 'src', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: baza.url, PORT: String(port), HOST: '127.0.0.1',
      UPLOADS_DIR: uploads, NODE_ENV: 'development', WORKERS: '2', SMTP_URL: '',
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
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    const t = setTimeout(() => child.kill('SIGKILL'), 8000);
    await gone;
    clearTimeout(t);
  }
  await rm(uploads, { recursive: true, force: true }).catch(() => {});
  await baza?.drop();
});

// Napuni keš prijava u oba radnika: 12 zahtjeva novim vezama, svi moraju vidjeti korisnika.
async function zagrij(sid) {
  for (let k = 0; k < 12; k += 1) {
    const r = await zahtjev(port, 'GET', '/api/me', sid);
    assert.ok(r.body && r.body.korisnik, 'korisnik je prijavljen prije radnje');
  }
}

describe('R-01: keš prijava u klasteru (WORKERS=2)', () => {
  let oglasId;
  let handle;
  before(async () => {
    const b = await noviButik(baza, { butik: 'Butik Klaster', email: 'butik.klaster@test.ba' });
    handle = b.handle;
    const shop = new Klijent(url);
    await shop.prijavi(b.email, b.password);
    const r = await shop.objavi({ title: 'Oglas klaster' });
    assert.equal(r.status, 201);
    oglasId = r.body.oglas.id;
  });

  test('brisanje naloga: stari sid na svim radnicima → 401 (nikad 500) za sviđanje i /api/me bez korisnika', async () => {
    const k = new Klijent(url);
    await k.registruj('obrisani@test.ba', 'Obrisani Kupac');
    const sid = k.cookies.get('sid');
    await zagrij(sid);
    const del = await zahtjev(port, 'POST', '/api/me/delete', sid, { password: LOZINKA });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    await sleep(100); // poruka primarnom procesu i nazad
    const statusi = {};
    for (let n = 0; n < 20; n += 1) {
      const r = await zahtjev(port, 'POST', `/api/listings/${oglasId}/like`, sid, { liked: true });
      statusi[r.status] = (statusi[r.status] || 0) + 1;
    }
    assert.deepEqual(statusi, { 401: 20 });
    for (let n = 0; n < 10; n += 1) {
      const r = await zahtjev(port, 'GET', '/api/me', sid);
      assert.equal(r.body.korisnik, null);
    }
  });

  test('odjava: stara sesija ne radi ni na jednom radniku', async () => {
    const k = new Klijent(url);
    await k.registruj('odjava.klaster@test.ba', 'Odjava Kupac');
    const sid = k.cookies.get('sid');
    await zagrij(sid);
    const out = await zahtjev(port, 'POST', '/api/auth/logout', sid);
    assert.equal(out.status, 200);
    await sleep(100);
    for (let n = 0; n < 12; n += 1) {
      const r = await zahtjev(port, 'GET', '/api/me', sid);
      assert.equal(r.body.korisnik, null, `zahtjev ${n}: odjavljena sesija još radi`);
    }
  });

  test('korisnik obrisan mimo API-ja (keš u oba radnika ne zna): sviđanje i poruka → 401, ne 500 (23503)', async () => {
    const k = new Klijent(url);
    const ja = await k.registruj('mimo.klaster@test.ba', 'Mimo Kupac');
    const sid = k.cookies.get('sid');
    await zagrij(sid);
    await baza.q('delete from users where id = $1', [ja.id]);
    const statusi = {};
    for (let n = 0; n < 10; n += 1) {
      const r = await zahtjev(port, 'POST', `/api/listings/${oglasId}/like`, sid, { liked: true });
      statusi[r.status] = (statusi[r.status] || 0) + 1;
      const p = await zahtjev(port, 'POST', '/api/conversations', sid, { handle, listingId: oglasId });
      statusi[`p${p.status}`] = (statusi[`p${p.status}`] || 0) + 1;
      const v = await zahtjev(port, 'POST', '/api/views', sid, { ids: [oglasId] });
      assert.notEqual(v.status, 500);
    }
    assert.equal(statusi[500] || 0, 0, JSON.stringify(statusi));
    assert.equal(statusi.p500 || 0, 0, JSON.stringify(statusi));
    assert.equal(statusi[401], 10, JSON.stringify(statusi));
    assert.equal(statusi.p401, 10, JSON.stringify(statusi));
    assert.ok(!lines.some((l) => /"level":50/.test(l) && /foreign key/.test(l)), 'u zapisu nema greške stranog ključa');
  });

  test('feed u klasteru: obrisan oglas nestaje iz „Novo” na svim radnicima (poruka o kešu)', async () => {
    const b = await noviButik(baza, { butik: 'Butik Klaster Dva', email: 'butik.klaster2@test.ba' });
    const shop = new Klijent(url);
    await shop.prijavi(b.email, b.password);
    const l = (await shop.objavi({ title: 'Brzo obrisan', category: 'Nakit' })).body.oglas;
    // Napuni javni keš (5 s) u oba radnika.
    for (let n = 0; n < 8; n += 1) {
      const r = await zahtjev(port, 'GET', '/api/feed?kartica=novo&category=Nakit');
      assert.ok(r.body.oglasi.some((x) => x.id === l.id));
    }
    assert.equal((await shop.del(`/api/listings/${l.id}`)).status, 200);
    await sleep(100);
    for (let n = 0; n < 8; n += 1) {
      const r = await zahtjev(port, 'GET', '/api/feed?kartica=novo&category=Nakit');
      assert.ok(!r.body.oglasi.some((x) => x.id === l.id), `radnik još vraća obrisan oglas (zahtjev ${n})`);
    }
  });
});
