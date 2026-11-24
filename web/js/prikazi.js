// Komodo web — Prikazi (ekrani) i donji meni: show(), značka poruka, stanje poslije prijave/odjave, povratak na stranicu.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- prikazi ---------- */

function show(view, keepFeed) {
  var isFeed = view === 'feed';
  if (!me && view !== 'profile') { clearPosle(); }   // U-04: sačuvana radnja važi samo dok je korisnik na prijavi
  feed.hidden = !isFeed; topbar.hidden = !isFeed;
  profile.hidden = view !== 'profile'; shopView.hidden = view !== 'shop';
  inbox.hidden = view !== 'inbox'; chat.hidden = view !== 'chat'; admin.hidden = view !== 'admin';
  if (view !== 'chat') { stopChat(); }
  profileTimer = staniTajmer(profileTimer);
  feedTimer = staniTajmer(feedTimer);
  if (isFeed) { feedTimer = tajmer('likes', refreshLikes); }
  if (view === 'profile') { profileTimer = tajmer('profil', refreshProfileGrid); }
  var tabView = view === 'chat' ? 'inbox' : (view === 'admin' ? 'profile' : view);
  var ts = tabs.querySelectorAll('.tab');
  for (var k = 0; k < ts.length; k++) {
    if (ts[k].getAttribute('data-go') === tabView) { ts[k].setAttribute('aria-current', 'page'); }
    else { ts[k].removeAttribute('aria-current'); }
  }
  if (isFeed) { if (!keepFeed) { watch(); } return; }
  hideUputa();   // U-12: uputa za prevlačenje važi samo u feedu
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
  else {
    show(go);
    // Dubinski link (?b=butik) ne učitava feed; prvi dodir na Početna ga učitava.
    if (go === 'feed' && !items.length && !loading) { loadFeed(true); }
  }
});
function setBadge(n) {
  var b = $('#badge');
  b.hidden = !(n > 0);
  b.textContent = n > 9 ? '9+' : String(n);
}
function refreshUnread() {
  if (!me) { setBadge(0); return null; }
  return api('GET', '/api/me').then(function (d) { if (d.korisnik) { setBadge(d.neprocitano); } }, function () {});
}
// Tajmer značke: samo dok je stranica vidljiva.
function tickUnread() { return pageVisible() ? refreshUnread() : null; }

// Poslije prijave ili odjave: dugme Objavi samo za butike, značka poruka, svjež feed i profil.
function afterAuthChange() {
  registerPush();
  toApp({ type: 'ready', loggedIn: !!me });
  if (me) { toApp({ type: 'push' }); }
  $('#tabPost').hidden = !isShop();
  unreadTimer = staniTajmer(unreadTimer);
  if (me) { unreadTimer = tajmer('me', tickUnread); }
  refreshUnread();
  forgetFollows();   // skup praćenih butika (butik.js) vrijedi za jednog korisnika
  if (me) { ensureFollows(); }
  if (!profile.hidden) { renderProfile(); }
  if (!me && (!inbox.hidden || !chat.hidden || !admin.hidden)) { show('profile'); }
  // U-04: radnja koju je neprijavljen korisnik započeo (sviđanje, poruka, praćenje) izvršava se sad.
  var posle = me ? readPosle() : null;
  if (posle && posle.t !== 'tab') { clearPosle(); runPosle(posle); return; }
  loadFeed(true);
}
function feedHome(firstId) {
  shop = null; brand.hidden = false; shopbar.hidden = true; filter = 'Sve';
  renderChips(); show('feed', true);
  return loadFeed(true, firstId);
}
function runPosle(p) {
  if (p.t === 'like' && /^\d+$/.test(String(p.id))) {
    feedHome(p.id).then(function () { var it = byId(p.id); if (it && !it.liked && !it.mine) { setLike(it, true); } });
  } else if (p.t === 'chat' && p.handle) {
    feedHome(null);
    startChat(p.handle, p.listingId);
  } else if (p.t === 'follow' && p.handle) {
    ensureFollows().then(function () {
      return isFollowing(p.handle) ? null : followShop(p.handle, p.name || p.handle, true);
    }).catch(function (err) { toast(err.message, true); }).then(function () {
      if (p.id) { feedHome(p.id).then(function () { paintAllFollow(); }); } else { openShopProfile(p.handle); }
    });
  } else {
    loadFeed(true);
  }
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
