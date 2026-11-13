(function () {
'use strict';

var CATS = ['Haljine', 'Jakne i kaputi', 'Majice i košulje', 'Pantalone', 'Obuća', 'Torbe', 'Nakit', 'Ostalo'];

var me = null;            // prijavljeni korisnik ili null
var filter = 'Sve';       // izabrana kategorija
var shop = null;          // handle butika čije oglase gledamo, ili null
var items = [];           // oglasi u feedu
var loading = false, noMore = false;
var soundOn = false, io = null, toastTimer = null;
var pendingFile = null, pendingURL = null, uploading = false;
var authMode = 'login';
var chatId = null, chatLast = 0, chatTimer = null, unreadTimer = null;
var profileTimer = null, gridSig = null, feedTimer = null;
var search = { q: '', min: '', max: '' };   // pretraga u feedu
var viewed = {};                             // oglasi čiji je pregled već prijavljen u ovoj posjeti
var editId = null, reportTarget = null, chatBlocked = false, authView = 'auth', resetToken = null;
var inApp = !!window.ReactNativeWebView;     // radi li unutar mobilne aplikacije (Expo)
var pushToken = null;

function $(s) { return document.querySelector(s); }
var feed = $('#feed'), topbar = $('#topbar'), profile = $('#profile'), chips = $('#chips'), tabs = $('#tabs');
var brand = $('#brand'), shopbar = $('#shopbar'), shopView = $('#shopView'), inbox = $('#inbox'), chat = $('#chat'), admin = $('#admin');
var editSheet = $('#editSheet'), reportSheet = $('#reportSheet');
function isShop() { return !!me && me.role === 'butik'; }
var postSheet = $('#postSheet'), postForm = $('#postForm'), fVideo = $('#fVideo'), fTitle = $('#fTitle'),
    fPrice = $('#fPrice'), fCat = $('#fCat'), preview = $('#preview'), pickText = $('#pickText'),
    postErr = $('#postErr'), progress = $('#progress'), progressBar = $('#progressBar'), postSubmit = $('#postSubmit');
var contactSheet = $('#contactSheet'), toastEl = $('#toast');

var ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4zM16 9.5l5 5m0-5-5 5"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4m0 1h11l-2 4 2 4H6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19h3l10-10-3-3L5 16v3zM14 7l3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>'
};

/* ---------- pomoćne funkcije ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtKM(n) {
  var dec = Math.round(n * 100) % 100 !== 0, s;
  try { s = n.toLocaleString('de-DE', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 }); }
  catch (e) { s = String(n); }
  return s + ' KM';
}
function tileMedia(i) {
  if (i.posterUrl) { return '<img class="tile-img" src="' + esc(i.posterUrl) + '" alt="' + esc(i.title) + '" loading="lazy">'; }
  return '<video src="' + esc(i.videoUrl) + '#t=0.1" muted playsinline preload="metadata" aria-label="' + esc(i.title) + '"></video>';
}
function initial(text) { return String(text || 'B').trim().charAt(0).toUpperCase() || 'B'; }
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4500);
}
function byId(id) {
  for (var k = 0; k < items.length; k++) { if (String(items[k].id) === String(id)) { return items[k]; } }
  return null;
}

// Poziv API-ja. Vraća JSON ili baca grešku s porukom koju je poslao server.
function api(method, url, body) {
  var opts = { method: method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(url, opts).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) { throw new Error(data.greska || 'Nešto nije u redu. Pokušaj ponovo.'); }
      return data;
    });
  }, function () {
    throw new Error('Nema veze sa serverom. Provjeri internet i pokušaj ponovo.');
  });
}

/* ---------- feed ---------- */

function soundBtnInner() {
  return (soundOn ? ICON.soundOn : ICON.soundOff) + '<span class="n">' + (soundOn ? 'Zvuk' : 'Bez zvuka') + '</span>';
}
function cardHTML(i) {
  return '<article class="card' + (i.sold ? ' is-sold' : '') + '" data-id="' + i.id + '">' +
    '<video class="media" src="' + esc(i.videoUrl) + '"' + (i.posterUrl ? ' poster="' + esc(i.posterUrl) + '"' : '') + ' playsinline muted loop preload="metadata"></video>' +
    '<div class="scrim"></div>' +
    '<div class="meta">' +
      '<button type="button" class="seller-btn" data-act="shop"><span class="avatar" aria-hidden="true">' + esc(initial(i.shopName)) + '</span><span>' + esc(i.shopName) + '</span></button>' +
      '<h2 class="title">' + esc(i.title) + '</h2>' +
      (i.processing && i.mine ? '<p class="state">Video se još obrađuje na Bunnyju. Kupci ga već vide.</p>' : '') +
      (i.videoError ? '<p class="state state-err">Obrada videa nije uspjela. Obriši oglas i objavi video ponovo.</p>' : '') +
      '<p class="row"><span class="price">' + fmtKM(i.price) + '</span>' + (i.sold ? '<span class="sold">Prodato</span>' : '') + '<span class="cat">' + esc(i.category) + '</span>' +
        (i.mine ? '<span class="views">' + (i.views || 0) + ' pregleda</span>' : '') + '</p>' +
      (i.mine ? '' : '<button type="button" class="cta" data-act="contact">Kontaktiraj butik</button>') +
    '</div>' +
    '<div class="actions">' +
      '<button type="button" class="act' + (i.liked ? ' on' : '') + '" data-act="like" aria-pressed="' + (i.liked ? 'true' : 'false') + '" aria-label="Sviđa mi se">' + ICON.heart + '<span class="n">' + i.likes + '</span></button>' +
      '<button type="button" class="act" data-act="share" aria-label="Podijeli oglas">' + ICON.share + '<span class="n">Podijeli</span></button>' +
      '<button type="button" class="act" data-act="sound" aria-label="Uključi ili isključi zvuk">' + soundBtnInner() + '</button>' +
      (i.mine
        ? '<button type="button" class="act" data-act="edit" aria-label="Izmijeni oglas">' + ICON.edit + '<span class="n">Izmijeni</span></button>' +
          '<button type="button" class="act act-del" data-act="del" aria-label="Obriši oglas">' + ICON.trash + '<span class="n">Obriši</span></button>'
        : '<button type="button" class="act" data-act="report" aria-label="Prijavi oglas">' + ICON.flag + '<span class="n">Prijavi</span></button>') +
    '</div></article>';
}
function emptyHTML() {
  if (search.q || search.min || search.max) {
    return '<article class="card empty"><div class="empty-box"><h2>Nema oglasa za ovu pretragu</h2>' +
      '<p>Probaj drugu riječ ili širi raspon cijene.</p><button type="button" class="cta" data-act="clear">Poništi pretragu</button></div></article>';
  }
  var where = shop ? 'Ovaj butik još nema oglasa' : (filter === 'Sve' ? 'Još nema oglasa' : 'Još nema oglasa u kategoriji ' + esc(filter));
  return '<article class="card empty"><div class="empty-box"><h2>' + where + '</h2>' +
    (isShop() ? '<p>Snimi proizvod, upiši naziv i cijenu, i oglas je tu.</p><button type="button" class="cta" data-act="post">Objavi video</button>'
              : '<p>Butici uskoro dodaju prve snimke. Svrati opet.</p>') + '</div></article>';
}
function watch() {
  if (io) { io.disconnect(); io = null; }
  if (!('IntersectionObserver' in window)) { return; }
  io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var v = en.target.querySelector('video');
      if (en.isIntersecting && en.intersectionRatio >= 0.6) {
        if (v) {
          v.muted = !soundOn;
          var p = v.play();
          if (p && p.catch) { p.catch(function () { v.muted = true; var r = v.play(); if (r && r.catch) { r.catch(function () {}); } }); }
        }
        var vid = en.target.getAttribute('data-id');
        if (vid && !viewed[vid]) { viewed[vid] = true; api('POST', '/api/listings/' + vid + '/view').catch(function () {}); }
        // pred krajem liste učitaj sljedeću stranu
        var cards = feed.querySelectorAll('.card');
        if (en.target === cards[cards.length - 1] || en.target === cards[cards.length - 2]) { loadFeed(false); }
      } else if (v) {
        v.pause();
      }
    });
  }, { root: feed, threshold: [0, 0.6, 1] });
  var all = feed.querySelectorAll('.card');
  for (var k = 0; k < all.length; k++) { io.observe(all[k]); }
}
function pauseAll() {
  var vs = feed.querySelectorAll('video');
  for (var k = 0; k < vs.length; k++) { vs[k].pause(); }
}
function loadFeed(reset, firstId) {
  if (loading || (!reset && noMore)) { return Promise.resolve(); }
  loading = true;
  if (reset) { items = []; noMore = false; feed.innerHTML = '<article class="card loading"><p>Učitavam oglase…</p></article>'; }
  var qs = [];
  if (filter !== 'Sve') { qs.push('category=' + encodeURIComponent(filter)); }
  if (shop) { qs.push('shop=' + encodeURIComponent(shop)); }
  if (search.q) { qs.push('q=' + encodeURIComponent(search.q)); }
  if (search.min) { qs.push('min=' + encodeURIComponent(search.min)); }
  if (search.max) { qs.push('max=' + encodeURIComponent(search.max)); }
  if (!reset && items.length) { qs.push('before=' + items[items.length - 1].id); }
  var first = (reset && firstId) ? api('GET', '/api/listings/' + firstId).then(function (d) { return d.oglas; }, function () { toast('Taj oglas više ne postoji.'); return null; }) : Promise.resolve(null);
  return Promise.all([first, api('GET', '/api/listings' + (qs.length ? '?' + qs.join('&') : ''))]).then(function (r) {
    var list = r[1].oglasi;
    if (list.length < 20) { noMore = true; }
    if (r[0]) { list = [r[0]].concat(list.filter(function (i) { return i.id !== r[0].id; })); }
    var fresh = list.filter(function (i) { return !byId(i.id); });
    if (reset) { feed.innerHTML = fresh.length ? fresh.map(cardHTML).join('') : emptyHTML(); feed.scrollTop = 0; }
    else { feed.insertAdjacentHTML('beforeend', fresh.map(cardHTML).join('')); }
    items = items.concat(fresh);
    loading = false;
    watch();
  }).catch(function (err) {
    loading = false;
    if (reset) {
      feed.innerHTML = '<article class="card empty"><div class="empty-box"><h2>Oglasi se nisu učitali</h2><p>' + esc(err.message) + '</p>' +
        '<button type="button" class="cta" data-act="retry">Pokušaj ponovo</button></div></article>';
    } else { toast(err.message); }
  });
}
// Dok je feed otvoren, brojevi sviđanja na učitanim oglasima se osvježavaju sami.
function refreshLikes() {
  if (feed.hidden || document.hidden || !items.length) { return; }
  var ids = items.slice(-100).map(function (i) { return i.id; });
  api('GET', '/api/likes?ids=' + ids.join(',')).then(function (d) {
    Object.keys(d.svidjanja).forEach(function (id) {
      var item = byId(id), v = d.svidjanja[id];
      if (!item || (item.likes === v.likes && item.liked === v.liked)) { return; }
      item.likes = v.likes; item.liked = v.liked;
      var btn = feed.querySelector('.card[data-id="' + id + '"] [data-act="like"]');
      if (!btn) { return; }
      btn.classList.toggle('on', v.liked);
      btn.setAttribute('aria-pressed', v.liked ? 'true' : 'false');
      btn.querySelector('.n').textContent = v.likes;
    });
  }, function () {});
}
function toggleSound() {
  soundOn = !soundOn;
  var vs = feed.querySelectorAll('video');
  for (var k = 0; k < vs.length; k++) { vs[k].muted = !soundOn; }
  var bs = feed.querySelectorAll('[data-act="sound"]');
  for (var j = 0; j < bs.length; j++) { bs[j].innerHTML = soundBtnInner(); }
}
function needLogin(msg) {
  toast(msg);
  show('profile');
}
function removeListing(id, after) {
  api('DELETE', '/api/listings/' + id).then(function () {
    toast('Oglas je obrisan.');
    after();
  }).catch(function (err) { toast(err.message); });
}
// Prozor s potvrdom za radnje koje se ne mogu poništiti (brisanje, gašenje naloga).
var confirmRun = null, confirmFocus = null;
function confirmAction(opts, run) {
  pauseAll();
  confirmRun = run;
  confirmFocus = document.activeElement;
  $('#confirmTitle').textContent = opts.title;
  $('#confirmText').textContent = opts.text;
  $('#confirmYes').textContent = opts.ok;
  $('#confirmSheet').hidden = false;
  $('#confirmNo').focus();
}
function closeConfirm() {
  $('#confirmSheet').hidden = true;
  confirmRun = null;
  if (confirmFocus && confirmFocus.focus) { confirmFocus.focus(); }
  if (!feed.hidden) { watch(); }
}
$('#confirmNo').addEventListener('click', closeConfirm);
$('#confirmSheet').addEventListener('click', function (e) { if (e.target === $('#confirmSheet')) { closeConfirm(); } });
$('#confirmYes').addEventListener('click', function () {
  var run = confirmRun;
  closeConfirm();
  if (run) { run(); }
});
var DELETE_LISTING = { title: 'Obrisati oglas?', text: 'Oglas i video se brišu trajno i ne mogu se vratiti.', ok: 'Obriši' };

