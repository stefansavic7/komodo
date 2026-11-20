// P5, F-09 i U-15: GET /api/admin/stats, posao daily_stats (proces s KOMODO_JOBS=1), pretraga naloga (?q=).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina, pokreniApi } from './pomoc/okolina.mjs';

let o, admin, kupac, shop;

before(async () => {
  o = await okolina({ ADMIN_EMAILS: 'admin@test.ba', ADMIN_STATS_CACHE_MS: '0' });
  admin = o.klijent();
  await admin.registruj('admin@test.ba', 'Administrator');
  // Administrator mora imati potvrđen email (S-01).
  await o.baza.q("update users set email_verified_at = now() where email = 'admin@test.ba'");
  const bu = await noviButik(o.baza, { butik: 'Admin Butik', email: 'admin.butik@test.ba' });
  shop = o.klijent(); await shop.prijavi(bu.email, bu.password);
  kupac = o.klijent();
});
after(async () => { await o?.stop(); });

describe('GET /api/admin/stats', () => {
  test('ne-admin i neprijavljen dobijaju 404', async () => {
    assert.equal((await o.klijent().get('/api/admin/stats')).status, 404);
    assert.equal((await shop.get('/api/admin/stats')).status, 404);
  });

  test('prije posla: 30 stavki s nulama, ukupno iz baze, azurirano null', async () => {
    // Admin je potvrđen kasnije u before, pa mora ponovo biti prijavljen s važećim stanjem (keš prijava).
    await admin.prijavi('admin@test.ba');
    const r = await admin.get('/api/admin/stats');
    assert.equal(r.status, 200);
    const b = r.body.brojke;
    assert.equal(b.dani.length, 30);
    assert.ok(b.dani.every((d) => d.active === 0 && d.messages === 0 && d.registrations === 0));
    assert.equal(b.azurirano, null);
    assert.equal(b.ukupno.shops, 1);
    assert.equal(b.ukupno.users, 1);   // administrator je kupac
    assert.equal(b.ukupno.listings, 0);
    assert.ok(b.dani[0].day > b.dani[1].day, 'najnoviji prvi');
  });

  test('posao daily_stats: 3 kupca, 2 oglasa, poruke, pregledi → današnji red; brojke u odgovoru', async () => {
    for (let i = 0; i < 3; i += 1) await o.klijent().registruj(`admin.k${i}@test.ba`, `Admin K${i}`);
    const l1 = (await shop.objavi({ title: 'Brojka 1' })).body.oglas;
    await shop.objavi({ title: 'Brojka 2' });
    const k = o.klijent();
    await k.registruj('admin.poruka@test.ba', 'Poruka Kupac');
    const ids = (await o.baza.q("select id from users where email like 'admin.k_@test.ba' order by email")).rows.map((r) => r.id);
    const rz = await k.post('/api/conversations', { shop: (await shop.get('/api/me')).body.korisnik.handle, listingId: l1.id });
    const m = await k.post(`/api/conversations/${rz.body.razgovor}/messages`, { body: 'Zdravo' });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    await o.baza.q(`insert into listing_views(listing_id, viewer, day) values
      ($1,'u${ids[0]}',current_date),($1,'u${ids[1]}',current_date),($1,'dabc',current_date),($1,'u${ids[0]}',current_date-1)`, [l1.id]);

    const posao = await pokreniApi(o.baza, { KOMODO_JOBS: '1' });
    try { await posao.cekajLog(/daily_stats: \d{4}-\d{2}-\d{2}/, 20000); } finally { await posao.stop(); }

    const red = (await o.baza.q('select * from daily_stats where day = current_date')).rows[0];
    assert.equal(red.registrations, 5, '4 kupca iz testa + administrator');
    assert.equal(red.shops, 1);
    assert.equal(red.listings, 2);
    assert.equal(red.messages, 1);
    assert.equal(red.conversations, 1);
    assert.equal(red.active_users, 2);
    assert.equal(red.active_devices, 1);
    assert.equal(red.active, 3);
    const juce = (await o.baza.q('select * from daily_stats where day = current_date - 1')).rows[0];
    assert.equal(juce.active, 1);

    const b = (await admin.get('/api/admin/stats')).body.brojke;
    assert.equal(b.dani[0].registrations, 5);
    assert.equal(b.dani[0].listings, 2);
    assert.equal(b.dani[0].active, 3);
    assert.equal(b.dani[0].activeUsers, 2);
    assert.equal(b.dani[1].active, 1);
    assert.ok(b.azurirano);
    assert.equal(b.ukupno.listings, 2);
    assert.equal(b.ukupno.shops, 1);
  });

  test('ponovni posao ne udvostručuje (upsert) i računa obrisane oglase kao napravljene', async () => {
    await o.baza.q("update listings set deleted_at = now() where title = 'Brojka 2'");
    const posao = await pokreniApi(o.baza, { KOMODO_JOBS: '1' });
    try { await posao.cekajLog(/daily_stats: \d{4}-\d{2}-\d{2}/, 20000); } finally { await posao.stop(); }
    assert.equal((await o.baza.q('select count(*)::int as n from daily_stats')).rows[0].n, 2);
    assert.equal((await o.baza.q('select listings from daily_stats where day = current_date')).rows[0].listings, 2);
    assert.equal((await admin.get('/api/admin/stats')).body.brojke.ukupno.listings, 1);
  });
});

describe('GET /api/admin/users?q= (U-15)', () => {
  before(async () => {
    await o.klijent().registruj('pero.peric@test.ba', 'Pero Perić');
    await o.klijent().registruj('proc_50%@test.ba', 'Popust 50%');
    await o.klijent().registruj('procX50Y@test.ba', 'Običan Naziv');
  });
  const trazi = async (q) => (await admin.get(`/api/admin/users?q=${encodeURIComponent(q)}`)).body.nalozi.map((n) => n.email);

  test('ime i email, bez obzira na velika slova; bez q svi', async () => {
    assert.deepEqual(await trazi('PERO'), ['pero.peric@test.ba']);
    assert.deepEqual(await trazi('peric@test'), ['pero.peric@test.ba']);
    assert.ok((await trazi('')).length >= 8);
    assert.deepEqual(await trazi('nema-nikoga'), []);
  });

  test('% i _ su obični znakovi (escape)', async () => {
    assert.deepEqual(await trazi('%'), ['proc_50%@test.ba']);
    assert.deepEqual(await trazi('_50'), ['proc_50%@test.ba']);
    assert.deepEqual(await trazi('c_5'), ['proc_50%@test.ba']);
    assert.deepEqual(await trazi('50%'), ['proc_50%@test.ba']);
    assert.deepEqual(await trazi('\\'), []);
  });

  test('duže od 60 znakova se skraćuje; ne-admin 404', async () => {
    const r = await admin.get(`/api/admin/users?q=${'a'.repeat(500)}`);
    assert.equal(r.status, 200);
    assert.equal((await shop.get('/api/admin/users?q=a')).status, 404);
  });
});
