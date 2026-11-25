// Komodo web — Vlastiti profil: podaci i linkovi butika, brisanje naloga, mreža „Moji oglasi” / „Sviđa mi se”.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- „Uredi profil” (U-07, F-05) ---------- */

var HOURS_ERR = 'Radno vrijeme upiši kao 09:00–20:00, a zatvaranje mora biti poslije otvaranja.';
var HOURS_DAYS = ['rd', 'sub', 'ned'];
var HOURS_DEFAULT = { rd: ['09:00', '20:00'], sub: ['09:00', '15:00'], ned: ['10:00', '14:00'] };
// Radno vrijeme iz tri reda forme: null kad nijedan dan nije uključen, inače { rd, sub, ned }; false kad je neki red neispravan.
function formHours() {
  var out = {}, any = false;
  for (var k = 0; k < HOURS_DAYS.length; k++) {
    var d = HOURS_DAYS[k];
    if (!$('#hOn_' + d).checked) { out[d] = null; continue; }
    var from = $('#hFrom_' + d).value, to = $('#hTo_' + d).value;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(to) || from >= to) { return false; }
    out[d] = [from, to]; any = true;
  }
  return any ? out : null;
}
function paintHoursForm(hours) {
  for (var k = 0; k < HOURS_DAYS.length; k++) {
    var d = HOURS_DAYS[k], h = hours && hours[d];
    $('#hOn_' + d).checked = !!h;
    $('#hFrom_' + d).value = h ? h[0] : HOURS_DEFAULT[d][0];
    $('#hTo_' + d).value = h ? h[1] : HOURS_DEFAULT[d][1];
    $('#hT_' + d).hidden = !h;
  }
}
$('#profSheet').addEventListener('change', function (e) {
  var day = e.target.getAttribute && e.target.getAttribute('data-day');
  if (day) { $('#hT_' + day).hidden = !e.target.checked; }
});
function openProfileEdit() {
  pauseAll();
  fillShopForm();
  $('#profSheet').hidden = false;
  if (window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches) { $('#sName').focus(); }
  else { $('#profClose').focus({ preventScroll: true }); }
}
function closeProfileEdit() {
  $('#profSheet').hidden = true;
  if (profile.hidden === false && $('#pEdit')) { $('#pEdit').focus(); }
}
$('#pEdit').addEventListener('click', openProfileEdit);
$('#shopCancel').addEventListener('click', closeProfileEdit);
$('#profClose').addEventListener('click', closeProfileEdit);
$('#profSheet').addEventListener('click', function (e) { if (e.target === $('#profSheet')) { closeProfileEdit(); } });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#profSheet').hidden) { closeProfileEdit(); } });
// Android Nazad u omotaču (omotac.js) ne zna za ovaj prozor, pa ga ovdje preuzimamo.
(function () {
  var prev = window.__komodoBack;
  window.__komodoBack = function () {
    if (!$('#profSheet').hidden) { closeProfileEdit(); return; }
    if (prev) { prev(); }
  };
})();
$('#shopForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#shopErr').textContent = '';
  var body = { name: $('#sName').value.trim() };
  if (isShop()) {
    var hours = formHours();
    if (hours === false) { $('#shopErr').textContent = HOURS_ERR; $('#shopErr').scrollIntoView({ block: 'center' }); return; }
    body.phone = $('#sPhone').value.trim(); body.links = formLinks();
    body.address = $('#sAddress').value.trim(); body.hours = hours;
  }
  var btn = $('#shopSave'); btn.disabled = true;
  api('PATCH', '/api/me', body).then(function (d) {
    btn.disabled = false;
    var kept = me.followingCount;
    me = d.korisnik;
    if (typeof me.followingCount !== 'number') { me.followingCount = kept; }
    closeProfileEdit(); renderProfile(); toast('Profil je sačuvan.');
  }).catch(function (err) { btn.disabled = false; $('#shopErr').textContent = err.message; $('#shopErr').scrollIntoView({ block: 'center' }); });
});
var MAX_LINKS = 5;
function linkRowHTML(value, n) {
  return '<div class="link-row"><input type="url" inputmode="url" maxlength="200" autocomplete="off" id="sLink' + n + '" aria-label="Link ' + (n + 1) + '" placeholder="npr. instagram.com/moj.butik" value="' + esc(value) + '">' +
    '<button type="button" class="icon-btn plain" data-x="' + n + '" aria-label="Ukloni link ' + (n + 1) + '">' + icon('x') + '</button></div>';
}
function renderLinks(values) {
  if (!values.length) { values = ['']; }
  $('#sLinks').innerHTML = values.map(linkRowHTML).join('');
  $('#addLink').hidden = values.length >= MAX_LINKS;
}
function rawLinks() {
  var out = [], ins = $('#sLinks').querySelectorAll('input');
  for (var k = 0; k < ins.length; k++) { out.push(ins[k].value.trim()); }
  return out;
}
function formLinks() { return rawLinks().filter(function (v) { return v !== ''; }); }
$('#addLink').addEventListener('click', function () {
  var values = rawLinks();
  if (values.length >= MAX_LINKS) { return; }
  values.push('');
  renderLinks(values);
  $('#sLink' + (values.length - 1)).focus();
});
$('#sLinks').addEventListener('click', function (e) {
  var b = e.target.closest('[data-x]');
  if (!b) { return; }
  var values = rawLinks();
  values.splice(Number(b.getAttribute('data-x')), 1);
  renderLinks(values);
});
function fillShopForm() {
  $('#sNameLbl').textContent = isShop() ? 'Naziv butika' : 'Ime';
  $('#shopOnly').hidden = !isShop();
  $('#sName').value = me.name; $('#sPhone').value = me.phone || '';
  $('#sAddress').value = me.address || '';
  paintHoursForm(me.hours);
  renderLinks((me.links || []).map(linkShort));
  $('#shopErr').textContent = '';
}
// Zaglavlje profila: ime, oznaka, brojke i dugmad (F-05, U-01, U-07).
var pFollowers = null;   // broj pratilaca vlastitog butika (iz javnog profila)
function paintProfileHead() {
  var shopRole = isShop();
  $('#pAvatar').textContent = initial(me.name);
  $('#pName').textContent = me.name;
  $('#pBadge').hidden = !shopRole;
  $('#pHandle').textContent = shopRole ? '@' + me.handle : me.email;
  $('#pCity').textContent = shopRole && me.city ? ' · ' + me.city : '';
  $('#pLikesBox').hidden = !shopRole;
  $('#pStatsOpen').hidden = !shopRole; $('#pShare').hidden = !shopRole;
  $('#pActions').classList.toggle('kupac', !shopRole);
  paintProfileFollow();
}
function paintProfileFollow() {
  if (!me) { return; }
  var n = isShop() ? (typeof pFollowers === 'number' ? pFollowers : 0) : (typeof me.followingCount === 'number' ? me.followingCount : 0);
  $('#pFollow').textContent = n;
  $('#pFollowLbl').textContent = isShop() ? butikMnozina(n, 'pratilac', 'pratioca', 'pratilaca') : 'pratiš';
}
$('#pBadge').addEventListener('click', function () { toast('Butike na Komodu otvara naš tim nakon provjere radnje.'); });
$('#pShare').addEventListener('click', function () { if (isShop()) { shareShopProfile(me.handle, me.name); } });
$('#pStatsOpen').addEventListener('click', function () {
  if (typeof openStats === 'function') { openStats(); } else { toast('Statistika stiže uskoro.'); }
});

