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
// Moje veličine (filter) se pamte po grupi u localStorage['komodo.velicine'] = {"odjeca":["M"],"obuca":["38"]} (ispravka P-2).
// Stari zapis (običan niz) se pri čitanju razvrsta po skupovima veličina (F-03).
function cleanSizeGroup(arr, set) {
  var out = [];
  for (var k = 0; k < arr.length; k++) { if (set.indexOf(arr[k]) !== -1 && out.indexOf(arr[k]) === -1) { out.push(arr[k]); } }
  return out;
}
function loadMySizes() {
  var out = { odjeca: [], obuca: [] };
  try {
    var a = JSON.parse(localStorage.getItem('komodo.velicine') || '{}');
    if (Array.isArray(a)) { a = { odjeca: a, obuca: a }; }
    if (a && typeof a === 'object') {
      out.odjeca = cleanSizeGroup(Array.isArray(a.odjeca) ? a.odjeca : [], SIZE_ODJECA);
      out.obuca = cleanSizeGroup(Array.isArray(a.obuca) ? a.obuca : [], SIZE_OBUCA);
    }
  } catch (e) { out = { odjeca: [], obuca: [] }; }
  while (out.odjeca.length + out.obuca.length > SIZE_MAX_FILTER) { if (out.odjeca.length) { out.odjeca.pop(); } else { out.obuca.pop(); } }
  return out;
}
var mojeVelicine = loadMySizes();
function saveMySizes() { try { localStorage.setItem('komodo.velicine', JSON.stringify(mojeVelicine)); } catch (e) {} }
function anyMySizes() { return mojeVelicine.odjeca.length + mojeVelicine.obuca.length > 0; }
// Šta se šalje u sizes=: Obuća samo obuća; Torbe i Nakit ništa; „Sve” obje grupe (server radi uniju); ostalo samo odjeća.
function activeSizes() {
  if (filter === 'Torbe' || filter === 'Nakit') { return []; }
  if (filter === 'Obuća') { return mojeVelicine.obuca; }
  if (filter === 'Sve') { return mojeVelicine.odjeca.concat(mojeVelicine.obuca); }
  return mojeVelicine.odjeca;
}

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

