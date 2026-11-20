// P4 Oglas: veličine (docs/SPEC-V1.md, F-03): objava, izmjena, validacija, filter.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

describe('veličine na oglasu', () => {
  let o;
  let butik;
  let anon;
  before(async () => {
    o = await okolina();
    const b = await noviButik(o.baza, { butik: 'Velicine Butik', email: 'velicine@test.ba' });
    butik = o.klijent(); await butik.prijavi(b.email, b.password);
    anon = o.klijent();
  });
  after(async () => { await o?.stop(); });

  test('objava: izbor se čuva redom iz tabele, torbe dobijaju UNI, izostavljeno = []', async () => {
    const a = await butik.objavi({ title: 'Haljina velicine', category: 'Haljine', sizes: 'M, S,m' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.deepEqual(a.body.oglas.sizes, ['S', 'M']);
    const b = await butik.objavi({ title: 'Cipele velicine', category: 'Obuća', sizes: '40,38' });
    assert.deepEqual(b.body.oglas.sizes, ['38', '40']);
    const c = await butik.objavi({ title: 'Torba velicine', category: 'Torbe' });
    assert.deepEqual(c.body.oglas.sizes, ['UNI']);
    const d = await butik.objavi({ title: 'Nakit velicine', category: 'Nakit', sizes: 'UNI' });
    assert.deepEqual(d.body.oglas.sizes, ['UNI']);
    const e = await butik.objavi({ title: 'Stari klijent', category: 'Pantalone' });
    assert.equal(e.status, 201);
    assert.deepEqual(e.body.oglas.sizes, []);
    const f = await butik.objavi({ title: 'Jedna velicina', category: 'Ostalo', sizes: 'UNI' });
    assert.deepEqual(f.body.oglas.sizes, ['UNI']);
  });

  test('objava: prazno, nepoznato i višak vrijednosti su 400', async () => {
    const prazno = await butik.objavi({ title: 'Prazno', category: 'Haljine', sizes: '' });
    assert.equal(prazno.status, 400);
    assert.equal(prazno.body.greska, 'Izaberi bar jednu veličinu.');
    for (const sizes of ['ABC', 'M,ABC', '38', 'S,M,38']) {
      const r = await butik.objavi({ title: 'Lose', category: 'Haljine', sizes });
      assert.equal(r.status, 400, sizes);
      assert.equal(r.body.greska, 'Veličina nije ispravna za ovu kategoriju.');
    }
    const obuca = await butik.objavi({ title: 'Lose', category: 'Obuća', sizes: 'M' });
    assert.equal(obuca.status, 400);
    assert.equal(obuca.body.greska, 'Veličina nije ispravna za ovu kategoriju.');
    const torba = await butik.objavi({ title: 'Lose', category: 'Torbe', sizes: 'M' });
    assert.equal(torba.status, 400);
    const mnogo = await butik.objavi({ title: 'Lose', category: 'Obuća', sizes: '35,36,37,38,39,40,41,42,43,44,45,46,35' });
    assert.equal(mnogo.status, 400);
    assert.equal(mnogo.body.greska, 'Veličina nije ispravna za ovu kategoriju.');
  });

  test('izmjena: niz, validacija, izostavljeno ostaje staro, promjena kategorije briše neispravno', async () => {
    const n = await butik.objavi({ title: 'Za izmjenu', category: 'Haljine', sizes: 'S,M' });
    const id = n.body.oglas.id;
    const telo = { title: 'Za izmjenu', price: '65', category: 'Haljine' };
    const ok = await butik.patch(`/api/listings/${id}`, { ...telo, sizes: ['L', 'XS'] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.oglas.sizes, ['XS', 'L']);
    const staro = await butik.patch(`/api/listings/${id}`, telo);
    assert.deepEqual(staro.body.oglas.sizes, ['XS', 'L']);
    const prazno = await butik.patch(`/api/listings/${id}`, { ...telo, sizes: [] });
    assert.equal(prazno.status, 400);
    assert.equal(prazno.body.greska, 'Izaberi bar jednu veličinu.');
    for (const sizes of [['38'], ['Q'], 'M', 5, ['M', 1]]) {
      const r = await butik.patch(`/api/listings/${id}`, { ...telo, sizes });
      assert.equal(r.status, 400, JSON.stringify(sizes));
      assert.equal(r.body.greska, 'Veličina nije ispravna za ovu kategoriju.');
    }
    // Promjena kategorije bez veličina: staro (odjeća) ne vrijedi za obuću.
    const obuca = await butik.patch(`/api/listings/${id}`, { ...telo, category: 'Obuća' });
    assert.deepEqual(obuca.body.oglas.sizes, []);
    const torba = await butik.patch(`/api/listings/${id}`, { ...telo, category: 'Torbe' });
    assert.deepEqual(torba.body.oglas.sizes, ['UNI']);
    const tudji = await anon.patch(`/api/listings/${id}`, telo);
    assert.equal(tudji.status, 401);
  });

  test('filter sizes u /api/listings i /api/feed vraća oglase s tim veličinama', async () => {
    const m = await butik.objavi({ title: 'Filterm', category: 'Majice i košulje', sizes: 'M' });
    await butik.objavi({ title: 'Filterl', category: 'Majice i košulje', sizes: 'L' });
    const obuca = await butik.objavi({ title: 'Filtercipela', category: 'Obuća', sizes: '38' });
    const a = await anon.get('/api/listings?category=Majice%20i%20ko%C5%A1ulje&sizes=M');
    assert.deepEqual(a.body.oglasi.map((i) => i.id), [m.body.oglas.id]);
    const b = await anon.get('/api/listings?category=Majice%20i%20ko%C5%A1ulje&sizes=M,38');
    assert.ok(b.body.oglasi.every((i) => i.sizes.includes('M')));
    const c = await anon.get('/api/listings?sizes=M,38');
    const ids = c.body.oglasi.map((i) => i.id);
    assert.ok(ids.includes(m.body.oglas.id) && ids.includes(obuca.body.oglas.id));
    assert.ok(c.body.oglasi.every((i) => i.sizes.includes('M') || i.sizes.includes('38')));
    const d = await anon.get('/api/feed?kartica=novo&sizes=38');
    assert.ok(d.body.oglasi.map((i) => i.id).includes(obuca.body.oglas.id));
    assert.ok(d.body.oglasi.every((i) => i.sizes.includes('38')));
    const bez = await anon.get('/api/listings?sizes=ABC');
    assert.ok(bez.body.oglasi.length >= 4);
  });
});
