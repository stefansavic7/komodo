// Komodo web — Osnova: zajedničko stanje, elementi stranice, ikone, pomoćne funkcije (esc, fmtKM, toast), api() i prozor s potvrdom.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
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
var viewQueue = [], viewsSending = false;    // pregledi koji čekaju slanje na /api/views
var viewsBatch = null;                       // null: ne znamo; false: server nema /api/views (stari API)
var MAX_VIEW_QUEUE = 500, VIEWS_PER_REQUEST = 50;
var currentId = null;                        // oglas koji je trenutno na ekranu u feedu
var likeBusy = {};                           // oglasi čije je sviđanje upravo u slanju
// Feed (docs/SPEC-V1.md, F-01): kartica 'zatebe' | 'novo' | 'praceni'; karticaRucno = korisnik ju je sam izabrao
// (inače: kupac i neprijavljen „Za tebe”, butik „Novo” jer svoje oglase ne vidi u „Za tebe”).
var kartica = 'zatebe', karticaRucno = false;
var shownIds = [];                           // id-jevi prikazani u „Za tebe” (izuzmi, najviše zadnjih 200)
var zaTebeKraj = false, novoBefore = null;   // poslije kraja „Za tebe” feed nastavlja stranama „Novo”
var hiddenAt = 0;                            // kad je stranica sakrivena (povratak poslije 30 min osvježava feed)
var LIKES_EVERY = 30000, likesAt = 0;        // B-01: sviđanja oglasa na ekranu najviše svakih ~30 s (KONFIG.intervali.likes)
var pItems = [], pPages = 0, pMoreOn = false, pBusy = false;   // mreža na vlastitom profilu
var vItems = [], vShop = null, vMoreOn = false, vBusy = false;  // mreža na javnom profilu butika
function pageVisible() { return document.visibilityState === 'visible'; }
var editId = null, reportTarget = null, chatBlocked = false, authView = 'auth', resetToken = null;
var inApp = !!window.ReactNativeWebView;     // radi li unutar mobilne aplikacije (Expo)
var pushToken = null;

function $(s) { return document.querySelector(s); }
var ftabs = $('#ftabs'), uputa = $('#uputa');
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
// Obavještenje na vrhu ekrana: 3 s, greške (drugi argument true) 5 s; dodir ga zatvara.
function toast(msg, isError) {
  toastEl.textContent = msg; toastEl.hidden = false;
  toastEl.classList.toggle('toast-err', !!isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.hidden = true; }, isError ? 5000 : 3000);
}
toastEl.addEventListener('click', function () { clearTimeout(toastTimer); toastEl.hidden = true; });
function byId(id) {
  for (var k = 0; k < items.length; k++) { if (String(items[k].id) === String(id)) { return items[k]; } }
  return null;
}

/* ---------- tajmeri, ponovni pokušaji i režim rada (talas 4, docs/ARHITEKTURA.md „Otpornost”) ---------- */

// Intervali i zastavice dolaze sa servera (GET /api/config, „veliki crveni prekidač”); ovo su zadane vrijednosti
// (režim „normalno”) dok odgovor ne stigne.
var KONFIG = { rezim: 'normalno', intervali: { likes: 30000, me: 60000, profil: 30000, chat: 4000, views: 30000, config: 600000 }, licniFeed: true, pregledi: true };
var kvarova = 0;          // greške mreže, 5xx i 429 zaredom (bilo koji poziv); prvi uspjeh vraća na 0
var kvarDo = 0;           // ne prije ovog trenutka (Retry-After sa servera)
var MAX_CEKANJE = 300000; // najduže čekanje pozadinskog poziva poslije grešaka: 5 min
var tajmeri = [];         // aktivni periodični tajmeri (da se preslože kad stigne novi režim)

