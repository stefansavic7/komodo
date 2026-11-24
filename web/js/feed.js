// Komodo web — Feed: kartice oglasa, kartice feeda (Za tebe, Novo, Praćeni), uputa za prevlačenje, učitavanje strana, sviđanja, pregledi, zvuk, dijeljenje, pretraga, prijava sadržaja, kategorije.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- feed ---------- */

/* ---------- veličine (F-03) ---------- */

var SIZE_ODJECA = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'UNI'];
var SIZE_OBUCA = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
var SIZE_MAX_FILTER = 6;
// Veličine koje kategorija nudi; prazan niz = birač se ne prikazuje (Torbe, Nakit: server upisuje UNI).
function sizeSet(cat) {
  if (cat === 'Obuća') { return SIZE_OBUCA; }
  if (cat === 'Torbe' || cat === 'Nakit') { return []; }
  return SIZE_ODJECA;
}
function sizeLabel(v) { return v === 'UNI' ? 'Jedna veličina' : v; }
// Red na kartici: „Vel. S · M · L”, „Br. 38 · 39” ili „Jedna veličina”; više od 6 → prvih 5 i „+N”.
function sizesLine(sizes) {
  if (!sizes || !sizes.length) { return ''; }
  if (sizes.length === 1 && sizes[0] === 'UNI') { return 'Jedna veličina'; }
  var shoe = /^\d/.test(sizes[0]);
  var shown = sizes.length > 6 ? sizes.slice(0, 5) : sizes;
  return (shoe ? 'Br. ' : 'Vel. ') + shown.map(sizeLabel).join(' · ') + (sizes.length > 6 ? ' · +' + (sizes.length - 5) : '');
}
function sizeButtonsHTML(list, selected) {
  return list.map(function (v) {
    var on = selected.indexOf(v) !== -1;
    return '<button type="button" class="size-btn" data-size="' + v + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(sizeLabel(v)) + '</button>';
  }).join('');
}
// Birač u formi: pokazuje se samo kad kategorija nudi veličine; vraća izbor očišćen od vrijednosti koje ne pripadaju kategoriji.
function paintSizePicker(box, group, cat, selected) {
  var list = sizeSet(cat);
  var keep = selected.filter(function (v) { return list.indexOf(v) !== -1; });
  box.hidden = !list.length;
  group.innerHTML = sizeButtonsHTML(list, keep);
  return keep;
}
function toggleSize(arr, v) {
  var k = arr.indexOf(v);
  if (k === -1) { arr.push(v); } else { arr.splice(k, 1); }
  return arr;
}
// Moje veličine (filter): pamte se u localStorage['komodo.velicine'] dok se ne ponište.
function loadMySizes() {
  var out = [];
  try {
    var a = JSON.parse(localStorage.getItem('komodo.velicine') || '[]');
    for (var k = 0; k < a.length && out.length < SIZE_MAX_FILTER; k++) {
      if ((SIZE_ODJECA.indexOf(a[k]) !== -1 || SIZE_OBUCA.indexOf(a[k]) !== -1) && out.indexOf(a[k]) === -1) { out.push(a[k]); }
    }
  } catch (e) { out = []; }
  return out;
}
var mojeVelicine = loadMySizes();
function saveMySizes() { try { localStorage.setItem('komodo.velicine', JSON.stringify(mojeVelicine)); } catch (e) {} }
// Za Torbe i Nakit se filter veličine ne šalje.
function activeSizes() { return (filter === 'Torbe' || filter === 'Nakit') ? [] : mojeVelicine; }

/* ---------- U-04: namjera se ne gubi ---------- */

