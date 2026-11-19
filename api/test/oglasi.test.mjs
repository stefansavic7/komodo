// Oglasi: objava (multipart), izmjena, prodato, brisanje, dozvole, feed i filteri, sviđanja, pregledi.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import { VIDEO, noviButik, okolina } from './pomoc/okolina.mjs';

let o;
let butikA; // podaci za prijavu
let butikB;
let shopA; // prijavljeni klijenti
let shopB;
let kupac;

before(async () => {
  o = await okolina();
  butikA = await noviButik(o.baza, { butik: 'Moda Ana', email: 'moda.ana@test.ba', telefon: '065 123 456' });
  butikB = await noviButik(o.baza, { butik: 'Stil Bojana', email: 'stil.bojana@test.ba' });
  shopA = o.klijent();
  await shopA.prijavi(butikA.email, butikA.password);
  shopB = o.klijent();
  await shopB.prijavi(butikB.email, butikB.password);
  kupac = o.klijent();
  await kupac.registruj('kupac.oglasi@test.ba', 'Kupac Oglasi');
});
after(async () => { await o?.stop(); });

describe('objava oglasa', () => {
  test('butik objavljuje video: 201, snimak se služi s /media/', async () => {
    const r = await shopA.objavi({ title: 'Crna saten haljina, M', price: '64,90', category: 'Haljine' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const l = r.body.oglas;
    assert.equal(l.title, 'Crna saten haljina, M');
    assert.equal(l.price, 64.9);
    assert.equal(l.category, 'Haljine');
    assert.equal(l.mine, true);
    assert.equal(l.sold, false);
    assert.equal(l.likes, 0);
    assert.equal(l.views, 0);
    assert.equal(l.handle, butikA.handle);
    assert.match(l.videoUrl, /^\/media\/[0-9a-f-]+\.mp4$/);
    const media = await fetch(o.url + l.videoUrl);
    assert.equal(media.status, 200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), await readFile(VIDEO));
  });

  test('kupac ne može objaviti (403), bez sesije 401', async () => {
    assert.equal((await kupac.objavi()).status, 403);
    assert.equal((await o.klijent().objavi()).status, 401);
  });

  test('provjera polja: video, naziv, cijena, kategorija, vrsta fajla, JSON umjesto obrasca', async () => {
    const slucajevi = [
      [{}, { video: null }, /video/i],
      [{ title: 'X' }, {}, /naziv/i],
      [{ price: 'jeftino' }, {}, /cijenu/i],
      [{ price: '0' }, {}, /cijenu/i],
      [{ category: 'Auto-dijelovi' }, {}, /kategoriju/i],
      [{}, { mime: 'image/png' }, /MP4/],
    ];
    for (const [polja, opcije, poruka] of slucajevi) {
      const r = await shopA.objavi(polja, opcije);
      assert.equal(r.status, 400, JSON.stringify(polja));
      assert.match(r.body.greska, poruka);
    }
    const json = await shopA.post('/api/listings', { title: 'Bez videa', price: '10', category: 'Ostalo' });
    assert.equal(json.status, 400);
  });

  test('odbijeni oglas ne ostavlja fajl na disku', async () => {
    const { readdir } = await import('node:fs/promises');
    const prije = (await readdir(o.api.uploads)).length;
    await shopA.objavi({ price: 'nije broj' });
    assert.equal((await readdir(o.api.uploads)).length, prije);
  });
});

describe('izmjena, prodato, brisanje i dozvole', () => {
  let oglas;
  before(async () => {
    oglas = (await shopA.objavi({ title: 'Kožna jakna', price: '120', category: 'Jakne i kaputi' })).body.oglas;
  });

  test('vlasnik mijenja naziv, cijenu i kategoriju', async () => {
    const r = await shopA.patch(`/api/listings/${oglas.id}`, { title: 'Kožna jakna, L', price: '99,50', category: 'Ostalo' });
    assert.equal(r.status, 200);
    assert.equal(r.body.oglas.title, 'Kožna jakna, L');
    assert.equal(r.body.oglas.price, 99.5);
    assert.equal(r.body.oglas.category, 'Ostalo');
    const javno = await kupac.get(`/api/listings/${oglas.id}`);
    assert.equal(javno.body.oglas.title, 'Kožna jakna, L');
    assert.equal(javno.body.oglas.mine, false);
    assert.equal(javno.body.oglas.views, undefined, 'pregledi se ne pokazuju drugima');
  });

  test('oznaka prodato se postavlja i skida', async () => {
    const r = await shopA.patch(`/api/listings/${oglas.id}`, { title: 'Kožna jakna, L', price: '99,50', category: 'Ostalo', sold: true });
    assert.equal(r.body.oglas.sold, true);
    assert.equal((await kupac.get(`/api/listings/${oglas.id}`)).body.oglas.sold, true);
    const back = await shopA.patch(`/api/listings/${oglas.id}`, { title: 'Kožna jakna, L', price: '99,50', category: 'Ostalo' });
    assert.equal(back.body.oglas.sold, false);
  });

  test('neispravna izmjena: 400', async () => {
    assert.equal((await shopA.patch(`/api/listings/${oglas.id}`, { title: 'K', price: '10', category: 'Ostalo' })).status, 400);
    assert.equal((await shopA.patch(`/api/listings/${oglas.id}`, { title: 'Kožna', price: '-5', category: 'Ostalo' })).status, 400);
    assert.equal((await shopA.patch(`/api/listings/${oglas.id}`, { title: 'Kožna', price: '10', category: 'Nešto' })).status, 400);
  });

  test('tuđi oglas: drugi butik i kupac ne mogu mijenjati ni brisati (404), bez sesije 401', async () => {
    const izmjena = { title: 'Ukradeno', price: '1', category: 'Ostalo', sold: true };
    assert.equal((await shopB.patch(`/api/listings/${oglas.id}`, izmjena)).status, 404);
    assert.equal((await kupac.patch(`/api/listings/${oglas.id}`, izmjena)).status, 404);
    assert.equal((await shopB.del(`/api/listings/${oglas.id}`)).status, 404);
    assert.equal((await kupac.del(`/api/listings/${oglas.id}`)).status, 404);
    assert.equal((await o.klijent().patch(`/api/listings/${oglas.id}`, izmjena)).status, 401);
    assert.equal((await o.klijent().del(`/api/listings/${oglas.id}`)).status, 401);
    const still = await kupac.get(`/api/listings/${oglas.id}`);
    assert.equal(still.body.oglas.title, 'Kožna jakna, L');
  });

  test('vlasnik briše: oglas i snimak nestaju, drugo brisanje 404', async () => {
    const r = await shopA.del(`/api/listings/${oglas.id}`);
    assert.equal(r.status, 200);
    assert.equal((await kupac.get(`/api/listings/${oglas.id}`)).status, 404);
    assert.equal((await fetch(o.url + oglas.videoUrl)).status, 404);
    assert.equal((await shopA.del(`/api/listings/${oglas.id}`)).status, 404);
    assert.equal((await kupac.post(`/api/listings/${oglas.id}/like`, { liked: true })).status, 404);
  });

  test('neispravan id: 404', async () => {
    assert.equal((await kupac.get('/api/listings/abc')).status, 404);
    assert.equal((await kupac.get('/api/listings/99999999')).status, 404);
  });
});

describe('feed i filteri', () => {
  // Javni feed ima keš od 5 s po kombinaciji filtera, pa svaki test koristi svoju kombinaciju
  // (jedinstvenu riječ u nazivu) i prvi upit šalje tek kad su svi oglasi napravljeni.
  const ids = {};
  before(async () => {
    const napravi = async (k, title, price, category, klijent = shopA) => {
      const r = await klijent.objavi({ title, price, category });
      assert.equal(r.status, 201);
      ids[k] = r.body.oglas.id;
    };
    await napravi('h1', 'Zeleni FILTAR haljina', '30', 'Haljine');
    await napravi('h2', 'Plavi FILTAR haljina', '80', 'Haljine');
    await napravi('o1', 'Bijele FILTAR patike', '150', 'Obuća');
    await napravi('t1', 'Crvena FILTAR torba', '55,50', 'Torbe', shopB);
    // 25 oglasa butika B za stranice i `ukupno`.
    for (let n = 0; n < 25; n += 1) await napravi(`p${n}`, `Stranica ${n}`, String(10 + n), 'Nakit', shopB);
  });

  test('feed bez filtera: najnoviji prvi, najviše 20, kategorije s API-ja', async () => {
    const r = await o.klijent().get('/api/listings');
    assert.equal(r.status, 200);
    assert.equal(r.body.oglasi.length, 20);
    const lista = r.body.oglasi.map((l) => l.id);
    assert.deepEqual(lista, [...lista].sort((a, b) => b - a));
    assert.equal(r.body.ukupno, undefined, 'ukupno samo za shop= i liked=1');
    const kat = await o.klijent().get('/api/categories');
    assert.ok(kat.body.kategorije.includes('Haljine'));
  });

  test('pretraga q= po nazivu i po nazivu butika, bez obzira na veličinu slova', async () => {
    const r = await o.klijent().get(`/api/listings?q=${encodeURIComponent('filtar')}`);
    assert.deepEqual(r.body.oglasi.map((l) => l.id).sort(), [ids.h1, ids.h2, ids.o1, ids.t1].sort());
    const poButiku = await o.klijent().get(`/api/listings?q=${encodeURIComponent('stil bojana')}`);
    assert.equal(poButiku.body.oglasi.length, 20);
    assert.ok(poButiku.body.oglasi.every((l) => l.handle === butikB.handle));
    const procenat = await o.klijent().get(`/api/listings?q=${encodeURIComponent('%')}`);
    assert.equal(procenat.body.oglasi.length, 0, '% se traži doslovno');
  });

  test('category= i raspon cijene min/max (zarez ili tačka)', async () => {
    const hal = await o.klijent().get(`/api/listings?q=filtar&category=${encodeURIComponent('Haljine')}`);
    assert.deepEqual(hal.body.oglasi.map((l) => l.id).sort(), [ids.h1, ids.h2].sort());
    const raspon = await o.klijent().get('/api/listings?q=filtar&min=50&max=100');
    assert.deepEqual(raspon.body.oglasi.map((l) => l.id).sort(), [ids.h2, ids.t1].sort());
    const granica = await o.klijent().get('/api/listings?q=filtar&min=55,50&max=55.5');
    assert.deepEqual(granica.body.oglasi.map((l) => l.id), [ids.t1]);
    const losaKat = await o.klijent().get('/api/listings?q=filtar&category=Nema');
    assert.equal(losaKat.body.oglasi.length, 4, 'nepoznata kategorija se zanemaruje');
  });

  test('shop= vraća oglase butika i ukupno; before= daje sljedeću stranu bez ukupno', async () => {
    const r = await o.klijent().get(`/api/listings?shop=${butikB.handle}`);
    assert.equal(r.body.oglasi.length, 20);
    assert.equal(r.body.ukupno, 26);
    assert.ok(r.body.oglasi.every((l) => l.handle === butikB.handle));
    const zadnji = r.body.oglasi[19].id;
    const s2 = await o.klijent().get(`/api/listings?shop=${butikB.handle}&before=${zadnji}`);
    assert.equal(s2.body.oglasi.length, 6);
    assert.equal(s2.body.ukupno, undefined);
    assert.ok(s2.body.oglasi.every((l) => l.id < zadnji));
    const sve = new Set([...r.body.oglasi, ...s2.body.oglasi].map((l) => l.id));
    assert.equal(sve.size, 26);
    const veliko = await o.klijent().get(`/api/listings?shop=${butikB.handle.toUpperCase()}`);
    assert.equal(veliko.body.ukupno, 26);
    const profil = await o.klijent().get(`/api/shops/${butikB.handle}`);
    assert.equal(profil.body.butik.listings, 26);
    assert.equal((await o.klijent().get('/api/shops/nepostoji')).status, 404);
  });

  test('liked=1 vraća samo moja sviđanja i ukupno; bez sesije prazno', async () => {
    const k = o.klijent();
    await k.registruj('lajker@test.ba', 'Lajker');
    for (const key of ['h1', 'o1', 't1']) await k.post(`/api/listings/${ids[key]}/like`, { liked: true });
    const r = await k.get('/api/listings?liked=1');
    assert.deepEqual(r.body.oglasi.map((l) => l.id), [ids.t1, ids.o1, ids.h1]);
    assert.ok(r.body.oglasi.every((l) => l.liked === true));
    assert.equal(r.body.ukupno, 3);
    const anon = await o.klijent().get('/api/listings?liked=1');
    assert.equal(anon.body.oglasi.length, 0);
  });

  // Popravljeno (backend): zahtjev prijavljenog butika ide mimo keša javnog feeda.
  test('butik odmah poslije objave vidi svoj oglas u feedu', async () => {
    const prije = await shopA.get(`/api/listings?category=${encodeURIComponent('Torbe')}`);
    assert.equal(prije.status, 200);
    const nov = (await shopA.objavi({ title: 'Upravo objavljena torba', category: 'Torbe' })).body.oglas;
    const poslije = await shopA.get(`/api/listings?category=${encodeURIComponent('Torbe')}`);
    assert.equal(poslije.body.oglasi[0]?.id, nov.id);
  });

  test('prijavljenom se u feedu označava liked i mine', async () => {
    await kupac.post(`/api/listings/${ids.h2}/like`, { liked: true });
    const r = await kupac.get('/api/listings?q=filtar&max=90');
    const h2 = r.body.oglasi.find((l) => l.id === ids.h2);
    assert.equal(h2.liked, true);
    assert.equal(h2.mine, false);
    const own = await shopA.get('/api/listings?q=filtar&max=90');
    assert.equal(own.body.oglasi.find((l) => l.id === ids.h2).mine, true);
  });
});

describe('sviđanja', () => {
  let oglas;
  before(async () => {
    oglas = (await shopA.objavi({ title: 'Za sviđanja' })).body.oglas;
  });

  test('{liked:true} je idempotentno, {liked:false} skida, bez tijela je prekidač', async () => {
    const url = `/api/listings/${oglas.id}/like`;
    assert.deepEqual((await kupac.post(url, { liked: true })).body, { liked: true, likes: 1 });
    assert.deepEqual((await kupac.post(url, { liked: true })).body, { liked: true, likes: 1 });
    assert.deepEqual((await kupac.post(url, { liked: false })).body, { liked: false, likes: 0 });
    assert.deepEqual((await kupac.post(url, { liked: false })).body, { liked: false, likes: 0 });
    assert.deepEqual((await kupac.post(url)).body, { liked: true, likes: 1 });
    assert.deepEqual((await kupac.post(url)).body, { liked: false, likes: 0 });
  });

  test('neispravno tijelo 400, bez sesije 401', async () => {
    const url = `/api/listings/${oglas.id}/like`;
    assert.equal((await kupac.post(url, { liked: 'da' })).status, 400);
    assert.equal((await o.klijent().post(url, { liked: true })).status, 401);
  });

  test('/api/likes?ids= vraća broj i moje stanje, prazni i neispravni id-jevi se zanemaruju', async () => {
    const drugi = o.klijent();
    await drugi.registruj('drugi.lajk@test.ba', 'Drugi Lajk');
    await kupac.post(`/api/listings/${oglas.id}/like`, { liked: true });
    await drugi.post(`/api/listings/${oglas.id}/like`, { liked: true });
    const r = await kupac.get(`/api/likes?ids=${oglas.id},abc,999999`);
    assert.deepEqual(r.body.svidjanja, { [oglas.id]: { likes: 2, liked: true } });
    const anon = await o.klijent().get(`/api/likes?ids=${oglas.id}`);
    assert.deepEqual(anon.body.svidjanja[oglas.id], { likes: 2, liked: false });
    assert.deepEqual((await kupac.get('/api/likes')).body, { svidjanja: {} });
    const red = await o.baza.q('select likes_count from listings where id = $1', [oglas.id]);
    assert.equal(red.rows[0].likes_count, 2);
  });
});

describe('pregledi', () => {
  let oglas;
  let drugi;
  const views = async () => (await shopA.get(`/api/listings/${oglas.id}`)).body.oglas.views;
  before(async () => {
    oglas = (await shopA.objavi({ title: 'Za preglede' })).body.oglas;
    drugi = (await shopA.objavi({ title: 'Za preglede 2' })).body.oglas;
  });

  test('jedan pregled po gledaocu po danu; neprijavljeni se broje po potpisanom kolačiću did', async () => {
    // S-07: uređaj bez ispravnog did kolačića dobije potpisan did u prvom odgovoru, ali se taj prvi zahtjev
    // ne broji (kolačić se može odbaciti pa bi svaki zahtjev bio „novi gledalac”).
    const anon = o.klijent();
    assert.deepEqual((await anon.post('/api/views', { ids: [oglas.id, drugi.id] })).body, { ok: true });
    assert.ok(anon.cookies.get('did'), 'server postavlja did');
    assert.match(decodeURIComponent(anon.cookies.get('did')), /\./, 'did je potpisan (vrijednost.potpis)');
    assert.equal(await views(), 0, 'prvi zahtjev novog uređaja se ne broji');
    assert.equal((await shopA.get(`/api/listings/${drugi.id}`)).body.oglas.views, 0);
    // Drugi zahtjev istog uređaja: broji se, i to samo jednom po oglasu i danu.
    await anon.post('/api/views', { ids: [oglas.id] });
    await anon.post(`/api/listings/${oglas.id}/view`);
    assert.equal(await views(), 1);
    // Novi uređaj: prvi zahtjev se ne broji, drugi se broji.
    const novi = o.klijent();
    await novi.post('/api/views', { ids: [oglas.id] });
    assert.equal(await views(), 1, 'prvi zahtjev novog uređaja se ne broji');
    await novi.post('/api/views', { ids: [oglas.id] });
    assert.equal(await views(), 2);
    // Prijavljen korisnik se broji odmah (po nalogu), duplikat u istom zahtjevu i ponovljeni zahtjev ne.
    await kupac.post('/api/views', { ids: [oglas.id, oglas.id] });
    await kupac.post(`/api/listings/${oglas.id}/view`);
    assert.equal(await views(), 3);
    assert.equal((await shopA.get(`/api/listings/${drugi.id}`)).body.oglas.views, 0);
  });

  test('lažan did kolačić se ne priznaje: dobije se novi potpisan did i zahtjev se ne broji', async () => {
    const lazni = o.klijent();
    lazni.cookies.set('did', 'lazniUredjajBezPotpisa1234');
    const prije = await views();
    await lazni.post('/api/views', { ids: [oglas.id] });
    await lazni.post('/api/views', { ids: [oglas.id] }); // sad je did ispravan, pa se ovaj broji
    assert.notEqual(lazni.cookies.get('did'), 'lazniUredjajBezPotpisa1234');
    assert.equal(await views(), prije + 1);
  });

  test('vlasnikovi pregledi se ne broje', async () => {
    const prije = await views();
    await shopA.post('/api/views', { ids: [oglas.id] });
    await shopA.post(`/api/listings/${oglas.id}/view`);
    assert.equal(await views(), prije);
  });

  test('neispravan zahtjev: 400 (nije niz, više od 50, nije cijeli broj)', async () => {
    const k = o.klijent();
    assert.equal((await k.post('/api/views', { ids: 'svi' })).status, 400);
    assert.equal((await k.post('/api/views', { ids: Array.from({ length: 51 }, (_, i) => i + 1) })).status, 400);
    assert.equal((await k.post('/api/views', { ids: [1.5] })).status, 400);
    assert.equal((await k.post('/api/views', {})).status, 400);
  });

  test('ograničenje: 30 brojanih zahtjeva istog gledaoca u minuti, sljedeći daje 429', async () => {
    // Prvi zahtjev novog uređaja se ne broji u ograničenju (dobija did), pa je 200 ukupno 1 + 30 = 31;
    // tek sljedeći prelazi granicu od 30 brojanih zahtjeva u minuti.
    const k = o.klijent();
    for (let n = 0; n < 31; n += 1) assert.equal((await k.post('/api/views', { ids: [] })).status, 200, `zahtjev ${n + 1}`);
    assert.equal((await k.post('/api/views', { ids: [oglas.id] })).status, 429);
  });
});
