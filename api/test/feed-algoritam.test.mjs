// Feed (docs/SPEC-V1.md, F-01): GET /api/feed — kartice „Za tebe”, „Novo”, „Praćeni”, algoritam (redoslijed po
// ocjeni, raznolikost, otkrivanje, lični faktori), straničenje bez ponavljanja, neprijavljeni, oglas u obradi,
// posao base_score. Podaci se upisuju direktno u bazu (kontrolisane ocjene); API se ispituje preko HTTP-a.
//
// Kandidati „Za tebe” se keširaju 60 s po (kategorija, veličine): svaki test koristi svoju veličinu (`sizes=`)
// ili kategoriju, da ne vidi keš drugog testa.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina, pokreniApi } from './pomoc/okolina.mjs';

const ids = (r) => r.body.oglasi.map((o) => o.id);

// Butici direktno u bazi (brže od skripte; lozinka nije potrebna jer se ne prijavljuju).
async function butici(baza, prefix, n) {
  const out = [];
  for (let k = 1; k <= n; k += 1) {
    const r = await baza.q(
      `insert into users(email, password_hash, shop_name, handle, role, created_at)
       values ($1, 'x', $2, $3, 'butik', now() - interval '60 days') returning id`,
      [`${prefix}${k}@feed.ba`, `${prefix} ${k}`, `${prefix}${k}`],
    );
    out.push(r.rows[0].id);
  }
  return out;
}

// Oglas s kontrolisanom ocjenom. `sati` = starost (≥ 73 → nije u otkrivanju).
// Ocjena je u listing_scores (migracija 012, R2-02); score 0 = bez reda.
async function oglas(baza, { shop, cat = 'Haljine', size = 'M', score = 1, sati = 100, views = 100, status = 'ready', title = 'Oglas' }) {
  const r = await baza.q(
    `insert into listings(user_id, title, price_cents, category, video_path, video_status, sizes, created_at, views)
     values ($1, $2, 5000, $3, 'x.mp4', $4, $5, now() - make_interval(hours => $6), $7) returning id`,
    [shop, title, cat, status, [size], sati, views],
  );
  if (score > 0) await baza.q('insert into listing_scores(listing_id, base_score) values ($1, $2)', [r.rows[0].id, score]);
  return r.rows[0].id;
}

let o;
let shops; // id-jevi butika S1…S8

before(async () => {
  o = await okolina();
  shops = await butici(o.baza, 'fs', 8);
});
after(async () => { await o?.stop(); });

describe('ugovor', () => {
  test('kartica=x → 400, zadano je zatebe, izlaz {oglasi, kraj}', async () => {
    const r = await o.klijent().get('/api/feed?kartica=x');
    assert.equal(r.status, 400);
    assert.equal(r.body.greska, 'Nepoznata kartica.');
    const z = await o.klijent().get('/api/feed?sizes=46');
    assert.equal(z.status, 200);
    assert.deepEqual(z.body, { oglasi: [], kraj: true });
    const n = await o.klijent().get('/api/feed?kartica=novo&sizes=46');
    assert.deepEqual(n.body, { oglasi: [] }); // kraj samo za zatebe
  });

  test('izuzmi sa 450 id-jeva → 200 (uzeto zadnjih 400), loši id-jevi se ignorišu', async () => {
    const list = Array.from({ length: 450 }, (_, k) => k + 1).join(',');
    const r = await o.klijent().get(`/api/feed?sizes=45&izuzmi=${list},abc,-1,9999999999`);
    assert.equal(r.status, 200);
    assert.equal(r.body.kraj, true);
  });

  test('praceni bez prijave → 401 s tekstom iz specifikacije', async () => {
    const r = await o.klijent().get('/api/feed?kartica=praceni');
    assert.equal(r.status, 401);
    assert.equal(r.body.greska, 'Prijavi se da vidiš butike koje pratiš.');
  });
});

