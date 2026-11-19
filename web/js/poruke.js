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
  chatId = String(id); chatLast = 0;
  toApp({ type: 'chat', id: chatId });
  $('#chatName').textContent = ''; $('#chatListing').textContent = '';
  $('#chatLog').innerHTML = '<p class="chat-empty">Učitavam razgovor…</p>';
  api('GET', '/api/conversations/' + chatId + '/messages').then(function (d) {
    if (chatId !== String(id)) { return; }
    $('#chatName').textContent = d.sagovornik.name;
    $('#chatListing').textContent = d.oglas ? 'Oglas: ' + d.oglas.title + ' · ' + fmtKM(d.oglas.price) : '';
    setChatBlock(d.blokirao, d.blokirano);
    $('#chatLog').innerHTML = d.poruke.length ? '' : '<p class="chat-empty">Napiši prvu poruku.</p>';
    appendMessages(d.poruke);
    chatTimer = setInterval(pollChat, 4000);
    refreshUnread();
    $('#chatInput').focus();
  }).catch(function (err) { $('#chatLog').innerHTML = '<p class="chat-empty">' + esc(err.message) + '</p>'; });
}
function setChatBlock(mine, any) {
  chatBlocked = any;
  $('#chatBlock').textContent = mine ? 'Odblokiraj' : 'Blokiraj';
  $('#chatBlock').setAttribute('data-on', mine ? '1' : '0');
  $('#chatInput').disabled = any;
  $('#chatInput').placeholder = any ? 'Razgovor je blokiran' : 'Napiši poruku';
  $('#chatForm').setAttribute('data-off', any ? '1' : '0');
}
$('#chatBlock').addEventListener('click', function () {
  if (!chatId) { return; }
  var on = $('#chatBlock').getAttribute('data-on') === '1';
  api('POST', '/api/conversations/' + chatId + '/block', { blocked: !on }).then(function (d) {
    setChatBlock(d.blokirao, d.blokirano);
    toast(d.blokirao ? 'Korisnik je blokiran. Više ti ne može pisati.' : 'Korisnik je odblokiran.');
  }).catch(function (err) { toast(err.message, true); });
});
$('#chatReport').addEventListener('click', function () {
  if (chatId) { openReport({ conversationId: chatId }, 'Prijavi poruku'); }
});
$('#chatBack').addEventListener('click', function () { show('inbox'); });

$('#chatForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = $('#chatInput'), text = input.value.trim();
  if (!text || !chatId) { return; }
  input.value = '';
  api('POST', '/api/conversations/' + chatId + '/messages', { body: text }).then(function (d) {
    appendMessages([d.poruka]);
  }).catch(function (err) { input.value = text; toast(err.message, true); });
});