feed.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]');
  var act = btn ? btn.getAttribute('data-act') : null;
  if (act === 'post') { openPost(); return; }
  if (act === 'retry') { loadFeed(true); return; }
  if (act === 'clear') { clearSearch(); return; }
  var card = e.target.closest('.card');
  if (!card) { return; }
  if (!btn) { if (e.target.closest('video')) { toggleSound(); } return; }
  var item = byId(card.getAttribute('data-id'));
  if (!item) { return; }
  if (act === 'sound') {
    toggleSound();
  } else if (act === 'shop') {
    openShopProfile(item.handle);
  } else if (act === 'contact') {
    openContact(item);
  } else if (act === 'like') {
    if (!me) { needLogin('Prijavi se da označiš šta ti se sviđa.'); return; }
    api('POST', '/api/listings/' + item.id + '/like').then(function (d) {
      item.liked = d.liked; item.likes = d.likes;
      btn.classList.toggle('on', d.liked);
      btn.setAttribute('aria-pressed', d.liked ? 'true' : 'false');
      btn.querySelector('.n').textContent = d.likes;
    }).catch(function (err) { toast(err.message); });
  } else if (act === 'share') {
    shareListing(item);
  } else if (act === 'edit') {
    openEdit(item);
  } else if (act === 'report') {
    openReport({ listingId: item.id }, 'Prijavi oglas');
  } else if (act === 'del') {
    confirmAction(DELETE_LISTING, function () {
      removeListing(item.id, function () { loadFeed(true); });
    });
  }
});