describe('Za tebe: algoritam', () => {
  test('redoslijed po ocjeni (različiti butici, stari oglasi, ista kategorija)', async () => {
    const scores = [0.3, 2.5, 1.1, 0.9, 1.8, 0.5];
    const made = [];
    for (let k = 0; k < scores.length; k += 1) {
      made.push({ id: await oglas(o.baza, { shop: shops[k], cat: 'Torbe', size: 'XS', score: scores[k] }), s: scores[k] });
    }
    const r = await o.klijent().get('/api/feed?sizes=XS');
    assert.equal(r.status, 200);
    const want = [...made].sort((a, b) => b.s - a.s).map((x) => x.id);
    assert.deepEqual(ids(r), want);
    assert.equal(r.body.kraj, true);
    const prvi = r.body.oglasi[0];
    for (const polje of ['id', 'title', 'price', 'category', 'videoUrl', 'shopName', 'handle', 'likes', 'liked', 'mine', 'sold', 'sizes']) {
      assert.ok(polje in prvi, `polje ${polje}`);
    }
    assert.equal(prvi.mine, false);
  });

  test('raznolikost: butik s 10 oglasa — najviše 1 od 4 uzastopna; nema 3 iste kategorije zaredom', async () => {
    const cats = ['Haljine', 'Obuća', 'Nakit'];
    // Butik 1 ima 10 najboljih oglasa; ostalih 7 butika po 4 slabija.
    for (let k = 0; k < 10; k += 1) await oglas(o.baza, { shop: shops[0], cat: cats[k % 3], size: 'S', score: 5 - k * 0.1 });
    for (let s = 1; s < 8; s += 1) {
      for (let k = 0; k < 4; k += 1) await oglas(o.baza, { shop: shops[s], cat: cats[(s + k) % 3], size: 'S', score: 1 - s * 0.05 - k * 0.01 });
    }
    const r = await o.klijent().get('/api/feed?sizes=S');
    const list = r.body.oglasi;
    assert.equal(list.length, 20);
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < Math.min(list.length, a + 4); b += 1) {
        assert.notEqual(list[a].handle, list[b].handle, `isti butik na pozicijama ${a} i ${b}`);
      }
      if (a >= 2) {
        assert.ok(!(list[a].category === list[a - 1].category && list[a].category === list[a - 2].category), `3 ista kategorija do ${a}`);
      }
    }
    // Najbolji oglas butika 1 je prvi.
    assert.equal(list[0].handle, 'fs1');
  });

  test('5 strana zaredom: nijedan id se ne ponavlja, poslije svih kandidata kraj:true', async () => {
    for (let s = 0; s < 8; s += 1) {
      for (let k = 0; k < 6; k += 1) await oglas(o.baza, { shop: shops[s], cat: ['Haljine', 'Pantalone'][k % 2], size: 'L', score: 0.5 + Math.random() });
    }
    // 48 starih + 4 nova (otkrivanje)
    for (let s = 0; s < 4; s += 1) await oglas(o.baza, { shop: shops[s], cat: 'Ostalo', size: 'L', score: 0.01, sati: 2, views: 3 });
    const vidjeno = [];
    let kraj = false;
    for (let strana = 0; strana < 5 && !kraj; strana += 1) {
      const r = await o.klijent().get(`/api/feed?sizes=L&izuzmi=${vidjeno.join(',')}`);
      assert.equal(r.status, 200);
      for (const id of ids(r)) {
        assert.ok(!vidjeno.includes(id), `id ${id} se ponovio na strani ${strana + 1}`);
        vidjeno.push(id);
      }
      kraj = r.body.kraj;
    }
    assert.equal(vidjeno.length, 52);
    assert.equal(kraj, true);
    const prazno = await o.klijent().get(`/api/feed?sizes=L&izuzmi=${vidjeno.join(',')}`);
    assert.deepEqual(prazno.body, { oglasi: [], kraj: true });
  });

  test('R2-01: 330 vidljivih (C∪D = 300) — sve strane do kraj:true, bez ponavljanja i bez prazne strane s kraj:false', async () => {
    // 230 starijih s ocjenom (C uzme najboljih 200) + 100 novih s malo pregleda (D); 30 starih ostaje van C∪D.
    await o.baza.q(
      `with n as (
         insert into listings(user_id, title, price_cents, category, video_path, video_status, sizes, created_at, views)
         select ($1::int[])[1 + g % 8], 'R2 ' || g, 5000, (array['Haljine','Obuća','Torbe'])[1 + g % 3], 'x.mp4', 'ready',
                array['43'], now() - make_interval(hours => case when g <= 230 then 100 else 2 end),
                case when g <= 230 then 100 else 3 end
           from generate_series(1, 330) g
         returning id, title)
       insert into listing_scores(listing_id, base_score)
       select id, case when substr(title, 4)::int <= 230 then 0.5 + random() else 0.01 end from n`,
      [shops],
    );
    const vidjeno = [];
    let kraj = false;
    let strana = 0;
    while (!kraj) {
      strana += 1;
      assert.ok(strana <= 16, 'previše strana: kraj nije došao');
      // Klijent (web/js/feed.js) šalje zadnjih 400 prikazanih.
      const url = `/api/feed?sizes=43${vidjeno.length ? `&izuzmi=${vidjeno.slice(-400).join(',')}` : ''}`;
      const r = await o.klijent().get(url);
      assert.equal(r.status, 200);
      kraj = r.body.kraj;
      assert.ok(r.body.oglasi.length > 0 || kraj, `strana ${strana}: prazna strana s kraj:false`);
      for (const id of ids(r)) {
        assert.ok(!vidjeno.includes(id), `id ${id} se ponovio na strani ${strana}`);
        vidjeno.push(id);
      }
    }
    assert.equal(vidjeno.length, 300);
    assert.equal(strana, 15);
    // Isto za prijavljenog kupca koji je dio oglasa već gledao (×0,2 ne smije vratiti izuzete).
    const kupac = o.klijent();
    const k = await kupac.registruj('kupac.r201@feed.ba', 'Kupac R2');
    await o.baza.q(`insert into listing_views(listing_id, viewer) select unnest($1::int[]), $2`, [vidjeno.slice(0, 50), `u${k.id}`]);
    const vid2 = [];
    for (kraj = false, strana = 0; !kraj;) {
      strana += 1;
      assert.ok(strana <= 16, 'prijavljen: kraj nije došao');
      const r = await kupac.get(`/api/feed?sizes=43${vid2.length ? `&izuzmi=${vid2.slice(-400).join(',')}` : ''}`);
      kraj = r.body.kraj;
      assert.ok(r.body.oglasi.length > 0 || kraj);
      for (const id of ids(r)) { assert.ok(!vid2.includes(id)); vid2.push(id); }
    }
    assert.equal(vid2.length, 300);
  });

  test('otkrivanje: pozicije 5, 10, 15, 20 (p%5==4) su novi oglasi s malo pregleda', async () => {
    const nova = new Set();
    for (let s = 0; s < 8; s += 1) {
      for (let k = 0; k < 4; k += 1) await oglas(o.baza, { shop: shops[s], cat: ['Haljine', 'Obuća'][k % 2], size: 'XL', score: 2 + Math.random() });
    }
    for (let s = 0; s < 8; s += 1) nova.add(await oglas(o.baza, { shop: shops[s], cat: 'Nakit', size: 'XL', score: 0.001, sati: 1, views: 0 }));
    const r = await o.klijent().get('/api/feed?sizes=XL');
    const list = ids(r);
    for (const p of [4, 9, 14, 19]) assert.ok(nova.has(list[p]), `pozicija ${p + 1} nije iz otkrivanja`);
    // Druga strana: n0 = 20, pa je otkrivanje opet na 5., 10. … poziciji strane.
    const r2 = await o.klijent().get(`/api/feed?sizes=XL&izuzmi=${list.join(',')}`);
    const l2 = ids(r2);
    const ostalo = [...nova].filter((id) => !list.includes(id));
    if (ostalo.length) assert.ok(nova.has(l2[4]));
  });

  test('lično: kupac sa 3+ sviđanja „Haljine” ima više haljina u prvih 20 nego neprijavljen', async () => {
    for (let s = 0; s < 8; s += 1) {
      for (let k = 0; k < 6; k += 1) {
        await oglas(o.baza, { shop: shops[s], cat: ['Haljine', 'Obuća', 'Torbe', 'Nakit', 'Pantalone', 'Ostalo'][k], size: 'XXL', score: 1 + ((s * 7 + k * 3) % 10) / 10 });
      }
    }
    const kupac = o.klijent();
    const k = await kupac.registruj('kupac.licno@feed.ba', 'Kupac Lično');
    // 3 sviđanja haljina (stari oglasi van ove veličine, da ne mijenjaju kandidate)
    for (let n = 0; n < 3; n += 1) {
      const id = await oglas(o.baza, { shop: shops[n], cat: 'Haljine', size: 'UNI', score: 0 });
      await o.baza.q('insert into likes(user_id, listing_id) values ($1, $2)', [k.id, id]);
    }
    const anon = (await o.klijent().get('/api/feed?sizes=XXL')).body.oglasi;
    const licno = (await kupac.get('/api/feed?sizes=XXL')).body.oglasi;
    const haljine = (l) => l.filter((x) => x.category === 'Haljine').length;
    assert.ok(haljine(licno) > haljine(anon), `haljine: lično ${haljine(licno)}, neprijavljen ${haljine(anon)}`);
  });

  test('pregledan oglas (listing_views za gledaoca) rangira se niže; sviđanje se vraća kao liked', async () => {
    const a = await oglas(o.baza, { shop: shops[0], cat: 'Majice i košulje', size: '35', score: 2 });
    const b = await oglas(o.baza, { shop: shops[1], cat: 'Majice i košulje', size: '35', score: 1.5 });
    const kupac = o.klijent();
    const k = await kupac.registruj('kupac.gledao@feed.ba', 'Kupac Gledao');
    const prije = await o.klijent().get('/api/feed?sizes=35');
    assert.deepEqual(ids(prije), [a, b]);
    await o.baza.q("insert into listing_views(listing_id, viewer) values ($1, $2)", [a, `u${k.id}`]);
    await o.baza.q('insert into likes(user_id, listing_id) values ($1, $2)', [k.id, b]);
    const poslije = await kupac.get('/api/feed?sizes=35');
    assert.deepEqual(ids(poslije), [b, a]);
    assert.equal(poslije.body.oglasi[0].liked, true);
    assert.equal(poslije.body.oglasi[1].liked, false);
    // Neprijavljen bez kolačića: isti redoslijed kao prije (bez ličnih faktora).
    assert.deepEqual(ids(await o.klijent().get('/api/feed?sizes=35')), [a, b]);
  });

  test('praćeni butik ×1,3; blokiran butik i vlastiti oglasi se ne prikazuju', async () => {
    const a = await oglas(o.baza, { shop: shops[2], cat: 'Pantalone', size: '36', score: 1.2 });
    const b = await oglas(o.baza, { shop: shops[3], cat: 'Pantalone', size: '36', score: 1.0 });
    const c = await oglas(o.baza, { shop: shops[4], cat: 'Pantalone', size: '36', score: 0.9 });
    const kupac = o.klijent();
    const k = await kupac.registruj('kupac.prati@feed.ba', 'Kupac Prati');
    await o.baza.q('insert into follows(user_id, shop_id) values ($1, $2)', [k.id, shops[3]]);
    await o.baza.q('insert into blocks(blocker_id, blocked_id) values ($1, $2)', [k.id, shops[4]]);
    assert.deepEqual(ids(await kupac.get('/api/feed?sizes=36')), [b, a]);
    // Butik ne vidi svoje u „Za tebe”.
    const butik = await noviButik(o.baza, { butik: 'Vlastiti Butik', email: 'vlastiti@feed.ba' });
    const shop = o.klijent();
    const ja = await shop.prijavi(butik.email, butik.password);
    const svoj = await oglas(o.baza, { shop: ja.id, cat: 'Pantalone', size: '37', score: 9 });
    const tudj = await oglas(o.baza, { shop: shops[5], cat: 'Pantalone', size: '37', score: 1 });
    assert.deepEqual(ids(await shop.get('/api/feed?sizes=37')), [tudj]);
    assert.deepEqual(ids(await o.klijent().get('/api/feed?sizes=37')), [svoj, tudj]);
    // U „Novo” butik vidi svoje.
    assert.ok(ids(await shop.get('/api/feed?kartica=novo&sizes=37')).includes(svoj));
    void c;
  });

  test('neprijavljen s kolačićem did: pregledi uređaja važe; bez kolačića nema ličnog upita', async () => {
    const a = await oglas(o.baza, { shop: shops[6], cat: 'Obuća', size: '38', score: 2 });
    const b = await oglas(o.baza, { shop: shops[7], cat: 'Obuća', size: '38', score: 1 });
    const gost = o.klijent();
    await gost.post('/api/views', { ids: [] }); // dobija potpisan kolačić did
    assert.ok(gost.cookies.get('did'));
    await gost.post('/api/views', { ids: [a] }); // sad se broji
    assert.deepEqual(ids(await gost.get('/api/feed?sizes=38')), [b, a]);
    assert.deepEqual(ids(await o.klijent().get('/api/feed?sizes=38')), [a, b]);
  });
});

