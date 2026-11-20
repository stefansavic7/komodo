// P5: R-04 (oglas u obradi ili obrisan se ne vidi kupcu u razgovoru, spisku i prijavi), sizes u odgovoru poruka
// (F-08), spisak razgovora s naslovom (U-08) i blokiranje (U-09).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

async function lazniBunny() {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') { n += 1; return res.end(JSON.stringify({ guid: `guid-${n}` })); }
      if (req.method === 'GET') return res.end(JSON.stringify({ status: 2 }));
      return res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('R-04: oglas u obradi (Bunny uključen)', () => {
  let o, bunny, shop, kupac, butik, l;
  before(async () => {
    bunny = await lazniBunny();
    o = await okolina({ BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k', BUNNY_CDN_HOST: 'cdn.test', BUNNY_API_BASE: bunny.url });
    butik = await noviButik(o.baza, { butik: 'Butik R04', email: 'butik.r04@test.ba' });
    shop = o.klijent(); await shop.prijavi(butik.email, butik.password);
    kupac = o.klijent(); await kupac.registruj('kupac.r04@test.ba', 'Kupac R04');
    l = (await shop.objavi({ title: 'Tajni oglas u obradi', price: '77', sizes: 'M' })).body.oglas;
  });
  after(async () => { await o?.stop(); await bunny?.close(); });

  test('kupac ne veže oglas u obradi za razgovor, pa ga ne vidi ni u razgovoru ni u spisku', async () => {
    const r = await kupac.post('/api/conversations', { shop: butik.handle, listingId: l.id });
    assert.equal(r.status, 200);
    await kupac.post(`/api/conversations/${r.body.razgovor}/messages`, { body: 'Zdravo' });
    const m = await kupac.get(`/api/conversations/${r.body.razgovor}/messages`);
    assert.equal(m.body.oglas, null);
    const sp = await kupac.get('/api/conversations');
    assert.equal(sp.body.razgovori[0].listingTitle, null);
    assert.ok(!JSON.stringify(sp.body).includes('Tajni'));
    assert.equal((await o.baza.q('select listing_id from conversations')).rows[0].listing_id, null);
    assert.equal((await o.baza.q('select count(*)::int as n from listing_contacts')).rows[0].n, 0);
  });

  test('razgovor otvoren ranije: dok je oglas u obradi kupac ga ne vidi, vlasnik vidi', async () => {
    const id = (await o.baza.q('select id from conversations')).rows[0].id;
    await o.baza.q('update conversations set listing_id = $1 where id = $2', [l.id, id]);
    assert.equal((await kupac.get(`/api/conversations/${id}/messages`)).body.oglas, null);
    assert.equal((await kupac.get('/api/conversations')).body.razgovori[0].listingTitle, null);
    const v = await shop.get(`/api/conversations/${id}/messages`);
    assert.equal(v.body.oglas.title, 'Tajni oglas u obradi');
    assert.deepEqual(v.body.oglas.sizes, ['M']);
    assert.equal((await shop.get('/api/conversations')).body.razgovori[0].listingTitle, 'Tajni oglas u obradi');
    // Kad je obrada gotova, kupac ga vidi.
    await o.baza.q("update listings set video_status = 'ready' where id = $1", [l.id]);
    const k = await kupac.get(`/api/conversations/${id}/messages`);
    assert.equal(k.body.oglas.title, 'Tajni oglas u obradi');
    assert.equal((await kupac.get('/api/conversations')).body.razgovori[0].listingTitle, 'Tajni oglas u obradi');
    await o.baza.q("update listings set video_status = 'processing' where id = $1", [l.id]);
  });

  test('prijava oglasa u obradi: 404 kao za nepostojeći', async () => {
    const r = await kupac.post('/api/reports', { listingId: l.id, reason: 'Ostalo' });
    assert.equal(r.status, 404);
    assert.equal((await kupac.post('/api/reports', { listingId: 999999, reason: 'Ostalo' })).status, 404);
    await o.baza.q("update listings set video_status = 'ready' where id = $1", [l.id]);
    assert.equal((await kupac.post('/api/reports', { listingId: l.id, reason: 'Ostalo' })).status, 201);
  });
});

describe('obrisan oglas, sizes, naslov u spisku, blokiranje (razvoj)', () => {
  let o, shop, kupac, kupac2, butik, oglas, razgovor;
  before(async () => {
    o = await okolina();
    butik = await noviButik(o.baza, { butik: 'Butik Blok', email: 'butik.blok@test.ba' });
    shop = o.klijent(); await shop.prijavi(butik.email, butik.password);
    kupac = o.klijent(); await kupac.registruj('kupac.blok@test.ba', 'Kupac Blok');
    kupac2 = o.klijent(); await kupac2.registruj('kupac.blok2@test.ba', 'Kupac Dva');
    oglas = (await shop.objavi({ title: 'Haljina s veličinama', sizes: 'S,M' })).body.oglas;
  });
  after(async () => { await o?.stop(); });

  test('sizes u odgovoru poruka; naslov u spisku (kupac i butik)', async () => {
    razgovor = (await kupac.post('/api/conversations', { shop: butik.handle, listingId: oglas.id })).body.razgovor;
    await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Imate li S?' });
    const m = await kupac.get(`/api/conversations/${razgovor}/messages`);
    assert.deepEqual(m.body.oglas, { id: oglas.id, title: 'Haljina s veličinama', price: 65, sizes: ['S', 'M'] });
    assert.equal((await kupac.get('/api/conversations')).body.razgovori[0].listingTitle, 'Haljina s veličinama');
    assert.equal((await shop.get('/api/conversations')).body.razgovori[0].listingTitle, 'Haljina s veličinama');
  });

  test('obrisan oglas: nestaje iz razgovora i spiska, razgovor ostaje', async () => {
    const drugi = (await shop.objavi({ title: 'Za brisanje' })).body.oglas;
    const r = (await kupac2.post('/api/conversations', { shop: butik.handle, listingId: drugi.id })).body.razgovor;
    await kupac2.post(`/api/conversations/${r}/messages`, { body: 'Hej' });
    assert.equal((await kupac2.get('/api/conversations')).body.razgovori[0].listingTitle, 'Za brisanje');
    await shop.del(`/api/listings/${drugi.id}`);
    assert.equal((await kupac2.get(`/api/conversations/${r}/messages`)).body.oglas, null);
    const sp = (await kupac2.get('/api/conversations')).body.razgovori;
    assert.equal(sp.length, 1);
    assert.equal(sp[0].listingTitle, null);
    assert.equal((await shop.get('/api/conversations')).body.razgovori.find((x) => x.id === r).listingTitle, null);
    assert.equal((await kupac2.post('/api/reports', { listingId: drugi.id, reason: 'Ostalo' })).status, 404);
  });

  test('blokiranje: oba smjera ne mogu pisati; odblokiranje vraća; blokirao/blokirano', async () => {
    let r = await kupac.post(`/api/conversations/${razgovor}/block`, {});
    assert.deepEqual(r.body, { blokirao: true, blokirano: true });
    const druga = await shop.get(`/api/conversations/${razgovor}/messages`);
    assert.equal(druga.body.blokirao, false);
    assert.equal(druga.body.blokirano, true);
    assert.equal((await shop.post(`/api/conversations/${razgovor}/messages`, { body: 'Hej' })).status, 403);
    assert.equal((await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Hej' })).status, 403);
    // Butik ne može odblokirati ono što je kupac blokirao.
    r = await shop.post(`/api/conversations/${razgovor}/block`, { blocked: false });
    assert.equal(r.body.blokirano, true);
    r = await kupac.post(`/api/conversations/${razgovor}/block`, { blocked: false });
    assert.deepEqual(r.body, { blokirao: false, blokirano: false });
    assert.equal((await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Opet tu' })).status, 201);
  });

  test('tuđi razgovor se ne može blokirati (404)', async () => {
    assert.equal((await kupac2.post(`/api/conversations/${razgovor}/block`, {})).status, 404);
  });
});