function toApp(msg) {
  if (inApp) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
}
function shareListing(item) {
  var url = location.origin + '/?o=' + item.id;
  var text = item.title + ' · ' + fmtKM(item.price) + ' · ' + item.shopName;
  if (inApp) {
    toApp({ type: 'share', text: text, url: url });
  } else if (navigator.share) {
    navigator.share({ title: item.title, text: text, url: url }).catch(function () {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text + '\n' + url).then(function () {
      toast('Link oglasa je kopiran.');
    }, function () { toast('Kopiranje nije uspjelo. Link: ' + url); });
  } else {
    toast('Link oglasa: ' + url);
  }
}

/* ---------- pretraga ---------- */

$('#searchToggle').addEventListener('click', function () {
  var f = $('#searchForm');
  f.hidden = !f.hidden;
  $('#searchToggle').setAttribute('aria-expanded', f.hidden ? 'false' : 'true');
  if (!f.hidden) { $('#qText').focus(); }
});
$('#searchForm').addEventListener('submit', function (e) {
  e.preventDefault();
  search = { q: $('#qText').value.trim(), min: $('#qMin').value.trim(), max: $('#qMax').value.trim() };
  loadFeed(true);
});
function clearSearch() {
  search = { q: '', min: '', max: '' };
  $('#qText').value = ''; $('#qMin').value = ''; $('#qMax').value = '';
  $('#searchForm').hidden = true;
  $('#searchToggle').setAttribute('aria-expanded', 'false');
  loadFeed(true);
}
$('#searchClear').addEventListener('click', clearSearch);

/* ---------- izmjena oglasa ---------- */

function openEdit(item) {
  pauseAll();
  editId = item.id;
  $('#eTitle').value = item.title;
  $('#ePrice').value = String(item.price).replace('.', ',');
  $('#eCat').value = item.category;
  $('#eSold').checked = item.sold;
  $('#editErr').textContent = '';
  editSheet.hidden = false;
  $('#eTitle').focus();
}
function closeEdit() { editSheet.hidden = true; editId = null; if (!feed.hidden) { watch(); } }
$('#editCancel').addEventListener('click', closeEdit);
editSheet.addEventListener('click', function (e) { if (e.target === editSheet) { closeEdit(); } });
$('#editForm').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!editId) { return; }
  $('#editErr').textContent = '';
  api('PATCH', '/api/listings/' + editId, {
    title: $('#eTitle').value.trim(), price: $('#ePrice').value.trim(), category: $('#eCat').value, sold: $('#eSold').checked
  }).then(function (d) {
    var item = byId(d.oglas.id), card = feed.querySelector('.card[data-id="' + d.oglas.id + '"]');
    if (item && card) {
      Object.keys(d.oglas).forEach(function (k) { item[k] = d.oglas[k]; });
      card.outerHTML = cardHTML(item);
    }
    closeEdit();
    toast('Oglas je izmijenjen.');
  }).catch(function (err) { $('#editErr').textContent = err.message; });
});

