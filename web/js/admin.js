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
