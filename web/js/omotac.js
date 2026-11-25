// Komodo web — Mobilni omotač (Expo WebView): toApp, push token i funkcije window.__komodo* koje zove aplikacija.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

function toApp(msg) {
  if (inApp) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
}

// Mobilna aplikacija predaje push token; serveru ga prijavljujemo kad je korisnik prijavljen.
function registerPush() {
  if (me && pushToken) { api('POST', '/api/me/push-token', { token: pushToken }).catch(function () {}); }
}
window.__komodoPush = function (token) { pushToken = token; registerPush(); };
window.__komodoOpenChat = function (id) {
  if (me) { openChat(id); } else { needLogin('Prijavi se da vidiš poruku.'); }
};
// Android dugme Nazad: zatvori prozor, vrati se na prethodni ekran ili javi da se aplikacija zatvara.
function closeOpenSheet() {
  var sheets = [[$('#confirmSheet'), closeConfirm], [postSheet, closePost], [editSheet, closeEdit], [reportSheet, closeReport], [moreSheet, closeMore], [contactSheet, closeContact], [buyerMoreSheet, closeBuyerMore], [searchSheet, closeSearch]];
  for (var k = 0; k < sheets.length; k++) { if (!sheets[k][0].hidden) { sheets[k][1](); return true; } }
  return false;
}
window.__komodoBack = function () {
  if (closeOpenSheet()) { return; }
  if (!chat.hidden) { show('inbox'); return; }
  if (!admin.hidden) { show('profile'); return; }
  if (!shopView.hidden || !inbox.hidden || !profile.hidden) { show('feed'); return; }
  if (shop) { $('#back').click(); return; }
  if (searchActive()) { clearSearch(); return; }
  toApp({ type: 'exit' });
};
$('#pushToggle').addEventListener('change', function () {
  var on = $('#pushToggle').checked;
  api('PATCH', '/api/me', { pushEnabled: on }).then(function (d) {
    me = d.korisnik;
    toast(on ? 'Obavještenja o porukama i sniženjima su uključena.' : 'Obavještenja o porukama i sniženjima su isključena.');
  }).catch(function (err) { $('#pushToggle').checked = !on; toast(err.message, true); });
});

// Link dok aplikacija radi (komodo:// ili https://komodo.ba/...): otvara ?o=, ?b=, ?poruke= bez ponovnog učitavanja.
// Sve ostalo (npr. /api/auth/verify) učita se puno, kao do sada. Funkcija iz start.js (openLink) se zove tek pri pozivu.
window.__komodoOpenUrl = function (path) {
  var u;
  try { u = new URL(String(path), location.origin); } catch (e) { return; }
  if (u.origin !== location.origin) { return; }
  if (u.pathname !== '/' || typeof openLink !== 'function') { location.href = u.pathname + u.search + u.hash; return; }
  closeOpenSheet();
  openLink(u.search, u.hash);
};

/* ---------- obavezna nadogradnja aplikacije ---------- */

// Poređenje verzija po brojevima: 1.10.0 > 1.9.0.
function versionLess(a, b) {
  var x = String(a).split('.'), y = String(b).split('.');
  for (var k = 0; k < Math.max(x.length, y.length); k++) {
    var p = parseInt(x[k], 10) || 0, q = parseInt(y[k], 10) || 0;
    if (p !== q) { return p < q; }
  }
  return false;
}
// R-03: pravi link prodavnice ili undefined. Bez znakova < > " ' i razmaka; App Store: apps.apple.com/[xx/]app/...,
// Google Play: play.google.com/store/apps/details?id=...
function validStoreUrl(u) {
  if (typeof u !== 'string' || /[<>"'\s]/.test(u)) { return undefined; }
  if (/^https:\/\/apps\.apple\.com\/([a-z]{2}\/)?app\/[A-Za-z0-9._~%\/-]+$/.test(u)) { return u; }
  if (/^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+(&[A-Za-z0-9._=%-]+)*$/.test(u)) { return u; }
  return undefined;
}
// Samo u omotaču (window.KOMODO_APP). Vraća Promise<true> ako je ova verzija aplikacije prestara i prikazan je blokirajući ekran.
function checkAppVersion() {
  var app = window.KOMODO_APP;
  if (!app || !app.version) { return Promise.resolve(false); }
  return fetch('/app-verzija.json', { credentials: 'omit' }).then(function (res) {
    return res.ok ? res.json() : null;
  }).then(function (cfg) {
    var rule = cfg && cfg[app.platform];
    if (!rule || !rule.min || !versionLess(app.version, rule.min)) { return false; }
    var url = validStoreUrl(rule.url);
    $('#updateGate').hidden = false;
    // R-03 / R2-04: neispravna adresa (npr. ostala je oznaka <APP_STORE_ID>) se nikad ne šalje; dugme ostaje i
    // šalje { type: 'update' } bez adrese, a omotač otvara svoju rezervnu adresu prodavnice (storeUrl u
    // mobile/App.js: market:// na Androidu, pretraga App Storea na iOS-u).
    $('#gateGo').onclick = function () { toApp(url ? { type: 'update', url: url } : { type: 'update' }); };
    $('#gateGo').focus();
    return true;
  }).catch(function () { return false; });
}