/* ---------- prijava oglasa ili poruke ---------- */

function openReport(target, title) {
  if (!me) { needLogin('Prijavi se da prijaviš sadržaj.'); return; }
  pauseAll();
  reportTarget = target;
  $('#reportTitle').textContent = title;
  $('#reportReason').selectedIndex = target.conversationId ? 2 : 0;
  $('#reportErr').textContent = '';
  reportSheet.hidden = false;
}
function closeReport() { reportSheet.hidden = true; reportTarget = null; if (!feed.hidden) { watch(); } }
$('#reportCancel').addEventListener('click', closeReport);
reportSheet.addEventListener('click', function (e) { if (e.target === reportSheet) { closeReport(); } });
$('#reportForm').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!reportTarget) { return; }
  var body = { reason: $('#reportReason').value };
  if (reportTarget.listingId) { body.listingId = reportTarget.listingId; } else { body.conversationId = reportTarget.conversationId; }
  api('POST', '/api/reports', body).then(function () {
    closeReport();
    toast('Prijava je poslana. Pregledaćemo je.');
  }).catch(function (err) { $('#reportErr').textContent = err.message; });
});

/* ---------- kategorije i pregled jednog butika ---------- */

function renderChips() {
  chips.innerHTML = ['Sve'].concat(CATS).map(function (c) {
    return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === filter ? 'true' : 'false') + '">' + esc(c) + '</button>';
  }).join('');
}
chips.addEventListener('click', function (e) {
  var b = e.target.closest('.chip');
  if (!b) { return; }
  filter = b.getAttribute('data-cat');
  renderChips(); loadFeed(true);
});
function openShop(handle, name, firstId) {
  shop = handle; filter = 'Sve';
  $('#shopTitle').textContent = name || handle;
  brand.hidden = true; shopbar.hidden = false;
  renderChips(); show('feed', true); loadFeed(true, firstId);
}
$('#back').addEventListener('click', function () {
  shop = null;
  brand.hidden = false; shopbar.hidden = true;
  loadFeed(true);
});

/* ---------- profil butika (kako ga vide kupci) ---------- */

function openShopProfile(handle) {
  show('shop');
  $('#vName').textContent = ''; $('#vHandle').textContent = '@' + handle;
  $('#vAvatar').textContent = 'B'; $('#vCount').textContent = '0';
  $('#vContact').innerHTML = ''; $('#vGrid').innerHTML = '';
  $('#vHint').textContent = 'Učitavam profil…';
  Promise.all([
    api('GET', '/api/shops/' + encodeURIComponent(handle)),
    api('GET', '/api/listings?shop=' + encodeURIComponent(handle))
  ]).then(function (r) {
    var b = r[0].butik, list = r[1].oglasi, rows = contactRows(b);
    $('#vMsg').hidden = isShop();
    $('#vMsg').setAttribute('data-handle', b.handle);
    $('#vName').textContent = b.shopName;
    $('#vHandle').textContent = '@' + b.handle + ' · ' + b.city;
    $('#vAvatar').textContent = initial(b.shopName);
    $('#vCount').textContent = b.listings;
    $('#vContact').innerHTML = rows.join('');
    $('#vHint').textContent = rows.length ? '' : 'Ovaj butik još nije upisao telefon ni linkove.';
    $('#vGrid').innerHTML = list.map(function (i) {
      return '<li class="tile">' + tileMedia(i) +
        '<span class="tile-price">' + fmtKM(i.price) + '</span>' +
        '<button type="button" class="tile-open" data-open="' + i.id + '" data-handle="' + esc(b.handle) + '" data-name="' + esc(b.shopName) + '" aria-label="Otvori oglas ' + esc(i.title) + '"></button></li>';
    }).join('');
  }).catch(function (err) { $('#vHint').textContent = err.message; });
}
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

/* ---------- profil i prijava ---------- */