var POSLE_MS = 30 * 60000;
function readPosle() {
  var p = null;
  try { p = JSON.parse(sessionStorage.getItem('komodo.posle') || 'null'); } catch (e) { p = null; }
  if (!p || typeof p.t !== 'string' || (p.at && Date.now() - p.at > POSLE_MS)) { return null; }
  return p;
}
function clearPosle() { try { sessionStorage.removeItem('komodo.posle'); } catch (e) {} }
// Neprijavljen dodir: čuva radnju, otvara „Novi nalog” s tekstom prema radnji (p.lead).
function needAccount(p) {
  p.at = Date.now();
  try { sessionStorage.setItem('komodo.posle', JSON.stringify(p)); } catch (e) {}
  setAuthMode('register');
  show('profile');
}

function soundBtnInner() {
  return (soundOn ? ICON.soundOn : ICON.soundOff) + '<span class="n">' + (soundOn ? 'Zvuk' : 'Bez zvuka') + '</span>';
}
// Broj sviđanja na kartici; 0 se ne piše (samo srce).
function likeCount(i) { return i.likes > 0 ? String(i.likes) : ''; }
var ICON_MORE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>';
var moreSheet = $('#moreSheet'), moreItem = null;
function followBtnHTML(i) {
  if (i.mine) { return ''; }
  var on = !!me && isFollowing(i.handle);
  return '<button type="button" class="follow-btn" data-act="follow" aria-pressed="' + (on ? 'true' : 'false') + '">' + (on ? 'Pratiš' : 'Prati') + '</button>';
}
function paintFollowBtns(handle) {
  var cards = feed.querySelectorAll('.card[data-id]');
  for (var k = 0; k < cards.length; k++) {
    var it = byId(cards[k].getAttribute('data-id')), b = cards[k].querySelector('[data-act="follow"]');
    if (!it || !b || String(it.handle).toLowerCase() !== String(handle).toLowerCase()) { continue; }
    var on = !!me && isFollowing(it.handle);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'Pratiš' : 'Prati';
  }
}
function paintAllFollow() {
  var cards = feed.querySelectorAll('.card[data-id]');
  for (var k = 0; k < cards.length; k++) {
    var it = byId(cards[k].getAttribute('data-id'));
    if (it && !it.mine) { paintFollowBtns(it.handle); }
  }
}
function cardHTML(i) {
  var vel = sizesLine(i.sizes);
  return '<article class="card' + (i.sold ? ' is-sold' : '') + '" data-id="' + i.id + '">' +
    '<video class="media" src="' + esc(i.videoUrl) + '"' + (i.posterUrl ? ' poster="' + esc(i.posterUrl) + '"' : '') + ' playsinline muted loop preload="metadata"></video>' +
    '<div class="scrim"></div>' +
    '<div class="meta">' +
      '<div class="seller-row"><button type="button" class="seller-btn" data-act="shop"><span class="avatar" aria-hidden="true">' + esc(initial(i.shopName)) + '</span><span>' + esc(i.shopName) + '</span></button>' + followBtnHTML(i) + '</div>' +
      '<h2 class="title">' + esc(i.title) + '</h2>' +
      (i.processing && i.mine ? '<p class="state">Obrađuje se — kupci će ga vidjeti za 1–3 minute.</p>' : '') +
      (i.videoError ? '<p class="state state-err">Obrada videa nije uspjela. Obriši oglas i objavi video ponovo.</p>' : '') +
      '<p class="row">' + (i.oldPrice ? '<s class="old-price">' + fmtKM(i.oldPrice) + '</s>' : '') + '<span class="price">' + fmtKM(i.price) + '</span>' +
        (i.oldPrice ? '<span class="drop">Sniženo</span>' : '') + (i.sold ? '<span class="sold">Prodato</span>' : '') + '<span class="cat">' + esc(i.category) + '</span>' +
        (i.mine ? '<span class="views">' + (i.views || 0) + ' pregleda</span>' : '') + '</p>' +
      (vel ? '<p class="vel">' + esc(vel) + '</p>' : '') +
      (i.mine ? '' : '<button type="button" class="cta" data-act="contact">Kontaktiraj butik</button>') +
    '</div>' +
    '<div class="actions">' +
      '<button type="button" class="act' + (i.liked ? ' on' : '') + '" data-act="like" aria-pressed="' + (i.liked ? 'true' : 'false') + '" aria-label="Sviđa mi se">' + ICON.heart + '<span class="n">' + likeCount(i) + '</span></button>' +
      '<button type="button" class="act" data-act="share" aria-label="Podijeli oglas">' + ICON.share + '<span class="n">Podijeli</span></button>' +
      '<button type="button" class="act" data-act="sound" aria-label="Uključi ili isključi zvuk">' + soundBtnInner() + '</button>' +
      (i.mine
        ? '<button type="button" class="act" data-act="more" aria-label="Više" aria-haspopup="dialog">' + ICON_MORE + '<span class="n">Više</span></button>'
        : '<button type="button" class="act" data-act="report" aria-label="Prijavi oglas">' + ICON.flag + '<span class="n">Prijavi</span></button>') +
    '</div></article>';
}
function emptySizesHTML() {
  return '<article class="card empty"><div class="empty-box"><h2>Nema oglasa u tvojoj veličini</h2>' +
    '<p>Probaj bez filtera veličine.</p><button type="button" class="cta" data-act="clearsizes">Poništi veličine</button></div></article>';
}
function emptyHTML() {
  if (activeSizes().length) { return emptySizesHTML(); }
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
/* ---------- kartice feeda: „Za tebe”, „Novo”, „Praćeni” (F-01) ---------- */

// Pretraga i pregled jednog butika idu starom listom (/api/listings, redom „Novo”), bez kartica.
function feedMode() { return (shop || search.q || search.min || search.max) ? 'lista' : kartica; }
function renderTabs() {
  ftabs.hidden = feedMode() === 'lista';
  var bs = ftabs.querySelectorAll('.ftab');
  for (var k = 0; k < bs.length; k++) { bs[k].setAttribute('aria-pressed', bs[k].getAttribute('data-k') === kartica ? 'true' : 'false'); }
}
// Kartica po zadanom: butik „Novo” (svoje oglase ne vidi u „Za tebe”), ostali „Za tebe”.
// Poslije registracije s kartice „Praćeni” (U-18) feed se vraća na nju.
function pickTab() {
  var posle = null;
  try { posle = JSON.parse(sessionStorage.getItem('komodo.posle') || 'null'); } catch (e) { posle = null; }
  if (me && posle && posle.t === 'tab' && (posle.v === 'zatebe' || posle.v === 'novo' || posle.v === 'praceni')) {
    try { sessionStorage.removeItem('komodo.posle'); } catch (e) {}
    kartica = posle.v; karticaRucno = true;
    if (feed.hidden) { show('feed', true); }
    return;
  }
  if (!karticaRucno) { kartica = isShop() ? 'novo' : 'zatebe'; }
}
ftabs.addEventListener('click', function (e) {
  var b = e.target.closest('.ftab');
  if (!b) { return; }
  // Dodir na već aktivnu karticu: osvježi od početka.
  kartica = b.getAttribute('data-k'); karticaRucno = true;
  feed.scrollTop = 0;
  loadFeed(true);
});
function pracenEmptyHTML() {
  if (!me) {
    return '<article class="card empty"><div class="empty-box"><h2>Prati butike koji ti se sviđaju</h2>' +
      '<p>Njihovi novi snimci će biti ovdje.</p><button type="button" class="cta" data-act="nalog">Napravi nalog</button></div></article>';
  }
  if (!(me.followingCount > 0)) {
    return '<article class="card empty"><div class="empty-box"><h2>Još ne pratiš nijedan butik</h2>' +
      '<p>Dodirni „Prati” pored imena butika na oglasu ili na njegovom profilu.</p>' +
      '<button type="button" class="cta" data-act="zatebe">Idi na Za tebe</button></div></article>';
  }
  if (activeSizes().length) { return emptySizesHTML(); }
  return '<article class="card empty"><div class="empty-box"><h2>Butici koje pratiš još nemaju oglasa.</h2>' +
    (filter !== 'Sve' ? '<button type="button" class="cta" data-act="all">Pogledaj sve oglase</button>' : '') + '</div></article>';
}
// R2-01: „Prikaži još” poslije PRAZNIH_NAJVISE strana zaredom bez novih oglasa (dalje samo na dodir).
function josHTML() {
  return '<article class="card empty jos"><div class="empty-box"><button type="button" class="cta" data-act="jos">Prikaži starije oglase</button></div></article>';
}
function dividerHTML() {
  return '<article class="card empty razdjelnik"><div class="empty-box"><h2>To je sve za sada u „Za tebe”. Slijede najnoviji oglasi.</h2></div></article>';
}
function feedUrl(mode, reset) {
  var qs = [];
  if (filter !== 'Sve') { qs.push('category=' + encodeURIComponent(filter)); }
  if (activeSizes().length) { qs.push('sizes=' + encodeURIComponent(activeSizes().join(','))); }
  if (mode === 'lista') {
    if (shop) { qs.push('shop=' + encodeURIComponent(shop)); }
    if (search.q) { qs.push('q=' + encodeURIComponent(search.q)); }
    if (search.min) { qs.push('min=' + encodeURIComponent(search.min)); }
    if (search.max) { qs.push('max=' + encodeURIComponent(search.max)); }
    if (!reset && items.length) { qs.push('before=' + items[items.length - 1].id); }
    return '/api/listings' + (qs.length ? '?' + qs.join('&') : '');
  }
  if (mode === 'zatebe' && !zaTebeKraj) {
    qs.unshift('kartica=zatebe');
    // Zadnjih IZUZMI_MAX prikazanih (server ih uzima isto toliko; pokriva sve kandidate C∪D = 300, R2-01).
    if (shownIds.length) { qs.push('izuzmi=' + shownIds.slice(-IZUZMI_MAX).join(',')); }
  } else if (mode === 'zatebe') {
    qs.unshift('kartica=novo');                      // nastavak poslije kraja „Za tebe”
    if (novoBefore) { qs.push('before=' + novoBefore); }
  } else {
    qs.unshift('kartica=' + mode);
    if (!reset && items.length) { qs.push('before=' + items[items.length - 1].id); }
  }
  return '/api/feed?' + qs.join('&');
}
// R2-01: zaštita od lanca praznih strana. Strana bez ijednog novog oglasa (poslije uklanjanja duplikata) broji se
// u praznihZaredom; poslije takve strane sljedeća ide najranije za RAZMAK_MS, a poslije PRAZNIH_NAJVISE zaredom
// automatsko učitavanje staje (dugme „Prikaži starije oglase”). Tako nijedan odgovor servera ne može izazvati
// brzo ponavljanje zahtjeva (ranije ~60/s kad je „Za tebe” vraćao samo već prikazane oglase).
var IZUZMI_MAX = 400, PRAZNIH_NAJVISE = 2, RAZMAK_MS = 1000;
var praznihZaredom = 0, zadnjeUcitavanje = 0, odgodaUcitavanja = null;
function loadFeed(reset, firstId) {
  if (reset) { pickTab(); }
  renderTabs();
  if (loading || (!reset && noMore)) { return Promise.resolve(); }
  if (!reset) {
    if (praznihZaredom >= PRAZNIH_NAJVISE) { return Promise.resolve(); }
    var ceka = zadnjeUcitavanje + RAZMAK_MS - Date.now();
    if (praznihZaredom > 0 && ceka > 0) {
      // Jednokratno odgađanje (nije periodični tajmer); poništava ga svako osvježavanje.
      if (!odgodaUcitavanja) { odgodaUcitavanja = setTimeout(function () { odgodaUcitavanja = null; loadFeed(false); }, ceka); }
      return Promise.resolve();
    }
  }
  var mode = feedMode();
  if (reset) {
    items = []; noMore = false; shownIds = []; zaTebeKraj = false; novoBefore = null;
    praznihZaredom = 0; clearTimeout(odgodaUcitavanja); odgodaUcitavanja = null;
  }
  if (mode === 'praceni' && !me && !firstId) {
    noMore = true;
    feed.innerHTML = pracenEmptyHTML(); feed.scrollTop = 0;
    return Promise.resolve();
  }
  loading = true;
  if (reset) { feed.innerHTML = '<article class="card loading"><p>Učitavam oglase…</p></article>'; }
  var cont = mode === 'zatebe' && zaTebeKraj;      // strana „Novo” poslije kraja „Za tebe”
  var url = (mode === 'praceni' && !me) ? null : feedUrl(mode, reset);
  var first = (reset && firstId) ? api('GET', '/api/listings/' + firstId).then(function (d) { return d.oglas; }, function () { toast('Taj oglas više ne postoji.'); return null; }) : Promise.resolve(null);
  return Promise.all([first, url ? api('GET', url) : Promise.resolve({ oglasi: [] })]).then(function (r) {
    var list = r[1].oglasi, divider = false, again = false, prelaz = false;
    if (mode === 'zatebe' && !cont) {
      // Kraj „Za tebe”: server kaže kraj, ili strana nema nijedan nov oglas (svi već prikazani) — tada je
      // kraj za ovog korisnika, ma šta server rekao (R2-01, odbrana u dubinu).
      var novih = list.filter(function (i) { return !byId(i.id); }).length + (r[0] && !byId(r[0].id) ? 1 : 0);
      if (r[1].kraj || !novih) {
        zaTebeKraj = true; prelaz = true;
        if (r[1].rezim === 'hitno') {
          // Hitni režim servera (talas 4): ovo je već prva strana „Novo” — bez razdjelnika, dalje strane „Novo”.
          if (list.length) { novoBefore = list[list.length - 1].id; }
          if (list.length < 20) { noMore = true; }
        } else {
          // Razdjelnik samo ako je „Za tebe” nešto prikazao; inače odmah najnoviji.
          if (items.length || list.length || r[0]) { divider = true; }
          again = true;
        }
      }
    } else {
      if (list.length < 20) { noMore = true; }
      if (cont && list.length) { novoBefore = list[list.length - 1].id; }
    }
    if (r[0]) { list = [r[0]].concat(list.filter(function (i) { return i.id !== r[0].id; })); }
    var fresh = list.filter(function (i) { return !byId(i.id); });
    if (mode === 'zatebe' && !cont) { fresh.forEach(function (i) { shownIds.push(i.id); }); }
    if (shownIds.length > 2 * IZUZMI_MAX) { shownIds = shownIds.slice(-IZUZMI_MAX); }
    // Prelaz „Za tebe” → „Novo” je promjena stanja, ne prazna strana: „Novo” se učitava odmah.
    praznihZaredom = (fresh.length || prelaz) ? 0 : praznihZaredom + 1;
    zadnjeUcitavanje = Date.now();
    var html = fresh.map(cardHTML).join('') + (divider ? dividerHTML() : '');
    // Nastavak „Novo” koji je sav već prikazan: sljedeća strana (uz razmak i granicu iznad).
    if (cont && !fresh.length && !noMore) { again = true; }
    var stani = again && praznihZaredom >= PRAZNIH_NAJVISE;
    if (stani) { again = false; html += josHTML(); }
    if (reset) {
      if (html) { feed.innerHTML = html; }
      else if (!again) { feed.innerHTML = mode === 'praceni' ? pracenEmptyHTML() : emptyHTML(); }
      feed.scrollTop = 0;
    } else {
      // Prva strana je bila prazna („Za tebe” bez oglasa) pa se odmah učitava „Novo”: skloni „Učitavam…”.
      var ld = feed.querySelector('.card.loading');
      if (ld && (html || !again)) { feed.removeChild(ld); }
      if (html) { feed.insertAdjacentHTML('beforeend', html); }
      else if (!items.length && !again && !feed.querySelector('.card')) { feed.innerHTML = emptyHTML(); }
    }
    items = items.concat(fresh);
    loading = false;
    watch();
    if (me && fresh.length) { ensureFollows().then(paintAllFollow); }
    if (fresh.length && items.length === fresh.length) { showUputa(); }
    if (again) { return loadFeed(false); }
  }).catch(function (err) {
    loading = false;
    if (reset) {
      feed.innerHTML = '<article class="card empty"><div class="empty-box"><h2>Oglasi se nisu učitali</h2><p>' + esc(err.message) + '</p>' +
        '<button type="button" class="cta" data-act="retry">Pokušaj ponovo</button></div></article>';
    } else { toast(err.message, true); }
  });
}

/* ---------- U-12: uputa za prevlačenje (samo prvi put) ---------- */

var uputaTimer = null;
function hideUputa() {
  if (uputa.hidden) { return; }
  uputa.hidden = true;
  clearTimeout(uputaTimer); uputaTimer = null;
  feed.removeEventListener('scroll', hideUputa);
}
function showUputa() {
  var seen = '1';
  try { seen = localStorage.getItem('komodo.uputa'); } catch (e) { seen = '1'; }
  if (seen || feed.hidden || !feed.querySelector('.card[data-id]')) { return; }
  try { localStorage.setItem('komodo.uputa', '1'); } catch (e) {}
  uputa.hidden = false;
  feed.addEventListener('scroll', hideUputa, { passive: true });
  uputaTimer = setTimeout(hideUputa, 4000);
}

function paintLike(item) {
  var btn = feed.querySelector('.card[data-id="' + item.id + '"] [data-act="like"]');
  if (!btn) { return; }
  btn.classList.toggle('on', !!item.liked);
  btn.setAttribute('aria-pressed', item.liked ? 'true' : 'false');
  btn.querySelector('.n').textContent = likeCount(item);
}
// Dok je feed otvoren i stranica vidljiva, broj sviđanja oglasa na ekranu se osvježava sam.
// B-01: najviše jednom u ~intervalu sviđanja (30 s; KONFIG, talas 4), i kad ga tajmer ili povratak na stranicu
// zovu češće. Prag je 75 % intervala, jer tajmer ima nasumičan pomak ±20 %.
function refreshLikes() {
  if (feed.hidden || !pageVisible() || !currentId || !byId(currentId) || likeBusy[currentId]) { return; }
  if (Date.now() - likesAt < intervalZa('likes') * 0.75) { return; }
  likesAt = Date.now();
  var id = currentId;
  return api('GET', '/api/likes?ids=' + encodeURIComponent(id)).then(function (d) {
    var item = byId(id), v = d.svidjanja && d.svidjanja[id];
    if (!item || !v || likeBusy[id] || (item.likes === v.likes && item.liked === v.liked)) { return; }
    item.likes = v.likes; item.liked = v.liked;
    paintLike(item);
  }, function () {});
}

/* ---------- pregledi: skupljaju se i šalju zajedno ---------- */

function queueView(id) {
  if (!KONFIG.pregledi) { return; }   // hitni režim: pregledi se ne šalju (server ih tada ni ne broji)
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
  return fetch('/api/views', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids })
  }).then(function (res) {
    viewsSending = false;
    zabiljeziOdgovor(res.status, res.headers.get('Retry-After'));
    if (res.status === 404 || res.status === 405) { viewsBatch = false; sendViewsOneByOne(ids, false); flushViews(); return; }
    if (res.ok) { viewsBatch = true; flushViews(); return; }
    if (res.status === 429 || res.status >= 500) { requeueViews(ids); }
  }, function () {
    viewsSending = false;
    zabiljeziOdgovor(0);
    requeueViews(ids);
  });
}
// Svakih ~30 s (KONFIG.intervali.views, ±20 %, duže poslije grešaka servera).
var viewsTimer = tajmer('views', flushViews);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { flushViewsOnHide(); hiddenAt = Date.now(); return; }
  // Povratak poslije više od 30 min: feed od početka (novi „Za tebe”, prazan izuzmi).
  if (hiddenAt && Date.now() - hiddenAt > 30 * 60000 && !feed.hidden && feedMode() !== 'lista') { loadFeed(true); }
  hiddenAt = 0;
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
  if (act === 'jos') {
    var jos = btn.closest('.card');
    if (jos) { feed.removeChild(jos); }
    praznihZaredom = 0;
    loadFeed(false);
    return;
  }
  if (act === 'clear') { clearSearch(); return; }
  if (act === 'all') { filter = 'Sve'; renderChips(); loadFeed(true); return; }
  if (act === 'clearsizes') { clearSizes(); return; }
  if (act === 'zatebe') { kartica = 'zatebe'; karticaRucno = true; loadFeed(true); return; }
  if (act === 'nalog') {
    // U-18 / U-04: poslije registracije feed se vraća na „Praćeni”.
    needAccount({ t: 'tab', v: 'praceni' });
    return;
  }
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
    if (!me) { needAccount({ t: 'like', id: item.id, lead: 'Napravi besplatan nalog da sačuvaš ovaj oglas.' }); return; }
    setLike(item, !item.liked);
  } else if (act === 'follow') {
    toggleFollowCard(item, btn);
  } else if (act === 'more') {
    openMore(item);
  } else if (act === 'share') {
    shareListing(item);
  } else if (act === 'report') {
    openReport({ listingId: item.id }, 'Prijavi oglas');
  }
});

