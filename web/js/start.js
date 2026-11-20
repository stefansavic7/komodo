// Komodo web — Start: čita parametre iz adrese (?o=, ?b=, ?poruke=, #lozinka=, #potvrda=, stari ?lozinka= i ?potvrda=) i otvara prvi ekran. Mora biti zadnji.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- parametri iz adrese ---------- */

var TOKEN_RE = /^[a-f0-9]{20,100}$/;
// Tokeni iz emaila stižu u fragmentu (#lozinka=TOKEN, #potvrda=TOKEN) da ne uđu u dnevnik servera ni u Referer;
// stari linkovi s upitom (?lozinka=TOKEN) i dalje rade. ?potvrda=ok|istekla je odgovor servera poslije potvrde.
function readLink(search, hash) {
  var q = new URLSearchParams(search), h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  var rawReset = h.get('lozinka') || q.get('lozinka') || '';
  var rawConfirm = h.get('potvrda') || q.get('potvrda') || '';
  return {
    o: /^\d+$/.test(q.get('o') || '') ? q.get('o') : null,
    b: q.get('b'),
    poruke: /^\d+$/.test(q.get('poruke') || '') ? q.get('poruke') : null,
    reset: TOKEN_RE.test(rawReset) ? rawReset : null,
    confirmToken: TOKEN_RE.test(rawConfirm) ? rawConfirm : null,
    confirmStatus: (rawConfirm === 'ok' || rawConfirm === 'istekla') ? rawConfirm : null,
    // Tajne i jednokratne stvari se brišu iz adrese odmah, bez obzira na ispravnost tokena.
    secret: !!(rawReset || rawConfirm || q.get('poruke'))
  };
}
// Potvrda emaila: token iz #potvrda= se šalje POST-om (POST /api/auth/verify {token}); 200 {ok:true} → 'ok',
// 400 i 429 → {greska: poruka iz odgovora}. Starija stranica ?potvrda=ok|istekla dolazi kao gotov ishod.
function confirmEmail(token) {
  return api('POST', '/api/auth/verify', { token: token }).then(function () { return 'ok'; }, function (err) {
    return { greska: err.message };
  });
}
function toastConfirm(status) {
  if (status === 'ok') { toast('Email je potvrđen.'); }
  else if (status === 'istekla') { toast('Link za potvrdu je istekao ili je već iskorišten. Novi tražiš u profilu.', true); }
  else if (status && status.greska) { toast(status.greska, true); }
}
// Otvara ono na što link upućuje. fresh = prvo pokretanje stranice; inače (link dok aplikacija radi) ekran se prebacuje.
function applyLink(l, fresh) {
  toastConfirm(l.confirmStatus);
  if (l.reset) { resetToken = l.reset; authView = 'reset'; }
  if (l.b) { openShopProfile(l.b.toLowerCase()); return; }
  if (!fresh) {
    shop = null; brand.hidden = false; shopbar.hidden = true; filter = 'Sve';
    renderChips(); show('feed', true);
  }
  if (fresh || l.o) { loadFeed(true, l.o); }
  if (l.reset) { show('profile'); }
  else if (l.poruke) {
    if (me) { openChat(l.poruke); } else { needLogin('Prijavi se da vidiš poruku.'); }
  }
}
// Poziva ga window.__komodoOpenUrl (omotac.js) za linkove dok aplikacija radi.
function openLink(search, hash) {
  var l = readLink(search, hash);
  if (l.secret) { history.replaceState(null, '', '/'); }
  if (l.confirmToken) {
    confirmEmail(l.confirmToken).then(function (status) {
      toastConfirm(status);
      api('GET', '/api/me').then(function (d) { me = d.korisnik; if (!profile.hidden) { renderProfile(); } }, function () {});
    });
    return;
  }
  applyLink(l, false);
}

/* ---------- start ---------- */

renderChips();
var startLink = readLink(location.search, location.hash);
if (startLink.secret) { history.replaceState(null, '', '/'); }
Promise.all([
  checkAppVersion(),
  startLink.confirmToken ? confirmEmail(startLink.confirmToken) : Promise.resolve(startLink.confirmStatus)
]).then(function (r) {
  var blocked = r[0];
  startLink.confirmStatus = r[1];
  return api('GET', '/api/me').then(function (d) { me = d.korisnik; setBadge(d.neprocitano); }, function () {}).then(function () {
    toApp({ type: 'ready', loggedIn: !!me });
    if (blocked) { return; }   // prestara verzija aplikacije: ostaje samo ekran za nadogradnju
    $('#tabPost').hidden = !isShop();
    if (me) { unreadTimer = setInterval(tickUnread, 60000); }
    // Skup praćenih butika (F-04, web/js/butik.js): jednom po učitavanju, za „Prati” na karticama i „Praćeni”.
    if (me && typeof ensureFollows === 'function') { ensureFollows(); }
    feedTimer = setInterval(refreshLikes, LIKES_EVERY);
    applyLink(startLink, true);
  });
});
// Link s fragmentom otvoren u stranici koja je već učitana (npr. isti jezik, nova adresa): preglednik ne učitava stranicu ponovo.
window.addEventListener('hashchange', function () {
  if (/^#(lozinka|potvrda)=/.test(location.hash)) { openLink('', location.hash); }
});