function setAuthMode(mode) {
  authMode = mode;
  var reg = mode === 'register';
  $('#authTitle').textContent = reg ? 'Novi nalog' : 'Prijava';
  $('#authLead').textContent = reg
    ? 'Nalog je besplatan. S njim čuvaš šta ti se sviđa i pišeš buticima.'
    : 'Prijavi se da označiš šta ti se sviđa i pišeš buticima.';
  $('#authShopField').hidden = !reg;
  $('#authSubmit').textContent = reg ? 'Napravi nalog' : 'Prijavi se';
  $('#authSwitch').textContent = reg ? 'Već imaš nalog? Prijavi se' : 'Nemaš nalog? Napravi ga';
  $('#aPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  $('#authErr').textContent = '';
}
$('#authSwitch').addEventListener('click', function () { setAuthMode(authMode === 'login' ? 'register' : 'login'); });
$('#authForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var body = { email: $('#aEmail').value.trim(), password: $('#aPass').value };
  if (authMode === 'register') { body.name = $('#aShop').value.trim(); }
  $('#authErr').textContent = '';
  api('POST', authMode === 'register' ? '/api/auth/register' : '/api/auth/login', body).then(function (d) {
    me = d.korisnik;
    $('#aPass').value = '';
    afterAuthChange();
    toast(authMode === 'register' ? 'Nalog je napravljen.' : 'Prijava je uspjela.');
  }).catch(function (err) { $('#authErr').textContent = err.message; });
});
$('#logout').addEventListener('click', function () {
  api('POST', '/api/auth/logout').then(function () {
    me = null; afterAuthChange(); toast('Odjava je uspjela.');
  }).catch(function (err) { toast(err.message); });
});
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
$('#forgotOpen').addEventListener('click', function () { authView = 'forgot'; $('#fgEmail').value = $('#aEmail').value; renderProfile(); });
$('#forgotBack').addEventListener('click', function () { authView = 'auth'; renderProfile(); });
$('#forgotForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#forgotErr').textContent = '';
  api('POST', '/api/auth/forgot', { email: $('#fgEmail').value.trim() }).then(function () {
    authView = 'auth'; renderProfile();
    toast('Ako nalog s tom adresom postoji, link za novu lozinku je poslan.');
  }).catch(function (err) { $('#forgotErr').textContent = err.message; });
});
$('#resetForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#resetErr').textContent = '';
  api('POST', '/api/auth/reset', { token: resetToken, password: $('#rsPass').value }).then(function (d) {
    me = d.korisnik; resetToken = null; authView = 'auth'; $('#rsPass').value = '';
    history.replaceState(null, '', '/');
    afterAuthChange();
    toast('Lozinka je promijenjena i prijava je uspjela.');
  }).catch(function (err) { $('#resetErr').textContent = err.message; });
});
$('#verifyResend').addEventListener('click', function () {
  api('POST', '/api/auth/resend').then(function () { toast('Link za potvrdu je poslan na ' + me.email + '.'); })
    .catch(function (err) { toast(err.message); });
});
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
  $('#authForm').hidden = !!me || authView !== 'auth';
  $('#forgotForm').hidden = !!me || authView !== 'forgot';
  $('#resetForm').hidden = !!me || authView !== 'reset';
  $('#me').hidden = !me;
  if (!me) { setAuthMode(authMode); return; }
  $('#verifyBox').hidden = me.verified;
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
function loadProfileGrid() {
  if (!me) { return; }
  var shopRole = isShop();
  api('GET', shopRole ? '/api/listings?shop=' + encodeURIComponent(me.handle) : '/api/listings?liked=1').then(function (d) {
    if (!me) { return; }
    var list = d.oglasi;
    $('#pCount').textContent = list.length;
    $('#pLikes').textContent = list.reduce(function (n, i) { return n + i.likes; }, 0);
    $('#pEmpty').hidden = list.length > 0;
    var sig = list.map(function (i) { return i.id; }).join(',');
    if (sig === gridSig) { return; }
    gridSig = sig;
    $('#pGrid').innerHTML = list.map(function (i) {
      return '<li class="tile">' + tileMedia(i) +
        '<span class="tile-price">' + fmtKM(i.price) + '</span>' +
        '<button type="button" class="tile-open" data-open="' + i.id + '" aria-label="Otvori oglas ' + esc(i.title) + '"></button>' +
        (shopRole ? '<button type="button" class="tile-del" data-del="' + i.id + '" aria-label="Obriši oglas ' + esc(i.title) + '">×</button>' : '') + '</li>';
    }).join('');
  }).catch(function (err) { if (gridSig === null) { toast(err.message); } });
}
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

/* ---------- prikazi ---------- */

function show(view, keepFeed) {
  var isFeed = view === 'feed';
  feed.hidden = !isFeed; topbar.hidden = !isFeed;
  profile.hidden = view !== 'profile'; shopView.hidden = view !== 'shop';
  inbox.hidden = view !== 'inbox'; chat.hidden = view !== 'chat'; admin.hidden = view !== 'admin';
  if (view !== 'chat') { stopChat(); }
  clearInterval(profileTimer); profileTimer = null;
  clearInterval(feedTimer); feedTimer = null;
  if (isFeed) { feedTimer = setInterval(refreshLikes, 5000); }
  if (view === 'profile') { profileTimer = setInterval(loadProfileGrid, 5000); }
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
// Mobilna aplikacija predaje push token; serveru ga prijavljujemo kad je korisnik prijavljen.
function registerPush() {
  if (me && pushToken) { api('POST', '/api/me/push-token', { token: pushToken }).catch(function () {}); }
}
window.__komodoPush = function (token) { pushToken = token; registerPush(); };
window.__komodoOpenChat = function (id) {
  if (me) { openChat(id); } else { needLogin('Prijavi se da vidiš poruku.'); }
};
// Android dugme Nazad: zatvori prozor, vrati se na prethodni ekran ili javi da se aplikacija zatvara.
window.__komodoBack = function () {
  var sheets = [[$('#confirmSheet'), closeConfirm], [postSheet, closePost], [editSheet, closeEdit], [reportSheet, closeReport], [contactSheet, closeContact]];
  for (var k = 0; k < sheets.length; k++) { if (!sheets[k][0].hidden) { sheets[k][1](); return; } }
  if (!chat.hidden) { show('inbox'); return; }
  if (!admin.hidden) { show('profile'); return; }
  if (!shopView.hidden || !inbox.hidden || !profile.hidden) { show('feed'); return; }
  if (shop) { $('#back').click(); return; }
  if (!$('#searchForm').hidden || search.q || search.min || search.max) { clearSearch(); return; }
  toApp({ type: 'exit' });
};
$('#pushToggle').addEventListener('change', function () {
  var on = $('#pushToggle').checked;
  api('PATCH', '/api/me', { pushEnabled: on }).then(function (d) {
    me = d.korisnik;
    toast(on ? 'Obavještenja o porukama su uključena.' : 'Obavještenja o porukama su isključena.');
  }).catch(function (err) { $('#pushToggle').checked = !on; toast(err.message); });
});

// Poslije prijave ili odjave: dugme Objavi samo za butike, značka poruka, svjež feed i profil.
function afterAuthChange() {
  registerPush();
  $('#tabPost').hidden = !isShop();
  clearInterval(unreadTimer); unreadTimer = null;
  if (me) { unreadTimer = setInterval(refreshUnread, 30000); }
  refreshUnread();
  if (!profile.hidden) { renderProfile(); }
  if (!me && (!inbox.hidden || !chat.hidden || !admin.hidden)) { show('profile'); }
  loadFeed(true);
}

// Kad se korisnik vrati na karticu preglednika, osvježi ono što gleda.
document.addEventListener('visibilitychange', function () {
  if (document.hidden || !me) { return; }
  refreshUnread();
  if (!profile.hidden) { loadProfileGrid(); }
  refreshLikes();
  if (!inbox.hidden) { renderInbox(); }
});

/* ---------- lozinka ---------- */

$('#passToggle').addEventListener('click', function () {
  $('#passFields').hidden = !$('#passFields').hidden;
  $('#passErr').textContent = '';
});
$('#passForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#passErr').textContent = '';
  api('POST', '/api/me/password', { current: $('#pwCur').value, next: $('#pwNew').value }).then(function () {
    $('#pwCur').value = ''; $('#pwNew').value = ''; $('#passFields').hidden = true;
    toast('Lozinka je promijenjena.');
  }).catch(function (err) { $('#passErr').textContent = err.message; });
});