/* ---------- druga kartica kupca: „Pratim” (F-04, P1) ---------- */

var pTab = 'grid';   // 'grid' (Moji oglasi / Sviđa mi se) ili 'follows' (Pratim, samo kupac)
function followRowHTML(b) {
  var line = [b.address || b.city, b.listings + ' ' + butikMnozina(b.listings, 'oglas', 'oglasa', 'oglasa')].filter(Boolean).join(' · ');
  return '<li class="f-item"><button type="button" class="f-open" data-handle="' + esc(b.handle) + '">' +
    '<span class="avatar" aria-hidden="true">' + esc(initial(b.shopName)) + '</span>' +
    '<span class="f-txt"><strong>' + esc(b.shopName) + '</strong><span>' + esc(line) + '</span></span></button>' +
    '<button type="button" class="btn btn-sm f-btn is-on" data-follow="' + esc(b.handle) + '" data-name="' + esc(b.shopName) + '" aria-pressed="true">Pratiš</button></li>';
}
function paintProfileTab() {
  var follows = !isShop() && pTab === 'follows';
  $('#pGridTitle').textContent = isShop() ? 'Moji oglasi' : (follows ? 'Pratim' : 'Sviđa mi se');
  $('#pSwitch').hidden = isShop();
  $('#pSwitch').textContent = follows ? 'Sviđa mi se' : 'Pratim';
  $('#pGrid').hidden = follows; $('#pMore').hidden = follows || !pMoreOn;
  $('#fList').hidden = !follows;
  if (follows) { $('#pEmpty').hidden = true; } else { $('#fEmpty').hidden = true; $('#pEmpty').hidden = pItems.length > 0; }
}
function renderFollowList() {
  $('#fList').innerHTML = followList.map(followRowHTML).join('');
  $('#fEmpty').hidden = followList.length > 0;
}
$('#pSwitch').addEventListener('click', function () {
  pTab = pTab === 'follows' ? 'grid' : 'follows';
  paintProfileTab();
  if (pTab === 'follows') {
    $('#fList').innerHTML = ''; $('#fEmpty').hidden = true;
    ensureFollows(true).then(function () { if (pTab === 'follows') { renderFollowList(); paintProfileFollow(); } });
  }
});
$('#fList').addEventListener('click', function (e) {
  var open = e.target.closest('[data-handle]');
  if (open) { openShopProfile(open.getAttribute('data-handle')); return; }
  var btn = e.target.closest('[data-follow]');
  if (!btn || btn.disabled) { return; }
  var handle = btn.getAttribute('data-follow'), name = btn.getAttribute('data-name'), want = btn.getAttribute('aria-pressed') !== 'true';
  btn.disabled = true;
  btn.textContent = want ? 'Pratiš' : 'Prati'; btn.setAttribute('aria-pressed', want ? 'true' : 'false'); btn.classList.toggle('is-on', want);
  followShop(handle, name, want).then(function () { btn.disabled = false; paintProfileFollow(); }).catch(function (err) {
    btn.disabled = false;
    btn.textContent = want ? 'Prati' : 'Pratiš'; btn.setAttribute('aria-pressed', want ? 'false' : 'true'); btn.classList.toggle('is-on', !want);
    toast(err.message, true);
  });
});