// Nasumičan pomak ±20 %: telefoni koji su počeli u istoj sekundi (npr. poslije pada servera) se razilaze.
function rasipanje(ms) { return Math.round(ms * (0.8 + Math.random() * 0.4)); }
function intervalZa(kljuc) { return (KONFIG.intervali && KONFIG.intervali[kljuc]) || 60000; }
// Razmak do sljedećeg poziva: interval ± 20 %, poslije grešaka eksponencijalno duže (×2 po grešci, najviše 5 min),
// i nikad prije Retry-After.
function sljedeciRazmak(kljuc) {
  var ms = rasipanje(intervalZa(kljuc));
  if (kvarova > 0) { ms = Math.min(MAX_CEKANJE, ms * Math.pow(2, Math.min(kvarova, 10))); }
  var doKraja = kvarDo - Date.now();
  if (doKraja > ms) { ms = doKraja + Math.round(Math.random() * 2000); }
  return ms;
}
// Periodični tajmer (umjesto setInterval): fn svakih ~interval(kljuc). `prvi` = razmak do prvog poziva
// (zadano: nasumično između 20 % i 100 % intervala, da se prvi pozivi ne poklope).
function tajmer(kljuc, fn, prvi) {
  var t = { kljuc: kljuc, fn: fn, id: null };
  // Sljedeći poziv se zakazuje tek kad ovaj završi (fn vraća obećanje), da se greška ovog odgovora već uračuna u
  // čekanje; zahtjev koji visi ne zaustavlja tajmer duže od 60 s.
  t.korak = function () {
    t.id = null;
    var gotovo = false, p = null;
    function zakazi() {
      if (gotovo) { return; }
      gotovo = true;
      if (tajmeri.indexOf(t) !== -1 && t.id === null) { t.id = setTimeout(t.korak, sljedeciRazmak(kljuc)); }
    }
    try { p = fn(); } catch (e) { p = null; /* greška u pozivu ne smije ugasiti tajmer */ }
    if (p && typeof p.then === 'function') {
      p.then(zakazi, zakazi);
      setTimeout(zakazi, 60000);
    } else { zakazi(); }
  };
  tajmeri.push(t);
  t.id = setTimeout(t.korak, prvi !== undefined ? prvi : Math.round(intervalZa(kljuc) * (0.2 + Math.random() * 0.8)));
  return t;
}
function staniTajmer(t) {
  if (!t) { return null; }
  clearTimeout(t.id);
  var k = tajmeri.indexOf(t);
  if (k !== -1) { tajmeri.splice(k, 1); }
  return null;
}
// Novi režim: svaki tajmer dobija razmak po novom intervalu (npr. iz „hitno” nazad u „normalno” bez čekanja 5 min).
function preslozITajmere() {
  tajmeri.forEach(function (t) { clearTimeout(t.id); t.id = setTimeout(t.korak, sljedeciRazmak(t.kljuc)); });
}
// Svaki odgovor servera (api(), pregledi): greška mreže (status 0), 5xx i 429 produžavaju čekanje, uspjeh ga vraća.
function zabiljeziOdgovor(status, retryAfter) {
  if (status === 0 || status === 429 || status >= 500) {
    kvarova += 1;
    var s = parseInt(retryAfter, 10);
    if (s > 0) { kvarDo = Math.max(kvarDo, Date.now() + Math.min(s, 300) * 1000); }
  } else if (status >= 200 && status < 400 && kvarova) {
    kvarova = 0; kvarDo = 0;
  }
}
function primijeniKonfig(d) {
  if (!d || !d.intervali) { return; }
  var promjena = d.rezim !== KONFIG.rezim;
  KONFIG = d;
  if (!KONFIG.pregledi) { viewQueue = []; }
  if (promjena) { preslozITajmere(); }
}
var konfigAt = 0, konfigTrazen = null;
// GET /api/config: pri startu, periodično (tajmer 'config', ~10 min) i kad zaglavlje X-Komodo-Rezim kaže da se režim
// promijenio. `rezim` u adresi: Nginx i preglednik keširaju odgovor 30 s po adresi, pa novi režim dobija svjež odgovor.
function ucitajKonfig(rezim) {
  konfigAt = Date.now(); konfigTrazen = rezim || null;
  return api('GET', '/api/config' + (rezim ? '?r=' + encodeURIComponent(rezim) : '')).then(primijeniKonfig, function () {});
}
function provjeriRezim(res) {
  var r = res.headers && res.headers.get ? res.headers.get('X-Komodo-Rezim') : null;
  // Jednom po novom režimu; isti ponovo tek poslije 30 s (npr. ako je prvi poziv pao).
  if (r && r !== KONFIG.rezim && (r !== konfigTrazen || Date.now() - konfigAt > 30000)) { ucitajKonfig(r); }
}
// Ključ protiv duplog slanja (Idempotency-Key): jedan po radnji (poruka, objava), isti pri ponovnom pokušaju.
function noviKljuc() {
  var a = [], k;
  try {
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    for (k = 0; k < b.length; k++) { a.push((b[k] < 16 ? '0' : '') + b[k].toString(16)); }
  } catch (e) {
    for (k = 0; k < 4; k++) { a.push(Math.floor(Math.random() * 0xffffffff).toString(16)); }
    a.push(String(Date.now()));
  }
  return a.join('');
}

// Poziv API-ja. Vraća JSON ili baca grešku s porukom koju je poslao server. `zaglavlja`: dodatna (Idempotency-Key).
function api(method, url, body, zaglavlja) {
  var opts = { method: method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (zaglavlja) { for (var h in zaglavlja) { if (Object.prototype.hasOwnProperty.call(zaglavlja, h)) { opts.headers[h] = zaglavlja[h]; } } }
  return fetch(url, opts).then(function (res) {
    zabiljeziOdgovor(res.status, res.headers.get('Retry-After'));
    provjeriRezim(res);
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) { throw new Error(data.greska || 'Nešto nije u redu. Pokušaj ponovo.'); }
      return data;
    });
  }, function () {
    zabiljeziOdgovor(0);
    throw new Error('Nema veze sa serverom. Provjeri internet i pokušaj ponovo.');
  });
}

function needLogin(msg) {
  toast(msg);
  show('profile');
}
function removeListing(id, after) {
  api('DELETE', '/api/listings/' + id).then(function () {
    toast('Oglas je obrisan.');
    after();
  }).catch(function (err) { toast(err.message, true); });
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
