// Komodo web — Feed: kartice, učitavanje strana, sviđanja, pregledi, zvuk, dijeljenje, pretraga, prijava sadržaja, kategorije.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- feed ---------- */

function soundBtnInner() {
  return (soundOn ? ICON.soundOn : ICON.soundOff) + '<span class="n">' + (soundOn ? 'Zvuk' : 'Bez zvuka') + '</span>';
}
// Broj sviđanja na kartici; 0 se ne piše (samo srce).
function likeCount(i) { return i.likes > 0 ? String(i.likes) : ''; }
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
      '<button type="button" class="act' + (i.liked ? ' on' : '') + '" data-act="like" aria-pressed="' + (i.liked ? 'true' : 'false') + '" aria-label="Sviđa mi se">' + ICON.heart + '<span class="n">' + likeCount(i) + '</span></button>' +
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
              : '<p>Butici uskoro dodaju prve snimke. Svrati opet.</p>') +
    (filter !== 'Sve' ? '<button type="button" class="cta" data-act="all">Pogledaj sve oglase</button>' : '') + '</div></article>';
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
        if (vid) { currentId = vid; }
        if (vid && !viewed[vid]) { viewed[vid] = true; queueView(vid); }
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
    } else { toast(err.message, true); }
  });
}
function paintLike(item) {
  var btn = feed.querySelector('.card[data-id="' + item.id + '"] [data-act="like"]');
  if (!btn) { return; }
  btn.classList.toggle('on', !!item.liked);
  btn.setAttribute('aria-pressed', item.liked ? 'true' : 'false');
  btn.querySelector('.n').textContent = likeCount(item);
}
// Dok je feed otvoren i stranica vidljiva, broj sviđanja oglasa na ekranu se osvježava sam.
function refreshLikes() {
  if (feed.hidden || !pageVisible() || !currentId || !byId(currentId) || likeBusy[currentId]) { return; }
  var id = currentId;
  api('GET', '/api/likes?ids=' + encodeURIComponent(id)).then(function (d) {
    var item = byId(id), v = d.svidjanja && d.svidjanja[id];
    if (!item || !v || likeBusy[id] || (item.likes === v.likes && item.liked === v.liked)) { return; }
    item.likes = v.likes; item.liked = v.liked;
    paintLike(item);
  }, function () {});
}

/* ---------- pregledi: skupljaju se i šalju zajedno ---------- */

function queueView(id) {
  viewQueue.push(Number(id));
  if (viewQueue.length > MAX_VIEW_QUEUE) { viewQueue = viewQueue.slice(-MAX_VIEW_QUEUE); }
}
function requeueViews(ids) {
  viewQueue = ids.concat(viewQueue);
  if (viewQueue.length > MAX_VIEW_QUEUE) { viewQueue = viewQueue.slice(-MAX_VIEW_QUEUE); }
}
// Stari API (bez /api/views): svaki pregled ide posebno, kao ranije.
function sendViewsOneByOne(ids, keepalive) {
  ids.forEach(function (id) {
    try {
      fetch('/api/listings/' + id + '/view', { method: 'POST', credentials: 'same-origin', keepalive: !!keepalive }).catch(function () {});
    } catch (e) {}
  });
}
// Pri sakrivanju stranice: sendBeacon ako postoji, inače fetch s keepalive.
function flushViewsOnHide() {
  if (!viewQueue.length) { return; }
  var ids = viewQueue; viewQueue = [];
  if (viewsBatch === false) { sendViewsOneByOne(ids, true); return; }
  var failed = [];
  for (var k = 0; k < ids.length; k += VIEWS_PER_REQUEST) {
    var chunk = ids.slice(k, k + VIEWS_PER_REQUEST), body = JSON.stringify({ ids: chunk }), ok = false;
    try {
      if (navigator.sendBeacon) {
        ok = navigator.sendBeacon('/api/views', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/views', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: body }).catch(function () {});
        ok = true;
      }
    } catch (e) { ok = false; }
    if (!ok) { failed = failed.concat(chunk); }
  }
  if (failed.length) { requeueViews(failed); }
}
// Redovno slanje (svakih 30 s): jedan zahtjev po najviše 50 oglasa.
function flushViews() {
  if (viewsSending || !viewQueue.length) { return; }
  var ids = viewQueue.slice(0, VIEWS_PER_REQUEST);
  viewQueue = viewQueue.slice(ids.length);
  if (viewsBatch === false) { sendViewsOneByOne(ids, false); flushViews(); return; }
  viewsSending = true;
  fetch('/api/views', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids })
  }).then(function (res) {
    viewsSending = false;
    if (res.status === 404 || res.status === 405) { viewsBatch = false; sendViewsOneByOne(ids, false); flushViews(); return; }
    if (res.ok) { viewsBatch = true; flushViews(); return; }
    if (res.status === 429 || res.status >= 500) { requeueViews(ids); }
  }, function () {
    viewsSending = false;
    requeueViews(ids);
  });
}
setInterval(flushViews, 30000);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { flushViewsOnHide(); }
});
window.addEventListener('pagehide', flushViewsOnHide);
function toggleSound() {
  soundOn = !soundOn;
  var vs = feed.querySelectorAll('video');
  for (var k = 0; k < vs.length; k++) { vs[k].muted = !soundOn; }
  var bs = feed.querySelectorAll('[data-act="sound"]');
  for (var j = 0; j < bs.length; j++) { bs[j].innerHTML = soundBtnInner(); }
}

feed.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]');
  var act = btn ? btn.getAttribute('data-act') : null;
  if (act === 'post') { openPost(); return; }
  if (act === 'retry') { loadFeed(true); return; }
  if (act === 'clear') { clearSearch(); return; }
  if (act === 'all') { filter = 'Sve'; renderChips(); loadFeed(true); return; }
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
    // Dok zahtjev za ovaj oglas traje, novi dodiri na isto srce se ne šalju.
    if (likeBusy[item.id]) { return; }
    var want = !item.liked, wasLiked = item.liked, wasLikes = item.likes;
    likeBusy[item.id] = true;
    item.liked = want; item.likes = Math.max(0, item.likes + (want ? 1 : -1));
    paintLike(item);
    api('POST', '/api/listings/' + item.id + '/like', { liked: want }).then(function (d) {
      delete likeBusy[item.id];
      item.liked = d.liked; item.likes = d.likes;
      paintLike(item);
    }).catch(function (err) {
      delete likeBusy[item.id];
      item.liked = wasLiked; item.likes = wasLikes;
      paintLike(item);
      toast(err.message, true);
    });
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