/* ---------- poruke ---------- */

function fmtTime(iso) {
  var d = new Date(iso), now = new Date();
  var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  if (d.toDateString() === now.toDateString()) { return hm; }
  return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + hm;
}
function renderInbox() {
  $('#inboxHint').textContent = 'Učitavam poruke…';
  $('#inboxList').innerHTML = '';
  api('GET', '/api/conversations').then(function (d) {
    var list = d.razgovori;
    $('#inboxHint').textContent = list.length ? '' : (isShop()
      ? 'Još nema poruka. Kad ti kupac piše zbog oglasa, razgovor se pojavi ovdje.'
      : 'Još nema poruka. Na oglasu dodirni Pošalji poruku i pitaj butik šta te zanima.');
    $('#inboxList').innerHTML = list.map(function (c) {
      return '<li><button type="button" data-chat="' + c.id + '" class="' + (c.unread ? 'unread' : '') + '">' +
        '<span class="who"><span>' + esc(c.name) + '</span><time>' + esc(fmtTime(c.at)) + '</time></span>' +
        '<span class="last">' + esc(c.last || '') + '</span></button></li>';
    }).join('');
    refreshUnread();
  }).catch(function (err) { $('#inboxHint').textContent = err.message; });
}
$('#inboxList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-chat]');
  if (b) { openChat(b.getAttribute('data-chat')); }
});
function startChat(handle, listingId) {
  if (!me) { needLogin('Prijavi se ili napravi nalog da pišeš butiku.'); return; }
  api('POST', '/api/conversations', { shop: handle, listingId: listingId }).then(function (d) {
    openChat(d.razgovor);
  }).catch(function (err) { toast(err.message); });
}
function msgHTML(m) {
  return '<div class="msg' + (m.mine ? ' mine' : '') + '">' + esc(m.body) + '<time>' + esc(fmtTime(m.at)) + '</time></div>';
}
function appendMessages(list) {
  if (!list.length) { return; }
  var log = $('#chatLog'), empty = log.querySelector('.chat-empty');
  if (empty) { empty.remove(); }
  var fresh = list.filter(function (m) { return m.id > chatLast; });
  if (!fresh.length) { return; }
  log.insertAdjacentHTML('beforeend', fresh.map(msgHTML).join(''));
  chatLast = fresh[fresh.length - 1].id;
  log.scrollTop = log.scrollHeight;
}
function pollChat() {
  if (!chatId) { return; }
  var id = chatId;
  api('GET', '/api/conversations/' + id + '/messages?after=' + chatLast).then(function (d) {
    if (chatId === id) { appendMessages(d.poruke); }
  }, function () {});
}
function stopChat() {
  clearInterval(chatTimer); chatTimer = null; chatId = null;
}
function openChat(id) {
  show('chat');
  chatId = String(id); chatLast = 0;
  $('#chatName').textContent = ''; $('#chatListing').textContent = '';
  $('#chatLog').innerHTML = '<p class="chat-empty">Učitavam razgovor…</p>';
  api('GET', '/api/conversations/' + chatId + '/messages').then(function (d) {
    if (chatId !== String(id)) { return; }
    $('#chatName').textContent = d.sagovornik.name;
    $('#chatListing').textContent = d.oglas ? 'Oglas: ' + d.oglas.title + ' · ' + fmtKM(d.oglas.price) : '';
    setChatBlock(d.blokirao, d.blokirano);
    $('#chatLog').innerHTML = d.poruke.length ? '' : '<p class="chat-empty">Napiši prvu poruku.</p>';
    appendMessages(d.poruke);
    chatTimer = setInterval(pollChat, 4000);
    refreshUnread();
    $('#chatInput').focus();
  }).catch(function (err) { $('#chatLog').innerHTML = '<p class="chat-empty">' + esc(err.message) + '</p>'; });
}
function setChatBlock(mine, any) {
  chatBlocked = any;
  $('#chatBlock').textContent = mine ? 'Odblokiraj' : 'Blokiraj';
  $('#chatBlock').setAttribute('data-on', mine ? '1' : '0');
  $('#chatInput').disabled = any;
  $('#chatInput').placeholder = any ? 'Razgovor je blokiran' : 'Napiši poruku';
  $('#chatForm').setAttribute('data-off', any ? '1' : '0');
}
$('#chatBlock').addEventListener('click', function () {
  if (!chatId) { return; }
  var on = $('#chatBlock').getAttribute('data-on') === '1';
  api('POST', '/api/conversations/' + chatId + '/block', { blocked: !on }).then(function (d) {
    setChatBlock(d.blokirao, d.blokirano);
    toast(d.blokirao ? 'Korisnik je blokiran. Više ti ne može pisati.' : 'Korisnik je odblokiran.');
  }).catch(function (err) { toast(err.message); });
});
$('#chatReport').addEventListener('click', function () {
  if (chatId) { openReport({ conversationId: chatId }, 'Prijavi poruku'); }
});
$('#chatBack').addEventListener('click', function () { show('inbox'); });

