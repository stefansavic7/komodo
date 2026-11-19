// Administracija (ADMIN_EMAILS): prijave, otvaranje butika, spisak naloga, gašenje i vraćanje naloga.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

let o;
let admin;
let kupac;
let butik;
let shop;

before(async () => {
  o = await okolina({ ADMIN_EMAILS: 'admin@test.ba, drugi.admin@test.ba' });
  admin = o.klijent();
  const a = await admin.registruj('Admin@Test.ba', 'Administrator');
  assert.equal(a.admin, true);
  kupac = o.klijent();
  await kupac.registruj('kupac.admin@test.ba', 'Kupac Admin');
  butik = await noviButik(o.baza, { butik: 'Butik Admin', email: 'butik.admin@test.ba' });
  shop = o.klijent();
  await shop.prijavi(butik.email, butik.password);
});
after(async () => { await o?.stop(); });

describe('pristup', () => {
  test('admin rute za kupca, butik i neprijavljenog izgledaju kao da ne postoje (404)', async () => {
    const rute = [
      ['get', '/api/admin/reports'],
      ['get', '/api/admin/users'],
      ['post', '/api/admin/shops', { name: 'Uljez', email: 'uljez@test.ba' }],
      ['post', '/api/admin/reports/1/resolve', { action: 'ukloni' }],
      ['post', '/api/admin/users/1/suspend', {}],
    ];
    for (const k of [kupac, shop, o.klijent()]) {
      for (const [m, url, body] of rute) {
        const r = await k[m](url, body);
        assert.equal(r.status, 404, `${m} ${url}`);
      }
    }
    const nijeOtvoren = await o.baza.q("select 1 from users where email = 'uljez@test.ba'");
    assert.equal(nijeOtvoren.rowCount, 0);
  });

  test('drugi email iz ADMIN_EMAILS (s razmakom u listi) je takođe admin', async () => {
    const k = o.klijent();
    const u = await k.registruj('drugi.admin@test.ba', 'Drugi Admin');
    assert.equal(u.admin, true);
    assert.equal((await k.get('/api/admin/users')).status, 200);
  });
});

