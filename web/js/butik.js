// Komodo web — Javni profil butika (kako ga vide kupci), praćenje butika, radno vrijeme i kontakt butika.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- raspored ekrana profila (P3, SPEC-V1 F-04, F-05, U-01, U-02, U-07) ----------
   Markup profila (#me) i javnog profila (#shopView) sklapa ovaj fajl pri učitavanju, jer ga prijava.js
   (učitava se poslije) veže na dugmad iz njega. Postojeći element #pushRow se premješta, ne pravi ponovo
   (omotac.js se na njega vezao ranije). Stil je u web/butik.css. */

(function buildProfileScreens() {
  var pushRow = $('#pushRow');
  $('#shopView').innerHTML =
    '<div class="topnav"><button type="button" class="back" id="shopBack">' + icon('back') + 'Nazad</button></div>' +
    '<div class="v-missing" id="vMissing" hidden>' +
      '<span class="empty-ico">' + icon('shop') + '</span>' +
      '<h2 id="vMissingTitle" tabindex="-1">Ovaj butik ne postoji</h2><p class="hint">Možda je link pogrešan ili butik više nije na Komodu.</p>' +
      '<button type="button" class="btn btn-main btn-wide" id="vHome">Na početnu</button></div>' +
    '<div class="v-body" id="vBody">' +
      '<div class="p-head"><div class="p-avatar" id="vAvatar" aria-hidden="true">B</div>' +
        '<div class="p-name"><h2 id="vName"></h2>' +
          '<button type="button" class="v-badge" id="vVerified" hidden>' + icon('check') + 'Provjeren butik</button>' +
        '<span class="hint" id="vHandle"></span></div></div>' +
      '<dl class="stats"><div><dt id="vCountLbl">oglasa</dt><dd id="vCount">0</dd></div>' +
        '<div><dt id="vFollowersLbl">pratilaca</dt><dd id="vFollowers">0</dd></div></dl>' +
      '<div class="trust" id="vTrust" hidden>' +
        '<div class="trust-row" id="vAddr" hidden>' + icon('pin') + '<span class="grow" id="vAddrText"></span>' +
          '<a class="btn btn-sm" id="vMap" target="_blank" rel="noopener">Mapa</a></div>' +
        '<div id="vHoursBox" hidden><button type="button" class="trust-row v-status" id="vStatus" aria-expanded="false">' + icon('clock') +
          '<span class="grow"></span>' + icon('chev-d', 'chev') + '</button>' +
        '<p class="v-full" id="vFull" hidden></p></div></div>' +
      '<div class="p-actions"><button type="button" class="btn btn-main" id="vMsg">Pošalji poruku</button>' +
        '<button type="button" class="btn v-follow" id="vFollow">Prati</button></div>' +
      '<div class="quick-links"><span class="ql-wrap" id="vContact"></span>' +
        '<button type="button" class="quick" id="vShare">' + icon('share', 'i-xs') + 'Podijeli profil</button></div>' +
      '<p class="hint" id="vHint"></p>' +
      '<ul class="grid" id="vGrid" aria-label="Oglasi butika"></ul>' +
      '<button type="button" class="btn more" id="vMore" hidden>Učitaj još</button>' +
    '</div>';

  $('#me').innerHTML =
    '<div class="note" id="verifyBox" hidden>' +
      '<p id="verifyText">Skoro gotovo! Poslali smo link na vaš email. Potvrdi ga da bi mogao pisati buticima.</p>' +
      '<button type="button" class="link" id="verifyResend">Pošalji link ponovo</button></div>' +
    '<div class="p-head"><div class="p-avatar" id="pAvatar" aria-hidden="true">M</div>' +
      '<div class="p-name"><h2 id="pName"></h2>' +
        '<button type="button" class="v-badge" id="pBadge" hidden>' + icon('check') + 'Provjeren butik</button>' +
      '<span class="hint"><span id="pHandle"></span><span id="pCity"></span></span></div></div>' +
    '<dl class="stats">' +
      '<div id="pCountBox"><dt id="pCountLbl">oglasa</dt><dd id="pCount">0</dd></div>' +
      '<div id="pLikesBox"><dt id="pLikesLbl">sviđanja</dt><dd id="pLikes">0</dd></div>' +
      '<div id="pFollowBox"><dt id="pFollowLbl">pratilaca</dt><dd id="pFollow">0</dd></div></dl>' +
    '<div class="p-actions3" id="pActions">' +
      '<button type="button" class="btn" id="pStatsOpen" hidden>' + icon('chart', 'i-sm') + 'Statistika</button>' +
      '<button type="button" class="btn" id="pEdit">' + icon('edit', 'i-sm') + 'Uredi profil</button>' +
      '<button type="button" class="icon-sq" id="pShare" aria-label="Podijeli profil" hidden>' + icon('share') + '</button></div>' +
    '<div class="p-grid-wrap">' +
      '<div class="sec-head"><h2 id="pGridTitle">Moji oglasi</h2>' +
        '<button type="button" class="btn btn-sm" id="pSwitch" hidden>Pratim</button></div>' +
      '<div class="p-empty" id="pEmpty" hidden><p id="pEmptyText"></p>' +
        '<button type="button" class="btn btn-main" id="pPost">Objavi prvi video</button></div>' +
      '<ul class="grid" id="pGrid" aria-labelledby="pGridTitle"></ul>' +
      '<button type="button" class="btn more" id="pMore" hidden>Učitaj još</button>' +
      '<ul class="f-list" id="fList" aria-labelledby="pGridTitle" hidden></ul>' +
      '<p class="hint" id="fEmpty" hidden>Još ne pratiš nijedan butik.</p>' +
    '</div>' +
    '<section class="nalog" aria-labelledby="nalogTitle"><h2 id="nalogTitle">Nalog</h2>' +
      '<div class="list-card">' +
      '<div id="nalogPush"></div>' +
      '<button type="button" class="menu-item" id="adminOpen" hidden>' + icon('lock') + '<span>Administracija</span>' + icon('chev-r', 'chev') + '</button>' +
      '<form class="shop-form" id="passForm" novalidate>' +
        '<button type="button" class="menu-item" id="passToggle" aria-expanded="false">' + icon('lock') + '<span>Promijeni lozinku</span>' + icon('chev-r', 'chev') + '</button>' +
        '<div class="shop-form sub-form" id="passFields" hidden>' +
          '<div class="field"><label for="pwCur">Trenutna lozinka</label><input id="pwCur" type="password" maxlength="200" autocomplete="current-password"></div>' +
          '<div class="field"><label for="pwNew">Nova lozinka</label><input id="pwNew" type="password" maxlength="200" autocomplete="new-password"></div>' +
          '<p class="err" id="passErr" role="alert"></p>' +
          '<button type="submit" class="btn btn-main btn-wide">Sačuvaj lozinku</button></div></form>' +
      '<button type="button" class="menu-item" id="logout">' + icon('logout') + '<span>Odjavi se</span></button>' +
      '<form class="shop-form" id="delForm" novalidate>' +
        '<button type="button" class="menu-item danger" id="delToggle" aria-expanded="false">' + icon('trash') + '<span>Obriši nalog</span></button>' +
        '<div class="shop-form sub-form" id="delFields" hidden>' +
          '<p class="hint">Brisanje je trajno. Nestaju tvoj profil, oglasi, snimci, poruke, sviđanja i praćenja.</p>' +
          '<div class="field"><label for="delPass">Lozinka za potvrdu</label><input id="delPass" type="password" maxlength="200" autocomplete="current-password"></div>' +
          '<p class="err" id="delErr" role="alert"></p>' +
          '<button type="submit" class="btn btn-danger btn-wide">Trajno obriši nalog</button></div></form>' +
      '</div>' +
      '<p class="hint"><a class="link" href="/uslovi.html">Uslovi korištenja</a> · <a class="link" href="/privatnost.html">Politika privatnosti</a></p>' +
    '</section>';
  if (pushRow) { $('#nalogPush').appendChild(pushRow); }

  // Prozor „Uredi profil” (U-07, F-05): ide na kraj aplikacije, iznad ostalih prozora.
  var days = [['rd', 'Radnim danima'], ['sub', 'Subota'], ['ned', 'Nedjelja']];
  var hoursRows = days.map(function (d) {
    return '<div class="h-row"><div class="h-head"><span class="lbl">' + d[1] + '</span>' +
      '<label class="check" for="hOn_' + d[0] + '"><span class="vh">Radi</span><input id="hOn_' + d[0] + '" type="checkbox" class="sw" data-day="' + d[0] + '"></label></div>' +
      '<div class="h-times" id="hT_' + d[0] + '" hidden>' +
        '<input id="hFrom_' + d[0] + '" type="time" aria-label="' + d[1] + ': otvaranje">' +
        '<input id="hTo_' + d[0] + '" type="time" aria-label="' + d[1] + ': zatvaranje"></div></div>';
  }).join('');
  var sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.id = 'profSheet'; sheet.hidden = true;
  sheet.innerHTML =
    '<form class="panel full" id="shopForm" role="dialog" aria-modal="true" aria-labelledby="profTitle" novalidate>' +
      '<div class="panel-head"><h2 id="profTitle">Uredi profil</h2>' +
        '<button type="button" class="icon-btn plain" id="profClose" aria-label="Zatvori">' + icon('x') + '</button></div>' +
      '<div class="field"><label for="sName" id="sNameLbl">Naziv butika</label>' +
        '<input id="sName" type="text" maxlength="40" autocomplete="organization"></div>' +
      '<div class="shop-only" id="shopOnly">' +
        '<div class="field"><label for="sPhone">Telefon ili Viber</label>' +
          '<input id="sPhone" type="tel" maxlength="30" placeholder="npr. 065 123 456" autocomplete="tel"></div>' +
        '<div class="field"><label for="sAddress">Adresa</label>' +
          '<input id="sAddress" type="text" maxlength="120" placeholder="npr. Kralja Petra I 12" autocomplete="street-address" aria-describedby="sAddressHint">' +
          '<p class="hint" id="sAddressHint">Adresa radnje u Banjoj Luci. Kupci je vide na profilu i otvaraju na mapi.</p></div>' +
        '<fieldset class="hours"><legend class="lbl">Radno vrijeme</legend>' + hoursRows + '</fieldset>' +
        '<div class="field"><span class="lbl" id="linksLbl">Linkovi (Instagram, Facebook, TikTok, sajt)</span>' +
          '<div class="links" id="sLinks" role="group" aria-labelledby="linksLbl"></div>' +
          '<button type="button" class="link" id="addLink">+ Dodaj još jedan link</button></div>' +
        '<p class="hint">Kupci ti pišu kroz aplikaciju, a na profilu vide i telefon, adresu i linkove koje ovdje upišeš.</p>' +
      '</div>' +
      '<p class="err" id="shopErr" role="alert"></p>' +
      '<div class="panel-foot"><div class="btns"><button type="button" class="btn" id="shopCancel">Odustani</button>' +
        '<button type="submit" class="btn btn-main" id="shopSave">Sačuvaj</button></div></div>' +
    '</form>';
  (shopView.parentNode).appendChild(sheet);
})();

/* >>> radno-vrijeme (čista logika bez DOM-a; api/test/butik-sati.test.mjs je učitava iz ovog fajla) */
var DAY_ACC = ['nedjelju', 'ponedjeljak', 'utorak', 'srijedu', 'četvrtak', 'petak', 'subotu'];   // indeks = dan u sedmici, 0 = nedjelja
var WEEKDAY_IDX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
var MONTH_GEN = ['januara', 'februara', 'marta', 'aprila', 'maja', 'juna', 'jula', 'augusta', 'septembra', 'oktobra', 'novembra', 'decembra'];
// Dan u sedmici, minute od ponoći, mjesec i godina u zoni Europe/Sarajevo (ljetno računanje uračunato).
function sarajevoParts(now) {
  var d = now || new Date(), out = { dow: d.getDay(), min: d.getHours() * 60 + d.getMinutes(), month: d.getMonth(), year: d.getFullYear() };
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Sarajevo', weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'numeric', year: 'numeric', hourCycle: 'h23'
    }).formatToParts(d), got = {};
    for (var k = 0; k < parts.length; k++) { got[parts[k].type] = parts[k].value; }
    if (WEEKDAY_IDX[got.weekday] !== undefined) {
      out = { dow: WEEKDAY_IDX[got.weekday], min: (Number(got.hour) % 24) * 60 + Number(got.minute), month: Number(got.month) - 1, year: Number(got.year) };
    }
  } catch (e) { /* stariji preglednik: lokalno vrijeme uređaja */ }
  return out;
}
function hoursKey(dow) { return dow === 0 ? 'ned' : (dow === 6 ? 'sub' : 'rd'); }
function hhmm(text) { return Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5)); }
// Status radnog vremena: { open: bool, text } ili null kad butik nije upisao radno vrijeme.
function hoursStatus(hours, now) {
  if (!hours) { return null; }
  var t = sarajevoParts(now), today = hours[hoursKey(t.dow)];
  if (today && t.min >= hhmm(today[0]) && t.min < hhmm(today[1])) { return { open: true, text: 'Otvoreno do ' + today[1] }; }
  if (today && t.min < hhmm(today[0])) { return { open: false, text: 'Zatvoreno · otvara u ' + today[0] }; }
  for (var i = 1; i <= 7; i++) {
    var dow = (t.dow + i) % 7, h = hours[hoursKey(dow)];
    if (h) { return { open: false, text: 'Zatvoreno · otvara ' + (i === 1 ? 'sutra' : 'u ' + DAY_ACC[dow]) + ' u ' + h[0] }; }
  }
  return { open: false, text: 'Zatvoreno' };
}
// Puno radno vrijeme: „Pon–pet 09:00–20:00 · Subota 09:00–15:00 · Nedjelja ne radi”.
function hoursFull(hours) {
  function part(label, h) { return label + (h ? ' ' + h[0] + '–' + h[1] : ' ne radi'); }
  return [part('Pon–pet', hours.rd), part('Subota', hours.sub), part('Nedjelja', hours.ned)].join(' · ');
}
// „novembra 2026.” iz ISO datuma.
function sinceText(iso) {
  var t = sarajevoParts(new Date(iso));
  return MONTH_GEN[t.month] + ' ' + t.year + '.';
}
// Oblik riječi uz broj (SPEC-V1, konvencije): 1 / 2–4 / 5+.
function butikMnozina(n, one, few, many) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) { return one; }
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) { return few; }
  return many;
}
/* <<< radno-vrijeme */

