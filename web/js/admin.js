// Komodo web — Administracija: prijave, nalozi, otvaranje butika.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

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
  renderAdminStats();
  loadAdminUsers();
  loadRezim();
}

/* ---------- režim rada („veliki crveni prekidač”, talas 4; docs/RUNBOOK.md) ---------- */

var REZIM_OPIS = {
  normalno: 'Normalno: svi tajmeri i lični „Za tebe”.',
  stedi: 'Štedni: aplikacije osvježavaju 2–4 puta rjeđe. Za vrh prometa (reklama).',
  hitno: 'Hitni: „Za tebe” postaje „Novo”, pregledi se ne broje, sve se osvježava najviše svakih 5 min, razgovor svakih 15 s.'
};
// Ugrađuje se na kraju fajla (poslije „Brojke”), ispod brojki.
function ugradiRezim() {
  var box = document.createElement('section');
  box.id = 'admRezim'; box.className = 'adm-stats';
  box.innerHTML = '<h2>Režim rada</h2><p class="hint" id="admRezimHint">Učitavam…</p>' +
    '<div class="p-row" role="group" aria-label="Režim rada">' +
    '<button type="button" class="btn" data-rezim="normalno" aria-pressed="false">Normalno</button>' +
    '<button type="button" class="btn" data-rezim="stedi" aria-pressed="false">Štedni</button>' +
    '<button type="button" class="btn btn-danger" data-rezim="hitno" aria-pressed="false">Hitni</button></div>' +
    '<button type="button" class="btn" id="admRezimOkolina">Vrati na podešavanje servera</button>';
  var stats = $('#admStats');
  admin.insertBefore(box, stats ? stats.nextSibling : $('#adminBack').nextSibling);
  $('#admRezim').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rezim]');
    if (b) {
      var r = b.getAttribute('data-rezim');
      if (r === 'hitno') {
        confirmAction({ title: 'Uključiti hitni režim?', text: REZIM_OPIS.hitno, ok: 'Uključi' }, function () { setRezim('hitno'); });
      } else { setRezim(r); }
      return;
    }
    if (e.target.closest('#admRezimOkolina')) { setRezim(null); }
  });
}
function paintRezim(d) {
  var bs = document.querySelectorAll('#admRezim [data-rezim]');
  for (var k = 0; k < bs.length; k++) {
    var on = bs[k].getAttribute('data-rezim') === d.rezim;
    bs[k].setAttribute('aria-pressed', on ? 'true' : 'false');
    bs[k].classList.toggle('btn-main', on && d.rezim !== 'hitno');
  }
  $('#admRezimHint').textContent = 'Sada: ' + REZIM_OPIS[d.rezim] + ' Podešavanje servera (KOMODO_REZIM): ' + d.okolina + '. Klijenti ga vide za najviše ~1 min.';
}
function loadRezim() {
  api('GET', '/api/admin/rezim').then(paintRezim).catch(function (err) { $('#admRezimHint').textContent = err.message; });
}
function setRezim(r) {
  api('POST', '/api/admin/rezim', { rezim: r }).then(function (d) {
    paintRezim(d);
    toast('Režim rada: ' + d.rezim + '.');
  }).catch(function (err) { toast(err.message, true); });
}


/* ---------- brojke (F-09) ---------- */

