// Backend P1 Šema (docs/SPEC-V1.md, odjeljci 4 i 5): migracija 009, nova polja u oglasu, korisniku i
// profilu butika, te pravilo „oglas u obradi vidi samo vlasnik” kad je Bunny uključen
// (docs/PLAN-PRODUKCIJA.md, odjeljak 4) — s lažnim Bunny serverom.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

// Lažni Bunny Stream: pravi snimak, prima fajl, a status je uvijek „obrada” (2).
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

describe('razvoj (bez Bunnyja)', () => {
  let o;
  let shop;
  let kupac;
  let butik;
  before(async () => {
    o = await okolina();
    butik = await noviButik(o.baza, { butik: 'Butik Sema', email: 'butik.sema@test.ba' });
    shop = o.klijent();
    await shop.prijavi(butik.email, butik.password);
    kupac = o.klijent();
    await kupac.registruj('kupac.sema@test.ba', 'Kupac Sema');
  });
  after(async () => { await o?.stop(); });

  test('migracija 009: tabele, kolone i indeksi postoje', async () => {
    const t = (await o.baza.q(`select table_name from information_schema.tables
      where table_name in ('follows','listing_contacts','daily_stats','known_devices')`)).rows.map((r) => r.table_name).sort();
    assert.deepEqual(t, ['daily_stats', 'follows', 'known_devices', 'listing_contacts']);
    const cols = (await o.baza.q(`select table_name || '.' || column_name as c from information_schema.columns
      where (table_name = 'listings' and column_name in ('sizes','sold_at','old_price_cents','price_dropped_at','base_score'))
         or (table_name = 'users' and column_name in ('address','hours','followers_count','following_count'))
         or (table_name = 'likes' and column_name = 'price_notified_at')`)).rows.length;
    assert.equal(cols, 10);
    // listings_score_idx i listings_cat_score_idx: zamijenjeni tabelom listing_scores (migracija 012, R2-02).
    const idx = (await o.baza.q(`select indexname from pg_indexes where indexname in
      ('listing_scores_score_idx','listings_fresh_idx','listings_sizes_idx','follows_shop_idx',
       'messages_created_brin','listings_created_brin','conversations_created_brin','users_created_brin')`)).rowCount;
    assert.equal(idx, 8);
    const stari = (await o.baza.q(`select indexname from pg_indexes where indexname in
      ('listings_score_idx','listings_cat_score_idx','listings_scored_idx')`)).rowCount;
    assert.equal(stari, 0);
  });

  test('migracija 012: listing_scores (ocjena van listings) i listings.price_set_at', async () => {
    const c = (await o.baza.q(`select table_name || '.' || column_name as c from information_schema.columns
      where (table_name = 'listing_scores' and column_name in ('listing_id','base_score'))
         or (table_name = 'listings' and column_name = 'price_set_at') order by 1`)).rows.map((r) => r.c);
    assert.deepEqual(c, ['listing_scores.base_score', 'listing_scores.listing_id', 'listings.price_set_at']);
    // Objava bez Bunnyja odmah upisuje početnu ocjenu 1; brisanje oglasa briše ocjenu.
    const l = (await shop.objavi({ title: 'Sema ocjena' })).body.oglas;
    const s = async () => (await o.baza.q('select base_score from listing_scores where listing_id = $1', [l.id])).rows;
    assert.deepEqual(await s(), [{ base_score: 1 }]);
    assert.equal((await shop.del(`/api/listings/${l.id}`)).status, 200);
    assert.deepEqual(await s(), []);
  });

  test('oglas: sizes, oldPrice, soldAt; prodato postavlja i briše soldAt', async () => {
    const l = (await shop.objavi({ title: 'Sema haljina', price: '89,90' })).body.oglas;
    assert.deepEqual(l.sizes, []);
    assert.equal(l.oldPrice, null);
    assert.equal(l.soldAt, null);
    const sold = (await shop.patch(`/api/listings/${l.id}`, { title: l.title, price: '89,90', category: 'Haljine', sold: true })).body.oglas;
    assert.equal(sold.sold, true);
    assert.ok(sold.soldAt && !Number.isNaN(Date.parse(sold.soldAt)));
    const again = (await shop.patch(`/api/listings/${l.id}`, { title: l.title, price: '89,90', category: 'Haljine', sold: true })).body.oglas;
    assert.equal(again.soldAt, sold.soldAt, 'ponovno „prodato” ne mijenja vrijeme');
    const back = (await shop.patch(`/api/listings/${l.id}`, { title: l.title, price: '89,90', category: 'Haljine', sold: false })).body.oglas;
    assert.equal(back.soldAt, null);

    await o.baza.q(`update listings set sizes = '{S,M}', price_cents = 6990, old_price_cents = 8990,
                    price_dropped_at = now() - interval '1 day' where id = $1`, [l.id]);
    const d = (await kupac.get(`/api/listings/${l.id}`)).body.oglas;
    assert.deepEqual(d.sizes, ['S', 'M']);
    assert.equal(d.price, 69.9);
    assert.equal(d.oldPrice, 89.9);
    await o.baza.q("update listings set price_dropped_at = now() - interval '8 days' where id = $1", [l.id]);
    assert.equal((await kupac.get(`/api/listings/${l.id}`)).body.oglas.oldPrice, null, 'sniženje starije od 7 dana');
    await o.baza.q("update listings set price_dropped_at = now(), price_cents = 9900 where id = $1", [l.id]);
    assert.equal((await kupac.get(`/api/listings/${l.id}`)).body.oglas.oldPrice, null, 'cijena iznad stare');
  });

  test('/api/me: address, hours, followingCount', async () => {
    const k = (await kupac.get('/api/me')).body.korisnik;
    assert.equal(k.address, '');
    assert.equal(k.hours, null);
    assert.equal(k.followingCount, 0);
  });

  test('/api/shops/:handle: nova polja; following za prijavljenog', async () => {
    await o.baza.q(`update users set address = 'Kralja Petra I 12', hours = '{"rd":["09:00","20:00"],"sub":null,"ned":null}',
                    followers_count = 1 where email = $1`, [butik.email]);
    const kupacId = (await kupac.get('/api/me')).body.korisnik.id;
    const shopId = (await shop.get('/api/me')).body.korisnik.id;
    await o.baza.q('insert into follows(user_id, shop_id) values ($1, $2)', [kupacId, shopId]);
    const anon = (await o.klijent().get(`/api/shops/${butik.handle}`)).body.butik;
    assert.equal(anon.address, 'Kralja Petra I 12');
    assert.deepEqual(anon.hours, { rd: ['09:00', '20:00'], sub: null, ned: null });
    assert.equal(anon.followers, 1);
    assert.equal(anon.following, false);
    assert.equal(anon.verified, true);
    assert.ok(!Number.isNaN(Date.parse(anon.since)));
    assert.equal(anon.posterUrl, '', 'lokalni snimak nema sličicu');
    assert.equal(typeof anon.listings, 'number');
    assert.equal((await kupac.get(`/api/shops/${butik.handle}`)).body.butik.following, true);
  });

  test('bez Bunnyja oglas „u obradi” vide svi (ponašanje iz razvoja)', async () => {
    const l = (await shop.objavi({ title: 'Obrada razvoj', category: 'Nakit' })).body.oglas;
    await o.baza.q("update listings set video_status = 'processing' where id = $1", [l.id]);
    assert.equal((await o.klijent().get(`/api/listings/${l.id}`)).status, 200);
  });

  test('listing_views.day je lokalni dan (Europe/Sarajevo)', async () => {
    const l = (await shop.objavi({ title: 'Dan pregleda', category: 'Nakit' })).body.oglas;
    await kupac.post('/api/views', { ids: [l.id] });
    const r = (await o.baza.q(`select day = (now() at time zone 'Europe/Sarajevo')::date as ok from listing_views
                                where listing_id = $1`, [l.id])).rows[0];
    assert.equal(r.ok, true);
  });
});