describe('Novo i Praćeni', () => {
  test('novo: redom id desc, before=, kategorija; praceni: samo praćeni, id desc', async () => {
    const x1 = await oglas(o.baza, { shop: shops[0], cat: 'Nakit', size: '39', score: 0 });
    const x2 = await oglas(o.baza, { shop: shops[1], cat: 'Nakit', size: '39', score: 0 });
    const x3 = await oglas(o.baza, { shop: shops[0], cat: 'Nakit', size: '39', score: 0 });
    const n = await o.klijent().get('/api/feed?kartica=novo&sizes=39');
    assert.deepEqual(ids(n), [x3, x2, x1]);
    assert.deepEqual(ids(await o.klijent().get(`/api/feed?kartica=novo&sizes=39&before=${x3}`)), [x2, x1]);
    assert.deepEqual(ids(await o.klijent().get('/api/feed?kartica=novo&sizes=39&category=Torbe')), []);

    const kupac = o.klijent();
    const k = await kupac.registruj('kupac.praceni@feed.ba', 'Kupac Praćeni');
    assert.deepEqual((await kupac.get('/api/feed?kartica=praceni')).body, { oglasi: [] });
    await o.baza.q('insert into follows(user_id, shop_id) values ($1, $2)', [k.id, shops[0]]);
    const p = await kupac.get('/api/feed?kartica=praceni&sizes=39');
    assert.deepEqual(ids(p), [x3, x1]);
    assert.deepEqual(ids(await kupac.get(`/api/feed?kartica=praceni&sizes=39&before=${x3}`)), [x1]);
  });

  test('/api/listings prima sizes (F-03): samo oglasi s tom veličinom', async () => {
    const a = await oglas(o.baza, { shop: shops[2], cat: 'Ostalo', size: '40', score: 0, title: 'Velicina40 jedan' });
    await oglas(o.baza, { shop: shops[2], cat: 'Ostalo', size: '41', score: 0, title: 'Velicina40 drugi' });
    const r = await o.klijent().get('/api/listings?q=Velicina40&sizes=40,ABC');
    assert.deepEqual(ids(r), [a]);
    assert.equal((await o.klijent().get('/api/listings?q=Velicina40')).body.oglasi.length, 2);
  });
});

