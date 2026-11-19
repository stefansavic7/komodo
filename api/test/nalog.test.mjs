// Nalog: registracija, prijava, odjava, potvrda emaila, zaboravljena lozinka, profil, lozinka, brisanje.
// API radi s „podešenim emailom” (lažni SMTP), pa se tokeni čitaju iz poslanih emailova.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Klijent, LOZINKA, noviButik, okolina } from './pomoc/okolina.mjs';
import { lazniSmtp } from './pomoc/smtp.mjs';

let o;
let smtp;
let butik;

before(async () => {
  smtp = await lazniSmtp();
  o = await okolina({ SMTP_URL: smtp.url });
  butik = await noviButik(o.baza, { butik: 'Butik Nalog', email: 'butik.nalog@test.ba', telefon: '065 111 222' });
});
after(async () => {
  await o?.stop();
  await smtp?.close();
});

describe('registracija', () => {
  test('novi kupac dobija sesiju, ulogu kupac i nepotvrđen email', async () => {
    const k = o.klijent();
    const r = await k.post('/api/auth/register', { email: 'Ana@Test.ba', password: LOZINKA, name: 'Ana Anić' });
    assert.equal(r.status, 201);
    assert.equal(r.body.korisnik.email, 'ana@test.ba');
    assert.equal(r.body.korisnik.role, 'kupac');
    assert.equal(r.body.korisnik.verified, false);
    assert.equal(r.body.korisnik.admin, false);
    assert.ok(k.cookies.get('sid'), 'postavljen kolačić sid');
    assert.ok(k.cookies.get('did'), 'postavljen kolačić did');
    const me = await k.get('/api/me');
    assert.equal(me.body.korisnik.email, 'ana@test.ba');
    assert.equal(me.body.neprocitano, 0);
  });

  test('isti email (bilo koja veličina slova) daje 409', async () => {
    const r = await o.klijent().post('/api/auth/register', { email: 'ANA@test.ba', password: LOZINKA, name: 'Druga Ana' });
    assert.equal(r.status, 409);
    assert.match(r.body.greska, /već postoji/);
  });

  test('neispravni podaci daju 400 s porukom', async () => {
    const k = o.klijent();
    for (const [body, poruka] of [
      [{ email: 'nije-email', password: LOZINKA, name: 'Ime' }, /email/],
      [{ email: 'kratka@test.ba', password: 'kratka', name: 'Ime' }, /8 znakova/],
      [{ email: 'bezimena@test.ba', password: LOZINKA, name: 'A' }, /ime/],
      [{}, /email/],
    ]) {
      const r = await k.post('/api/auth/register', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.body.greska, poruka);
    }
  });

  test('isto ime dvaput daje različite handle-ove', async () => {
    const a = await o.klijent().registruj('isto1@test.ba', 'Isto Ime');
    const b = await o.klijent().registruj('isto2@test.ba', 'Isto Ime');
    assert.notEqual(a.handle, b.handle);
  });

  test('ograničenje: šesta registracija s istog uređaja u satu daje 429', async () => {
    const k = o.klijent();
    for (let n = 0; n < 5; n += 1) await k.registruj(`uredjaj${n}@test.ba`, `Uređaj ${n}`);
    const r = await k.post('/api/auth/register', { email: 'uredjaj5@test.ba', password: LOZINKA, name: 'Uređaj 5' });
    assert.equal(r.status, 429);
  });
});

