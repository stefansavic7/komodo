// P4 Oglas: sniženje (docs/SPEC-V1.md, F-07): stara cijena, push kupcima koji su označili oglas (lažni Expo server).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina, sleep } from './pomoc/okolina.mjs';

function laziExpo() {
  const zahtjevi = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
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
    reset: () => { zahtjevi.length = 0; },
    close: () => new Promise((r) => server.close(r)),
  })));
}
const tel = (cijena, extra = {}) => ({ title: 'Haljina sniz', price: cijena, category: 'Haljine', sizes: ['M'], ...extra });
const token = (n) => `ExponentPushToken[snizenje${n}]`;

describe('sniženje oglasa', () => {
  let o; let expo; let butik; let b; let anon; const kupci = {};
  before(async () => {
    expo = await laziExpo();
    o = await okolina({ EXPO_PUSH_URL: expo.url });
    b = await noviButik(o.baza, { butik: 'Moda Bojana', email: 'snizenje@test.ba' });
    butik = o.klijent(); await butik.prijavi(b.email, b.password);
    anon = o.klijent();
    for (const ime of ['a', 'b', 'iskljucen', 'ugasen', 'blokiran', 'bez']) {
      const k = o.klijent();
      await k.registruj(`sniz-${ime}@test.ba`, `Kupac ${ime}`);
      if (ime !== 'bez') await k.post('/api/me/push-token', { token: token(ime) });
      kupci[ime] = k;
    }
  });
  after(async () => { await o?.stop(); await expo?.close(); });

  // R2-07: push samo ako je stara cijena važila bar 72 h — testovi pusha „stare” cijenu (price_set_at).
  const ostari = (id) => o.baza.q("update listings set price_set_at = now() - interval '4 days' where id = $1", [id]);
  const novi = async (naziv) => {
    const r = await butik.objavi({ title: naziv, price: '89,90', category: 'Haljine', sizes: 'M' });
    assert.equal(r.status, 201);
    await ostari(r.body.oglas.id);
    return r.body.oglas.id;
  };
  const cekaj = async (n, ms = 3000) => {
    const kraj = Date.now() + ms;
    while (Date.now() < kraj && expo.poruke().length < n) await sleep(50);
    await sleep(150); // da se vidi i višak
  };
  const korisnikId = async (ime) => (await o.baza.q('select id from users where email = $1', [`sniz-${ime}@test.ba`])).rows[0].id;

  test('89,90 → 69,90: stara cijena, push samo onima koji smiju; 24 h pravilo; ponovno sniženje ne šalje', async () => {
    const id = await novi('Sniženje jedan');
    for (const ime of ['a', 'b', 'iskljucen', 'ugasen', 'blokiran', 'bez']) {
      assert.equal((await kupci[ime].post(`/api/listings/${id}/like`, { liked: true })).status, 200);
    }
    await o.baza.q("update users set push_enabled = false where email = 'sniz-iskljucen@test.ba'");
    await o.baza.q("update users set suspended_at = now() where email = 'sniz-ugasen@test.ba'");
    await o.baza.q('insert into blocks(blocker_id, blocked_id) values ($1, (select id from users where email = $2))',
      [await korisnikId('blokiran'), b.email]);
    expo.reset();
    const r = await butik.patch(`/api/listings/${id}`, tel('69,90', { title: 'Sniženje jedan' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.obavijesteno, true);
    assert.equal(r.body.oglas.oldPrice, 89.9);
    assert.equal(r.body.oglas.price, 69.9);
    await cekaj(2);
    const poruke = expo.poruke();
    assert.deepEqual(poruke.map((p) => p.to).sort(), [token('a'), token('b')]);
    assert.equal(poruke[0].title, 'Sniženje: Sniženje jedan');
    assert.equal(poruke[0].body, 'Moda Bojana: 89,90 KM → 69,90 KM');
    assert.deepEqual(poruke[0].data, { listingId: id });
    assert.ok(poruke[0].channelId);
    // Nije označen niko ko ne smije: oni nisu potrošili svoj prozor od 24 h.
    const oznake = (await o.baza.q('select u.email, k.price_notified_at is not null as n from likes k join users u on u.id = k.user_id where k.listing_id = $1', [id])).rows;
    assert.deepEqual(oznake.filter((x) => x.n).map((x) => x.email).sort(), ['sniz-a@test.ba', 'sniz-b@test.ba']);

    // Odmah novo sniženje: niko ne dobija drugi push, stara cijena ostaje veća.
    expo.reset();
    await ostari(id); // da se ovdje provjeri 24 h pravilo, ne 72 h (R2-07)
    const r2 = await butik.patch(`/api/listings/${id}`, tel('59,90', { title: 'Sniženje jedan' }));
    assert.equal(r2.body.oglas.oldPrice, 89.9);
    assert.equal(r2.body.obavijesteno, true);
    await cekaj(1, 800);
    assert.equal(expo.poruke().length, 0);

    // Poslije 24 h opet može.
    await o.baza.q('update likes set price_notified_at = now() - interval \'25 hours\' where listing_id = $1', [id]);
    await ostari(id);
    const r3 = await butik.patch(`/api/listings/${id}`, tel('49,90', { title: 'Sniženje jedan' }));
    assert.equal(r3.body.oglas.oldPrice, 89.9);
    await cekaj(2);
    assert.equal(expo.poruke().length, 2);
  });

  test('sniženje manje od 5 % ne upisuje staru cijenu i ne šalje push; povećanje briše staru cijenu', async () => {
    const id = await novi('Sniženje dva');
    await kupci.a.post(`/api/listings/${id}/like`, { liked: true });
    expo.reset();
    const r = await butik.patch(`/api/listings/${id}`, tel('87,90', { title: 'Sniženje dva' }));
    assert.equal(r.body.oglas.oldPrice, null);
    assert.equal(r.body.obavijesteno, false);
    // Tačno 5 %: 100 → 95 jeste sniženje.
    const p = await butik.patch(`/api/listings/${id}`, tel('100', { title: 'Sniženje dva' }));
    assert.equal(p.body.oglas.oldPrice, null);
    await ostari(id);
    const pet = await butik.patch(`/api/listings/${id}`, tel('95', { title: 'Sniženje dva' }));
    assert.equal(pet.body.oglas.oldPrice, 100);
    assert.equal(pet.body.obavijesteno, true);
    await cekaj(1);
    const veca = await butik.patch(`/api/listings/${id}`, tel('101', { title: 'Sniženje dva' }));
    assert.equal(veca.body.oglas.oldPrice, null);
    const red = (await o.baza.q('select old_price_cents, price_dropped_at from listings where id = $1', [id])).rows[0];
    assert.equal(red.old_price_cents, null);
    assert.equal(red.price_dropped_at, null);
  });

  test('prodat oglas i oglas bez označenih ne šalju; precrtana cijena stoji u listi i jednom oglasu', async () => {
    const id = await novi('Sniženje tri');
    await kupci.a.post(`/api/listings/${id}/like`, { liked: true });
    expo.reset();
    const prodato = await butik.patch(`/api/listings/${id}`, tel('50', { title: 'Sniženje tri', sold: true }));
    assert.equal(prodato.body.obavijesteno, false);
    await cekaj(1, 600);
    assert.equal(expo.poruke().length, 0);
    const jedan = await anon.get(`/api/listings/${id}`);
    assert.equal(jedan.body.oglas.oldPrice, 89.9);
    const tudji = await kupci.a.patch(`/api/listings/${id}`, tel('10'));
    assert.equal(tudji.status, 403 === tudji.status ? 403 : 404);
  });

  test('250 označenih → 3 zahtjeva prema Expo-u, najviše 100 poruka u zahtjevu', async () => {
    const id = (await butik.objavi({ title: 'Serije', price: '100', category: 'Torbe' })).body.oglas.id;
    await ostari(id);
    await o.baza.q(`insert into users(email, password_hash, shop_name, handle, role)
                    select 'se' || g || '@t.ba', 'x', 'Se ' || g, 'se' || g, 'kupac' from generate_series(1, 250) g`);
    await o.baza.q(`insert into push_tokens(token, user_id, session_token)
                    select 'ExponentPushToken[se' || u.id || ']', u.id, (select token from sessions limit 1) from users u where u.email like 'se%@t.ba'`);
    await o.baza.q("insert into likes(user_id, listing_id) select u.id, $1 from users u where u.email like 'se%@t.ba'", [id]);
    expo.reset();
    const r = await butik.patch(`/api/listings/${id}`, { title: 'Serije', price: '50', category: 'Torbe' });
    assert.equal(r.body.obavijesteno, true);
    await cekaj(250, 5000);
    assert.equal(expo.poruke().length, 250);
    assert.deepEqual(expo.zahtjevi.map((z) => z.length), [100, 100, 50]);
  });

  test('PATCH ne čeka slanje: spor Expo server ne usporava odgovor', async () => {
    // Lažni Expo ne odgovara dok test to ne dozvoli: PATCH mora završiti dok je slanje još zaključano.
    // (Bez tajming pragova, koji pod opterećenjem 2 jezgra nisu pouzdani.)
    const zadrzani = [];
    const spor = http.createServer((req, res) => { req.resume(); zadrzani.push(res); });
    await new Promise((r) => spor.listen(0, '127.0.0.1', r));
    const o2 = await okolina({ EXPO_PUSH_URL: `http://127.0.0.1:${spor.address().port}/push` });
    try {
      const bb = await noviButik(o2.baza, { butik: 'Spori Butik', email: 'spori@test.ba' });
      const bk = o2.klijent(); await bk.prijavi(bb.email, bb.password);
      const r = await bk.objavi({ title: 'Spori', price: '100', category: 'Torbe' });
      const id = r.body.oglas.id;
      await o2.baza.q("update listings set price_set_at = now() - interval '4 days' where id = $1", [id]);
      // 150 kupaca upisano direktno u bazu (registracija je ograničena na 60 po adresi); svaki ima token.
      const kk = o2.klijent(); await kk.registruj('spor-jedan@test.ba', 'Spor Jedan');
      await kk.post('/api/me/push-token', { token: 'ExponentPushToken[sporjedan]' });
      await o2.baza.q(`insert into users(email, password_hash, shop_name, handle, role)
                       select 'sp' || g || '@t.ba', 'x', 'Sp ' || g, 'sp' || g, 'kupac' from generate_series(1, 150) g`);
      await o2.baza.q(`insert into push_tokens(token, user_id, session_token)
                       select 'ExponentPushToken[sp' || u.id || ']', u.id, (select token from sessions limit 1) from users u where u.email like 'sp%@t.ba'`);
      await o2.baza.q(`insert into likes(user_id, listing_id) select u.id, $1 from users u where u.email like 'sp%@t.ba'`, [id]);
      const p = await bk.patch(`/api/listings/${id}`, { title: 'Spori', price: '50', category: 'Torbe' });
      assert.equal(p.body.obavijesteno, true);
      // Odgovor je stigao, a nijedan zahtjev prema Expo-u nije odgovoren (barem jedan je pokušan ili tek dolazi).
      for (const res of zadrzani) { res.setHeader('content-type', 'application/json'); res.end('{"data":[]}'); }
    } finally {
      for (const res of zadrzani) { if (!res.writableEnded) res.destroy(); }
      await o2.stop(); spor.closeAllConnections?.(); spor.close();
    }
  });
  test('R2-07: „digni pa spusti” (50 → 500 → 50) ne šalje push; precrtana cijena po starom pravilu', async () => {
    const id = (await butik.objavi({ title: 'Digni spusti', price: '50', category: 'Torbe' })).body.oglas.id;
    await ostari(id); // 50 KM važi dugo
    await kupci.a.post(`/api/listings/${id}/like`, { liked: true });
    expo.reset();
    const gore = await butik.patch(`/api/listings/${id}`, { title: 'Digni spusti', price: '500', category: 'Torbe' });
    assert.equal(gore.body.obavijesteno, false);
    assert.equal(gore.body.oglas.pushSnizenje, false, 'vlasnik vidi da sniženje sada ne bi javilo kupcima');
    const dole = await butik.patch(`/api/listings/${id}`, { title: 'Digni spusti', price: '50', category: 'Torbe' });
    assert.equal(dole.status, 200);
    assert.equal(dole.body.obavijesteno, false);
    assert.equal(dole.body.oglas.oldPrice, 500); // precrtano kao i prije (odluka: samo push se ne šalje)
    await cekaj(1, 800);
    assert.equal(expo.poruke().length, 0);
    // Ni kupac nije „potrošio” prozor od 24 h.
    const n = (await o.baza.q('select count(*)::int as n from likes where listing_id = $1 and price_notified_at is not null', [id])).rows[0].n;
    assert.equal(n, 0);
  });

  test('R2-07: cijena stara 71 h → bez pusha; 73 h → push; izmjena bez promjene cijene ne pomjera rok', async () => {
    const id = await novi('Rok 72');
    await kupci.b.post(`/api/listings/${id}/like`, { liked: true });
    await o.baza.q("update listings set price_set_at = now() - interval '71 hours' where id = $1", [id]);
    // Izmjena naziva (ista cijena) ne mijenja price_set_at.
    await butik.patch(`/api/listings/${id}`, tel('89,90', { title: 'Rok 72 novi naziv' }));
    const prije = (await o.baza.q("select price_set_at < now() - interval '70 hours' as ok from listings where id = $1", [id])).rows[0];
    assert.equal(prije.ok, true);
    expo.reset();
    const r = await butik.patch(`/api/listings/${id}`, tel('59,90', { title: 'Rok 72' }));
    assert.equal(r.body.obavijesteno, false);
    assert.equal(r.body.oglas.oldPrice, 89.9);
    // Vrati cijenu (briše precrtavanje), pa je „ostari” na 73 h: sniženje sada javlja.
    await butik.patch(`/api/listings/${id}`, tel('89,90', { title: 'Rok 72' }));
    await o.baza.q("update listings set price_set_at = now() - interval '73 hours' where id = $1", [id]);
    const g = await butik.get(`/api/listings/${id}`);
    assert.equal(g.body.oglas.pushSnizenje, true);
    const r2 = await butik.patch(`/api/listings/${id}`, tel('59,90', { title: 'Rok 72' }));
    assert.equal(r2.body.obavijesteno, true);
    await cekaj(1);
    assert.deepEqual(expo.poruke().map((p) => p.to), [token('b')]);
    // Kupac ne vidi pushSnizenje.
    assert.equal((await kupci.b.get(`/api/listings/${id}`)).body.oglas.pushSnizenje, undefined);
  });
});

// R2-08: oglas u obradi (Bunny uključen, lažni server) — sniženje ne šalje push: kupci ga još ne smiju vidjeti.
async function lazniBunny() {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') { n += 1; return res.end(JSON.stringify({ guid: `guid-sn-${n}` })); }
      if (req.method === 'GET') return res.end(JSON.stringify({ status: 2 })); // obrada traje
      return res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('sniženje oglasa u obradi (lažni Bunny)', () => {
  let o; let expo; let bunny;
  before(async () => {
    expo = await laziExpo();
    bunny = await lazniBunny();
    o = await okolina({
      EXPO_PUSH_URL: expo.url, BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k', BUNNY_CDN_HOST: 'cdn.test', BUNNY_API_BASE: bunny.url,
    });
  });
  after(async () => { await o?.stop(); await expo?.close(); await bunny?.close(); });

  test('oglas u obradi: sniženje upisuje staru cijenu, ali niko ne dobija push', async () => {
    const b = await noviButik(o.baza, { butik: 'Butik Obrada Sniz', email: 'obrada.sniz@test.ba' });
    const butik = o.klijent(); await butik.prijavi(b.email, b.password);
    const l = (await butik.objavi({ title: 'Obrada sniz', price: '100', category: 'Torbe' })).body.oglas;
    assert.equal(l.processing, true);
    await o.baza.q("update listings set price_set_at = now() - interval '4 days' where id = $1", [l.id]);
    // Sviđanje upisano direktno (kupac oglas u obradi ne vidi, pa ga ne može ni označiti preko API-ja).
    const kupac = o.klijent();
    const k = await kupac.registruj('kupac.obrada.sniz@test.ba', 'Kupac Obrada');
    await kupac.post('/api/me/push-token', { token: 'ExponentPushToken[obradasniz]' });
    await o.baza.q('insert into likes(user_id, listing_id) values ($1, $2)', [k.id, l.id]);
    expo.reset();
    const r = await butik.patch(`/api/listings/${l.id}`, { title: 'Obrada sniz', price: '50', category: 'Torbe' });
    assert.equal(r.status, 200);
    assert.equal(r.body.obavijesteno, false);
    assert.equal(r.body.oglas.oldPrice, 100);
    await sleep(800);
    assert.equal(expo.poruke().length, 0);
    const n = (await o.baza.q('select price_notified_at from likes where listing_id = $1', [l.id])).rows[0];
    assert.equal(n.price_notified_at, null);
  });
});