(function () {
  var box = document.createElement('section');
  box.id = 'admStats'; box.className = 'adm-stats';
  box.innerHTML = '<h2>Brojke</h2><p class="hint" id="admStatsHint">Učitavam brojke…</p><div id="admStatsBody" hidden></div>';
  admin.insertBefore(box, admin.querySelector('h2'));
  var users = $('#admUsers'), find = document.createElement('div');
  find.className = 'field adm-find';
  find.innerHTML = '<label for="admSearch">Traži po imenu ili emailu</label>' +
    '<input id="admSearch" type="search" maxlength="60" autocomplete="off" placeholder="Ime butika, ime ili email">';
  users.parentNode.insertBefore(find, users);
})();
function admTile(label, today, yesterday) {
  return '<div class="adm-tile"><span class="adm-lbl">' + esc(label) + '</span><strong>' + fmtBroj(today) + '</strong>' +
    '<span class="adm-prev">(juče ' + fmtBroj(yesterday) + ')</span></div>';
}
function admDay(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.'; }
function renderAdminStats() {
  api('GET', '/api/admin/stats').then(function (d) {
    var b = d.brojke, t = b.dani[0], j = b.dani[1];
    var at = b.azurirano ? new Date(b.azurirano) : null;
    var hm = at ? ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2) : '';
    $('#admStatsHint').textContent = 'Osvježava se svakih 15 minuta' + (at ? ', zadnje u ' + hm : '') + '.';
    $('#admStatsBody').hidden = false;
    $('#admStatsBody').innerHTML = '<div class="adm-tiles">' +
      admTile('Aktivni danas', t.active, j.active) + admTile('Registracije', t.registrations, j.registrations) +
      admTile('Novi oglasi', t.listings, j.listings) + admTile('Poruke', t.messages, j.messages) + '</div>' +
      '<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Dan</th><th>Aktivni</th><th>Registracije</th><th>Oglasi</th><th>Poruke</th></tr></thead><tbody>' +
      b.dani.map(function (x) {
        return '<tr><td>' + admDay(x.day) + '</td><td>' + fmtBroj(x.active) + '</td><td>' + fmtBroj(x.registrations) +
          '</td><td>' + fmtBroj(x.listings) + '</td><td>' + fmtBroj(x.messages) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="adm-total">Ukupno: ' + fmtBroj(b.ukupno.users) + ' korisnika · ' + fmtBroj(b.ukupno.shops) + ' butika · ' +
      fmtBroj(b.ukupno.listings) + ' aktivnih oglasa</p>' +
      '<p class="hint">Aktivni = različiti ljudi i uređaji koji su pogledali bar jedan oglas tog dana.</p>';
  }).catch(function (err) { $('#admStatsHint').textContent = err.message; $('#admStatsBody').hidden = true; });
}

/* ---------- nalozi s pretragom (U-15) ---------- */

var admUsersSeq = 0, admSearchTimer = null;
function loadAdminUsers() {
  var term = ($('#admSearch').value || '').trim(), seq = ++admUsersSeq;
  api('GET', '/api/admin/users' + (term ? '?q=' + encodeURIComponent(term) : '')).then(function (d) {
    if (seq !== admUsersSeq) { return; }
    $('#admUsers').innerHTML = !d.nalozi.length ? '<li><span class="muted">Nema naloga za ovu pretragu.</span></li>' : d.nalozi.map(function (u) {
      return '<li><strong>' + esc(u.name) + (u.suspended ? ' (ugašen)' : '') + '</strong>' +
        '<span class="muted">' + (u.role === 'butik' ? 'Butik · ' + u.listings + ' oglasa' : 'Kupac') + ' · ' + esc(u.email) + '</span>' +
        '<div class="p-row"><button type="button" class="btn' + (u.suspended ? '' : ' btn-danger') + '" data-susp="' + (u.suspended ? '0' : '1') + '" data-id="' + u.id + '">' +
        (u.suspended ? 'Vrati nalog' : 'Ugasi nalog') + '</button></div></li>';
    }).join('');
  }).catch(function () {});
}
$('#admSearch').addEventListener('input', function () {
  clearTimeout(admSearchTimer);
  admSearchTimer = setTimeout(loadAdminUsers, 300);
});
admin.addEventListener('click', function (e) {
  var b = e.target.closest('[data-res], [data-susp]');
  if (!b) { return; }
  var id = b.getAttribute('data-id');
  if (b.hasAttribute('data-res')) {
    api('POST', '/api/admin/reports/' + id + '/resolve', { action: b.getAttribute('data-res') }).then(function () {
      toast(b.getAttribute('data-res') === 'ukloni' ? 'Sadržaj je uklonjen.' : 'Prijava je odbačena.');
      renderAdmin();
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  var off = b.getAttribute('data-susp') === '1';
  confirmAction(off
    ? { title: 'Ugasiti nalog?', text: 'Korisnik se odjavljuje, a njegov profil i oglasi nestaju iz aplikacije dok nalog ne vratiš.', ok: 'Ugasi nalog' }
    : { title: 'Vratiti nalog?', text: 'Korisnik se ponovo može prijaviti, a njegov profil i oglasi se vraćaju u aplikaciju.', ok: 'Vrati nalog' }, function () {
    api('POST', '/api/admin/users/' + id + '/suspend', { suspended: off }).then(function () {
      toast(off ? 'Nalog je ugašen.' : 'Nalog je vraćen.');
      renderAdmin();
    }).catch(function (err) { toast(err.message, true); });
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
ugradiRezim();