function mapsURL(address, city) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address + ', ' + (city || 'Banja Luka'));
}

/* ---------- praćenje butika (F-04) ----------
   Skup praćenih (handle) se učitava jednom po prijavi (GET /api/me/follows) i mijenja lokalno poslije
   svakog praćenja. Drugi ekrani (kartica oglasa) ga koriste kroz isFollowing(), ensureFollows() i followShop(). */

var followedSet = {}, followList = [], followsPromise = null;
function isFollowing(handle) { return followedSet[String(handle).toLowerCase()] === true; }
// Učitava spisak praćenih; ponovni poziv vraća isti obećani rezultat dok se ne zatraži svježi (fresh) ili dok se korisnik ne promijeni.
function ensureFollows(fresh) {
  if (!me) { followedSet = {}; followList = []; followsPromise = null; return Promise.resolve([]); }
  if (followsPromise && !fresh) { return followsPromise; }
  var who = me.id;
  followsPromise = api('GET', '/api/me/follows').then(function (d) {
    if (!me || me.id !== who) { return []; }
    followList = d.butici; followedSet = {};
    followList.forEach(function (b) { followedSet[b.handle] = true; });
    me.followingCount = followList.length;
    return followList;
  }).catch(function () { followsPromise = null; return []; });
  return followsPromise;
}
function forgetFollows() { followedSet = {}; followList = []; followsPromise = null; }
// Prati (want = true) ili otprati. Vraća obećanje s { following, followers }; greške prosljeđuje pozivaocu.
function followShop(handle, name, want) {
  handle = String(handle).toLowerCase();
  return api('POST', '/api/shops/' + encodeURIComponent(handle) + '/follow', { following: want }).then(function (d) {
    var was = isFollowing(handle);
    if (d.following) { followedSet[handle] = true; } else { delete followedSet[handle]; }
    if (me && was !== d.following && typeof me.followingCount === 'number') { me.followingCount += d.following ? 1 : -1; }
    if (d.following) {
      var first = true;
      try { first = !localStorage.getItem('komodo.pratio'); localStorage.setItem('komodo.pratio', '1'); } catch (e) { /* privatni način */ }
      if (first) { toast('Pratiš ' + name + '. Novi snimci su u kartici Praćeni.'); }
    } else {
      toast('Više ne pratiš ' + name + '.');
    }
    return d;
  });
}

