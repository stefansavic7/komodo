// P3 Butik: adresa i radno vrijeme (PATCH /api/me, SPEC-V1 F-05), profil butika i nepostojeći butik (U-02).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { noviButik, okolina } from './pomoc/okolina.mjs';

const GRESKA_SATI = 'Radno vrijeme upiši kao 09:00–20:00, a zatvaranje mora biti poslije otvaranja.';

describe('adresa i radno vrijeme butika', () => {
  let o;
  let butik;
  let shop;
  let kupac;
  before(async () => {
    o = await okolina();
    butik = await noviButik(o.baza, { butik: 'Sati Butik', email: 'sati@test.ba' });
    shop = o.klijent(); await shop.prijavi(butik.email, butik.password);
    kupac = o.klijent(); await kupac.registruj('sati.kupac@test.ba', 'Sati Kupac');
  });
  after(async () => { await o?.stop(); });

  test('upis adrese i radnog vremena; profil i /api/me ih vraćaju', async () => {
    const hours = { rd: ['09:00', '20:00'], sub: ['09:00', '15:00'], ned: null };
    const r = await shop.patch('/api/me', { address: '  Kralja Petra I 12 ', hours });
    assert.equal(r.status, 200);
    assert.equal(r.body.korisnik.address, 'Kralja Petra I 12');
    assert.deepEqual(r.body.korisnik.hours, hours);
    assert.equal(r.body.korisnik.name, 'Sati Butik', 'ostala polja ostaju');
    const me = (await shop.get('/api/me')).body.korisnik;
    assert.equal(me.address, 'Kralja Petra I 12');
    assert.deepEqual(me.hours, hours);
    const javni = (await o.klijent().get(`/api/shops/${butik.handle}`)).body.butik;
    assert.equal(javni.address, 'Kralja Petra I 12');
    assert.deepEqual(javni.hours, hours);
    assert.equal(javni.verified, true);
  });

  test('izmjena drugog polja ne briše adresu ni sate; nedostajući dan znači „ne radi”', async () => {
    const r = await shop.patch('/api/me', { name: 'Sati Butik 2' });
    assert.equal(r.body.korisnik.address, 'Kralja Petra I 12');
    assert.deepEqual(r.body.korisnik.hours.rd, ['09:00', '20:00']);
    const s = await shop.patch('/api/me', { hours: { rd: ['08:30', '16:00'] } });
    assert.deepEqual(s.body.korisnik.hours, { rd: ['08:30', '16:00'], sub: null, ned: null });
  });

  test('prazna adresa i hours:null brišu', async () => {
    const r = await shop.patch('/api/me', { address: '', hours: null });
    assert.equal(r.status, 200);
    assert.equal(r.body.korisnik.address, '');
    assert.equal(r.body.korisnik.hours, null);
    const javni = (await o.klijent().get(`/api/shops/${butik.handle}`)).body.butik;
    assert.equal(javni.address, '');
    assert.equal(javni.hours, null);
  });

  test('neispravno radno vrijeme → 400 s tekstom iz specifikacije', async () => {
    const loše = [
      { rd: ['20:00', '09:00'] },            // zatvaranje prije otvaranja
      { rd: ['09:00', '09:00'] },            // isto vrijeme
      { rd: ['9:00', '20:00'] },             // bez vodeće nule
      { rd: ['09:00', '24:00'] },            // nepostojeće vrijeme
      { rd: ['09:60', '20:00'] },
      { rd: ['09:00'] },                     // nepotpun par
      { rd: ['09:00', '20:00', '21:00'] },
      { rd: '09:00-20:00' },
      { rd: [9, 20] },
      { rd: [null, null] },
      { pon: ['09:00', '20:00'] },           // nepoznat ključ
      [], 'radi stalno', 5, true,
    ];
    for (const hours of loše) {
      const r = await shop.patch('/api/me', { hours });
      assert.equal(r.status, 400, JSON.stringify(hours));
      assert.equal(r.body.greska, GRESKA_SATI, JSON.stringify(hours));
    }
    assert.equal((await shop.get('/api/me')).body.korisnik.hours, null, 'ništa nije sačuvano');
  });

  test('adresa: najviše 120 znakova, mora biti tekst', async () => {
    const ok = await shop.patch('/api/me', { address: 'a'.repeat(120) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.korisnik.address.length, 120);
    const dugo = await shop.patch('/api/me', { address: 'a'.repeat(121) });
    assert.equal(dugo.status, 400);
    assert.equal(dugo.body.greska, 'Adresa može imati najviše 120 znakova.');
    for (const address of [123, ['x'], { a: 1 }, true]) {
      assert.equal((await shop.patch('/api/me', { address })).status, 400, JSON.stringify(address));
    }
    assert.equal((await shop.get('/api/me')).body.korisnik.address.length, 120);
    // Razmaci se sažimaju, a HTML se ne izvršava (klijent ga escapuje); upis je običan tekst.
    const t = await shop.patch('/api/me', { address: 'Ulica   <b>1</b>' });
    assert.equal(t.body.korisnik.address, 'Ulica <b>1</b>');
  });

  test('kupac: adresa i sati se ignorišu', async () => {
    const r = await kupac.patch('/api/me', { name: 'Sati Kupac 2', address: 'Neka ulica 1', hours: { rd: ['09:00', '10:00'] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.korisnik.name, 'Sati Kupac 2');
    assert.equal(r.body.korisnik.address, '');
    assert.equal(r.body.korisnik.hours, null);
    // Neispravni sati kupcu ne smetaju (polje se ne gleda).
    assert.equal((await kupac.patch('/api/me', { hours: 'x' })).status, 200);
  });

  test('bez prijave 401; tuđi Origin 403', async () => {
    assert.equal((await o.klijent().patch('/api/me', { address: 'x' })).status, 401);
    const r = await shop.patch('/api/me', { address: 'x' }, { headers: { origin: 'https://zlo.example' } });
    assert.equal(r.status, 403);
  });

  test('nepostojeći, ugašen i kupčev handle → 404 „Ovaj butik ne postoji.”', async () => {
    for (const handle of ['nema.ga', 'sati.kupac', 'x'.repeat(90)]) {
      const r = await o.klijent().get(`/api/shops/${handle}`);
      assert.equal(r.status, 404, handle.slice(0, 20));
      assert.equal(r.body.greska, 'Ovaj butik ne postoji.');
    }
    await o.baza.q("update users set suspended_at = now() where email = 'sati@test.ba'");
    assert.equal((await o.klijent().get(`/api/shops/${butik.handle}`)).status, 404);
    await o.baza.q("update users set suspended_at = null where email = 'sati@test.ba'");
    assert.equal((await o.klijent().get(`/api/shops/${butik.handle}`)).status, 200);
  });
});