/* ---------- administracija ---------- */

function renderAdmin() {
  $('#admReportsHint').textContent = 'Učitavam…';
  api('GET', '/api/admin/reports').then(function (d) {
    $('#admReportsHint').textContent = d.prijave.length ? '' : 'Nema otvorenih prijava.';
    $('#admReports').innerHTML = d.prijave.map(function (r) {
      var what = r.listing
        ? '<strong>Oglas: ' + esc(r.listing.title) + '</strong><span class="muted">Butik: ' + esc(r.listing.shopName) + '</span>' +
          '<video src="' + esc(r.listing.videoUrl) + '#t=0.1" controls muted playsinline preload="metadata"></video>'
        : '<strong>Poruka: „' + esc(r.message ? r.message.body : '') + '”</strong><span class="muted">Poslao: ' + esc(r.message ? r.message.senderName : '') + '</span>';
      var uid = r.listing ? r.listing.userId : (r.message ? r.message.userId : '');
      return '<li>' + what + '<span class="muted">Razlog: ' + esc(r.reason) + ' · prijavio ' + esc(r.reporter) + ' · ' + esc(fmtTime(r.at)) + '</span>' +
        '<div class="p-row"><button type="button" class="btn btn-main" data-res="ukloni" data-id="' + r.id + '">Ukloni sadržaj</button>' +
        '<button type="button" class="btn" data-res="odbaci" data-id="' + r.id + '">Odbaci prijavu</button>' +
        '<button type="button" class="btn btn-danger" data-susp="1" data-id="' + uid + '">Ugasi nalog</button></div></li>';
    }).join('');
  }).catch(function (err) { $('#admReportsHint').textContent = err.message; });
  api('GET', '/api/admin/users').then(function (d) {
    $('#admUsers').innerHTML = d.nalozi.map(function (u) {
      return '<li><strong>' + esc(u.name) + (u.suspended ? ' (ugašen)' : '') + '</strong>' +
        '<span class="muted">' + (u.role === 'butik' ? 'Butik · ' + u.listings + ' oglasa' : 'Kupac') + ' · ' + esc(u.email) + '</span>' +
        '<div class="p-row"><button type="button" class="btn' + (u.suspended ? '' : ' btn-danger') + '" data-susp="' + (u.suspended ? '0' : '1') + '" data-id="' + u.id + '">' +
        (u.suspended ? 'Vrati nalog' : 'Ugasi nalog') + '</button></div></li>';
    }).join('');
  }).catch(function () {});
}
admin.addEventListener('click', function (e) {
  var b = e.target.closest('[data-res], [data-susp]');
  if (!b) { return; }
  var id = b.getAttribute('data-id');
  if (b.hasAttribute('data-res')) {
    api('POST', '/api/admin/reports/' + id + '/resolve', { action: b.getAttribute('data-res') }).then(function () {
      toast(b.getAttribute('data-res') === 'ukloni' ? 'Sadržaj je uklonjen.' : 'Prijava je odbačena.');
      renderAdmin();
    }).catch(function (err) { toast(err.message); });
    return;
  }
  var off = b.getAttribute('data-susp') === '1';
  confirmAction(off
    ? { title: 'Ugasiti nalog?', text: 'Korisnik se odjavljuje, a njegov profil i oglasi nestaju iz aplikacije dok nalog ne vratiš.', ok: 'Ugasi nalog' }
    : { title: 'Vratiti nalog?', text: 'Korisnik se ponovo može prijaviti, a njegov profil i oglasi se vraćaju u aplikaciju.', ok: 'Vrati nalog' }, function () {
    api('POST', '/api/admin/users/' + id + '/suspend', { suspended: off }).then(function () {
      toast(off ? 'Nalog je ugašen.' : 'Nalog je vraćen.');
      renderAdmin();
    }).catch(function (err) { toast(err.message); });
  });
});
$('#admShopForm').addEventListener('submit', function (e) {
  e.preventDefault();
  $('#admShopErr').textContent = ''; $('#admShopDone').hidden = true;
  api('POST', '/api/admin/shops', {
    name: $('#admName').value.trim(), email: $('#admEmail').value.trim(), phone: $('#admPhone').value.trim()
  }).then(function (d) {
    var b = d.butik;
    $('#admShopDone').innerHTML = '<p><strong>Butik je otvoren.</strong></p><p>Email za prijavu: ' + esc(b.email) + '</p>' +
      '<p>Privremena lozinka: <strong>' + esc(b.password) + '</strong></p><p>Lozinka se više ne može vidjeti. Zapiši je i pošalji vlasniku.</p>';
    $('#admShopDone').hidden = false;
    $('#admName').value = ''; $('#admEmail').value = ''; $('#admPhone').value = '';
    renderAdmin();
  }).catch(function (err) { $('#admShopErr').textContent = err.message; });
});
$('#adminOpen').addEventListener('click', function () { show('admin'); });
$('#adminBack').addEventListener('click', function () { show('profile'); });
$('#chatForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = $('#chatInput'), text = input.value.trim();
  if (!text || !chatId) { return; }
  input.value = '';
  api('POST', '/api/conversations/' + chatId + '/messages', { body: text }).then(function (d) {
    appendMessages([d.poruka]);
  }).catch(function (err) { input.value = text; toast(err.message); });
});

/* ---------- objava oglasa ---------- */

fCat.innerHTML = CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
$('#eCat').innerHTML = fCat.innerHTML;

