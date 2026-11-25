// Redizajn (docs/DIZAJN.md, 4.5): adresa i radno vrijeme butika su na svakom oglasu (kartica feeda), bez novih upita,
// i izmjena u PATCH /api/me odmah poništava keš feeda.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

describe('shopAddress i shopHours na oglasima', () => {
  let o;
  let shop;
  let gost;
  let bez;
  let oglas;
  let oglasBez;
  const SATI = { rd: ['09:00', '20:00'], sub: ['09:00', '15:00'], ned: null };
  before(async () => {
    o = await okolina();
    const b = await noviButik(o.baza, { butik: 'Kartica Butik', email: 'kartica@test.ba' });
    const c = await noviButik(o.baza, { butik: 'Bez Podataka', email: 'bez@test.ba' });
    shop = o.klijent(); await shop.prijavi(b.email, b.password);
    bez = o.klijent(); await bez.prijavi(c.email, c.password);
    gost = o.klijent();
    oglas = (await shop.objavi({ title: 'Kartica haljina', price: '70', category: 'Haljine' })).body.oglas;
    oglasBez = (await bez.objavi({ title: 'Bez podataka haljina', price: '40', category: 'Haljine' })).body.oglas;
    const r = await shop.patch('/api/me', { address: 'Gospodska 14', hours: SATI });
    assert.equal(r.status, 200);
  });
  after(async () => { await o?.stop(); });

  test('jedan oglas, lista i feed (Novo) nose shopAddress i shopHours', async () => {
    const jedan = (await gost.get(`/api/listings/${oglas.id}`)).body.oglas;
    assert.equal(jedan.shopAddress, 'Gospodska 14');
    assert.deepEqual(jedan.shopHours, SATI);
    const lista = (await gost.get('/api/listings')).body.oglasi.find((i) => i.id === oglas.id);
    assert.equal(lista.shopAddress, 'Gospodska 14');
    assert.deepEqual(lista.shopHours, SATI);
    const feed = (await gost.get('/api/feed?kartica=novo')).body.oglasi.find((i) => i.id === oglas.id);
    assert.equal(feed.shopAddress, 'Gospodska 14');
    assert.deepEqual(feed.shopHours, SATI);
  });

  test('butik bez adrese i sati: prazan niz znakova i null', async () => {
    const i = (await gost.get(`/api/listings/${oglasBez.id}`)).body.oglas;
    assert.equal(i.shopAddress, '');
    assert.equal(i.shopHours, null);
  });

  test('„Za tebe” (kandidati) nosi ista polja', async () => {
    const k = o.klijent(); await k.registruj('kartica.kupac@test.ba', 'Kartica Kupac');
    const z = (await k.get('/api/feed?kartica=zatebe')).body;
    const sve = (z.oglasi || []).filter((i) => i.id === oglas.id);
    for (const i of sve) {
      assert.equal(i.shopAddress, 'Gospodska 14');
      assert.deepEqual(i.shopHours, SATI);
    }
  });

  test('izmjena adrese i sati odmah mijenja i keširan javni feed', async () => {
    const prije = (await gost.get('/api/feed?kartica=novo')).body.oglasi.find((i) => i.id === oglas.id);
    assert.equal(prije.shopAddress, 'Gospodska 14');   // feed je sad u kešu (5 s)
    const nove = { rd: ['08:00', '16:00'], sub: null, ned: null };
    assert.equal((await shop.patch('/api/me', { address: 'Kralja Petra I 12', hours: nove })).status, 200);
    const poslije = (await gost.get('/api/feed?kartica=novo')).body.oglasi.find((i) => i.id === oglas.id);
    assert.equal(poslije.shopAddress, 'Kralja Petra I 12');
    assert.deepEqual(poslije.shopHours, nove);
  });

  test('izmjena naziva butika se također odmah vidi u feedu', async () => {
    await gost.get('/api/feed?kartica=novo');
    assert.equal((await shop.patch('/api/me', { name: 'Kartica Butik 2' })).status, 200);
    const i = (await gost.get('/api/feed?kartica=novo')).body.oglasi.find((x) => x.id === oglas.id);
    assert.equal(i.shopName, 'Kartica Butik 2');
  });
});
