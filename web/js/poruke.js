// Komodo web — Poruke: spisak razgovora, razgovor, dovlačenje svake 4 s, blokiranje.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- poruke ---------- */

function fmtTime(iso) {
  var d = new Date(iso), now = new Date();
  var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  if (d.toDateString() === now.toDateString()) { return hm; }
  return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + hm;
}
function renderInbox() {
  $('#inboxHint').textContent = 'Učitavam poruke…';
  $('#inboxEmpty').hidden = true; $('#inboxEmpty').innerHTML = '';
  $('#inboxList').innerHTML = '';
  api('GET', '/api/conversations').then(function (d) {
    var list = d.razgovori;
    $('#inboxHint').textContent = '';
    // Prazno stanje iz sistema (docs/DIZAJN.md 1.7): krug s ikonom, naslov i tekst.
    $('#inboxEmpty').innerHTML = list.length ? '' : '<div class="empty-box"><span class="empty-ico">' + icon('chat') + '</span><h2>Još nema poruka</h2><p>' +
      (isShop() ? 'Kad ti kupac piše zbog oglasa, razgovor se pojavi ovdje.' : 'Na oglasu dodirni „Kontaktiraj” i pitaj šta te zanima.') + '</p></div>';
    $('#inboxEmpty').hidden = !!list.length;
    $('#inboxList').innerHTML = list.map(function (c) {
      return '<li><button type="button" data-chat="' + c.id + '" class="' + (c.unread ? 'unread' : '') + '">' +
        '<span class="av40" aria-hidden="true">' + esc(initial(c.name)) + '</span>' +
        '<span style="min-width:0"><span class="who"><span>' + esc(c.name) + '</span><time>' + esc(fmtTime(c.at)) + '</time></span>' +
        (c.listingTitle ? '<span class="ltitle">' + esc(c.listingTitle) + '</span>' : '') +
        '<span class="last">' + esc(c.last || '') + '</span></span>' +
        (c.unread ? '<span class="udot" role="img" aria-label="Nepročitano"></span>' : '<span></span>') + '</button></li>';
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
  }).catch(function (err) { toast(err.message, true); });
}
// Razdjelnik dana u razgovoru: Danas | Juče | 21.11. (bez novih zahtjeva).
var chatLastDay = '';
function dayLabel(iso) {
  var d = new Date(iso), now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) { return 'Danas'; }
  if (d.toDateString() === y.toDateString()) { return 'Juče'; }
  return d.getDate() + '.' + (d.getMonth() + 1) + '.' + (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '.' : '');
}
function msgHTML(m) {
  var day = new Date(m.at).toDateString(), sep = '';
  if (day !== chatLastDay) { chatLastDay = day; sep = '<p class="day" role="separator">' + esc(dayLabel(m.at)) + '</p>'; }
  return sep + '<div class="msg' + (m.mine ? ' mine' : '') + '">' + esc(m.body) + '<time>' + esc(fmtTime(m.at)) + '</time></div>';
}
function appendMessages(list) {
  if (!list.length) { return; }
  var log = $('#chatLog'), fresh = list.filter(function (m) { return m.id > chatLast; });
  if (!fresh.length) { return; }
  var old = log.querySelectorAll('.chat-empty, .pstatus'), k;
  for (k = 0; k < old.length; k++) { old[k].remove(); }
  log.insertAdjacentHTML('beforeend', fresh.map(msgHTML).join(''));
  chatLast = fresh[fresh.length - 1].id;
  log.scrollTop = log.scrollHeight;
}
function pollChat() {
  if (!chatId || !pageVisible()) { return; }
  var id = chatId;
  return api('GET', '/api/conversations/' + id + '/messages?after=' + chatLast).then(function (d) {
    if (chatId === id) { appendMessages(d.poruke); }
  }, function () {});
}
function stopChat() {
  if (chatId) { toApp({ type: 'chat', id: null }); }
  chatTimer = staniTajmer(chatTimer); chatId = null;
}
// Kartica proizvoda na vrhu razgovora (iz odgovora, bez novih zahtjeva) i status radnog vremena butika (samo kupcu, dok nema poruka).
function pcardHTML(o) {
  var media = o.posterUrl ? '<img class="tile-img" width="96" height="128" src="' + esc(o.posterUrl) + '" alt="" loading="lazy">' : icon('video');
  var sizes = o.sizes && o.sizes.length ? '<span class="psz">' + esc((/^\d/.test(o.sizes[0]) ? 'Br. ' : 'Vel. ') + o.sizes.map(sizeLabel).join(' · ')) + '</span>' : '';
  return '<button type="button" class="pcard" data-open="' + o.id + '" aria-label="Otvori oglas ' + esc(o.title) + '">' +
    '<span class="tile-m">' + media + '</span><span><strong>' + esc(o.title) + '</strong>' +
    '<span class="pp"><em>' + fmtKM(o.price) + '</em>' + (o.oldPrice ? '<s>' + fmtKM(o.oldPrice) + '</s>' : '') + '</span>' + sizes + '</span></button>';
}
function pstatusHTML(st) {
  if (!st) { return ''; }
  var t = st.open ? 'Butik je otvoren do ' + st.text.replace('Otvoreno do ', '') + '. Odgovor stiže ovdje.'
    : 'Butik je zatvoren' + (st.text.indexOf('otvara') > -1 ? ' · ' + st.text.slice(st.text.indexOf('otvara')) : '') + '. Odgovor stiže ovdje.';
  return '<p class="pstatus' + (st.open ? '' : ' is-closed') + '">' + icon('clock') + '<span>' + esc(t) + '</span></p>';
}
function openChat(id) {
  show('chat');
  chatId = String(id); chatLast = 0; chatLastDay = ''; chatSizes = []; chatPeerName = '';
  toApp({ type: 'chat', id: chatId });
  $('#chatName').textContent = ''; $('#chatStatus').textContent = ''; $('#chatAvatar').textContent = '';
  $('#chatLog').innerHTML = '<p class="chat-empty">Učitavam razgovor…</p>';
  api('GET', '/api/conversations/' + chatId + '/messages').then(function (d) {
    if (chatId !== String(id)) { return; }
    var st = d.sagovornik.butik ? hoursStatus(d.sagovornik.hours) : null;
    $('#chatName').textContent = d.sagovornik.name;
    $('#chatAvatar').textContent = initial(d.sagovornik.name);
    $('#chatStatus').innerHTML = st ? '<span' + (st.open ? ' class="open"' : '') + '>' + esc(st.text) + '</span>' : '';
    chatSizes = d.oglas && d.oglas.sizes ? d.oglas.sizes : [];
    chatPeerName = d.sagovornik.name;
    setChatBlock(d.blokirao, d.blokirano);
    $('#chatLog').innerHTML = (d.oglas ? pcardHTML(d.oglas) : '') +
      (d.poruke.length ? '' : (isShop() ? '<p class="chat-empty">Napiši prvu poruku.</p>' : pstatusHTML(st) || '<p class="chat-empty">Napiši prvu poruku.</p>'));
    appendMessages(d.poruke);
    chatTimer = staniTajmer(chatTimer);
    chatTimer = tajmer('chat', pollChat, sljedeciRazmak('chat'));
    refreshUnread();
    paintChatForm();
    // Polje ne dobija fokus samo od sebe: tastatura ne smije prekriti karticu i status (M-2).
  }).catch(function (err) { $('#chatLog').innerHTML = '<p class="chat-empty">' + esc(err.message) + '</p>'; });
}
$('#chatLog').addEventListener('click', function (e) {
  var b = e.target.closest('.pcard');
  if (b && window.__komodoOpenUrl) { window.__komodoOpenUrl('/?o=' + b.getAttribute('data-open')); }
});
/* ---------- zaglavlje, traka potvrde i brza pitanja (U-06, U-08, U-09, F-08) ---------- */

var chatSizes = [], chatPeerName = '', chatMineBlock = false;
var QUICK_BUYER = ['Je li još dostupno?', 'Imate li u veličini …?', 'Može li dostava i koliko košta?', 'Mogu li doći da probam?'];
var QUICK_SHOP = ['Da, dostupno je.', 'Nažalost, prodato je.', 'Dostava je moguća. Pošaljite adresu i broj telefona.', 'Izvolite u radnju, tu smo.'];

function openChatMore() {
  if (!chatId) { return; }
  $('#chatBlock span').textContent = (chatMineBlock ? 'Odblokiraj ' : 'Blokiraj ') + chatPeerName;
  $('#chatMoreSheet').hidden = false;
  $('#chatBlock').focus();
}
function closeChatMore() { $('#chatMoreSheet').hidden = true; }
$('#chatMore').addEventListener('click', openChatMore);
$('#chatMoreNo').addEventListener('click', closeChatMore);
$('#chatMoreClose').addEventListener('click', closeChatMore);
$('#chatMoreSheet').addEventListener('click', function (e) { if (e.target === $('#chatMoreSheet')) { closeChatMore(); } });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#chatMoreSheet').hidden) { closeChatMore(); } });
(function () {
  var prev = window.__komodoBack;
  window.__komodoBack = function () {
    if (!$('#chatMoreSheet').hidden) { closeChatMore(); return; }
    if (prev) { prev(); }
  };
})();

function emailOk() { return !me || me.verified !== false; }

// Stanje polja za unos: blokiran razgovor ili nepotvrđen email onemogućuju slanje; brza pitanja samo dok je polje prazno.
function paintChatForm() {
  var any = chatBlocked, noMail = !emailOk(), off = any || noMail;
  $('#chatInput').disabled = off;
  $('#chatInput').placeholder = any ? 'Razgovor je blokiran' : (noMail ? 'Potvrdi email da bi pisao' : 'Napiši poruku');
  $('#chatForm').setAttribute('data-off', off ? '1' : '0');
  $('#chatForm').hidden = any;
  $('#chatBar').hidden = !(any || noMail);
  $('#chatResend').hidden = any;
  $('#chatBar .chat-bar-err').hidden = any;
  $('#chatUnblock').hidden = !(any && chatMineBlock);
  $('#chatUnblock').textContent = 'Odblokiraj ' + chatPeerName;
  $('#chatBar use').setAttribute('href', any ? '#i-ban' : '#i-mail');
  if (any) {
    $('#chatBarText').textContent = 'Razgovor je blokiran.';
  } else if (noMail) {
    $('#chatBarText').textContent = 'Potvrdi email da bi poslao poruku. Link smo poslali na ' + (me.email || 'tvoj email') + '.';
  }
  paintQuick();
}
$('#chatUnblock').addEventListener('click', function () { if (chatId) { doBlock(false); } });
function quickList() {
  var out = [], k;
  if (isShop()) {
    for (k = 0; k < QUICK_SHOP.length; k++) { out.push({ label: QUICK_SHOP[k], text: QUICK_SHOP[k] }); }
    return out;
  }
  out.push({ label: QUICK_BUYER[0], text: QUICK_BUYER[0] });
  if (chatSizes.length) {
    for (k = 0; k < chatSizes.length && k < 6; k++) {
      if (chatSizes[k] === 'UNI') { continue; }
      out.push({ label: 'Imate li ' + chatSizes[k] + '?', text: 'Imate li ovo u veličini ' + chatSizes[k] + '?' });
    }
  } else {
    out.push({ label: QUICK_BUYER[1], text: 'Imate li ovo u veličini ' });
  }
  out.push({ label: QUICK_BUYER[2], text: QUICK_BUYER[2] });
  out.push({ label: QUICK_BUYER[3], text: QUICK_BUYER[3] });
  return out;
}
function paintQuick() {
  var box = $('#chatQuick');
  $('#chatSend').disabled = $('#chatInput').disabled || $('#chatInput').value.trim() === '';
  var show = !!chatId && !chatBlocked && emailOk() && $('#chatInput').value === '' && !!chatPeerName;
  if (!show) { box.hidden = true; return; }
  if (!box.getAttribute('data-for') || box.getAttribute('data-for') !== chatId + '|' + chatSizes.join(',') + '|' + (isShop() ? 'b' : 'k')) {
    box.setAttribute('data-for', chatId + '|' + chatSizes.join(',') + '|' + (isShop() ? 'b' : 'k'));
    box.innerHTML = quickList().map(function (t) {
      return '<button type="button" class="quick" data-text="' + esc(t.text) + '">' + esc(t.label) + '</button>';
    }).join('');
  }
  box.hidden = false;
}
$('#chatQuick').addEventListener('click', function (e) {
  var b = e.target.closest('.quick');
  if (!b) { return; }
  var input = $('#chatInput'), text = b.getAttribute('data-text');
  input.value = text;
  paintQuick();
  input.focus();
  try { input.setSelectionRange(text.length, text.length); } catch (err) { /* polje bez izbora */ }
});
$('#chatInput').addEventListener('input', paintQuick);

$('#chatResend').addEventListener('click', function () {
  var btn = $('#chatResend');
  btn.disabled = true; $('#chatBarErr').textContent = '';
  api('POST', '/api/auth/resend').then(function () {
    btn.disabled = false;
    toast('Link je poslan na ' + (me.email || 'tvoj email') + '.');
  }).catch(function (err) {
    btn.disabled = false;
    $('#chatBarErr').textContent = err.message;   // npr. 429: „Link je već poslan. Provjeri poštu…”
  });
});

function setChatBlock(mine, any) {
  chatBlocked = any; chatMineBlock = mine;
  paintChatForm();
}
function doBlock(on) {
  api('POST', '/api/conversations/' + chatId + '/block', { blocked: on }).then(function (d) {
    setChatBlock(d.blokirao, d.blokirano);
    toast(d.blokirao ? 'Korisnik je blokiran. Više ti ne može pisati.' : 'Korisnik je odblokiran.');
  }).catch(function (err) { toast(err.message, true); });
}
$('#chatBlock').addEventListener('click', function () {
  if (!chatId) { return; }
  closeChatMore();
  if (chatMineBlock) { doBlock(false); return; }
  confirmAction({
    title: 'Blokirati ' + chatPeerName + '?',
    text: 'Više ti neće moći pisati, a ni ti njemu. Možeš ga odblokirati kasnije.',
    ok: 'Blokiraj'
  }, function () { doBlock(true); });
});
$('#chatReport').addEventListener('click', function () {
  closeChatMore();
  if (chatId) { openReport({ conversationId: chatId }, 'Prijavi poruku'); }
});
$('#chatBack').addEventListener('click', function () { show('inbox'); });

// Idempotency-Key (talas 4): poruka koja nije potvrđena (pukla veza, greška) i ponovo se pošalje s istim tekstom
// u istom razgovoru nosi isti ključ, pa server ne upiše dvije poruke ako je prva ipak stigla.
var porukaKljuc = null, porukaZa = null;
$('#chatForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = $('#chatInput'), text = input.value.trim();
  if (!text || !chatId) { return; }
  if (porukaZa !== chatId + '|' + text) { porukaKljuc = noviKljuc(); porukaZa = chatId + '|' + text; }
  input.value = ''; paintQuick();
  api('POST', '/api/conversations/' + chatId + '/messages', { body: text }, { 'Idempotency-Key': porukaKljuc }).then(function (d) {
    porukaKljuc = null; porukaZa = null;
    appendMessages([d.poruka]);
    paintQuick();
  }).catch(function (err) { input.value = text; paintQuick(); toast(err.message, true); });
});
