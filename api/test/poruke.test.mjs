// Poruke (razgovori, nepročitane, blokiranje) i prijave sadržaja.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

let o;
let butik;
let drugiButik;
let shop;
let shop2;
let kupac;
let tudji;
let oglas;
let oglasDrugog;

before(async () => {
  o = await okolina();
  butik = await noviButik(o.baza, { butik: 'Butik Poruke', email: 'butik.poruke@test.ba' });
  drugiButik = await noviButik(o.baza, { butik: 'Drugi Butik', email: 'drugi.butik@test.ba' });
  shop = o.klijent();
  await shop.prijavi(butik.email, butik.password);
  shop2 = o.klijent();
  await shop2.prijavi(drugiButik.email, drugiButik.password);
  kupac = o.klijent();
  await kupac.registruj('kupac.poruke@test.ba', 'Kupac Poruke');
  tudji = o.klijent();
  await tudji.registruj('tudji@test.ba', 'Tuđi Kupac');
  oglas = (await shop.objavi({ title: 'Haljina za poruke', price: '45' })).body.oglas;
  oglasDrugog = (await shop2.objavi({ title: 'Oglas drugog butika' })).body.oglas;
});
after(async () => { await o?.stop(); });

describe('razgovor', () => {
  let razgovor;

  test('kupac otvara razgovor s butikom; ponovno otvaranje vraća isti', async () => {
    const r = await kupac.post('/api/conversations', { shop: butik.handle, listingId: oglas.id });
    assert.equal(r.status, 200);
    razgovor = r.body.razgovor;
    const again = await kupac.post('/api/conversations', { shop: butik.handle.toUpperCase() });
    assert.equal(again.body.razgovor, razgovor);
    // Oglas drugog butika se ne veže za ovaj razgovor.
    await kupac.post('/api/conversations', { shop: butik.handle, listingId: oglasDrugog.id });
    const m = await kupac.get(`/api/conversations/${razgovor}/messages`);
    assert.deepEqual(m.body.oglas, { id: oglas.id, title: 'Haljina za poruke', price: 45 });
    assert.equal(m.body.sagovornik.handle, butik.handle);
    assert.equal(m.body.sagovornik.butik, true);
  });

  test('butik ne započinje razgovor (403); nepostojeći butik 404; kupac kao „butik” 404', async () => {
    assert.equal((await shop.post('/api/conversations', { shop: drugiButik.handle })).status, 403);
    assert.equal((await kupac.post('/api/conversations', { shop: 'nema.ga' })).status, 404);
    const kupacHandle = (await tudji.get('/api/me')).body.korisnik.handle;
    assert.equal((await kupac.post('/api/conversations', { shop: kupacHandle })).status, 404);
  });

  test('prazan razgovor se ne vidi u spisku', async () => {
    assert.equal((await kupac.get('/api/conversations')).body.razgovori.length, 0);
    assert.equal((await shop.get('/api/conversations')).body.razgovori.length, 0);
  });

  test('poruka kupca: butik vidi nepročitanu, čitanjem nestaje', async () => {
    const r = await kupac.post(`/api/conversations/${razgovor}/messages`, { body: '  Ima li M?  ' });
    assert.equal(r.status, 201);
    assert.equal(r.body.poruka.body, 'Ima li M?');
    assert.equal(r.body.poruka.mine, true);
    assert.equal((await shop.get('/api/me')).body.neprocitano, 1);
    assert.equal((await kupac.get('/api/me')).body.neprocitano, 0);
    const spisak = await shop.get('/api/conversations');
    assert.equal(spisak.body.razgovori.length, 1);
    assert.deepEqual(
      { id: spisak.body.razgovori[0].id, name: spisak.body.razgovori[0].name, last: spisak.body.razgovori[0].last, unread: spisak.body.razgovori[0].unread, listingTitle: spisak.body.razgovori[0].listingTitle },
      { id: razgovor, name: 'Kupac Poruke', last: 'Ima li M?', unread: true, listingTitle: 'Haljina za poruke' },
    );
    const m = await shop.get(`/api/conversations/${razgovor}/messages`);
    assert.equal(m.body.poruke.length, 1);
    assert.equal(m.body.poruke[0].mine, false);
    assert.equal(m.body.sagovornik.butik, false);
    assert.equal((await shop.get('/api/me')).body.neprocitano, 0);
    assert.equal((await shop.get('/api/conversations')).body.razgovori[0].unread, false);
  });

  test('odgovor butika; after= vraća samo novije poruke', async () => {
    const prva = (await kupac.get(`/api/conversations/${razgovor}/messages`)).body.poruke[0].id;
    assert.equal((await shop.post(`/api/conversations/${razgovor}/messages`, { body: 'Ima, izvolite.' })).status, 201);
    assert.equal((await kupac.get('/api/me')).body.neprocitano, 1);
    const novo = await kupac.get(`/api/conversations/${razgovor}/messages?after=${prva}`);
    assert.deepEqual(novo.body.poruke.map((p) => [p.body, p.mine]), [['Ima, izvolite.', false]]);
    assert.equal((await kupac.get('/api/me')).body.neprocitano, 0);
  });

  test('prazna poruka 400, predugačka se skraćuje na 1000 znakova', async () => {
    assert.equal((await kupac.post(`/api/conversations/${razgovor}/messages`, { body: '   ' })).status, 400);
    const r = await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'a'.repeat(1500) });
    assert.equal(r.status, 201);
    assert.equal(r.body.poruka.body.length, 1000);
  });

  test('tuđi razgovor: čitanje, slanje, blokiranje i prijava daju 404', async () => {
    assert.equal((await tudji.get(`/api/conversations/${razgovor}/messages`)).status, 404);
    assert.equal((await tudji.post(`/api/conversations/${razgovor}/messages`, { body: 'Upad' })).status, 404);
    assert.equal((await tudji.post(`/api/conversations/${razgovor}/block`, {})).status, 404);
    assert.equal((await tudji.post('/api/reports', { conversationId: razgovor })).status, 404);
    assert.equal((await shop2.get(`/api/conversations/${razgovor}/messages`)).status, 404);
    const r = await o.baza.q('select count(*)::int as n from messages where conversation_id = $1 and body = $2', [razgovor, 'Upad']);
    assert.equal(r.rows[0].n, 0);
  });

  test('blokiranje: niko ne piše dok traje; odblokirati može samo onaj ko je blokirao', async () => {
    const b = await kupac.post(`/api/conversations/${razgovor}/block`, {});
    assert.deepEqual(b.body, { blokirao: true, blokirano: true });
    assert.equal((await shop.post(`/api/conversations/${razgovor}/messages`, { body: 'Halo?' })).status, 403);
    assert.equal((await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Halo?' })).status, 403);
    const pogled = await shop.get(`/api/conversations/${razgovor}/messages`);
    assert.equal(pogled.body.blokirao, false);
    assert.equal(pogled.body.blokirano, true);
    const pokusaj = await shop.post(`/api/conversations/${razgovor}/block`, { blocked: false });
    assert.deepEqual(pokusaj.body, { blokirao: false, blokirano: true }, 'butik ne skida tuđu blokadu');
    const skini = await kupac.post(`/api/conversations/${razgovor}/block`, { blocked: false });
    assert.deepEqual(skini.body, { blokirao: false, blokirano: false });
    assert.equal((await shop.post(`/api/conversations/${razgovor}/messages`, { body: 'Opet tu.' })).status, 201);
  });

  test('ograničenje: 31. poruka u minuti daje 429', async () => {
    const k = o.klijent();
    await k.registruj('brzi@test.ba', 'Brzi');
    const id = (await k.post('/api/conversations', { shop: butik.handle })).body.razgovor;
    for (let n = 0; n < 30; n += 1) {
      assert.equal((await k.post(`/api/conversations/${id}/messages`, { body: `poruka ${n}` })).status, 201);
    }
    assert.equal((await k.post(`/api/conversations/${id}/messages`, { body: 'previše' })).status, 429);
  });
});