$('#delToggle').addEventListener('click', function () {
  $('#delFields').hidden = !$('#delFields').hidden;
  $('#delToggle').setAttribute('aria-expanded', $('#delFields').hidden ? 'false' : 'true');
  $('#delErr').textContent = '';
});
$('#delForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#delErr').textContent = '';
  api('POST', '/api/me/delete', { password: $('#delPass').value }).then(function () {
    me = null; $('#delPass').value = ''; $('#delFields').hidden = true;
    afterAuthChange();
    toast('Nalog je obrisan.');
  }).catch(function (err) { $('#delErr').textContent = err.message; });
});

function renderProfile() {
  // Nova lozinka (link iz emaila) se prikazuje i kad je neko prijavljen.
  var resetting = authView === 'reset';
  $('#authForm').hidden = !!me || authView !== 'auth';
  $('#forgotForm').hidden = !!me || authView !== 'forgot';
  $('#resetForm').hidden = !resetting;
  $('#me').hidden = !me || resetting;
  if (!me) { setAuthMode(authMode); return; }
  if (resetting) { return; }
  $('#verifyBox').hidden = me.verified !== false;
  $('#verifyText').textContent = 'Skoro gotovo! Poslali smo link na ' + me.email + '. Potvrdi ga da bi mogao pisati buticima.';
  $('#pushRow').hidden = !inApp;
  $('#pushToggle').checked = me.pushEnabled !== false;
  $('#adminOpen').hidden = !me.admin;
  var shopRole = isShop();
  if (shopRole) { pTab = 'grid'; pFollowers = null; }
  paintProfileHead();
  paintProfileTab();
  // Brojke praćenja: butik čita broj pratilaca iz svog javnog profila, kupac učitava spisak praćenih (jednom).
  var who = me.id;
  if (shopRole) {
    api('GET', '/api/shops/' + encodeURIComponent(me.handle)).then(function (d) {
      if (me && me.id === who) { pFollowers = d.butik.followers; paintProfileFollow(); }
    }, function () {});
  } else {
    ensureFollows().then(function () { if (me && me.id === who) { paintProfileFollow(); if (pTab === 'follows') { renderFollowList(); } } });
  }
  $('#pEmptyText').textContent = shopRole
    ? 'Još nemaš oglasa. Dodaj prvi video i pojaviće se ovdje i na početnoj.'
    : 'Još ništa nisi označio. Dodirni srce na oglasu i naći ćeš ga ovdje.';
  $('#pPost').hidden = !shopRole;
  gridSig = null;
  loadProfileGrid();
}
// Brojke se osvježavaju same dok je profil otvoren. Mreža snimaka se crta ponovo
// samo kad se promijeni spisak oglasa, da snimci ne trepere.
function profileListURL() {
  return isShop() ? '/api/listings?shop=' + encodeURIComponent(me.handle) : '/api/listings?liked=1';
}
function profileTileHTML(i) { return tileHTML(i); }
var pTotal;   // ukupno iz odgovora (novi API) ili undefined (stari API)
function paintProfileStats() {
  $('#pCount').textContent = typeof pTotal === 'number' ? pTotal : pItems.length;
  $('#pLikes').textContent = pItems.reduce(function (n, i) { return n + i.likes; }, 0);
  // Kupac nema oglase: njegov broj je broj oglasa koji su mu se svidjeli (liked=1), a ukupno sviđanja se ne prikazuje.
  $('#pCountLbl').textContent = isShop() ? butikMnozina($('#pCount').textContent | 0, 'oglas', 'oglasa', 'oglasa') : 'sviđa ti se';
  $('#pLikesBox').hidden = !isShop();
  $('#pEmpty').hidden = pItems.length > 0 || pTab === 'follows';
}
// Učitava (ponovo) prvu stranu mreže na profilu; dodatne strane se brišu.
function loadProfileGrid() {
  if (!me) { return; }
  var shopRole = isShop(), who = me.id;
  api('GET', profileListURL()).then(function (d) {
    if (!me || me.id !== who) { return; }
    var list = d.oglasi;
    pTotal = typeof d.ukupno === 'number' ? d.ukupno : undefined;
    pItems = list.slice(); pPages = 1;
    pMoreOn = hasMore(list.length, list.length, pTotal);
    $('#pMore').hidden = !pMoreOn || pTab === 'follows';
    paintProfileStats();
    var sig = list.map(function (i) { return i.id; }).join(',');
    if (sig === gridSig) { return; }
    gridSig = sig;
    $('#pGrid').innerHTML = list.map(function (i) { return profileTileHTML(i, shopRole); }).join('');
  }).catch(function (err) { if (gridSig === null) { toast(err.message, true); } });
}
// Samo osvježavanje (tajmer, povratak na stranicu): preskače se ako su učitane dodatne strane.
function refreshProfileGrid() {
  if (profile.hidden || !pageVisible() || pBusy || pPages > 1) { return; }
  loadProfileGrid();
}
$('#pMore').addEventListener('click', function () {
  if (!me || pBusy || !pMoreOn || !pItems.length) { return; }
  var shopRole = isShop(), who = me.id, btn = $('#pMore');
  pBusy = true; btn.disabled = true; btn.textContent = 'Učitavam…';
  api('GET', profileListURL() + '&before=' + pItems[pItems.length - 1].id).then(function (d) {
    pBusy = false; btn.disabled = false; btn.textContent = 'Učitaj još';
    if (!me || me.id !== who) { return; }
    var fresh = d.oglasi.filter(function (i) { return !pItems.some(function (x) { return x.id === i.id; }); });
    pItems = pItems.concat(fresh); pPages += 1;
    $('#pGrid').insertAdjacentHTML('beforeend', fresh.map(function (i) { return profileTileHTML(i, shopRole); }).join(''));
    gridSig = null;
    pMoreOn = hasMore(d.oglasi.length, pItems.length, pTotal);
    btn.hidden = !pMoreOn;
    paintProfileStats();
  }).catch(function (err) {
    pBusy = false; btn.disabled = false; btn.textContent = 'Učitaj još';
    toast(err.message, true);
  });
});
$('#pGrid').addEventListener('click', function (e) {
  var o = e.target.closest('[data-open]');
  if (o && isShop()) { openShop(me.handle, me.name, o.getAttribute('data-open')); return; }
  if (o) {
    shop = null; brand.hidden = false; shopbar.hidden = true; filter = 'Sve';
    renderChips(); show('feed', true); loadFeed(true, o.getAttribute('data-open'));
    return;
  }
});
$('#pPost').addEventListener('click', openPost);
