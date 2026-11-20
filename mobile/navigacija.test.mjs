import test from 'node:test';
import assert from 'node:assert/strict';
import nav from './navigacija.js';

const APP = 'https://komodo.ba';

test('deep linkovi', () => {
  assert.equal(nav.toAppUrl('komodo://o/123', APP), 'https://komodo.ba/?o=123');
  assert.equal(nav.toAppUrl('komodo://b/ime-butika', APP), 'https://komodo.ba/?b=ime-butika');
  assert.equal(nav.toAppUrl('komodo://poruke/45', APP), 'https://komodo.ba/?poruke=45');
  assert.equal(nav.toAppUrl('komodo:///?o=7', APP), 'https://komodo.ba/?o=7');
  assert.equal(nav.toAppUrl('komodo://api/auth/verify?t=abc', APP), 'https://komodo.ba/api/auth/verify?t=abc');
  assert.equal(nav.toAppUrl('komodo://o/1%202', APP), 'https://komodo.ba/');
  assert.equal(nav.toAppUrl('https://komodo.ba/?o=9', APP), 'https://komodo.ba/?o=9');
  assert.equal(nav.toAppUrl('https://www.komodo.ba/?b=x', APP), 'https://www.komodo.ba/?b=x');
  assert.equal(nav.toAppUrl('https://komodo.ba.evil.com/?o=9', APP), null);
  assert.equal(nav.toAppUrl('https://instagram.com/x', APP), null);
  assert.equal(nav.toAppUrl(null, APP), null);
});

test('putanja za __komodoOpenUrl', () => {
  assert.equal(nav.pathWithQuery('https://komodo.ba/?o=123'), '/?o=123');
  assert.equal(nav.pathWithQuery('https://komodo.ba?o=123'), '/?o=123');
  assert.equal(nav.pathWithQuery('https://komodo.ba'), '/');
  assert.equal(nav.pathWithQuery('https://komodo.ba/api/auth/verify?t=1'), '/api/auth/verify?t=1');
});

test('zasebne stranice', () => {
  assert.equal(nav.isStandalonePage('https://komodo.ba/uslovi.html'), true);
  assert.equal(nav.isStandalonePage('https://komodo.ba/index.html'), false);
  assert.equal(nav.isStandalonePage('https://komodo.ba/?o=1'), false);
});

test('rutiranje obavještenja', () => {
  assert.deepEqual(nav.routeNotification({ listingId: 55 }), { kind: 'listing', id: '55' });
  assert.deepEqual(nav.routeNotification({ listingId: '55' }), { kind: 'listing', id: '55' });
  assert.deepEqual(nav.routeNotification({ conversationId: 7 }), { kind: 'chat', id: '7' });
  assert.deepEqual(nav.routeNotification({ listingId: 5, conversationId: 7 }), { kind: 'listing', id: '5' });
  assert.equal(nav.routeNotification({ listingId: 'x; alert(1)' }), null);
  assert.equal(nav.routeNotification({ conversationId: '1/../2' }), null);
  assert.equal(nav.routeNotification({}), null);
  assert.equal(nav.routeNotification(undefined), null);
});

test('adresa za hladan start', () => {
  assert.equal(nav.routeToUrl({ kind: 'listing', id: '55' }, APP + '/'), 'https://komodo.ba/?o=55');
  assert.equal(nav.routeToUrl({ kind: 'chat', id: '7' }, APP), 'https://komodo.ba/?poruke=7');
  assert.equal(nav.routeToUrl(null, APP), null);
});

test('baner u prvom planu', () => {
  assert.equal(nav.shouldShowBanner({ conversationId: 7 }, '7', true), false);   // otvoren isti razgovor
  assert.equal(nav.shouldShowBanner({ conversationId: 7 }, 7, true), false);
  assert.equal(nav.shouldShowBanner({ conversationId: 8 }, '7', true), true);    // drugi razgovor
  assert.equal(nav.shouldShowBanner({ conversationId: 7 }, null, true), true);   // nijedan nije otvoren
  assert.equal(nav.shouldShowBanner({ conversationId: 7 }, '7', false), true);   // aplikacija nije aktivna
  assert.equal(nav.shouldShowBanner({ listingId: 7 }, '7', true), true);         // sniženje uvijek
  assert.equal(nav.shouldShowBanner(undefined, '7', true), true);
});