// Broj sviđanja na kartici; 0 se ne piše (samo srce).
function likeCount(i) { return i.likes > 0 ? String(i.likes) : ''; }
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
// Veličine kao okviri na kartici; skriveni dijelovi čuvaju tekst „Vel. M · L” za čitač ekrana (i testove).
function sizesHTML(sizes) {
  if (!sizes || !sizes.length) { return ''; }
  if (sizes.length === 1 && sizes[0] === 'UNI') { return '<p class="vel"><b>Jedna veličina</b></p>'; }
  var shoe = /^\d/.test(sizes[0]);
  var shown = sizes.length > 6 ? sizes.slice(0, 5) : sizes;
  var out = '<span class="vh">' + (shoe ? 'Br. ' : 'Vel. ') + '</span>';
  for (var k = 0; k < shown.length; k++) {
    out += (k ? '<span class="vh"> · </span>' : '') + '<b>' + esc(sizeLabel(shown[k])) + '</b>';
  }
  if (sizes.length > 6) { out += '<span class="vh"> · </span><b>+' + (sizes.length - 5) + '</b>'; }
  return '<p class="vel">' + out + '</p>';
}
// „{adresa} · otvoreno do 20:00” / „… · otvara sutra u 09:00”; status računa klijent iz radnog vremena (bez zahtjeva).
function shopSubHTML(i) {
  var adr = i.shopAddress ? '<span class="adr">' + esc(i.shopAddress) + '</span>' : '', st = typeof hoursStatus === 'function' ? hoursStatus(i.shopHours) : null, stH = '';
  if (st) {
    var txt = st.open ? st.text.charAt(0).toLowerCase() + st.text.slice(1) : st.text.replace(/^Zatvoreno · /, '').replace(/^Zatvoreno$/, 'zatvoreno');
    stH = '<span class="st">' + (adr ? '· ' : '') + '<span' + (st.open ? ' class="open"' : '') + '>' + esc(txt) + '</span></span>';
  }
  return adr || stH ? '<p class="shop-sub">' + adr + stH + '</p>' : '';
}
// Ušteda: „229 KM” precrtano, ispod „Sniženo −40 KM”.
function saveHTML(i) {
  if (!i.oldPrice) { return ''; }
  var diff = Math.round((i.oldPrice - i.price) * 100) / 100;
  return '<span class="save"><s class="old-price">' + fmtKM(i.oldPrice) + '</s><span><span class="drop">Sniženo</span> <b>−' + fmtKM(diff) + '</b></span></span>';
}
function cardHTML(i) {
  return '<article class="card' + (i.sold ? ' is-sold' : '') + (i.mine ? ' is-mine' : '') + '" data-id="' + i.id + '">' +
    '<video class="media" src="' + esc(i.videoUrl) + '"' + (i.posterUrl ? ' poster="' + esc(i.posterUrl) + '"' : '') + ' playsinline muted loop preload="metadata"></video>' +
    '<div class="scrim"></div>' +
    '<div class="meta">' +
      '<div class="seller-row"><button type="button" class="seller-btn" data-act="shop"><span class="avatar" aria-hidden="true">' + esc(initial(i.shopName)) + '</span><span>' + esc(i.shopName) + '</span></button>' +
        '<span class="ok-badge" role="img" aria-label="Provjeren butik">' + icon('check') + '</span>' + followBtnHTML(i) + '</div>' +
      shopSubHTML(i) +
      '<h2 class="title">' + esc(i.title) + '</h2>' +
      (i.processing && i.mine ? '<p class="state">' + icon('clock') + 'Obrađuje se — kupci će ga vidjeti za 1–3 minute.</p>' : '') +
      (i.videoError ? '<p class="state state-err">' + icon('alert') + 'Obrada videa nije uspjela. Obriši oglas i objavi video ponovo.</p>' : '') +
      '<div class="row"><span class="price">' + fmtKM(i.price) + '</span>' + saveHTML(i) + (i.sold ? '<span class="sold">Prodato</span>' : '') +
        (i.mine ? '<span class="views">' + (i.views || 0) + ' pregleda</span>' : '') + '</div>' +
      sizesHTML(i.sizes) +
    '</div>' +
    '<div class="actions">' +
      '<button type="button" class="act' + (i.liked ? ' on' : '') + '" data-act="like" aria-pressed="' + (i.liked ? 'true' : 'false') + '" aria-label="Sviđa mi se"><span>' + ICON.heart + '</span><span class="n">' + likeCount(i) + '</span></button>' +
      '<button type="button" class="act" data-act="share" aria-label="Podijeli oglas"><span>' + ICON.share + '</span></button>' +
      '<button type="button" class="act" data-act="more" aria-label="Više" aria-haspopup="dialog"><span>' + ICON.more + '</span></button>' +
    '</div>' +
    (i.mine ? '' : '<div class="card-cta"><button type="button" class="cta" data-act="contact">' + icon('chat', 'i-sm') + 'Kontaktiraj</button></div>') +
  '</article>';
}
// Prazno stanje: krug s ikonom, naslov, tekst i dugmad (docs/DIZAJN.md 1.7).
function emptyCard(ico, h2, p, btns, cls) {
  return '<article class="card empty' + (cls ? ' ' + cls : '') + '"><div class="empty-box"><span class="empty-ico">' + icon(ico) + '</span>' +
    (h2 ? '<h2>' + h2 + '</h2>' : '') + (p ? '<p>' + p + '</p>' : '') + (btns ? '<div class="btns-v">' + btns + '</div>' : '') + '</div></article>';
}
function emptyBtn(act, text, main) {
  return '<button type="button" class="btn ' + (main === false ? '' : 'btn-main ') + 'btn-wide" data-act="' + act + '">' + text + '</button>';
}
function loadingHTML() {
  return '<article class="card loading" aria-busy="true"><div class="sk sk-media"></div><div class="meta">' +
    '<div class="seller-row"><span class="sk sk-avatar"></span><span class="sk sk-line" style="width:120px"></span></div>' +
    '<div class="sk sk-line" style="width:180px"></div><div class="sk sk-title"></div><div class="sk sk-price"></div>' +
    '<div class="sk-vel"><span class="sk"></span><span class="sk"></span></div></div>' +
    '<div class="card-cta"><div class="sk sk-cta"></div></div><p class="vh" role="status">Učitavam oglase…</p></article>';
}
function emptySizesHTML() {
  return emptyCard('sliders', 'Nema oglasa u tvojoj veličini', 'Probaj bez filtera veličine.', emptyBtn('clearsizes', 'Poništi veličine'));
}
function emptyHTML() {
  if (activeSizes().length) { return emptySizesHTML(); }
  if (search.q || search.min || search.max) {
    return emptyCard('search', 'Nema oglasa za ovu pretragu', 'Probaj drugu riječ ili širi raspon cijene.', emptyBtn('clear', 'Poništi pretragu'));
  }
  var where = shop ? 'Ovaj butik još nema oglasa' : (filter === 'Sve' ? 'Još nema oglasa' : 'Još nema oglasa u kategoriji ' + esc(filter));
  return emptyCard('tag', where,
    isShop() ? 'Snimi proizvod, upiši naziv i cijenu, i oglas je tu.' : 'Butici uskoro dodaju prve snimke. Svrati opet.',
    (isShop() ? emptyBtn('post', 'Objavi video') : '') + (filter !== 'Sve' ? emptyBtn('all', 'Pogledaj sve oglase', !isShop()) : ''));
}
function watch() {
  if (io) { io.disconnect(); io = null; }
  if (!('IntersectionObserver' in window) || document.querySelector('.sheet:not([hidden])')) { return; }
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
    return emptyCard('users', 'Prati butike koji ti se sviđaju', 'Njihovi novi snimci će biti ovdje.', emptyBtn('nalog', 'Napravi nalog'));
  }
  if (!(me.followingCount > 0)) {
    return emptyCard('users', 'Još ne pratiš nijedan butik', 'Dodirni „Prati” pored imena butika na oglasu ili na njegovom profilu.', emptyBtn('zatebe', 'Idi na Za tebe'));
  }
  if (activeSizes().length) { return emptySizesHTML(); }
  return emptyCard('users', 'Butici koje pratiš još nemaju oglasa.', '', filter !== 'Sve' ? emptyBtn('all', 'Pogledaj sve oglase') : '');
}
// R2-01: „Prikaži još” poslije PRAZNIH_NAJVISE strana zaredom bez novih oglasa (dalje samo na dodir).
function josHTML() {
  return emptyCard('refresh', '', '', emptyBtn('jos', 'Prikaži starije oglase', false), 'jos');
}
function dividerHTML() {
  return emptyCard('check', 'To je sve za sada u „Za tebe”. Slijede najnoviji oglasi.', '', '', 'razdjelnik');
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
  if (reset) { hideUputa(); pickTab(); }
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
  if (reset) { feed.innerHTML = loadingHTML(); }
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
      feed.innerHTML = emptyCard('wifi-off', 'Oglasi se nisu učitali', esc(err.message), emptyBtn('retry', 'Pokušaj ponovo'));
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
// Zvuk je prekidač cijelog feeda u gornjoj traci (#soundToggle), ne dugme na svakoj kartici.
var soundToggle = $('#soundToggle');
function paintSound() {
  soundToggle.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  soundToggle.innerHTML = icon(soundOn ? 'sound-on' : 'sound-off');
}
function toggleSound() {
  soundOn = !soundOn;
  var vs = feed.querySelectorAll('video');
  for (var k = 0; k < vs.length; k++) { vs[k].muted = !soundOn; }
  paintSound();
}
soundToggle.addEventListener('click', toggleSound);

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
  if (act === 'shop') {
    openShopProfile(item.handle);
  } else if (act === 'contact') {
    openContact(item);
  } else if (act === 'like') {
    if (!me) { needAccount({ t: 'like', id: item.id, lead: 'Napravi besplatan nalog da sačuvaš ovaj oglas.' }); return; }
    setLike(item, !item.liked);
  } else if (act === 'follow') {
    toggleFollowCard(item, btn);
  } else if (act === 'more') {
    if (item.mine) { openMore(item); } else { openBuyerMore(item); }
  } else if (act === 'share') {
    shareListing(item);
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
  $('#moreTitle').textContent = item.title;
  $('#moreSoldLbl').textContent = item.sold ? 'Vrati u prodaju' : 'Označi kao prodato';
  $('#moreStats').hidden = typeof openStats !== 'function';
  moreSheet.hidden = false;
  moreSheet.querySelector('.menu-item').focus();
}
function closeMore(keepPaused) {
  moreSheet.hidden = true; moreItem = null;
  if (!keepPaused && !feed.hidden) { watch(); }
}
$('#moreClose').addEventListener('click', function () { closeMore(); });
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

/* ---------- „Više” za kupca: profil butika, kopiranje linka, prijava (docs/DIZAJN.md 2.8) ---------- */

var buyerMoreSheet = $('#buyerMoreSheet'), buyerItem = null;
function openBuyerMore(item) {
  pauseAll();
  buyerItem = item;
  $('#buyerMoreTitle').textContent = item.title;
  $('#bmShop').textContent = 'Profil butika ' + item.shopName;
  buyerMoreSheet.hidden = false;
  buyerMoreSheet.querySelector('.menu-item').focus();
}
function closeBuyerMore(keepPaused) {
  buyerMoreSheet.hidden = true; buyerItem = null;
  if (!keepPaused && !feed.hidden) { watch(); }
}
// Kopiranje: Clipboard API, a u starim WebView-ima privremeno polje; bez oba, link se samo ispiše.
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) { return navigator.clipboard.writeText(text); }
  return new Promise(function (resolve, reject) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) { resolve(); } else { reject(new Error('copy')); }
  });
}
buyerMoreSheet.addEventListener('click', function (e) {
  if (e.target === buyerMoreSheet) { closeBuyerMore(); return; }
  var c = e.target.closest('[data-bmore="close"]');
  if (c) { closeBuyerMore(); return; }
  var b = e.target.closest('[data-act]');
  if (!b || !buyerItem) { return; }
  var what = b.getAttribute('data-act'), item = buyerItem;
  if (what === 'shop') { closeBuyerMore(true); openShopProfile(item.handle); }
  else if (what === 'report') { closeBuyerMore(true); openReport({ listingId: item.id }, 'Prijavi oglas'); }
  else if (what === 'copy') {
    var url = location.origin + '/?o=' + item.id;
    closeBuyerMore();
    copyText(url).then(function () { toast('Link oglasa je kopiran.'); }, function () { toast('Link oglasa: ' + url); });
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

var searchSheet = $('#searchSheet');
function searchActive() { return !!(search.q || search.min || search.max); }
function paintSearchDot() { $('#searchDot').hidden = !(anyMySizes() || searchActive()); }
function openSearch() {
  pauseAll();
  searchSheet.hidden = false;
  $('#searchToggle').setAttribute('aria-expanded', 'true');
  // Programski fokus samo uz tastaturu/miša: na dodir bi otvorio tastaturu i pokrio veličine (D-08).
  if (window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches) { $('#qText').focus(); }
  else { $('#searchClose').focus({ preventScroll: true }); }
}
// Zatvara prozor i vraća fokus na lupu; feed se ponovo posmatra (video se pušta).
function closeSearch() {
  searchSheet.hidden = true;
  $('#searchToggle').setAttribute('aria-expanded', 'false');
  $('#searchToggle').focus();
  if (!feed.hidden) { watch(); }
}
$('#searchToggle').addEventListener('click', openSearch);
$('#searchClose').addEventListener('click', closeSearch);
searchSheet.addEventListener('click', function (e) { if (e.target === searchSheet) { closeSearch(); } });
$('#searchForm').addEventListener('submit', function (e) {
  e.preventDefault();
  search = { q: $('#qText').value.trim(), min: $('#qMin').value.trim(), max: $('#qMax').value.trim() };
  paintSearchDot();
  closeSearch();        // P-1: „Traži” zatvara prozor, rezultat se vidi odmah
  loadFeed(true);
});
function clearSearch() {
  search = { q: '', min: '', max: '' };
  $('#qText').value = ''; $('#qMin').value = ''; $('#qMax').value = '';
  paintSearchDot();
  if (!searchSheet.hidden) { closeSearch(); }
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
$('#reportClose').addEventListener('click', closeReport);
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
  // Filter veličine stoji izvan pojasa koji klizi (style.css, .chips-scroll), pa ga kategorije ne prekrivaju.
  // Pojas se crta iznova, pa se pomak čuva (dodir na „Nakit” ne vraća red na početak).
  var stari = chips.querySelector('.chips-scroll'), pomak = stari ? stari.scrollLeft : 0;
  chips.innerHTML = vt + '<div class="chips-scroll">' + ['Sve'].concat(CATS).map(function (c) {
    return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === filter ? 'true' : 'false') + '">' + esc(c) + '</button>';
  }).join('') + '</div>';
  if (pomak) { chips.querySelector('.chips-scroll').scrollLeft = pomak; }
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
  $('#qSizesOdjeca').innerHTML = sizeButtonsHTML(SIZE_ODJECA, mojeVelicine.odjeca);
  $('#qSizesObuca').innerHTML = sizeButtonsHTML(SIZE_OBUCA, mojeVelicine.obuca);
  $('#sizesClear').hidden = !anyMySizes();
  paintSearchDot();
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
function clearSizes() { mojeVelicine = { odjeca: [], obuca: [] }; sizesChanged(); }
function onSizeFilterClick(group) {
  return function (e) {
    var b = e.target.closest('.size-btn');
    if (!b) { return; }
    var v = b.getAttribute('data-size'), arr = mojeVelicine[group];
    if (arr.indexOf(v) === -1 && mojeVelicine.odjeca.length + mojeVelicine.obuca.length >= SIZE_MAX_FILTER) { toast('Izaberi najviše ' + SIZE_MAX_FILTER + ' veličina.'); return; }
    toggleSize(arr, v);
    sizesChanged();
  };
}
$('#qSizesOdjeca').addEventListener('click', onSizeFilterClick('odjeca'));
$('#qSizesObuca').addEventListener('click', onSizeFilterClick('obuca'));
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
