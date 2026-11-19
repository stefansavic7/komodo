// Komodo web — Vlastiti profil: podaci i linkovi butika, brisanje naloga, mreža „Moji oglasi” / „Sviđa mi se”.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

$('#shopForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#shopErr').textContent = '';
  api('PATCH', '/api/me', {
    name: $('#sName').value.trim(), phone: $('#sPhone').value.trim(), links: formLinks()
  }).then(function (d) {
    me = d.korisnik; fillShopForm(); toast('Profil je sačuvan.');
  }).catch(function (err) { $('#shopErr').textContent = err.message; });
});
var MAX_LINKS = 5;
function linkRowHTML(value, n) {
  return '<div class="link-row"><input type="url" inputmode="url" maxlength="200" autocomplete="off" id="sLink' + n + '" aria-label="Link ' + (n + 1) + '" placeholder="npr. instagram.com/moj.butik" value="' + esc(value) + '">' +
    '<button type="button" class="link-x" data-x="' + n + '" aria-label="Ukloni link ' + (n + 1) + '">×</button></div>';
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
// Dugme Sačuvaj se vidi samo kad se nešto razlikuje od sačuvanog profila.
function checkDirty() {
  if (!me) { return; }
  var links = formLinks().map(linkShort).join('|');
  var saved = (me.links || []).map(linkShort).join('|');
  var dirty = $('#sName').value.trim() !== me.name || (isShop() && ($('#sPhone').value.trim() !== me.phone || links !== saved));
  $('#shopSave').hidden = !dirty;
}
$('#shopForm').addEventListener('input', checkDirty);
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
  checkDirty();
});
function fillShopForm() {
  $('#pAvatar').textContent = initial(me.name);
  $('#pHandle').textContent = isShop() ? '@' + me.handle : me.email;
  $('#sNameLbl').textContent = isShop() ? 'Naziv butika' : 'Ime';
  $('#shopOnly').hidden = !isShop();
  $('#sName').value = me.name; $('#sPhone').value = me.phone;
  renderLinks((me.links || []).map(linkShort));
  $('#shopErr').textContent = '';
  checkDirty();
}

$('#delToggle').addEventListener('click', function () {
  $('#delFields').hidden = !$('#delFields').hidden;
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
  fillShopForm();
  var shopRole = isShop();
  $('#pGridTitle').textContent = shopRole ? 'Moji oglasi' : 'Sviđa mi se';
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
function profileTileHTML(i, shopRole) {
  return '<li class="tile">' + tileMedia(i) +
    '<span class="tile-price">' + fmtKM(i.price) + '</span>' +
    '<button type="button" class="tile-open" data-open="' + i.id + '" aria-label="Otvori oglas ' + esc(i.title) + '"></button>' +
    (shopRole ? '<button type="button" class="tile-del" data-del="' + i.id + '" aria-label="Obriši oglas ' + esc(i.title) + '">×</button>' : '') + '</li>';
}
var pTotal;   // ukupno iz odgovora (novi API) ili undefined (stari API)
function paintProfileStats() {
  $('#pCount').textContent = typeof pTotal === 'number' ? pTotal : pItems.length;
  $('#pLikes').textContent = pItems.reduce(function (n, i) { return n + i.likes; }, 0);
  // Kupac nema oglase: njegov broj je broj oglasa koji su mu se svidjeli (liked=1), a ukupno sviđanja se ne prikazuje.
  $('#pCountLbl').textContent = isShop() ? 'oglasa' : 'sviđa ti se';
  $('#pLikesBox').hidden = !isShop();
  $('#pEmpty').hidden = pItems.length > 0;
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
    $('#pMore').hidden = !pMoreOn;
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
  var b = e.target.closest('[data-del]');
  if (!b) { return; }
  var id = b.getAttribute('data-del');
  confirmAction(DELETE_LISTING, function () { removeListing(id, loadProfileGrid); });
});
$('#pPost').addEventListener('click', openPost);
