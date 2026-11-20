// Komodo web — Prijava, registracija, odjava, zaboravljena i nova lozinka, potvrda emaila, promjena lozinke.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- profil i prijava ---------- */

function setAuthMode(mode) {
  authMode = mode;
  var reg = mode === 'register';
  $('#authTitle').textContent = reg ? 'Novi nalog' : 'Prijava';
  // U-04: u režimu „Novi nalog” tekst prema sačuvanoj radnji (sviđanje, poruka, praćenje).
  var posle = reg ? readPosle() : null;
  $('#authLead').textContent = reg
    ? ((posle && posle.lead) || 'Nalog je besplatan. S njim čuvaš šta ti se sviđa i pišeš buticima.')
    : 'Prijavi se da označiš šta ti se sviđa i pišeš buticima.';
  $('#authShopField').hidden = !reg;
  $('#authSubmit').textContent = reg ? 'Napravi nalog' : 'Prijavi se';
  $('#authSwitch').textContent = reg ? 'Već imaš nalog? Prijavi se' : 'Nemaš nalog? Napravi ga';
  $('#aPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  $('#aPassHint').hidden = !reg;
  $('#authErr').textContent = '';
  clearFieldErrors();
}
// Greške registracije idu ispod polja na koje se odnose; polje dobija crveni okvir i fokus.
var AUTH_FIELDS = [['#aEmail', '#aEmailErr'], ['#aPass', '#aPassErr'], ['#aShop', '#aShopErr']];
function clearFieldErrors() {
  for (var k = 0; k < AUTH_FIELDS.length; k++) {
    $(AUTH_FIELDS[k][0]).removeAttribute('aria-invalid');
    $(AUTH_FIELDS[k][1]).textContent = '';
  }
}
function fieldError(input, errEl, msg) {
  $(errEl).textContent = msg;
  $(input).setAttribute('aria-invalid', 'true');
}
// Isti uslovi i tekstovi kao na serveru (api/src/rute/auth.js), istim redom. Vraća prvo polje s greškom ili null.
function validateRegister(email, pass, name) {
  clearFieldErrors();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toLowerCase())) { fieldError('#aEmail', '#aEmailErr', 'Upiši ispravnu email adresu.'); }
  if (pass.length < 8) { fieldError('#aPass', '#aPassErr', 'Lozinka mora imati najmanje 8 znakova.'); }
  if (name.length < 2) { fieldError('#aShop', '#aShopErr', 'Upiši svoje ime.'); }
  // Fokus ide na prvo polje s greškom po redu na ekranu (ime, email, lozinka).
  var order = ['#aShop', '#aEmail', '#aPass'];
  for (var k = 0; k < order.length; k++) { if ($(order[k]).getAttribute('aria-invalid')) { return order[k]; } }
  return null;
}
$('#authForm').addEventListener('input', function (e) {
  var id = e.target.id;
  for (var k = 0; k < AUTH_FIELDS.length; k++) {
    if ('#' + id === AUTH_FIELDS[k][0]) { e.target.removeAttribute('aria-invalid'); $(AUTH_FIELDS[k][1]).textContent = ''; }
  }
});
$('#aPassEye').addEventListener('click', function () {
  var show = $('#aPass').type === 'password';
  $('#aPass').type = show ? 'text' : 'password';
  $('#aPassEye').textContent = show ? 'Sakrij' : 'Prikaži';
  $('#aPassEye').setAttribute('aria-pressed', show ? 'true' : 'false');
});
$('#authSwitch').addEventListener('click', function () { setAuthMode(authMode === 'login' ? 'register' : 'login'); });
$('#authForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var body = { email: $('#aEmail').value.trim(), password: $('#aPass').value };
  if (authMode === 'register') {
    body.name = $('#aShop').value.trim();
    var badField = validateRegister(body.email, body.password, body.name);
    if (badField) { $(badField).focus(); $('#authErr').textContent = ''; return; }
  }
  $('#authErr').textContent = '';
  api('POST', authMode === 'register' ? '/api/auth/register' : '/api/auth/login', body).then(function (d) {
    me = d.korisnik;
    $('#aPass').value = '';
    $('#aPass').type = 'password'; $('#aPassEye').textContent = 'Prikaži'; $('#aPassEye').setAttribute('aria-pressed', 'false');
    afterAuthChange();
    toast(authMode === 'register' ? 'Nalog je napravljen.' : 'Prijava je uspjela.');
  }).catch(function (err) { $('#authErr').textContent = err.message; });
});
$('#logout').addEventListener('click', function () {
  api('POST', '/api/auth/logout').then(function () {
    me = null; afterAuthChange(); toast('Odjava je uspjela.');
  }).catch(function (err) { toast(err.message, true); });
});

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
    afterAuthChange();
    toast('Lozinka je promijenjena i prijava je uspjela.');
  }).catch(function (err) { $('#resetErr').textContent = err.message; });
});
$('#verifyResend').addEventListener('click', function () {
  api('POST', '/api/auth/resend').then(function () { toast('Link za potvrdu je poslan na ' + me.email + '.'); })
    .catch(function (err) { toast(err.message, true); });
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

/* ---------- U-04: neprijavljen dodir na „Pošalji poruku” i „Prati” (profil butika, kontakt) ---------- */

// Dugmad iz butik.js (profil butika, prozor kontakta) pozivaju needLogin; ovdje se presreću prije njih
// i čuvaju radnju, da se poslije registracije izvrši (runPosle u prikazi.js).
document.addEventListener('click', function (e) {
  if (me || !e.target.closest) { return; }
  var p = null, btn;
  if ((btn = e.target.closest('#contactMsg'))) {
    var name = $('#contactTitle').textContent;
    p = { t: 'chat', handle: btn.getAttribute('data-handle'), listingId: btn.getAttribute('data-listing') || null, lead: 'Napravi besplatan nalog da pišeš butiku ' + name + '.' };
    contactSheet.hidden = true;
  } else if ((btn = e.target.closest('#vMsg'))) {
    p = { t: 'chat', handle: btn.getAttribute('data-handle'), listingId: null, lead: 'Napravi besplatan nalog da pišeš butiku ' + $('#vName').textContent + '.' };
  } else if ((btn = e.target.closest('#vFollow')) && vShop) {
    p = { t: 'follow', handle: vShop.handle, name: vShop.shopName, id: null, lead: 'Napravi besplatan nalog da pratiš ' + vShop.shopName + '.' };
  }
  if (!p) { return; }
  e.stopPropagation(); e.preventDefault();
  needAccount(p);
}, true);
