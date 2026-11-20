// P5, F-06: GET /api/me/stats (tačni brojevi u kontrolisanim podacima), listing_contacts pri slanju poruke, keš.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

let o, shop, drugi, kupci, a, b, tudjiOglas;
const stat = (k, p) => k.get(`/api/me/stats${p ? `?period=${p}` : ''}`);

before(async () => {
  o = await okolina({ STATS_CACHE_MS: '0' });
  const bu = await noviButik(o.baza, { butik: 'Butik Stat', email: 'butik.stat@test.ba' });
  const bu2 = await noviButik(o.baza, { butik: 'Drugi Stat', email: 'drugi.stat@test.ba' });
  shop = o.klijent(); await shop.prijavi(bu.email, bu.password);
  drugi = o.klijent(); await drugi.prijavi(bu2.email, bu2.password);
  a = (await shop.objavi({ title: 'Stat A', price: '10' })).body.oglas;
  b = (await shop.objavi({ title: 'Stat B', price: '20' })).body.oglas;
  tudjiOglas = (await drugi.objavi({ title: 'Tuđi stat' })).body.oglas;
  kupci = [];
  for (let i = 0; i < 4; i += 1) {
    const k = o.klijent();
    await k.registruj(`kupac.stat${i}@test.ba`, `Kupac Stat ${i}`);
    kupci.push(k);
  }
  const ids = (await o.baza.q("select id from users where email like 'kupac.stat%' order by email")).rows.map((r) => r.id);
  const q = (t, p) => o.baza.q(t, p);
  // Pregledi oglasa A: danas 2 gledaoca, prije 3 dana 1, prije 8 dana 1 (samo period 30). Oglas B: danas 1.
  await q(`insert into listing_views(listing_id, viewer, day) values
    ($1,'u${ids[0]}',current_date),($1,'u${ids[1]}',current_date),($1,'u${ids[0]}',current_date-3),($1,'u${ids[2]}',current_date-8),
    ($2,'u${ids[0]}',current_date),($3,'u${ids[0]}',current_date)`, [a.id, b.id, tudjiOglas.id]);
  // Sviđanja: A 2 (jedno staro 10 dana), B 1; tuđi 1.
  await q(`insert into likes(user_id, listing_id, created_at) values
    ($1,$3,now()),($2,$3,now()-interval '10 days'),($1,$4,now()),($1,$5,now())`, [ids[0], ids[1], a.id, b.id, tudjiOglas.id]);
  // Pratioci: jedan prije 2 dana, jedan prije 20 dana.
  const shopId = (await q('select id from users where email = $1', [bu.email])).rows[0].id;
  await q(`insert into follows(user_id, shop_id, created_at) values ($1,$3,now()-interval '2 days'),($2,$3,now()-interval '20 days')`, [ids[0], ids[1], shopId]);
  await q('update users set followers_count = 2 where id = $1', [shopId]);
});
after(async () => { await o?.stop(); });