describe('posao base_score (proces s KOMODO_JOBS=1)', () => {
  test('obrisan, ugašen butik, star 31 dan i prodat prije 4 dana → 0; svjež → > 0; prodat oglas u Novo', async () => {
    const [ziv, ugasen] = await butici(o.baza, 'job', 2);
    await o.baza.q('update users set suspended_at = now() where id = $1', [ugasen]);
    const svjez = await oglas(o.baza, { shop: ziv, cat: 'Torbe', size: '42', score: 0, sati: 5, views: 0 });
    const obrisan = await oglas(o.baza, { shop: ziv, cat: 'Torbe', size: '42', score: 1, sati: 5 });
    await o.baza.q('update listings set deleted_at = now() where id = $1', [obrisan]);
    const odUgasenog = await oglas(o.baza, { shop: ugasen, cat: 'Torbe', size: '42', score: 1, sati: 5 });
    const star = await oglas(o.baza, { shop: ziv, cat: 'Torbe', size: '42', score: 1, sati: 31 * 24 });
    const prodat = await oglas(o.baza, { shop: ziv, cat: 'Torbe', size: '42', score: 1, sati: 10 * 24 });
    await o.baza.q("update listings set sold = true, sold_at = now() - interval '4 days' where id = $1", [prodat]);
    const prodatJuce = await oglas(o.baza, { shop: ziv, cat: 'Torbe', size: '42', score: 0, sati: 48 });
    await o.baza.q("update listings set sold = true, sold_at = now() - interval '1 day' where id = $1", [prodatJuce]);

    const posao = await pokreniApi(o.baza, { KOMODO_JOBS: '1' });
    try {
      await posao.cekajLog(/base_score: \d+ oglasa/, 10000);
    } finally {
      await posao.stop();
    }
    const s = Object.fromEntries((await o.baza.q(
      `select l.id, coalesce(s.base_score, 0) as base_score from listings l
         left join listing_scores s on s.listing_id = l.id where l.id = any($1::int[])`,
      [[svjez, obrisan, odUgasenog, star, prodat, prodatJuce]],
    )).rows.map((r) => [r.id, r.base_score]));
    assert.ok(s[svjez] > 0.9 && s[svjez] <= 1.2, `svjež ${s[svjez]}`);
    assert.equal(s[obrisan], 0);
    assert.equal(s[odUgasenog], 0);
    assert.equal(s[star], 0);
    assert.equal(s[prodat], 0);
    assert.ok(s[prodatJuce] > 0 && s[prodatJuce] < s[svjez] * 0.3, `prodat juče ${s[prodatJuce]}`);

    const z = ids(await o.klijent().get('/api/feed?sizes=42'));
    assert.ok(z.includes(svjez) && !z.includes(prodat));
    const novo = (await o.klijent().get('/api/feed?kartica=novo&sizes=42')).body.oglasi;
    const p = novo.find((x) => x.id === prodat);
    assert.ok(p && p.sold === true, 'prodat oglas je u Novo s oznakom prodato');
  });
});