describe('Bunny uključen: oglas u obradi vidi samo vlasnik', () => {
  let o;
  let bunny;
  let shop;
  let kupac;
  let butik;
  let l;
  before(async () => {
    bunny = await lazniBunny();
    o = await okolina({ BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k', BUNNY_CDN_HOST: 'cdn.test', BUNNY_API_BASE: bunny.url });
    butik = await noviButik(o.baza, { butik: 'Butik Obrada', email: 'butik.obrada@test.ba' });
    shop = o.klijent();
    await shop.prijavi(butik.email, butik.password);
    kupac = o.klijent();
    await kupac.registruj('kupac.obrada@test.ba', 'Kupac Obrada');
    // Javni keš feeda se napuni prije objave i poslije nje, s istim ključem.
    await o.klijent().get('/api/listings?category=Torbe');
    l = (await shop.objavi({ title: 'U obradi', category: 'Torbe' })).body.oglas;
  });
  after(async () => {
    await o?.stop();
    await bunny?.close();
  });

  test('vlasnik vidi oglas s processing:true u feedu, na profilu i pojedinačno', async () => {
    assert.equal(l.processing, true);
    assert.equal((await shop.get('/api/listings?category=Torbe')).body.oglasi[0]?.id, l.id);
    const profil = await shop.get(`/api/listings?shop=${butik.handle}`);
    assert.equal(profil.body.ukupno, 1);
    assert.equal((await shop.get(`/api/listings/${l.id}`)).status, 200);
    assert.equal((await shop.get(`/api/shops/${butik.handle}`)).body.butik.listings, 1);
  });

  test('ostali ga ne vide: feed (i javni keš), profil, pojedinačno, sviđanje, /api/likes, pregledi', async () => {
    for (const k of [o.klijent(), kupac]) {
      for (const url of ['/api/listings?category=Torbe', '/api/listings', `/api/listings?shop=${butik.handle}`, '/api/listings?q=obradi']) {
        const r = await k.get(url);
        assert.ok(!r.body.oglasi.some((x) => x.id === l.id), url);
      }
      assert.equal((await k.get(`/api/listings?shop=${butik.handle}`)).body.ukupno, 0);
      assert.equal((await k.get(`/api/listings/${l.id}`)).status, 404);
      assert.equal((await k.get(`/api/shops/${butik.handle}`)).body.butik.listings, 0);
    }
    assert.equal((await kupac.post(`/api/listings/${l.id}/like`, { liked: true })).status, 404);
    assert.deepEqual((await kupac.get(`/api/likes?ids=${l.id}`)).body.svidjanja, {});
    await kupac.post('/api/views', { ids: [l.id] });
    assert.equal((await o.baza.q('select views from listings where id = $1', [l.id])).rows[0].views, 0);
  });

  test('kad je snimak gotov, vide ga svi (s Bunny adresama i sličicom na profilu)', async () => {
    await o.baza.q("update listings set video_status = 'ready', video_res = '720p', bunny_guid = 'guid-gotov' where id = $1", [l.id]);
    const r = await kupac.get(`/api/listings/${l.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.oglas.videoUrl, 'https://cdn.test/guid-gotov/play_720p.mp4');
    const feed = await o.klijent().get('/api/listings?category=Torbe&min=1');
    assert.equal(feed.body.oglasi[0]?.id, l.id);
    const b = (await o.klijent().get(`/api/shops/${butik.handle}`)).body.butik;
    assert.equal(b.listings, 1);
    assert.equal(b.posterUrl, 'https://cdn.test/guid-gotov/thumbnail.jpg');
    assert.equal((await kupac.post(`/api/listings/${l.id}/like`, { liked: true })).body.liked, true);
  });
});
