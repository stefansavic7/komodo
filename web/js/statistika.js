// Komodo web — Statistika butika (docs/SPEC-V1.md, F-06): openStats(listingId?) i zajedničke pomoćne funkcije
// za brojeve (fmtBroj). Ekran je prozor preko cijele aplikacije koji skripta sama pravi; nema tajmera —
// brojke se učitavaju otvaranjem i promjenom perioda.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- pomoćne funkcije ---------- */

// 1240 -> „1.240”
function fmtBroj(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
// Množina: oblik 1 (1, 21), oblik 2–4 (2–4, 22–24), inače 5+ (11–14 su 5+).
function statMnozina(n, one, few, many) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) { return one; }
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) { return few; }
  return many;
}

/* ---------- ekran ---------- */

var statPeriod = 7, statFocus = null, statSeq = 0, statOpener = null;
var statEl = document.createElement('section');
statEl.className = 'stat-screen'; statEl.id = 'statScreen'; statEl.hidden = true;
statEl.setAttribute('aria-label', 'Statistika');
statEl.innerHTML =
  '<div class="stat-head"><button type="button" class="back" id="statBack">' +
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Profil</button>' +
  '<h2>Statistika</h2></div>' +
  '<div class="stat-seg" role="group" aria-label="Period">' +
  '<button type="button" data-period="7" aria-pressed="true">7 dana</button>' +
  '<button type="button" data-period="30" aria-pressed="false">30 dana</button></div>' +
  '<p class="hint" id="statHint"></p>' +
  '<div id="statBody" hidden></div>';
document.querySelector('.app').appendChild(statEl);

function openStats(listingId) {
  if (!me) { needLogin('Prijavi se da vidiš statistiku.'); return; }
  if (!isShop()) { toast('Statistika je dostupna samo butiku.', true); return; }
  statFocus = listingId ? String(listingId) : null;
  statOpener = document.activeElement;
  pauseAll();
  statEl.hidden = false;
  statEl.scrollTop = 0;
  loadStats();
  $('#statBack').focus();
}
function closeStats() {
  statSeq++;
  statEl.hidden = true;
  if (statOpener && statOpener.focus) { statOpener.focus(); }
  if (!feed.hidden) { watch(); }
}
$('#statBack').addEventListener('click', closeStats);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !statEl.hidden && $('#confirmSheet').hidden) { closeStats(); } });
// Android Nazad u omotaču (omotac.js) ne zna za ovaj prozor, pa ga ovdje preuzimamo.
(function () {
  var prev = window.__komodoBack;
  window.__komodoBack = function () {
    if (!statEl.hidden) { closeStats(); return; }
    if (prev) { prev(); }
  };
})();
statEl.querySelector('.stat-seg').addEventListener('click', function (e) {
  var b = e.target.closest('[data-period]');
  if (!b) { return; }
  var p = Number(b.getAttribute('data-period'));
  if (p === statPeriod) { return; }
  statPeriod = p;
  loadStats();
});

function statPaintSeg() {
  var bs = statEl.querySelectorAll('.stat-seg button');
  for (var k = 0; k < bs.length; k++) {
    bs[k].setAttribute('aria-pressed', Number(bs[k].getAttribute('data-period')) === statPeriod ? 'true' : 'false');
  }
}
function loadStats() {
  var seq = ++statSeq;
  statPaintSeg();
  $('#statBody').hidden = true;
  $('#statHint').innerHTML = 'Učitavam statistiku…';
  api('GET', '/api/me/stats?period=' + statPeriod).then(function (d) {
    if (seq !== statSeq) { return; }
    $('#statHint').textContent = '';
    paintStats(d.statistika);
  }).catch(function (err) {
    if (seq !== statSeq) { return; }
    $('#statHint').innerHTML = '<span id="statErr"></span> <button type="button" class="link" id="statRetry">Pokušaj ponovo</button>';
    $('#statErr').textContent = err.message;
    $('#statRetry').addEventListener('click', loadStats);
  });
}

function statTile(label, n) {
  return '<div class="stat-tile"><strong>' + fmtBroj(n) + '</strong><span>' + label + '</span></div>';
}
function statDaysChart(dani) {
  var max = 0, k;
  for (k = 0; k < dani.length; k++) { if (dani[k].views > max) { max = dani[k].views; } }
  if (!max) { return ''; }
  return '<div class="stat-chart" role="img" aria-label="Pregledi po danima">' + dani.map(function (x) {
    var h = Math.max(2, Math.round(x.views / max * 100));
    return '<span class="stat-bar" title="' + esc(x.day) + ': ' + x.views + '"><i style="height:' + h + '%"></i></span>';
  }).join('') + '</div>' +
  '<div class="stat-axis"><span>' + esc(dani[0].day.slice(8, 10) + '.' + dani[0].day.slice(5, 7) + '.') + '</span><span>' +
  esc(dani[dani.length - 1].day.slice(8, 10) + '.' + dani[dani.length - 1].day.slice(5, 7) + '.') + '</span></div>';
}
function statRow(l, focus) {
  var line = fmtBroj(l.views) + ' ' + statMnozina(l.views, 'pregled', 'pregleda', 'pregleda') + ' · ' +
    fmtBroj(l.likes) + ' ' + statMnozina(l.likes, 'sviđanje', 'sviđanja', 'sviđanja') + ' · ' +
    fmtBroj(l.contacts) + ' ' + statMnozina(l.contacts, 'razgovor', 'razgovora', 'razgovora');
  return '<li class="stat-item' + (focus ? ' is-focus' : '') + '" data-id="' + l.id + '">' +
    '<div class="stat-thumb">' + tileMedia(l) + '</div>' +
    '<div class="stat-info"><strong>' + esc(l.title) + '</strong>' +
    '<span class="stat-price">' + esc(fmtKM(l.price)) + (l.sold ? ' · prodato' : '') + '</span>' +
    '<span class="stat-line">' + line + '</span></div></li>';
}
function paintStats(s) {
  var t = s.ukupno, list = s.oglasi.slice(), k, empty = true;
  if (statFocus) {
    for (k = 0; k < list.length; k++) {
      if (String(list[k].id) === statFocus) { list.unshift(list.splice(k, 1)[0]); break; }
    }
  }
  if (t.views || t.likes || t.contacts || t.newFollowers) { empty = false; }
  $('#statBody').innerHTML =
    '<div class="stat-tiles">' + statTile('Pregledi', t.views) + statTile('Sviđanja', t.likes) +
    statTile('Razgovori', t.contacts) + statTile('Novi pratioci', t.newFollowers) + '</div>' +
    (empty ? '<p class="hint">Još nema podataka za ovaj period. Brojke rastu kad kupci gledaju tvoje snimke.</p>' : statDaysChart(s.dani)) +
    '<h3>Oglasi</h3>' +
    (list.length ? '<ul class="stat-list">' + list.map(function (l) { return statRow(l, statFocus && String(l.id) === statFocus); }).join('') + '</ul>'
      : '<p class="hint">Još nemaš oglasa.</p>') +
    '<p class="hint">Pregled = jedan kupac pogledao oglas tog dana. Razgovor = kupac ti je pisao iz tog oglasa.<br>Brojke se osvježavaju svakih 5 minuta.</p>';
  $('#statBody').hidden = false;
  statEl.scrollTop = 0;
}