describe('potvrda emaila', () => {
  test('link iz emaila (#potvrda=) potvrđuje nalog preko POST /api/auth/verify, token radi samo jednom', async () => {
    const k = o.klijent();
    await k.registruj('potvrda@test.ba', 'Potvrda');
    const token = await smtp.cekaj('potvrda@test.ba', /#potvrda=([a-f0-9]+)/);
    assert.equal((await k.get('/api/me')).body.korisnik.verified, false);
    const r = await k.post('/api/auth/verify', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    assert.equal((await k.get('/api/me')).body.korisnik.verified, true);
    const again = await k.post('/api/auth/verify', { token });
    assert.equal(again.status, 400);
    assert.ok(again.body.greska);
    assert.equal((await o.klijent().post('/api/auth/verify', { token: 'nepostojeci' })).status, 400);
    assert.equal((await o.klijent().post('/api/auth/verify', {})).status, 400);
  });

  test('stari link GET /api/auth/verify?token= i dalje preusmjerava, i on važi samo jednom', async () => {
    const k = o.klijent();
    await k.registruj('stari.link@test.ba', 'Stari Link');
    const token = await smtp.cekaj('stari.link@test.ba', /#potvrda=([a-f0-9]+)/);
    const r = await k.get(`/api/auth/verify?token=${token}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/?potvrda=ok');
    assert.equal((await k.get('/api/me')).body.korisnik.verified, true);
    const again = await k.get(`/api/auth/verify?token=${token}`);
    assert.equal(again.status, 302);
    assert.equal(again.headers.get('location'), '/?potvrda=istekla');
    // Token potrošen starim linkom ne radi ni na novom putu.
    assert.equal((await k.post('/api/auth/verify', { token })).status, 400);
  });

  test('nepotvrđen kupac ne može slati poruke (403), potvrđen može', async () => {
    const k = o.klijent();
    await k.registruj('nepotvrdjen@test.ba', 'Nepotvrđen');
    const conv = await k.post('/api/conversations', { shop: butik.handle });
    assert.equal(conv.status, 200);
    const msg = await k.post(`/api/conversations/${conv.body.razgovor}/messages`, { body: 'Zdravo' });
    assert.equal(msg.status, 403);
    assert.match(msg.body.greska, /Potvrdi email/);
    const token = await smtp.cekaj('nepotvrdjen@test.ba', /#potvrda=([a-f0-9]+)/);
    assert.equal((await k.post('/api/auth/verify', { token })).status, 200);
    const ok = await k.post(`/api/conversations/${conv.body.razgovor}/messages`, { body: 'Zdravo' });
    assert.equal(ok.status, 201);
  });

  test('ponovno slanje linka: novi email, četvrti put u satu 429', async () => {
    const k = o.klijent();
    await k.registruj('ponovo@test.ba', 'Ponovo');
    await smtp.cekaj('ponovo@test.ba', /#potvrda=/);
    const prije = smtp.poruke.filter((p) => p.to.includes('ponovo@test.ba')).length;
    for (let n = 0; n < 3; n += 1) assert.equal((await k.post('/api/auth/resend')).status, 200);
    const end = Date.now() + 3000;
    while (smtp.poruke.filter((p) => p.to.includes('ponovo@test.ba')).length < prije + 3 && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(smtp.poruke.filter((p) => p.to.includes('ponovo@test.ba')).length, prije + 3);
    assert.equal((await k.post('/api/auth/resend')).status, 429);
    assert.equal((await o.klijent().post('/api/auth/resend')).status, 401);
  });
});

describe('prijava i odjava', () => {
  test('pogrešna lozinka i nepostojeći nalog daju istu poruku (401)', async () => {
    await o.klijent().registruj('prijava@test.ba', 'Prijava');
    const a = await o.klijent().post('/api/auth/login', { email: 'prijava@test.ba', password: 'pogresna1' });
    const b = await o.klijent().post('/api/auth/login', { email: 'nema.ga@test.ba', password: 'pogresna1' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.greska, b.body.greska);
  });

  test('prijava, pa odjava poništava sesiju (i stari kolačić više ne radi)', async () => {
    const k = o.klijent();
    const u = await k.prijavi('prijava@test.ba');
    assert.equal(u.email, 'prijava@test.ba');
    const sid = k.cookies.get('sid');
    assert.equal((await k.get('/api/me')).body.korisnik.email, 'prijava@test.ba');
    const out = await k.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal(k.cookies.has('sid'), false, 'kolačić sid je obrisan');
    assert.equal((await k.get('/api/me')).body.korisnik, null);
    const stari = new Klijent(o.url);
    stari.cookies.set('sid', sid);
    assert.equal((await stari.get('/api/me')).body.korisnik, null);
  });

  test('butik otvoren skriptom se prijavljuje privremenom lozinkom', async () => {
    const k = o.klijent();
    const u = await k.prijavi(butik.email, butik.password);
    assert.equal(u.role, 'butik');
    assert.equal(u.verified, true);
    assert.equal(u.handle, butik.handle);
  });

  test('ograničenje: poslije 10 pogrešnih pokušaja i tačna lozinka daje 429', async () => {
    await o.klijent().registruj('zakljucan@test.ba', 'Zaključan');
    const k = o.klijent();
    for (let n = 0; n < 10; n += 1) {
      assert.equal((await k.post('/api/auth/login', { email: 'zakljucan@test.ba', password: 'pogresna1' })).status, 401);
    }
    const r = await k.post('/api/auth/login', { email: 'zakljucan@test.ba', password: LOZINKA });
    assert.equal(r.status, 429);
  });
});

describe('zaboravljena lozinka', () => {
  test('nepostojeća adresa: isti odgovor, bez emaila', async () => {
    const r = await o.klijent().post('/api/auth/forgot', { email: 'niko@test.ba' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(smtp.poruke.some((p) => p.to.includes('niko@test.ba')), false);
  });

  test('link iz emaila postavlja novu lozinku, gasi stare sesije i prijavljuje', async () => {
    const stari = o.klijent();
    await stari.registruj('zaboravio@test.ba', 'Zaboravio');
    const r = await o.klijent().post('/api/auth/forgot', { email: 'zaboravio@test.ba' });
    assert.equal(r.status, 200);
    const token = await smtp.cekaj('zaboravio@test.ba', /#lozinka=([a-f0-9]+)/);
    const k = o.klijent();
    assert.equal((await k.post('/api/auth/reset', { token, password: 'kratka' })).status, 400);
    assert.equal((await k.post('/api/auth/reset', { token: 'abc123', password: 'novalozinka1' })).status, 400);
    const ok = await k.post('/api/auth/reset', { token, password: 'novalozinka1' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.korisnik.email, 'zaboravio@test.ba');
    assert.equal(ok.body.korisnik.verified, true, 'reset potvrđuje email');
    assert.equal((await k.get('/api/me')).body.korisnik.email, 'zaboravio@test.ba');
    assert.equal((await stari.get('/api/me')).body.korisnik, null, 'stara sesija je ugašena');
    assert.equal((await o.klijent().post('/api/auth/login', { email: 'zaboravio@test.ba', password: LOZINKA })).status, 401);
    await o.klijent().prijavi('zaboravio@test.ba', 'novalozinka1');
    assert.equal((await k.post('/api/auth/reset', { token, password: 'jos1novija' })).status, 400, 'token se koristi jednom');
  });

  test('ograničenje: četvrti zahtjev za istu adresu u satu daje 429', async () => {
    const k = o.klijent();
    for (let n = 0; n < 3; n += 1) assert.equal((await k.post('/api/auth/forgot', { email: 'cesto@test.ba' })).status, 200);
    assert.equal((await k.post('/api/auth/forgot', { email: 'cesto@test.ba' })).status, 429);
  });
});

describe('profil (/api/me)', () => {
  test('bez sesije: korisnik null, izmjena 401', async () => {
    const k = o.klijent();
    assert.deepEqual((await k.get('/api/me')).body, { korisnik: null, neprocitano: 0 });
    assert.equal((await k.patch('/api/me', { name: 'Neko' })).status, 401);
  });

  test('kupac mijenja ime; telefon i linkovi kupca se ne upisuju', async () => {
    const k = o.klijent();
    await k.registruj('profil@test.ba', 'Profil');
    const r = await k.patch('/api/me', { name: 'Novo Ime', phone: '065 999 999', links: ['instagram.com/x'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.korisnik.name, 'Novo Ime');
    assert.equal(r.body.korisnik.phone, '');
    assert.deepEqual(r.body.korisnik.links, []);
    assert.equal((await k.get('/api/me')).body.korisnik.name, 'Novo Ime');
    assert.equal((await k.patch('/api/me', { name: 'X' })).status, 400);
  });

  test('butik mijenja telefon i linkove; neispravni se odbijaju', async () => {
    const k = o.klijent();
    await k.prijavi(butik.email, butik.password);
    const r = await k.patch('/api/me', { phone: '065 123 456', links: ['instagram.com/butik', 'https://fb.com/butik'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.korisnik.phone, '065 123 456');
    assert.deepEqual(r.body.korisnik.links, ['https://instagram.com/butik', 'https://fb.com/butik']);
    const javno = await o.klijent().get(`/api/shops/${butik.handle}`);
    assert.equal(javno.body.butik.phone, '065 123 456');
    assert.equal((await k.patch('/api/me', { phone: 'zovi me' })).status, 400);
    assert.equal((await k.patch('/api/me', { links: ['javascript:alert(1)'] })).status, 400);
    assert.equal((await k.patch('/api/me', { links: ['a.ba', 'b.ba', 'c.ba', 'd.ba', 'e.ba', 'f.ba'] })).status, 400);
    assert.equal((await k.patch('/api/me', { pushEnabled: false })).body.korisnik.pushEnabled, false);
  });

  test('promjena lozinke: provjera trenutne, ostale sesije se gase, ova ostaje', async () => {
    const k = o.klijent();
    await k.registruj('lozinka@test.ba', 'Lozinka');
    const drugi = o.klijent();
    await drugi.prijavi('lozinka@test.ba');
    assert.equal((await k.post('/api/me/password', { current: 'pogresna1', next: 'novalozinka1' })).status, 400);
    assert.equal((await k.post('/api/me/password', { current: LOZINKA, next: 'kratka' })).status, 400);
    assert.equal((await k.post('/api/me/password', { current: LOZINKA, next: 'novalozinka1' })).status, 200);
    assert.equal((await k.get('/api/me')).body.korisnik.email, 'lozinka@test.ba');
    assert.equal((await drugi.get('/api/me')).body.korisnik, null);
    await o.klijent().prijavi('lozinka@test.ba', 'novalozinka1');
    assert.equal((await o.klijent().post('/api/me/password', { current: LOZINKA, next: 'x12345678' })).status, 401);
  });
});

describe('brisanje naloga', () => {
  test('kupac briše nalog: traži lozinku, sviđanja nestaju i likes_count se vraća', async () => {
    const b = o.klijent();
    await b.prijavi(butik.email, butik.password);
    const oglas = (await b.objavi({ title: 'Za brisanje naloga' })).body.oglas;
    const k = o.klijent();
    await k.registruj('brisem@test.ba', 'Brišem');
    const drugi = o.klijent();
    await drugi.registruj('ostajem@test.ba', 'Ostajem');
    await k.post(`/api/listings/${oglas.id}/like`, { liked: true });
    await drugi.post(`/api/listings/${oglas.id}/like`, { liked: true });
    assert.equal((await b.get(`/api/listings/${oglas.id}`)).body.oglas.likes, 2);

    assert.equal((await k.post('/api/me/delete', { password: 'pogresna1' })).status, 400);
    const r = await k.post('/api/me/delete', { password: LOZINKA });
    assert.equal(r.status, 200);
    assert.equal((await k.get('/api/me')).body.korisnik, null);
    assert.equal((await b.get(`/api/listings/${oglas.id}`)).body.oglas.likes, 1);
    const red = await o.baza.q('select likes_count, (select count(*)::int from likes where listing_id = $1) as n from listings where id = $1', [oglas.id]);
    assert.equal(red.rows[0].likes_count, red.rows[0].n);
    assert.equal((await o.klijent().post('/api/auth/login', { email: 'brisem@test.ba', password: LOZINKA })).status, 401);
    // Email je ponovo slobodan.
    await o.klijent().registruj('brisem@test.ba', 'Brišem Opet');
  });

  test('butik briše nalog: oglasi i profil nestaju', async () => {
    const drugiButik = await noviButik(o.baza, { butik: 'Butik Za Brisanje', email: 'butik.brisanje@test.ba' });
    const b = o.klijent();
    await b.prijavi(drugiButik.email, drugiButik.password);
    const oglas = (await b.objavi({ title: 'Nestaje s butikom' })).body.oglas;
    assert.equal((await b.post('/api/me/delete', { password: drugiButik.password })).status, 200);
    const k = o.klijent();
    assert.equal((await k.get(`/api/listings/${oglas.id}`)).status, 404);
    assert.equal((await k.get(`/api/shops/${drugiButik.handle}`)).status, 404);
  });

  test('bez sesije: 401', async () => {
    assert.equal((await o.klijent().post('/api/me/delete', { password: LOZINKA })).status, 401);
  });
});
