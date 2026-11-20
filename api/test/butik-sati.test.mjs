// P3 Butik: računanje statusa radnog vremena (SPEC-V1 F-05, kriterij 2) s fiksnim vremenom.
// Funkcije su u web/js/butik.js između oznaka „>>> radno-vrijeme” i „<<< radno-vrijeme” (čista logika bez DOM-a);
// ovdje se izvlače i izvršavaju u Nodeu.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FAJL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'js', 'butik.js');
const izvor = await readFile(FAJL, 'utf8');
const a = izvor.indexOf('/* >>> radno-vrijeme');
const b = izvor.indexOf('/* <<< radno-vrijeme */');
assert.ok(a > 0 && b > a, 'oznake radno-vrijeme nisu nađene u web/js/butik.js');
const { hoursStatus, hoursFull, sinceText, butikMnozina } = new Function(
  `'use strict';${izvor.slice(a, b)}; return { hoursStatus, hoursFull, sinceText, butikMnozina };`)();

// Trenutak zadan po sarajevskom satu: zima je UTC+1, ljeto UTC+2.
const zima = (dan, sat, min) => new Date(Date.UTC(2026, 10, dan, sat - 1, min));   // novembar 2026.
const ljeto = (dan, sat, min) => new Date(Date.UTC(2026, 6, dan, sat - 2, min));   // juli 2026.
// 16.11.2026. je ponedjeljak, 19. četvrtak, 20. petak, 21. subota, 22. nedjelja.
const SATI = { rd: ['09:00', '20:00'], sub: ['09:00', '15:00'], ned: null };

test('19:59 radnim danom → „Otvoreno do 20:00”', () => {
  assert.deepEqual(hoursStatus(SATI, zima(19, 19, 59)), { open: true, text: 'Otvoreno do 20:00' });
});
test('tačno u 20:00 → zatvoreno, otvara sutra u 09:00 (pon–čet)', () => {
  assert.deepEqual(hoursStatus(SATI, zima(19, 20, 0)), { open: false, text: 'Zatvoreno · otvara sutra u 09:00' });
});
test('tačno u 09:00 → otvoreno; u 08:59 → otvara u 09:00 istog dana', () => {
  assert.equal(hoursStatus(SATI, zima(19, 9, 0)).open, true);
  assert.deepEqual(hoursStatus(SATI, zima(19, 8, 59)), { open: false, text: 'Zatvoreno · otvara u 09:00' });
});
test('petak 20:00 uz subotu „ne radi” → otvara u ponedjeljak u 09:00', () => {
  const bezSubote = { rd: ['09:00', '20:00'], sub: null, ned: null };
  assert.deepEqual(hoursStatus(bezSubote, zima(20, 20, 0)), { open: false, text: 'Zatvoreno · otvara u ponedjeljak u 09:00' });
});
test('subota poslije zatvaranja, nedjelja ne radi → ponedjeljak', () => {
  assert.deepEqual(hoursStatus(SATI, zima(21, 15, 0)), { open: false, text: 'Zatvoreno · otvara u ponedjeljak u 09:00' });
  assert.deepEqual(hoursStatus(SATI, zima(22, 12, 0)), { open: false, text: 'Zatvoreno · otvara sutra u 09:00' });
});
test('petak 20:00 uz otvorenu subotu → sutra', () => {
  assert.deepEqual(hoursStatus(SATI, zima(20, 20, 0)), { open: false, text: 'Zatvoreno · otvara sutra u 09:00' });
});
test('nazivi dana u zahtjevnom padežu', () => {
  const samoUtorak = { rd: null, sub: null, ned: ['10:00', '12:00'] };
  assert.equal(hoursStatus(samoUtorak, zima(19, 12, 0)).text, 'Zatvoreno · otvara u nedjelju u 10:00');
  const samoSubota = { rd: null, sub: ['09:00', '15:00'], ned: null };
  assert.equal(hoursStatus(samoSubota, zima(16, 12, 0)).text, 'Zatvoreno · otvara u subotu u 09:00');
  assert.equal(hoursStatus({ rd: ['09:00', '20:00'], sub: null, ned: null }, zima(21, 10, 0)).text, 'Zatvoreno · otvara u ponedjeljak u 09:00');
  // Sedmica poslije: danas je subota poslije zatvaranja, a radi samo subotom.
  assert.equal(hoursStatus(samoSubota, zima(21, 16, 0)).text, 'Zatvoreno · otvara u subotu u 09:00');
});
test('sarajevska zona: UTC trenutak se računa po lokalnom satu, i ljeti (UTC+2)', () => {
  // 18:59 UTC u novembru je 19:59 u Sarajevu.
  assert.equal(hoursStatus(SATI, new Date('2026-11-19T18:59:00Z')).text, 'Otvoreno do 20:00');
  assert.equal(hoursStatus(SATI, new Date('2026-11-19T19:00:00Z')).open, false);
  // Ljeti je 17:59 UTC = 19:59 u Sarajevu.
  assert.equal(hoursStatus(SATI, new Date('2026-07-15T17:59:00Z')).text, 'Otvoreno do 20:00');
  assert.equal(hoursStatus(SATI, ljeto(15, 20, 0)).open, false);
  // Kasno uvečer po UTC-u je već sutra u Sarajevu: 22:30 UTC u četvrtak = 23:30 u četvrtak; 23:30 UTC = 00:30 u petak.
  assert.equal(hoursStatus(SATI, new Date('2026-11-19T23:30:00Z')).text, 'Zatvoreno · otvara u 09:00');
  assert.equal(hoursStatus({ rd: ['09:00', '20:00'], sub: null, ned: null }, new Date('2026-11-20T23:30:00Z')).text, 'Zatvoreno · otvara u ponedjeljak u 09:00', 'subota 00:30 u Sarajevu');
});
test('bez radnog vremena nema statusa; svi dani „ne radi” → „Zatvoreno”', () => {
  assert.equal(hoursStatus(null, zima(19, 12, 0)), null);
  assert.equal(hoursStatus(undefined, zima(19, 12, 0)), null);
  assert.deepEqual(hoursStatus({ rd: null, sub: null, ned: null }, zima(19, 12, 0)), { open: false, text: 'Zatvoreno' });
});
test('puno radno vrijeme', () => {
  assert.equal(hoursFull(SATI), 'Pon–pet 09:00–20:00 · Subota 09:00–15:00 · Nedjelja ne radi');
  assert.equal(hoursFull({ rd: ['08:00', '16:00'], sub: null, ned: ['10:00', '12:00'] }),
    'Pon–pet 08:00–16:00 · Subota ne radi · Nedjelja 10:00–12:00');
});
test('„na Komodu od” i množina', () => {
  assert.equal(sinceText('2026-11-19T10:00:00Z'), 'novembra 2026.');
  assert.equal(sinceText('2027-03-01T10:00:00Z'), 'marta 2027.');
  assert.equal(sinceText('2026-12-31T23:30:00Z'), 'januara 2027.', 'po sarajevskom vremenu je već januar');
  const oblici = (n) => butikMnozina(n, 'pratilac', 'pratioca', 'pratilaca');
  assert.deepEqual([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map(oblici), [
    'pratilaca', 'pratilac', 'pratioca', 'pratioca', 'pratilaca', 'pratilaca', 'pratilaca', 'pratilaca',
    'pratilac', 'pratioca', 'pratilaca', 'pratilac', 'pratilaca', 'pratilaca']);
});