function clearPending() {
  if (pendingURL) { URL.revokeObjectURL(pendingURL); }
  pendingURL = null; pendingFile = null;
}
function resetPost() {
  postForm.reset();
  preview.pause(); preview.removeAttribute('src'); preview.load(); preview.hidden = true;
  pickText.textContent = 'Snimi ili izaberi video';
  postErr.textContent = ''; progress.hidden = true; progressBar.style.width = '0';
  postSubmit.disabled = false; postSubmit.textContent = 'Objavi';
  clearPending();
}
function openPost() {
  if (!me) { needLogin('Prijavi se nalogom butika da objaviš oglas.'); return; }
  if (!isShop()) { toast('Oglase objavljuju samo butici.'); return; }
  pauseAll();
  postSheet.hidden = false;
  fVideo.focus();
}
function closePost() {
  if (uploading) { return; }
  resetPost();
  postSheet.hidden = true;
  if (!feed.hidden) { watch(); }
}
fVideo.addEventListener('change', function () {
  var f = fVideo.files && fVideo.files[0];
  if (!f) { return; }
  if (f.type.indexOf('video/') !== 0) {
    postErr.textContent = 'Ovaj fajl nije video. Izaberi video snimak.';
    fVideo.value = '';
    return;
  }
  if (f.size > 100 * 1024 * 1024) {
    postErr.textContent = 'Video je prevelik. Najviše 100 MB, a kratak snimak je sasvim dovoljan.';
    fVideo.value = '';
    return;
  }
  clearPending();
  pendingFile = f;
  pendingURL = URL.createObjectURL(f);
  preview.src = pendingURL; preview.hidden = false;
  var p = preview.play(); if (p && p.catch) { p.catch(function () {}); }
  pickText.textContent = 'Promijeni video';
  postErr.textContent = '';
});
postForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (uploading) { return; }
  var title = fTitle.value.trim(), price = fPrice.value.trim();
  if (!pendingFile) { postErr.textContent = 'Dodaj video proizvoda.'; return; }
  if (title.length < 2) { postErr.textContent = 'Upiši naziv, npr. Crna saten haljina, M.'; fTitle.focus(); return; }
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(price.replace(/\s/g, ''))) { postErr.textContent = 'Upiši cijenu u KM brojem, npr. 65 ili 64,90.'; fPrice.focus(); return; }

  // Polja idu prije videa, da ih server ima i kad je video velik.
  var data = new FormData();
  data.append('title', title);
  data.append('price', price);
  data.append('category', fCat.value);
  data.append('video', pendingFile);

  uploading = true;
  postErr.textContent = '';
  postSubmit.disabled = true; postSubmit.textContent = 'Šaljem…';
  progress.hidden = false;

  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/listings');
  xhr.withCredentials = true;
  xhr.upload.onprogress = function (ev) {
    if (ev.lengthComputable) { progressBar.style.width = Math.round(ev.loaded / ev.total * 100) + '%'; }
  };
  function fail(msg) {
    uploading = false;
    postErr.textContent = msg;
    postSubmit.disabled = false; postSubmit.textContent = 'Objavi';
    progress.hidden = true; progressBar.style.width = '0';
  }
  xhr.onload = function () {
    var res = {};
    try { res = JSON.parse(xhr.responseText); } catch (err) {}
    if (xhr.status === 201) {
      uploading = false;
      resetPost();
      postSheet.hidden = true;
      shop = null; brand.hidden = false; shopbar.hidden = true;
      filter = 'Sve'; renderChips(); show('feed', true); loadFeed(true);
      toast('Oglas je objavljen.');
    } else if (xhr.status === 401) {
      fail('Prijava je istekla. Prijavi se ponovo, pa objavi.');
    } else {
      fail(res.greska || 'Objava nije uspjela. Pokušaj ponovo.');
    }
  };
  xhr.onerror = function () { fail('Nema veze sa serverom. Provjeri internet i pokušaj ponovo.'); };
  xhr.send(data);
});
$('#postCancel').addEventListener('click', closePost);
postSheet.addEventListener('click', function (e) { if (e.target === postSheet) { closePost(); } });
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') { return; }
  if (!$('#confirmSheet').hidden) { closeConfirm(); return; }
  if (!postSheet.hidden) { closePost(); }
  if (!editSheet.hidden) { closeEdit(); }
  if (!reportSheet.hidden) { closeReport(); }
  if (!contactSheet.hidden) { closeContact(); }
});

/* ---------- start ---------- */

renderChips();
var params = new URLSearchParams(location.search);
var startId = /^\d+$/.test(params.get('o') || '') ? params.get('o') : null;
var startShop = params.get('b');
api('GET', '/api/me').then(function (d) { me = d.korisnik; setBadge(d.neprocitano); }, function () {}).then(function () {
  $('#tabPost').hidden = !isShop();
  if (me) { unreadTimer = setInterval(refreshUnread, 30000); }
  feedTimer = setInterval(refreshLikes, 5000);
  toApp({ type: 'ready' });
  var confirmed = params.get('potvrda'), chatParam = params.get('poruke');
  resetToken = /^[a-f0-9]{20,100}$/.test(params.get('lozinka') || '') ? params.get('lozinka') : null;
  if (confirmed === 'ok') { toast('Email je potvrđen.'); }
  if (confirmed === 'istekla') { toast('Link za potvrdu je istekao. Novi tražiš u profilu.'); }
  if (confirmed || chatParam) { history.replaceState(null, '', '/'); }
  if (startShop) { openShopProfile(startShop.toLowerCase()); return; }
  loadFeed(true, startId);
  if (resetToken && !me) { authView = 'reset'; show('profile'); }
  else if (chatParam && /^\d+$/.test(chatParam)) {
    if (me) { openChat(chatParam); } else { needLogin('Prijavi se da vidiš poruku.'); }
  }
});
})();