// Oglas u obradi (Bunny uključen) vidi samo vlasnik — u svim karticama i u kešu kandidata.
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

describe('Bunny uključen: oglas u obradi nije u feedu za druge', () => {
  let b;
  let bunny;
  before(async () => {
    bunny = await lazniBunny();
    b = await okolina({ BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k', BUNNY_CDN_HOST: 'cdn.test', BUNNY_API_BASE: bunny.url });
  });
  after(async () => {
    await b?.stop();
    await bunny?.close();
  });

  test('ni u Za tebe (C i D), ni u Novo, ni u Praćeni; vlasnik ga vidi u Novo', async () => {
    const butik = await noviButik(b.baza, { butik: 'Butik Obrada Feed', email: 'obrada.feed@test.ba' });
    const shop = b.klijent();
    const ja = await shop.prijavi(butik.email, butik.password);
    const kupac = b.klijent();
    const k = await kupac.registruj('kupac.obrada.feed@test.ba', 'Kupac Obrada');
    await b.baza.q('insert into follows(user_id, shop_id) values ($1, $2)', [k.id, ja.id]);
    // Keš kandidata i javnog feeda se puni prije objave.
    await kupac.get('/api/feed');
    await kupac.get('/api/feed?kartica=novo');
    const l = (await shop.objavi({ title: 'U obradi feed', category: 'Torbe' })).body.oglas;
    assert.equal(l.processing, true);
    // I s ocjenom > 0 (npr. zastarjela ocjena) oglas u obradi ne smije u kandidate.
    await b.baza.q('insert into listing_scores(listing_id, base_score) values ($1, 5) on conflict (listing_id) do update set base_score = 5', [l.id]);
    const gotov = (await b.baza.q(
      `insert into listings(user_id, title, price_cents, category, video_path, video_provider, video_status, bunny_guid)
       values ($1, 'Gotov', 1000, 'Torbe', null, 'bunny', 'ready', 'g-ready') returning id`, [ja.id],
    )).rows[0].id;
    await b.baza.q('insert into listing_scores(listing_id, base_score) values ($1, 1)', [gotov]);
    for (const url of ['/api/feed', '/api/feed?category=Torbe', '/api/feed?kartica=novo', '/api/feed?kartica=novo&category=Torbe', '/api/feed?kartica=praceni']) {
      for (const who of [kupac, b.klijent()]) {
        const r = await who.get(url);
        if (r.status === 401) continue; // praceni za neprijavljenog
        assert.equal(r.status, 200, url);
        assert.ok(!ids(r).includes(l.id), `${url}: oglas u obradi vidljiv drugima`);
      }
    }
    assert.ok(ids(await kupac.get('/api/feed?category=Torbe')).includes(gotov), 'gotov oglas je u Za tebe');
    assert.ok(ids(await kupac.get('/api/feed?kartica=praceni')).includes(gotov));
    assert.ok(ids(await shop.get('/api/feed?kartica=novo')).includes(l.id), 'vlasnik vidi svoj oglas u obradi u Novo');
  });
});