describe('prijave', () => {
  let oglas;
  let drugiOglas;
  let razgovor;

  before(async () => {
    oglas = (await shop.objavi({ title: 'Sporni oglas' })).body.oglas;
    drugiOglas = (await shop.objavi({ title: 'Nevin oglas' })).body.oglas;
    await kupac.post('/api/reports', { listingId: oglas.id, reason: 'Prevara ili lažan oglas' });
    const k2 = o.klijent();
    await k2.registruj('drugi.prijavio@test.ba', 'Drugi Prijavio');
    await k2.post('/api/reports', { listingId: oglas.id });
    await kupac.post('/api/reports', { listingId: drugiOglas.id });
    razgovor = (await kupac.post('/api/conversations', { shop: butik.handle })).body.razgovor;
    await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Pitanje' });
    await shop.post(`/api/conversations/${razgovor}/messages`, { body: 'Ružna poruka' });
    await kupac.post('/api/reports', { conversationId: razgovor, reason: 'Uvredljiva poruka' });
  });

  test('spisak otvorenih prijava s oglasom i porukom', async () => {
    const r = await admin.get('/api/admin/reports');
    assert.equal(r.status, 200);
    assert.equal(r.body.prijave.length, 4);
    const zaOglas = r.body.prijave.find((p) => p.listing && p.listing.id === oglas.id && p.reason === 'Prevara ili lažan oglas');
    assert.equal(zaOglas.reporter, 'Kupac Admin');
    assert.equal(zaOglas.listing.title, 'Sporni oglas');
    assert.equal(zaOglas.listing.shopName, 'Butik Admin');
    assert.match(zaOglas.listing.videoUrl, /^\/media\//);
    const zaPoruku = r.body.prijave.find((p) => p.message);
    assert.equal(zaPoruku.message.body, 'Ružna poruka');
    assert.equal(zaPoruku.message.senderName, 'Butik Admin');
  });

  test('odbaci: prijava nestaje, oglas ostaje', async () => {
    const p = (await admin.get('/api/admin/reports')).body.prijave.find((x) => x.listing && x.listing.id === drugiOglas.id);
    assert.equal((await admin.post(`/api/admin/reports/${p.id}/resolve`, { action: 'odbaci' })).status, 200);
    assert.equal((await kupac.get(`/api/listings/${drugiOglas.id}`)).status, 200);
    const ostalo = (await admin.get('/api/admin/reports')).body.prijave;
    assert.equal(ostalo.some((x) => x.id === p.id), false);
    assert.equal((await admin.post(`/api/admin/reports/${p.id}/resolve`, { action: 'odbaci' })).status, 404, 'već riješena');
  });

  test('ukloni oglas: oglas i snimak nestaju, rješavaju se sve prijave za taj oglas', async () => {
    const p = (await admin.get('/api/admin/reports')).body.prijave.find((x) => x.listing && x.listing.id === oglas.id);
    assert.equal((await admin.post(`/api/admin/reports/${p.id}/resolve`, { action: 'ukloni' })).status, 200);
    assert.equal((await kupac.get(`/api/listings/${oglas.id}`)).status, 404);
    assert.equal((await fetch(o.url + oglas.videoUrl)).status, 404);
    const ostalo = (await admin.get('/api/admin/reports')).body.prijave;
    assert.equal(ostalo.some((x) => x.listing && x.listing.id === oglas.id), false);
  });

  test('ukloni poruku: tekst se zamjenjuje', async () => {
    const p = (await admin.get('/api/admin/reports')).body.prijave.find((x) => x.message);
    assert.equal((await admin.post(`/api/admin/reports/${p.id}/resolve`, { action: 'ukloni' })).status, 200);
    const m = await kupac.get(`/api/conversations/${razgovor}/messages`);
    assert.deepEqual(m.body.poruke.map((x) => x.body), ['Pitanje', '(poruka je uklonjena)']);
    assert.equal((await admin.get('/api/admin/reports')).body.prijave.length, 0);
  });

  test('nepostojeća prijava 404', async () => {
    assert.equal((await admin.post('/api/admin/reports/999999/resolve', { action: 'odbaci' })).status, 404);
    assert.equal((await admin.post('/api/admin/reports/abc/resolve', { action: 'odbaci' })).status, 404);
  });
});

describe('otvaranje butika', () => {
  test('admin otvara butik; vlasnik se prijavljuje privremenom lozinkom', async () => {
    const r = await admin.post('/api/admin/shops', { name: 'Novi Butik Iz Admina', email: 'Novi.Butik@test.ba', phone: '066 222 333' });
    assert.equal(r.status, 201);
    assert.equal(r.body.butik.email, 'novi.butik@test.ba');
    assert.ok(r.body.butik.password.length >= 8);
    const k = o.klijent();
    const u = await k.prijavi('novi.butik@test.ba', r.body.butik.password);
    assert.equal(u.role, 'butik');
    assert.equal(u.handle, r.body.butik.handle);
    assert.equal((await k.objavi()).status, 201);
    const javno = await o.klijent().get(`/api/shops/${r.body.butik.handle}`);
    assert.equal(javno.body.butik.phone, '066 222 333');
  });

  test('postojeći email i neispravni podaci: 400, ništa se ne mijenja', async () => {
    const r = await admin.post('/api/admin/shops', { name: 'Preotimanje', email: 'kupac.admin@test.ba' });
    assert.equal(r.status, 400);
    assert.match(r.body.greska, /već postoji/);
    assert.equal((await kupac.get('/api/me')).body.korisnik.role, 'kupac');
    assert.equal((await admin.post('/api/admin/shops', { name: 'A', email: 'a@test.ba' })).status, 400);
    assert.equal((await admin.post('/api/admin/shops', { name: 'Bez Emaila', email: 'nije-email' })).status, 400);
  });

  test('skripta novi-butik.js odbija postojeći email', async () => {
    await assert.rejects(noviButik(o.baza, { butik: 'Dupli', email: 'butik.admin@test.ba' }), /već postoji/);
  });
});

describe('spisak i gašenje naloga', () => {
  test('spisak naloga: butici prvi, s brojem oglasa', async () => {
    const r = await admin.get('/api/admin/users');
    assert.equal(r.status, 200);
    const uloge = r.body.nalozi.map((u) => u.role);
    assert.ok(uloge.indexOf('kupac') > uloge.lastIndexOf('butik'));
    const b = r.body.nalozi.find((u) => u.email === butik.email);
    assert.equal(b.suspended, false);
    assert.equal(typeof b.listings, 'number');
  });

  test('gašenje butika: sesija, profil i oglasi nestaju, prijava 403; vraćanje sve vraća', async () => {
    const zrtva = await noviButik(o.baza, { butik: 'Butik Za Gasenje', email: 'gasenje@test.ba' });
    const s = o.klijent();
    await s.prijavi(zrtva.email, zrtva.password);
    const l = (await s.objavi({ title: 'Oglas ugašenog' })).body.oglas;
    const id = (await s.get('/api/me')).body.korisnik.id;

    const r = await admin.post(`/api/admin/users/${id}/suspend`, {});
    assert.deepEqual(r.body, { ok: true, suspended: true });
    assert.equal((await s.get('/api/me')).body.korisnik, null);
    assert.equal((await s.objavi()).status, 401);
    const login = await o.klijent().post('/api/auth/login', { email: zrtva.email, password: zrtva.password });
    assert.equal(login.status, 403);
    assert.equal((await kupac.get(`/api/listings/${l.id}`)).status, 404);
    assert.equal((await kupac.get(`/api/shops/${zrtva.handle}`)).status, 404);
    assert.equal((await kupac.post('/api/conversations', { shop: zrtva.handle })).status, 404);
    assert.equal((await admin.get('/api/admin/users')).body.nalozi.find((u) => u.id === id).suspended, true);

    const back = await admin.post(`/api/admin/users/${id}/suspend`, { suspended: false });
    assert.deepEqual(back.body, { ok: true, suspended: false });
    await o.klijent().prijavi(zrtva.email, zrtva.password);
    assert.equal((await kupac.get(`/api/listings/${l.id}`)).status, 200);
  });

  test('admin ne gasi sebe (400); nepostojeći nalog 404', async () => {
    const meId = (await admin.get('/api/me')).body.korisnik.id;
    assert.equal((await admin.post(`/api/admin/users/${meId}/suspend`, {})).status, 400);
    assert.equal((await admin.post('/api/admin/users/999999/suspend', {})).status, 404);
  });
});
