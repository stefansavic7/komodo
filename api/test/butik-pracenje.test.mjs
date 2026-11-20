// P3 Butik: praćenje butika (docs/SPEC-V1.md, F-04): idempotentnost, brojači, pravila, istovremenost,
// lista „Pratim” i brisanje naloga.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

describe('praćenje butika', () => {
  let o;
  let butik1;
  let butik2;
  let shop1;
  let shop2;
  let kupac;
  let anon;
  const brojaci = async (email) => (await o.baza.q(
    'select followers_count, following_count from users where email = $1', [email.toLowerCase()])).rows[0];
  const redovi = async () => Number((await o.baza.q('select count(*) from follows')).rows[0].count);

  before(async () => {
    o = await okolina();
    butik1 = await noviButik(o.baza, { butik: 'Pratnja Jedan', email: 'pratnja1@test.ba' });
    butik2 = await noviButik(o.baza, { butik: 'Pratnja Dva', email: 'pratnja2@test.ba' });
    shop1 = o.klijent(); await shop1.prijavi(butik1.email, butik1.password);
    shop2 = o.klijent(); await shop2.prijavi(butik2.email, butik2.password);
    kupac = o.klijent(); await kupac.registruj('pratilac@test.ba', 'Pratilac');
    anon = o.klijent();
  });
  after(async () => { await o?.stop(); });

  test('bez prijave 401; loš ulaz 400; nepostojeći butik 404', async () => {
    const r = await anon.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    assert.equal(r.status, 401);
    assert.equal(r.body.greska, 'Prijavi se da pratiš butik.');
    assert.equal((await anon.get('/api/me/follows')).status, 401);
    for (const tijelo of [{}, { following: 'true' }, { following: 1 }, { following: null }, []]) {
      const b = await kupac.post(`/api/shops/${butik1.handle}/follow`, tijelo);
      assert.equal(b.status, 400, JSON.stringify(tijelo));
      assert.equal(b.body.greska, 'Polje following mora biti true ili false.');
    }
    const bez = await kupac.zahtjev('POST', `/api/shops/${butik1.handle}/follow`);
    assert.equal(bez.status, 400, 'bez tijela');
    const nema = await kupac.post('/api/shops/nema.ga/follow', { following: true });
    assert.equal(nema.status, 404);
    assert.equal(nema.body.greska, 'Ovaj butik ne postoji.');
    // Kupac nije butik: ne može se pratiti.
    const drugiKupac = o.klijent();
    const dk = await drugiKupac.registruj('drugi.kupac@test.ba', 'Drugi Kupac');
    const kupacHandle = await kupac.post(`/api/shops/${dk.handle}/follow`, { following: true });
    assert.equal(kupacHandle.status, 404);
    assert.equal(await redovi(), 0);
  });

  test('prati, ponovno prati (idempotentno), otprati, ponovno otprati', async () => {
    const a = await kupac.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, { following: true, followers: 1 });
    const b = await kupac.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    assert.deepEqual(b.body, { following: true, followers: 1 });
    assert.equal((await brojaci(butik1.email)).followers_count, 1);
    assert.equal((await brojaci('pratilac@test.ba')).following_count, 1);
    // Veliko slovo u adresi ne smeta.
    const c = await kupac.post(`/api/shops/${butik1.handle.toUpperCase()}/follow`, { following: true });
    assert.equal(c.body.followers, 1);

    const profil = (await kupac.get(`/api/shops/${butik1.handle}`)).body.butik;
    assert.equal(profil.following, true);
    assert.equal(profil.followers, 1);
    assert.equal((await anon.get(`/api/shops/${butik1.handle}`)).body.butik.following, false);
    assert.equal((await kupac.get('/api/me')).body.korisnik.followingCount, 1);

    const d = await kupac.post(`/api/shops/${butik1.handle}/follow`, { following: false });
    assert.deepEqual(d.body, { following: false, followers: 0 });
    const e = await kupac.post(`/api/shops/${butik1.handle}/follow`, { following: false });
    assert.deepEqual(e.body, { following: false, followers: 0 });
    assert.deepEqual(await brojaci(butik1.email), { followers_count: 0, following_count: 0 });
    assert.equal((await kupac.get('/api/me')).body.korisnik.followingCount, 0);
    assert.equal(await redovi(), 0);
  });

  test('DELETE otpraćuje; ne može pratiti svoj butik; butik može pratiti drugi butik', async () => {
    await kupac.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    const del = await kupac.del(`/api/shops/${butik1.handle}/follow`);
    assert.deepEqual(del.body, { following: false, followers: 0 });
    const sebe = await shop1.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    assert.equal(sebe.status, 400);
    assert.equal(sebe.body.greska, 'Ne možeš pratiti svoj butik.');
    const drugi = await shop1.post(`/api/shops/${butik2.handle}/follow`, { following: true });
    assert.deepEqual(drugi.body, { following: true, followers: 1 });
    assert.equal((await shop1.get('/api/me')).body.korisnik.followingCount, 1);
    assert.equal((await brojaci(butik1.email)).followers_count, 0, 'tuđe praćenje ne dira moj broj pratilaca');
    await shop1.post(`/api/shops/${butik2.handle}/follow`, { following: false });
    assert.equal(await redovi(), 0);
  });

  test('GET /api/me/follows: novije prvo, polja po specifikaciji', async () => {
    const k = o.klijent(); await k.registruj('lista@test.ba', 'Lista');
    assert.deepEqual((await k.get('/api/me/follows')).body, { butici: [] });
    await o.baza.q("update users set address = 'Kralja Petra I 12' where email = $1", [butik2.email]);
    await shop2.objavi({ title: 'Lista haljina' });
    await k.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    await k.post(`/api/shops/${butik2.handle}/follow`, { following: true });
    const r = await k.get('/api/me/follows');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.butici.map((b) => b.handle), [butik2.handle, butik1.handle]);
    assert.deepEqual(r.body.butici[0], {
      handle: butik2.handle, shopName: 'Pratnja Dva', city: 'Banja Luka', address: 'Kralja Petra I 12', listings: 1,
    });
    assert.equal(r.body.butici[1].listings, 0);
    // Ugašen butik nestaje sa spiska.
    await o.baza.q("update users set suspended_at = now() where email = $1", [butik1.email]);
    assert.deepEqual((await k.get('/api/me/follows')).body.butici.map((b) => b.handle), [butik2.handle]);
    const ugasen = await k.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    assert.equal(ugasen.status, 404);
    await o.baza.q("update users set suspended_at = null where email = $1", [butik1.email]);
    await k.post(`/api/shops/${butik1.handle}/follow`, { following: false });
    await k.post(`/api/shops/${butik2.handle}/follow`, { following: false });
  });

  test('istovremeno: isti kupac 50× true daje 1 red; 40 kupaca daje 40 pratilaca', async () => {
    const k = o.klijent(); await k.registruj('istovremeno@test.ba', 'Istovremeno');
    const isti = await Promise.all(Array.from({ length: 50 }, () =>
      k.post(`/api/shops/${butik2.handle}/follow`, { following: true })));
    assert.ok(isti.every((r) => r.status === 200 && r.body.following === true), JSON.stringify(isti.map((r) => r.status)));
    assert.equal(await redovi(), 1);
    assert.equal((await brojaci(butik2.email)).followers_count, 1);
    assert.equal((await brojaci('istovremeno@test.ba')).following_count, 1);

    const ljudi = [];
    for (let i = 0; i < 40; i += 1) {
      const c = o.klijent();
      await c.registruj(`mnogo${i}@test.ba`, `Mnogo ${i}`);
      ljudi.push(c);
    }
    const sve = await Promise.all(ljudi.map((c) => c.post(`/api/shops/${butik2.handle}/follow`, { following: true })));
    assert.ok(sve.every((r) => r.status === 200));
    assert.equal(await redovi(), 41);
    assert.equal((await brojaci(butik2.email)).followers_count, 41);
    const mijesano = await Promise.all(ljudi.slice(0, 20).map((c) => c.post(`/api/shops/${butik2.handle}/follow`, { following: false })));
    assert.ok(mijesano.every((r) => r.status === 200));
    assert.equal(await redovi(), 21);
    assert.equal((await brojaci(butik2.email)).followers_count, 21);
    // Brojač je jednak broju redova za svakog korisnika.
    const razlike = await o.baza.q(`select u.id from users u
      where u.followers_count <> (select count(*) from follows f where f.shop_id = u.id)
         or u.following_count <> (select count(*) from follows f where f.user_id = u.id)`);
    assert.equal(razlike.rowCount, 0);
  });

  test('brisanje naloga kupca umanjuje brojače butika; brisanje butika umanjuje following_count pratilaca', async () => {
    const pocetni = (await brojaci(butik2.email)).followers_count;
    const k = o.klijent(); await k.registruj('brisi.me@test.ba', 'Brisi Me');
    await k.post(`/api/shops/${butik2.handle}/follow`, { following: true });
    await k.post(`/api/shops/${butik1.handle}/follow`, { following: true });
    assert.equal((await brojaci(butik2.email)).followers_count, pocetni + 1);
    const b1 = (await brojaci(butik1.email)).followers_count;
    const bad = await k.post('/api/me/delete', { password: 'pogresna' });
    assert.equal(bad.status, 400);
    assert.equal((await brojaci(butik2.email)).followers_count, pocetni + 1, 'pogrešna lozinka ništa ne mijenja');
    assert.equal((await k.post('/api/me/delete', { password: 'lozinka123' })).status, 200);
    assert.equal((await brojaci(butik2.email)).followers_count, pocetni);
    assert.equal((await brojaci(butik1.email)).followers_count, b1 - 1);

    // Butik koji ima pratioce se briše: njihov following_count pada.
    const p1 = o.klijent(); await p1.registruj('pratilac.a@test.ba', 'Pratilac A');
    const p2 = o.klijent(); await p2.registruj('pratilac.b@test.ba', 'Pratilac B');
    const stalni = (await o.baza.q("select id from users where email = 'istovremeno@test.ba'")).rows[0].id;
    for (const p of [p1, p2]) {
      await p.post(`/api/shops/${butik1.handle}/follow`, { following: true });
      await p.post(`/api/shops/${butik2.handle}/follow`, { following: true });
    }
    assert.equal((await brojaci('pratilac.a@test.ba')).following_count, 2);
    assert.equal((await shop1.post('/api/me/delete', { password: butik1.password })).status, 200);
    assert.equal((await brojaci('pratilac.a@test.ba')).following_count, 1);
    assert.equal((await brojaci('pratilac.b@test.ba')).following_count, 1);
    assert.equal((await p1.get('/api/me')).body.korisnik.followingCount, 1);
    assert.ok(stalni > 0);
    const razlike = await o.baza.q(`select u.id from users u
      where u.followers_count <> (select count(*) from follows f where f.shop_id = u.id)
         or u.following_count <> (select count(*) from follows f where f.user_id = u.id)`);
    assert.equal(razlike.rowCount, 0, 'brojači odgovaraju redovima');
  });

  test('granica od 500 praćenih i ograničenje 60 u minuti', async () => {
    const k = o.klijent(); await k.registruj('granica@test.ba', 'Granica');
    const id = (await o.baza.q("select id from users where email = 'granica@test.ba'")).rows[0].id;
    // 500 lažnih butika direktno u bazi (brže od 500 zahtjeva).
    await o.baza.q(`insert into users(email, password_hash, shop_name, handle, role)
                    select 'fb' || g || '@x.ba', 'x', 'Fb ' || g, 'fb' || g, 'butik' from generate_series(1, 501) g`);
    await o.baza.q(`insert into follows(user_id, shop_id)
                    select $1, id from users where handle like 'fb%' order by id limit 500`, [id]);
    await o.baza.q('update users set following_count = 500 where id = $1', [id]);
    const zadnji = (await o.baza.q("select handle from users where handle like 'fb%' order by id desc limit 1")).rows[0].handle;
    const r = await k.post(`/api/shops/${zadnji}/follow`, { following: true });
    assert.equal(r.status, 400);
    assert.equal(r.body.greska, 'Možeš pratiti najviše 500 butika.');
    // Već praćeni butik ostaje praćen (idempotentno) i može se otpratiti.
    const prvi = (await o.baza.q("select handle from users where handle like 'fb%' order by id limit 1")).rows[0].handle;
    assert.equal((await k.post(`/api/shops/${prvi}/follow`, { following: true })).status, 200);
    assert.equal((await k.post(`/api/shops/${prvi}/follow`, { following: false })).status, 200);
    assert.equal((await k.post(`/api/shops/${zadnji}/follow`, { following: true })).status, 200);
    assert.equal((await k.get('/api/me/follows')).body.butici.length, 500);

    // 429: jedan korisnik, više od 60 zahtjeva u minuti.
    let stao = null;
    for (let i = 0; i < 70; i += 1) {
      const t = await k.post(`/api/shops/${prvi}/follow`, { following: i % 2 === 0 });
      if (t.status === 429) { stao = t; break; }
    }
    assert.ok(stao, 'očekivan 429');
    assert.equal(stao.body.greska, 'Previše zahtjeva. Sačekaj minut.');
  });

  test('Origin s tuđeg sajta se odbija za praćenje', async () => {
    const r = await kupac.post(`/api/shops/${butik2.handle}/follow`, { following: true }, { headers: { origin: 'https://zlo.example' } });
    assert.equal(r.status, 403);
  });
  test('R2-06: praćenje butika koji se upravo briše → 404 „Ovaj butik ne postoji.”, ne 500', async () => {
    const b3 = await noviButik(o.baza, { butik: 'Pratnja Brisanje', email: 'pratnja3@test.ba' });
    // Brisanje naloga drži red butika zaključan do potvrde (kao POST /api/me/delete); praćenje čeka na tom redu.
    const c = await o.baza.pool.connect();
    try {
      await c.query('begin');
      await c.query('delete from users where email = $1', [b3.email]);
      const zahtjev = kupac.post(`/api/shops/${b3.handle}/follow`, { following: true });
      // Upis mora stvarno čekati na zaključanom redu prije potvrde brisanja.
      for (let k = 0; k < 100; k += 1) {
        const w = await o.baza.q("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()");
        if (w.rows[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await c.query('commit');
      const r = await zahtjev;
      assert.equal(r.status, 404, JSON.stringify(r.body));
      assert.equal(r.body.greska, 'Ovaj butik ne postoji.');
    } finally {
      c.release();
    }
    // Sesija kupca i dalje važi.
    assert.equal((await kupac.get('/api/me')).status, 200);
  });
});