describe('prijave sadržaja', () => {
  test('razlozi s API-ja', async () => {
    const r = await o.klijent().get('/api/report-reasons');
    assert.ok(r.body.razlozi.includes('Neprimjeren sadržaj'));
  });

  test('prijava oglasa: 201 i upis; nepoznat razlog postaje Ostalo', async () => {
    assert.equal((await kupac.post('/api/reports', { listingId: oglas.id, reason: 'Prevara ili lažan oglas' })).status, 201);
    assert.equal((await kupac.post('/api/reports', { listingId: oglas.id, reason: 'izmišljen' })).status, 201);
    const r = await o.baza.q('select reason from reports where listing_id = $1 order by id', [oglas.id]);
    assert.deepEqual(r.rows.map((x) => x.reason), ['Prevara ili lažan oglas', 'Ostalo']);
  });

  test('nepostojeći ili obrisan oglas 404, ništa navedeno 400, bez sesije 401', async () => {
    const obrisan = (await shop.objavi({ title: 'Obrisan za prijavu' })).body.oglas;
    await shop.del(`/api/listings/${obrisan.id}`);
    assert.equal((await kupac.post('/api/reports', { listingId: obrisan.id })).status, 404);
    assert.equal((await kupac.post('/api/reports', { listingId: 999999 })).status, 404);
    assert.equal((await kupac.post('/api/reports', { reason: 'Ostalo' })).status, 400);
    assert.equal((await o.klijent().post('/api/reports', { listingId: oglas.id })).status, 401);
  });

  test('prijava poruke prijavljuje posljednju poruku sagovornika; bez nje 400', async () => {
    const k = o.klijent();
    await k.registruj('prijavljuje@test.ba', 'Prijavljuje');
    const id = (await k.post('/api/conversations', { shop: butik.handle })).body.razgovor;
    await k.post(`/api/conversations/${id}/messages`, { body: 'Pitanje' });
    assert.equal((await k.post('/api/reports', { conversationId: id })).status, 400);
    await shop.post(`/api/conversations/${id}/messages`, { body: 'Uvreda' });
    assert.equal((await k.post('/api/reports', { conversationId: id, reason: 'Uvredljiva poruka' })).status, 201);
    const r = await o.baza.q(
      'select m.body, r.reason from reports r join messages m on m.id = r.message_id where m.conversation_id = $1',
      [id],
    );
    assert.deepEqual(r.rows, [{ body: 'Uvreda', reason: 'Uvredljiva poruka' }]);
  });

  test('ograničenje: 21. prijava u satu daje 429', async () => {
    const k = o.klijent();
    await k.registruj('prijavljivac@test.ba', 'Prijavljivač');
    for (let n = 0; n < 20; n += 1) assert.equal((await k.post('/api/reports', { listingId: oglas.id })).status, 201);
    assert.equal((await k.post('/api/reports', { listingId: oglas.id })).status, 429);
  });
});
