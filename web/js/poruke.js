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
  $('#inboxList').innerHTML = '';
  api('GET', '/api/conversations').then(function (d) {
    var list = d.razgovori;
    $('#inboxHint').textContent = list.length ? '' : (isShop()
      ? 'Još nema poruka. Kad ti kupac piše zbog oglasa, razgovor se pojavi ovdje.'
      : 'Još nema poruka. Na oglasu dodirni Pošalji poruku i pitaj butik šta te zanima.');
    $('#inboxList').innerHTML = list.map(function (c) {
      return '<li><button type="button" data-chat="' + c.id + '" class="' + (c.unread ? 'unread' : '') + '">' +
        '<span class="who"><span>' + esc(c.name) + '</span><time>' + esc(fmtTime(c.at)) + '</time></span>' +
        (c.listingTitle ? '<span class="ltitle">' + esc(c.listingTitle) + '</span>' : '') +
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
  }).catch(function (err) { toast(err.message, true); });
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
  if (!chatId || !pageVisible()) { return; }
  var id = chatId;
  api('GET', '/api/conversations/' + id + '/messages?after=' + chatLast).then(function (d) {
    if (chatId === id) { appendMessages(d.poruke); }
  }, function () {});
}
function stopChat() {
  if (chatId) { toApp({ type: 'chat', id: null }); }
  clearInterval(chatTimer); chatTimer = null; chatId = null;
}
function openChat(id) {
  show('chat');
  chatId = String(id); chatLast = 0; chatSizes = []; chatPeerName = '';
  toApp({ type: 'chat', id: chatId });
  $('#chatName').textContent = ''; $('#chatListing').textContent = '';
  $('#chatLog').innerHTML = '<p class="chat-empty">Učitavam razgovor…</p>';
  api('GET', '/api/conversations/' + chatId + '/messages').then(function (d) {
    if (chatId !== String(id)) { return; }
    $('#chatName').textContent = d.sagovornik.name;
    $('#chatListing').textContent = d.oglas ? 'Oglas: ' + d.oglas.title + ' · ' + fmtKM(d.oglas.price) : '';
    chatSizes = d.oglas && d.oglas.sizes ? d.oglas.sizes : [];
    chatPeerName = d.sagovornik.name;
    setChatBlock(d.blokirao, d.blokirano);
    $('#chatLog').innerHTML = d.poruke.length ? '' : '<p class="chat-empty">Napiši prvu poruku.</p>';
    appendMessages(d.poruke);
    chatTimer = setInterval(pollChat, 4000);
    refreshUnread();
    paintChatForm();
    if (!$('#chatInput').disabled) { $('#chatInput').focus(); }
  }).catch(function (err) { $('#chatLog').innerHTML = '<p class="chat-empty">' + esc(err.message) + '</p>'; });
}
/* ---------- zaglavlje, traka potvrde i brza pitanja (U-06, U-08, U-09, F-08) ---------- */

var chatSizes = [], chatPeerName = '', chatMineBlock = false;
var QUICK_BUYER = ['Je li još dostupno?', 'Imate li u veličini …?', 'Može li dostava i koliko košta?', 'Mogu li doći da probam?'];
var QUICK_SHOP = ['Da, dostupno je.', 'Nažalost, prodato je.', 'Dostava je moguća. Pošaljite adresu i broj telefona.', 'Izvolite u radnju, tu smo.'];

// Ostatak ekrana razgovora gradi skripta: „Više” umjesto dva linka, trake iznad polja za unos i prozor „Više”.
$('.chat-tools').innerHTML = '<button type="button" class="chat-more" id="chatMore" aria-label="Više" aria-haspopup="dialog"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg></button>';
(function () {
  var form = $('#chatForm'), foot = document.createElement('div');
  foot.className = 'chat-foot';
  foot.innerHTML = '<div class="chat-bar" id="chatBar" role="status" hidden>' +
    '<p id="chatBarText"></p><p class="chat-bar-err" id="chatBarErr" role="alert"></p>' +
    '<button type="button" class="btn" id="chatResend">Pošalji ponovo</button></div>' +
    '<div class="chat-quick" id="chatQuick" role="group" aria-label="Brza pitanja" hidden></div>';
  chat.insertBefore(foot, form);
  foot.appendChild(form);
  var sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.id = 'chatMoreSheet'; sheet.hidden = true;
  sheet.innerHTML = '<div class="panel" role="dialog" aria-modal="true" aria-label="Više">' +
    '<button type="button" class="btn sheet-opt" id="chatBlock"></button>' +
    '<button type="button" class="btn sheet-opt" id="chatReport">Prijavi poruku</button>' +
    '<button type="button" class="btn sheet-opt" id="chatMoreNo">Odustani</button></div>';
  chat.parentNode.appendChild(sheet);
})();

function openChatMore() {
  if (!chatId) { return; }
  $('#chatBlock').textContent = (chatMineBlock ? 'Odblokiraj ' : 'Blokiraj ') + chatPeerName;
  $('#chatMoreSheet').hidden = false;
  $('#chatBlock').focus();
}
function closeChatMore() { $('#chatMoreSheet').hidden = true; }
$('#chatMore').addEventListener('click', openChatMore);
$('#chatMoreNo').addEventListener('click', closeChatMore);
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
  $('#chatForm button[type="submit"]').disabled = off;
  $('#chatInput').placeholder = any ? 'Razgovor je blokiran' : (noMail ? 'Potvrdi email da bi pisao' : 'Napiši poruku');
  $('#chatForm').setAttribute('data-off', off ? '1' : '0');
  $('#chatBar').hidden = !noMail;
  if (noMail) {
    $('#chatBarText').textContent = 'Potvrdi email da bi poslao poruku. Link smo poslali na ' + (me.email || 'tvoj email') + '.';
  }
  paintQuick();
}
function quickList() {
  var out = [], k;
  if (isShop()) {
    for (k = 0; k < QUICK_SHOP.length; k++) { out.push({ label: QUICK_SHOP[k], text: QUICK_SHOP[k] }); }
    return out;
  }
  out.push({ label: QUICK_BUYER[0], text: QUICK_BUYER[0] });
  if (chatSizes.length) {
    for (k = 0; k < chatSizes.length && k < 6; k++) {
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

$('#chatForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = $('#chatInput'), text = input.value.trim();
  if (!text || !chatId) { return; }
  input.value = ''; paintQuick();
  api('POST', '/api/conversations/' + chatId + '/messages', { body: text }).then(function (d) {
    appendMessages([d.poruka]);
    paintQuick();
  }).catch(function (err) { input.value = text; paintQuick(); toast(err.message, true); });
});
