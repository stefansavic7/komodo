// Komodo web — Prikazi (ekrani) i donji meni: show(), značka poruka, stanje poslije prijave/odjave, povratak na stranicu.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- prikazi ---------- */

function show(view, keepFeed) {
  var isFeed = view === 'feed';
  feed.hidden = !isFeed; topbar.hidden = !isFeed;
  profile.hidden = view !== 'profile'; shopView.hidden = view !== 'shop';
  inbox.hidden = view !== 'inbox'; chat.hidden = view !== 'chat'; admin.hidden = view !== 'admin';
  if (view !== 'chat') { stopChat(); }
  clearInterval(profileTimer); profileTimer = null;
  clearInterval(feedTimer); feedTimer = null;
  if (isFeed) { feedTimer = setInterval(refreshLikes, 15000); }
  if (view === 'profile') { profileTimer = setInterval(refreshProfileGrid, 30000); }
  var tabView = view === 'chat' ? 'inbox' : (view === 'admin' ? 'profile' : view);
  var ts = tabs.querySelectorAll('.tab');
  for (var k = 0; k < ts.length; k++) {
    if (ts[k].getAttribute('data-go') === tabView) { ts[k].setAttribute('aria-current', 'page'); }
    else { ts[k].removeAttribute('aria-current'); }
  }
  if (isFeed) { if (!keepFeed) { watch(); } return; }
  pauseAll();
  if (view === 'profile') { renderProfile(); }
  if (view === 'inbox') { renderInbox(); }
  if (view === 'admin') { renderAdmin(); }
}
tabs.addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (!b) { return; }
  var go = b.getAttribute('data-go');
  if (go === 'post') { openPost(); }
  else if (go === 'inbox' && !me) { needLogin('Prijavi se da vidiš poruke.'); }
  else { show(go); }
});
function setBadge(n) {
  var b = $('#badge');
  b.hidden = !(n > 0);
  b.textContent = n > 9 ? '9+' : String(n);
}
function refreshUnread() {
  if (!me) { setBadge(0); return; }
  api('GET', '/api/me').then(function (d) { if (d.korisnik) { setBadge(d.neprocitano); } }, function () {});
}
// Tajmer značke: samo dok je stranica vidljiva.
function tickUnread() { if (pageVisible()) { refreshUnread(); } }

// Poslije prijave ili odjave: dugme Objavi samo za butike, značka poruka, svjež feed i profil.
function afterAuthChange() {
  registerPush();
  toApp({ type: 'ready', loggedIn: !!me });
  if (me) { toApp({ type: 'push' }); }
  $('#tabPost').hidden = !isShop();
  clearInterval(unreadTimer); unreadTimer = null;
  if (me) { unreadTimer = setInterval(tickUnread, 60000); }
  refreshUnread();
  if (!profile.hidden) { renderProfile(); }
  if (!me && (!inbox.hidden || !chat.hidden || !admin.hidden)) { show('profile'); }
  loadFeed(true);
}

// Kad se korisnik vrati na karticu preglednika, osvježi ono što gleda.
document.addEventListener('visibilitychange', function () {
  if (!pageVisible() || !me) { return; }
  refreshUnread();
  refreshProfileGrid();
  refreshLikes();
  if (!inbox.hidden) { renderInbox(); }
  if (chatId && chatTimer) { pollChat(); }
});