/* ---------- profil butika (kako ga vide kupci) ---------- */

function shopTileHTML(i, b) {
  return tileHTML(i, ' data-handle="' + esc(b.handle) + '" data-name="' + esc(b.shopName) + '"');
}
// Ima li još strana: puna strana (20) i, ako znamo ukupan broj, nije sve učitano.
function hasMore(pageLen, loaded, total) {
  return pageLen >= 20 && (typeof total !== 'number' || loaded < total);
}
function paintFollow(b) {
  var btn = $('#vFollow');
  btn.textContent = b.following ? 'Pratiš' : 'Prati';
  btn.classList.toggle('is-on', !!b.following);
  btn.setAttribute('aria-pressed', b.following ? 'true' : 'false');
  $('#vFollowers').textContent = b.followers;
  $('#vFollowersLbl').textContent = butikMnozina(b.followers, 'pratilac', 'pratioca', 'pratilaca');
}
function paintShopProfile(b) {
  var own = !!me && me.handle === b.handle;
  $('#vName').textContent = b.shopName;
  $('#vVerified').hidden = b.verified === false;
  $('#vHandle').textContent = '@' + b.handle + (b.since ? ' · na Komodu od ' + sinceText(b.since) : '');
  $('#vAvatar').textContent = initial(b.shopName);
  $('#vCount').textContent = b.listings;
  $('#vCountLbl').textContent = butikMnozina(b.listings, 'oglas', 'oglasa', 'oglasa');
  $('#vAddr').hidden = !b.address;
  if (b.address) {
    $('#vAddrText').textContent = b.address;
    $('#vMap').setAttribute('href', mapsURL(b.address, b.city));
  }
  var st = hoursStatus(b.hours);
  $('#vHoursBox').hidden = !st;
  $('#vTrust').hidden = !b.address && !st;
  if (st) {
    $('#vStatus .grow').textContent = st.text;
    $('#vStatus').classList.toggle('is-open', st.open);
    $('#vFull').textContent = hoursFull(b.hours);
  }
  $('#vFull').hidden = true; $('#vStatus').setAttribute('aria-expanded', 'false');
  $('#vFollow').hidden = own;
  $('#vMsg').hidden = isShop();
  $('#vMsg').setAttribute('data-handle', b.handle);
  paintFollow(b);
}
function openShopProfile(handle) {
  show('shop');
  $('#vMissing').hidden = true; $('#vBody').hidden = false;
  $('#vName').textContent = ''; $('#vHandle').textContent = '@' + handle;
  $('#vAvatar').textContent = 'B'; $('#vCount').textContent = '0'; $('#vFollowers').textContent = '0';
  $('#vVerified').hidden = true; $('#vTrust').hidden = true; $('#vAddr').hidden = true; $('#vHoursBox').hidden = true;
  $('#vFollow').hidden = true; $('#vMsg').hidden = true;
  $('#vContact').innerHTML = ''; $('#vGrid').innerHTML = '';
  $('#vMore').hidden = true; vItems = []; vShop = null; vMoreOn = false; vBusy = false;
  $('#vHint').textContent = 'Učitavam profil…';
  var token = {}; openShopProfile.token = token;
  var pShop = api('GET', '/api/shops/' + encodeURIComponent(handle));
  var pList = api('GET', '/api/listings?shop=' + encodeURIComponent(handle)).catch(function () { return { oglasi: [] }; });
  Promise.all([pShop, pList]).then(function (r) {
    if (openShopProfile.token !== token) { return; }
    var b = r[0].butik, list = r[1].oglasi, rows = contactRows(b);
    vShop = b; vItems = list.slice();
    vMoreOn = hasMore(list.length, list.length, typeof b.listings === 'number' ? b.listings : r[1].ukupno);
    $('#vMore').hidden = !vMoreOn;
    paintShopProfile(b);
    $('#vContact').innerHTML = rows.join('');
    $('#vHint').textContent = rows.length || b.address ? '' : 'Ovaj butik još nije upisao telefon ni linkove.';
    $('#vGrid').innerHTML = list.map(function (i) { return shopTileHTML(i, b); }).join('');
  }).catch(function (err) {
    if (openShopProfile.token !== token) { return; }
    // U-02: nepostojeći ili ugašen butik nema avatar, broj, poruku ni mrežu.
    if (err.message === 'Ovaj butik ne postoji.') { $('#vBody').hidden = true; $('#vMissing').hidden = false; $('#vMissingTitle').focus({ preventScroll: true }); return; }
    $('#vHint').textContent = err.message;
  });
}
$('#vHome').addEventListener('click', function () {
  shop = null; brand.hidden = false; shopbar.hidden = true; renderChips(); show('feed');
  if (!items.length && !loading) { loadFeed(true); }
});
var vFollowBusy = false;
$('#vFollow').addEventListener('click', function () {
  var b = vShop;
  if (!b || vFollowBusy) { return; }
  if (!me) { needLogin('Napravi besplatan nalog da pratiš ' + b.shopName + '.'); return; }
  var want = !b.following, before = { following: b.following, followers: b.followers };
  vFollowBusy = true;
  b.following = want; b.followers = Math.max(0, b.followers + (want ? 1 : -1)); paintFollow(b);   // odmah, vraća se na grešku
  followShop(b.handle, b.shopName, want).then(function (d) {
    vFollowBusy = false;
    b.following = d.following; b.followers = d.followers;
    if (vShop === b) { paintFollow(b); }
  }).catch(function (err) {
    vFollowBusy = false;
    b.following = before.following; b.followers = before.followers;
    if (vShop === b) { paintFollow(b); }
    toast(err.message, true);
  });
});
$('#vVerified').addEventListener('click', function () { toast('Butike na Komodu otvara naš tim nakon provjere radnje.'); });
$('#vStatus').addEventListener('click', function () {
  var open = $('#vFull').hidden;
  $('#vFull').hidden = !open; $('#vStatus').setAttribute('aria-expanded', open ? 'true' : 'false');
});
// Dijeljenje profila: postojeći način dijeljenja linka (/?b=handle); pregled linka radi F-02.
function shareShopProfile(handle, name) {
  var url = location.origin + '/?b=' + encodeURIComponent(handle), text = name + ' na Komodu — pogledaj naše proizvode na videu';
  if (inApp) {
    toApp({ type: 'share', text: text, url: url });
  } else if (navigator.share) {
    navigator.share({ title: name, text: text, url: url }).catch(function () {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text + '\n' + url).then(function () {
      toast('Link profila je kopiran.');
    }, function () { toast('Kopiranje nije uspjelo. Link: ' + url); });
  } else {
    toast('Link profila: ' + url);
  }
}
$('#vShare').addEventListener('click', function () { if (vShop) { shareShopProfile(vShop.handle, vShop.shopName); } });
$('#vMore').addEventListener('click', function () {
  if (vBusy || !vMoreOn || !vShop || !vItems.length) { return; }
  var b = vShop, token = openShopProfile.token, btn = $('#vMore');
  vBusy = true; btn.disabled = true; btn.textContent = 'Učitavam…';
  api('GET', '/api/listings?shop=' + encodeURIComponent(b.handle) + '&before=' + vItems[vItems.length - 1].id).then(function (d) {
    vBusy = false; btn.disabled = false; btn.textContent = 'Učitaj još';
    if (openShopProfile.token !== token) { return; }
    var fresh = d.oglasi.filter(function (i) { return !vItems.some(function (x) { return x.id === i.id; }); });
    vItems = vItems.concat(fresh);
    $('#vGrid').insertAdjacentHTML('beforeend', fresh.map(function (i) { return shopTileHTML(i, b); }).join(''));
    vMoreOn = hasMore(d.oglasi.length, vItems.length, typeof b.listings === 'number' ? b.listings : undefined);
    btn.hidden = !vMoreOn;
  }).catch(function (err) {
    vBusy = false; btn.disabled = false; btn.textContent = 'Učitaj još';
    toast(err.message, true);
  });
});
$('#vGrid').addEventListener('click', function (e) {
  var b = e.target.closest('[data-open]');
  if (!b) { return; }
  openShop(b.getAttribute('data-handle'), b.getAttribute('data-name'), b.getAttribute('data-open'));
});
$('#shopBack').addEventListener('click', function () { show('feed'); if (!items.length && !loading) { loadFeed(true); } });
$('#vMsg').addEventListener('click', function () { startChat($('#vMsg').getAttribute('data-handle'), null); });

/* ---------- kontakt butika ---------- */

function intlPhone(phone) {
  var d = String(phone).replace(/[^0-9+]/g, '');
  if (d.charAt(0) === '+') { return d; }
  if (d.indexOf('00') === 0) { return '+' + d.slice(2); }
  if (d.charAt(0) === '0') { return '+387' + d.slice(1); }
  return '+' + d;
}
function linkLabel(url) {
  var host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, ''); } catch (e) { return 'Link'; }
  if (/(^|\.)instagram\.com$/.test(host)) { return 'Instagram'; }
  if (/(^|\.)(facebook|fb)\.com$/.test(host)) { return 'Facebook'; }
  if (/(^|\.)tiktok\.com$/.test(host)) { return 'TikTok'; }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) { return 'YouTube'; }
  return host;
}
function linkShort(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}
// Tableti ispod dugmadi na profilu butika: Pozovi, Viber, linkovi. Broj telefona je skriven za čitač ekrana.
function contactRows(b) {
  var rows = [];
  if (b.phone) {
    var intl = intlPhone(b.phone);
    rows.push('<a class="quick" href="tel:' + esc(intl) + '">' + icon('phone', 'i-xs') + 'Pozovi<span class="vh"> ' + esc(b.phone) + '</span></a>');
    rows.push('<a class="quick" href="viber://chat?number=' + encodeURIComponent(intl) + '">' + icon('chat', 'i-xs') + 'Viber<span class="vh"> ' + esc(b.phone) + '</span></a>');
  }
  (b.links || []).forEach(function (url) {
    rows.push('<a class="quick" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('link', 'i-xs') + esc(linkLabel(url)) + '<span class="vh"> ' + esc(linkShort(url)) + '</span></a>');
  });
  return rows;
}
// Red u kartici povjerenja prozora „Kontaktiraj butik”: ikona, tekst, strelica ili „Mapa”.
function trustRow(tag, attrs, ico, inner, tail) {
  return '<' + tag + ' class="trust-row"' + attrs + '>' + icon(ico) + '<span class="grow">' + inner + '</span>' + (tail || '') + '</' + tag + '>';
}
function trustChev() { return icon('chev-r', 'chev'); }
// Sažetak za red statusa: „sub do 15:00” (u subotu: „pon–pet do 20:00”).
function hoursBrief(hours) {
  if (!hours) { return ''; }
  if (sarajevoParts().dow === 6) { return hours.rd ? 'pon–pet do ' + hours.rd[1] : ''; }
  return hours.sub ? 'sub do ' + hours.sub[1] : 'sub ne radi';
}
function contactSheetRows(b) {
  var rows = [], st = hoursStatus(b.hours);
  if (st) {
    var brief = hoursBrief(b.hours);
    rows.push(trustRow('div', '', 'clock', '<span class="c-status ' + (st.open ? 'is-open open' : 'closed') + '">' + esc(st.text) + '</span>' + (brief ? ' · ' + esc(brief) : '')));
  }
  if (b.address) {
    rows.push(trustRow('a', ' href="' + esc(mapsURL(b.address, b.city)) + '" target="_blank" rel="noopener"', 'pin', esc(b.address + ', ' + (b.city || 'Banja Luka')), '<span class="link">Mapa</span>'));
  }
  if (b.phone) {
    var intl = intlPhone(b.phone);
    rows.push(trustRow('a', ' href="tel:' + esc(intl) + '"', 'phone', 'Pozovi · ' + esc(b.phone), trustChev()));
    rows.push(trustRow('a', ' href="viber://chat?number=' + encodeURIComponent(intl) + '"', 'chat', 'Viber poruka', trustChev()));
  }
  (b.links || []).forEach(function (url) {
    rows.push(trustRow('a', ' href="' + esc(url) + '" target="_blank" rel="noopener"', 'link', esc(linkLabel(url)) + ' · ' + esc(linkShort(url)), trustChev()));
  });
  return rows;
}
function openContact(item) {
  pauseAll();
  $('#contactTitle').textContent = item.shopName;
  $('#contactAvatar').textContent = initial(item.shopName);
  $('#contactList').innerHTML = ''; $('#contactList').hidden = true;
  $('#contactHint').textContent = 'Učitavam kontakt…';
  $('#contactMsg').hidden = isShop();
  $('#contactMsg').setAttribute('data-handle', item.handle);
  $('#contactMsg').setAttribute('data-listing', item.id);
  contactSheet.hidden = false;
  $('#contactClose').focus();
  api('GET', '/api/shops/' + encodeURIComponent(item.handle)).then(function (d) {
    var all = contactSheetRows(d.butik), hasContact = !!(d.butik.phone || (d.butik.links || []).length);
    $('#contactList').innerHTML = all.join(''); $('#contactList').hidden = !all.length;
    $('#contactHint').textContent = hasContact
      ? 'Ako zoveš ili pišeš van aplikacije, reci da je zbog oglasa „' + item.title + '” na Komodu.'
      : (isShop() ? 'Ovaj butik još nije upisao telefon ni linkove.' : 'Butik još nije upisao telefon ni linkove, ali mu možeš pisati ovdje.');
  }).catch(function (err) { $('#contactHint').textContent = err.message; });
}
function closeContact() { contactSheet.hidden = true; if (!feed.hidden) { watch(); } }
$('#contactClose').addEventListener('click', closeContact);
$('#contactMsg').addEventListener('click', function () {
  var b = $('#contactMsg');
  contactSheet.hidden = true;
  startChat(b.getAttribute('data-handle'), b.getAttribute('data-listing'));
});
contactSheet.addEventListener('click', function (e) { if (e.target === contactSheet) { closeContact(); } });