describe('GET /api/me/stats', () => {
  test('401, kupac 403, loš period 400, zadano 7', async () => {
    assert.equal((await o.klijent().get('/api/me/stats')).status, 401);
    const k = await stat(kupci[0]);
    assert.equal(k.status, 403);
    assert.equal(k.body.greska, 'Statistika je dostupna samo butiku.');
    const p = await stat(shop, 14);
    assert.equal(p.status, 400);
    assert.equal(p.body.greska, 'Period može biti 7 ili 30 dana.');
    assert.equal((await stat(shop)).body.statistika.period, 7);
  });

  test('period 7: tačni brojevi, zbir po oglasima = ukupno, 7 dana, samo svoji oglasi', async () => {
    const s = (await stat(shop, 7)).body.statistika;
    assert.deepEqual(s.ukupno, { views: 4, likes: 2, contacts: 0, newFollowers: 1, followers: 2 });
    assert.equal(s.dani.length, 7);
    assert.equal(s.dani[6].views, 3);
    assert.equal(s.dani[3].views, 1);
    assert.equal(s.dani.reduce((x, d) => x + d.views, 0), s.ukupno.views);
    assert.deepEqual(s.oglasi.map((l) => [l.id, l.views, l.likes, l.contacts]), [[a.id, 3, 1, 0], [b.id, 1, 1, 0]]);
    assert.equal(s.oglasi.reduce((x, l) => x + l.views, 0), s.ukupno.views);
    assert.ok(!s.oglasi.some((l) => l.id === tudjiOglas.id));
    assert.equal(s.oglasi[0].price, 10);
    assert.match(s.od, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('period 30 uključuje starije; dani ima 30 stavki', async () => {
    const s = (await stat(shop, 30)).body.statistika;
    assert.deepEqual(s.ukupno, { views: 5, likes: 3, contacts: 0, newFollowers: 2, followers: 2 });
    assert.equal(s.dani.length, 30);
    assert.equal(s.oglasi[0].views, 4);
    assert.equal(s.oglasi[0].viewsAll, 0, 'viewsAll je listings.views (ovdje ručno upisani pregledi ga ne dižu)');
  });

  test('drugi butik vidi samo svoje', async () => {
    const s = (await stat(drugi, 7)).body.statistika;
    assert.deepEqual(s.oglasi.map((l) => l.id), [tudjiOglas.id]);
    assert.equal(s.ukupno.views, 1);
    assert.equal(s.ukupno.newFollowers, 0);
  });

  test('listing_contacts: otvaranje bez poruke 0, prva poruka 1, još 5 poruka i dalje 1; butik odgovara — ne broji se', async () => {
    const shopHandle = (await shop.get('/api/me')).body.korisnik.handle;
    const r = await kupci[3].post('/api/conversations', { shop: shopHandle, listingId: a.id });
    assert.equal((await stat(shop, 7)).body.statistika.ukupno.contacts, 0);
    for (let i = 0; i < 6; i += 1) {
      assert.equal((await kupci[3].post(`/api/conversations/${r.body.razgovor}/messages`, { body: `Poruka ${i}` })).status, 201);
      if (i === 0) assert.equal((await stat(shop, 7)).body.statistika.ukupno.contacts, 1);
    }
    await shop.post(`/api/conversations/${r.body.razgovor}/messages`, { body: 'Odgovor' });
    const s = (await stat(shop, 7)).body.statistika;
    assert.equal(s.ukupno.contacts, 1);
    assert.equal(s.oglasi.find((l) => l.id === a.id).contacts, 1);
    const n = (await o.baza.q('select count(*)::int as n from listing_contacts where listing_id = $1', [a.id])).rows[0].n;
    assert.equal(n, 1);
  });

  test('razgovor bez oglasa ne daje kontakt; drugi kupac isti oglas — 2', async () => {
    const shopHandle = (await shop.get('/api/me')).body.korisnik.handle;
    const r = await kupci[2].post('/api/conversations', { shop: shopHandle });
    await kupci[2].post(`/api/conversations/${r.body.razgovor}/messages`, { body: 'Bez oglasa' });
    assert.equal((await stat(shop, 7)).body.statistika.ukupno.contacts, 1);
    const r2 = await kupci[1].post('/api/conversations', { shop: shopHandle, listingId: a.id });
    await kupci[1].post(`/api/conversations/${r2.body.razgovor}/messages`, { body: 'Zanima me' });
    assert.equal((await stat(shop, 7)).body.statistika.ukupno.contacts, 2);
  });

  test('obrisan oglas nestaje iz statistike', async () => {
    assert.equal((await shop.del(`/api/listings/${b.id}`)).status, 200);
    const s = (await stat(shop, 7)).body.statistika;
    assert.deepEqual(s.oglasi.map((l) => l.id), [a.id]);
    assert.equal(s.ukupno.views, 3);
  });
});

describe('keš statistike (zadano 5 min)', () => {
  let k, shop2, listing;
  before(async () => {
    k = await okolina();
    const bu = await noviButik(k.baza, { butik: 'Keš Butik', email: 'kes.butik@test.ba' });
    shop2 = k.klijent(); await shop2.prijavi(bu.email, bu.password);
    listing = (await shop2.objavi({ title: 'Keš oglas' })).body.oglas;
  });
  after(async () => { await k?.stop(); });

  test('drugi poziv vraća keširano; brz', async () => {
    const prvi = (await shop2.get('/api/me/stats?period=7')).body.statistika;
    assert.equal(prvi.ukupno.views, 0);
    await k.baza.q("insert into listing_views(listing_id, viewer) values ($1,'dkes')", [listing.id]);
    const drugi = (await shop2.get('/api/me/stats?period=7')).body.statistika;
    assert.equal(drugi.ukupno.views, 0, 'keš (nije pročitano iz baze)');
    assert.equal((await shop2.get('/api/me/stats?period=30')).body.statistika.ukupno.views, 1, 'drugi ključ (period 30) čita bazu');
  });
});
