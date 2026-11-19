// Komodo web — Javni profil butika (kako ga vide kupci) i kontakt butika.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- profil butika (kako ga vide kupci) ---------- */

function shopTileHTML(i, b) {
  return '<li class="tile">' + tileMedia(i) +
    '<span class="tile-price">' + fmtKM(i.price) + '</span>' +
    '<button type="button" class="tile-open" data-open="' + i.id + '" data-handle="' + esc(b.handle) + '" data-name="' + esc(b.shopName) + '" aria-label="Otvori oglas ' + esc(i.title) + '"></button></li>';
}
// Ima li još strana: puna strana (20) i, ako znamo ukupan broj, nije sve učitano.
function hasMore(pageLen, loaded, total) {
  return pageLen >= 20 && (typeof total !== 'number' || loaded < total);
}
function openShopProfile(handle) {
  show('shop');
  $('#vName').textContent = ''; $('#vHandle').textContent = '@' + handle;
  $('#vAvatar').textContent = 'B'; $('#vCount').textContent = '0';
  $('#vContact').innerHTML = ''; $('#vGrid').innerHTML = '';
  $('#vMore').hidden = true; vItems = []; vShop = null; vMoreOn = false; vBusy = false;
  $('#vHint').textContent = 'Učitavam profil…';
  var token = {}; openShopProfile.token = token;
  Promise.all([
    api('GET', '/api/shops/' + encodeURIComponent(handle)),
    api('GET', '/api/listings?shop=' + encodeURIComponent(handle))
  ]).then(function (r) {
    if (openShopProfile.token !== token) { return; }
    var b = r[0].butik, list = r[1].oglasi, rows = contactRows(b);
    vShop = b; vItems = list.slice();
    vMoreOn = hasMore(list.length, list.length, typeof b.listings === 'number' ? b.listings : r[1].ukupno);
    $('#vMore').hidden = !vMoreOn;
    $('#vMsg').hidden = isShop();
    $('#vMsg').setAttribute('data-handle', b.handle);
    $('#vName').textContent = b.shopName;
    $('#vHandle').textContent = '@' + b.handle + ' · ' + b.city;
    $('#vAvatar').textContent = initial(b.shopName);
    $('#vCount').textContent = b.listings;
    $('#vContact').innerHTML = rows.join('');
    $('#vHint').textContent = rows.length ? '' : 'Ovaj butik još nije upisao telefon ni linkove.';
    $('#vGrid').innerHTML = list.map(function (i) { return shopTileHTML(i, b); }).join('');
  }).catch(function (err) { if (openShopProfile.token === token) { $('#vHint').textContent = err.message; } });
}
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
$('#shopBack').addEventListener('click', function () { show('feed'); });
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
function contactRows(b) {
  var rows = [];
  if (b.phone) {
    var intl = intlPhone(b.phone);
    rows.push('<a href="tel:' + esc(intl) + '">Pozovi<span>' + esc(b.phone) + '</span></a>');
    rows.push('<a href="viber://chat?number=' + encodeURIComponent(intl) + '">Viber poruka<span>' + esc(b.phone) + '</span></a>');
  }
  (b.links || []).forEach(function (url) {
    rows.push('<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(linkLabel(url)) + '<span>' + esc(linkShort(url)) + '</span></a>');
  });
  return rows;
}
function openContact(item) {
  pauseAll();
  $('#contactTitle').textContent = item.shopName;
  $('#contactList').innerHTML = '';
  $('#contactHint').textContent = 'Učitavam kontakt…';
  $('#contactMsg').hidden = isShop();
  $('#contactMsg').setAttribute('data-handle', item.handle);
  $('#contactMsg').setAttribute('data-listing', item.id);
  contactSheet.hidden = false;
  api('GET', '/api/shops/' + encodeURIComponent(item.handle)).then(function (d) {
    var rows = contactRows(d.butik);
    $('#contactList').innerHTML = rows.join('');
    $('#contactHint').textContent = rows.length
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