// Sviđanje (want = true/false): odmah na ekranu, vraća se na grešku. Dok zahtjev traje, novi dodiri se ne šalju.
function setLike(item, want) {
  if (likeBusy[item.id]) { return; }
  var wasLiked = item.liked, wasLikes = item.likes;
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
}
var followBusy = {};
function toggleFollowCard(item, btn) {
  var handle = String(item.handle).toLowerCase();
  if (!me) {
    needAccount({ t: 'follow', handle: handle, name: item.shopName, id: item.id, lead: 'Napravi besplatan nalog da pratiš ' + item.shopName + '.' });
    return;
  }
  if (followBusy[handle]) { return; }
  followBusy[handle] = true;
  btn.disabled = true;
  followShop(handle, item.shopName, !isFollowing(handle)).then(function () {
    delete followBusy[handle]; btn.disabled = false; paintFollowBtns(handle);
  }).catch(function (err) {
    delete followBusy[handle]; btn.disabled = false; paintFollowBtns(handle); toast(err.message, true);
  });
}

/* ---------- U-10: „Više” za vlastiti oglas ---------- */

// Ažurira oglas u feedu poslije izmjene i crta karticu ponovo.
function applyUpdated(oglas) {
  var item = byId(oglas.id), card = feed.querySelector('.card[data-id="' + oglas.id + '"]');
  if (!item || !card) { return; }
  Object.keys(oglas).forEach(function (k) { item[k] = oglas[k]; });
  card.outerHTML = cardHTML(item);
}
function openMore(item) {
  pauseAll();
  moreItem = item;
  $('#moreSold').textContent = item.sold ? 'Vrati u prodaju' : 'Označi kao prodato';
  $('#moreStats').hidden = typeof openStats !== 'function';
  moreSheet.hidden = false;
  moreSheet.querySelector('.btn').focus();
}
function closeMore(keepPaused) {
  moreSheet.hidden = true; moreItem = null;
  if (!keepPaused && !feed.hidden) { watch(); }
}
moreSheet.addEventListener('click', function (e) {
  if (e.target === moreSheet) { closeMore(); return; }
  var b = e.target.closest('[data-more]');
  if (!b || !moreItem) { return; }
  var what = b.getAttribute('data-more'), item = moreItem;
  if (what === 'close') { closeMore(); }
  else if (what === 'edit') { closeMore(true); openEdit(item); }
  else if (what === 'stats') { closeMore(true); openStats(item.id); }
  else if (what === 'del') {
    closeMore(true);
    confirmAction(DELETE_LISTING, function () {
      removeListing(item.id, function () { loadFeed(true); });
    });
  } else if (what === 'sold') {
    closeMore();
    var want = !item.sold;
    api('PATCH', '/api/listings/' + item.id, { title: item.title, price: item.price, category: item.category, sold: want }).then(function (d) {
      applyUpdated(d.oglas);
      watch();
      toast(want ? 'Oglas je označen kao prodat.' : 'Oglas je vraćen u prodaju.');
    }).catch(function (err) { toast(err.message, true); });
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
  var vt = activeSizes().length
    ? '<button type="button" class="vtab" data-vel="clear" aria-label="Poništi filter veličine">Veličine: ' + esc(activeSizes().map(sizeLabel).join(', ')) + ' ✕</button>' : '';
  chips.innerHTML = vt + ['Sve'].concat(CATS).map(function (c) {
    return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === filter ? 'true' : 'false') + '">' + esc(c) + '</button>';
  }).join('');
}
chips.addEventListener('click', function (e) {
  if (e.target.closest('.vtab')) { clearSizes(); return; }
  var b = e.target.closest('.chip');
  if (!b) { return; }
  filter = b.getAttribute('data-cat');
  renderChips(); loadFeed(true);
});

/* ---------- filter veličine (F-03) ---------- */

var velTimer = null;
function paintSizeFilter() {
  $('#qSizesOdjeca').innerHTML = sizeButtonsHTML(SIZE_ODJECA, mojeVelicine);
  $('#qSizesObuca').innerHTML = sizeButtonsHTML(SIZE_OBUCA, mojeVelicine);
  $('#sizesClear').hidden = !mojeVelicine.length;
  $('#searchDot').hidden = !mojeVelicine.length;
}
// Ponovno učitavanje feeda poslije izbora veličina; ako je učitavanje u toku, čeka se da završi.
function reloadFeedSoon(tries) {
  clearTimeout(velTimer);
  velTimer = setTimeout(function () {
    if (loading && (tries || 0) < 20) { reloadFeedSoon((tries || 0) + 1); return; }
    loadFeed(true);
  }, 350);
}
function sizesChanged() {
  saveMySizes(); paintSizeFilter(); renderChips(); reloadFeedSoon(0);
}
function clearSizes() { mojeVelicine = []; sizesChanged(); }
function onSizeFilterClick(e) {
  var b = e.target.closest('.size-btn');
  if (!b) { return; }
  var v = b.getAttribute('data-size');
  if (mojeVelicine.indexOf(v) === -1 && mojeVelicine.length >= SIZE_MAX_FILTER) { toast('Izaberi najviše ' + SIZE_MAX_FILTER + ' veličina.'); return; }
  toggleSize(mojeVelicine, v);
  sizesChanged();
}
$('#qSizesOdjeca').addEventListener('click', onSizeFilterClick);
$('#qSizesObuca').addEventListener('click', onSizeFilterClick);
$('#sizesClear').addEventListener('click', clearSizes);
paintSizeFilter();

// Dodir na push o sniženju (mobilni omotač): oglas je prvi u kartici „Novo”.
window.__komodoOpenListing = function (id) {
  if (!/^\d+$/.test(String(id))) { return; }
  shop = null; brand.hidden = false; shopbar.hidden = true; filter = 'Sve';
  kartica = 'novo'; karticaRucno = true;
  renderChips(); show('feed', true); loadFeed(true, String(id));
};
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
