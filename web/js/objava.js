// Komodo web — Objava novog oglasa (video) i izmjena oglasa.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- izmjena oglasa ---------- */

var editSizes = [], postSizes = [], editItem = null;
// Obavještenje o sniženju (F-07): nova cijena najmanje 5 % niža, oglas nije prodat i ima sviđanja.
function updateDropNote() {
  var note = $('#eDrop'), it = editItem;
  var raw = $('#ePrice').value.replace(/\s/g, '').replace(/km$/i, '').replace(',', '.');
  var cents = /^\d+(\.\d{1,2})?$/.test(raw) ? Math.round(parseFloat(raw) * 100) : null;
  var drop = !!it && cents !== null && cents * 100 <= Math.round(it.price * 100) * 95 && !$('#eSold').checked && !it.processing && !it.videoError;
  var was = $('#eWas');
  was.hidden = !(it && cents !== null && cents < Math.round(it.price * 100));
  if (!was.hidden) { was.textContent = 'Bila ' + fmtKM(it.price); }
  if (drop && it.likes > 0 && it.pushSnizenje === false) {
    // R2-07: cijena je promijenjena prije manje od 3 dana — sniženje se prikazuje, ali bez obavještenja.
    note.textContent = 'Cijena je mijenjana u zadnja 3 dana, pa kupci ovaj put neće dobiti obavještenje o sniženju.';
    note.hidden = false;
  } else if (drop && it.likes > 0) {
    note.textContent = 'Kupci koji su označili ovaj oglas (' + it.likes + ') dobiće obavještenje o sniženju.';
    note.hidden = false;
  } else { note.hidden = true; }
}
$('#ePrice').addEventListener('input', updateDropNote);
$('#eSold').addEventListener('change', updateDropNote);
function openEdit(item) {
  pauseAll();
  editId = item.id; editItem = item;
  editSizes = (item.sizes || []).slice();
  $('#eTitle').value = item.title;
  $('#ePrice').value = (Math.round(item.price * 100) % 100 !== 0 ? item.price.toFixed(2) : String(item.price)).replace('.', ',');
  $('#eCat').value = item.category;
  $('#eSold').checked = item.sold;
  editSizes = paintSizePicker($('#eSizesBox'), $('#eSizes'), item.category, editSizes);
  updateDropNote();
  $('#editErr').textContent = '';
  editSheet.hidden = false;
}
function closeEdit() { editSheet.hidden = true; editId = null; editItem = null; if (!feed.hidden) { watch(); } }
$('#editCancel').addEventListener('click', closeEdit);
$('#editClose').addEventListener('click', closeEdit);
editSheet.addEventListener('click', function (e) { if (e.target === editSheet) { closeEdit(); } });
$('#editForm').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!editId) { return; }
  $('#editErr').textContent = '';
  var body = { title: $('#eTitle').value.trim(), price: $('#ePrice').value.trim(), category: $('#eCat').value, sold: $('#eSold').checked };
  if (sizeSet(body.category).length) {
    if (!editSizes.length) { $('#editErr').textContent = 'Izaberi bar jednu veličinu.'; return; }
    body.sizes = editSizes.slice();
  }
  api('PATCH', '/api/listings/' + editId, body).then(function (d) {
    applyUpdated(d.oglas);
    closeEdit();
    toast(d.obavijesteno && d.oglas.likes > 0 ? 'Oglas je izmijenjen. Obavijestili smo kupce o sniženju.' : 'Oglas je izmijenjen.');
  }).catch(function (err) { $('#editErr').textContent = err.message; });
});

/* ---------- objava oglasa ---------- */

fCat.innerHTML = CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
$('#eCat').innerHTML = fCat.innerHTML;
$('#fSizes').addEventListener('click', function (e) {
  var b = e.target.closest('.size-btn');
  if (!b) { return; }
  toggleSize(postSizes, b.getAttribute('data-size'));
  postSizes = paintSizePicker($('#fSizesBox'), $('#fSizes'), fCat.value, postSizes);
});
$('#eSizes').addEventListener('click', function (e) {
  var b = e.target.closest('.size-btn');
  if (!b) { return; }
  toggleSize(editSizes, b.getAttribute('data-size'));
  editSizes = paintSizePicker($('#eSizesBox'), $('#eSizes'), $('#eCat').value, editSizes);
});
// Promjena kategorije briše izbor koji ne pripada novom skupu.
fCat.addEventListener('change', function () { postSizes = paintSizePicker($('#fSizesBox'), $('#fSizes'), fCat.value, postSizes); });
$('#eCat').addEventListener('change', function () { editSizes = paintSizePicker($('#eSizesBox'), $('#eSizes'), $('#eCat').value, editSizes); });
postSizes = paintSizePicker($('#fSizesBox'), $('#fSizes'), fCat.value, postSizes);

function clearPending() {
  if (pendingURL) { URL.revokeObjectURL(pendingURL); }
  pendingURL = null; pendingFile = null;
}
function resetPost() {
  postForm.reset();
  postSizes = paintSizePicker($('#fSizesBox'), $('#fSizes'), fCat.value, []);
  preview.pause(); preview.removeAttribute('src'); preview.load(); preview.hidden = true;
  $('#prevBox').hidden = true; $('#pickBox').hidden = false; paintPreviewText();
  pickText.textContent = 'Snimi ili izaberi video';
  clearPostInvalid(); postErr.textContent = ''; progress.hidden = true; progressBar.style.width = '0';
  postSubmit.disabled = false; postSubmit.removeAttribute('aria-busy'); postSubmit.textContent = 'Objavi';
  clearPending();
}
// Pregled preko snimka: naziv i cijena se upisuju na sličicu dok korisnik kuca.
function paintPreviewText() {
  var t = fTitle.value.trim(), raw = fPrice.value.replace(/\s/g, '').replace(',', '.');
  $('#pvTitle').textContent = t;
  var ok = /^\d{1,6}(\.\d{1,2})?$/.test(raw);
  $('#pvPrice').hidden = !ok;
  if (ok) { $('#pvPrice').textContent = fmtKM(parseFloat(raw)); }
}
fTitle.addEventListener('input', paintPreviewText);
fPrice.addEventListener('input', paintPreviewText);
// Greška uz polje: crveni okvir i aria-invalid; briše se čim korisnik počne ispravljati.
function markPostInvalid(el) { if (el) { el.setAttribute('aria-invalid', 'true'); } }
function clearPostInvalid() {
  var els = [fTitle, fPrice, $('#pickBox')];
  for (var k = 0; k < els.length; k++) { els[k].removeAttribute('aria-invalid'); }
}
postForm.addEventListener('input', function (e) { if (e.target.removeAttribute) { e.target.removeAttribute('aria-invalid'); } });
function postFail(msg, el) {
  postErr.textContent = msg;
  markPostInvalid(el);
  postErr.scrollIntoView({ block: 'center' });
  if (el && el.focus && el !== $('#pickBox')) { el.focus(); }
}
function openPost() {
  if (!me) { needLogin('Prijavi se nalogom butika da objaviš oglas.'); return; }
  if (!isShop()) { toast('Oglase objavljuju samo butici.'); return; }
  pauseAll();
  $('#postDone').hidden = true; postForm.hidden = false;
  postSheet.hidden = false;
}
function closePost() {
  if (uploading) { return; }
  resetPost();
  $('#postDone').hidden = true; postForm.hidden = false;
  postSheet.hidden = true;
  if (!feed.hidden) { watch(); }
}
fVideo.addEventListener('change', function () {
  var f = fVideo.files && fVideo.files[0];
  if (!f) { return; }
  if (f.type.indexOf('video/') !== 0) {
    postFail('Ovaj fajl nije video. Izaberi video snimak.', $('#pickBox'));
    fVideo.value = '';
    return;
  }
  if (f.size > 100 * 1024 * 1024) {
    postFail('Video je prevelik. Najviše 100 MB, a kratak snimak je sasvim dovoljan.', $('#pickBox'));
    fVideo.value = '';
    return;
  }
  clearPending();
  objavaKljuc = null;   // novi snimak = nova objava
  pendingFile = f;
  pendingURL = URL.createObjectURL(f);
  preview.src = pendingURL; preview.hidden = false;
  $('#prevBox').hidden = false; $('#pickBox').hidden = true;
  $('#pvInfo span').textContent = 'Video';
  paintPreviewText();
  var p = preview.play(); if (p && p.catch) { p.catch(function () {}); }
  clearPostInvalid(); postErr.textContent = '';
});
// Prvi kadar odabranog videa kao mala sličica za ekran „Oglas je u izlogu” (bez zahtjeva); null ako preglednik ne da.
function captureFrame() {
  try {
    var c = document.createElement('canvas'), w = preview.videoWidth, h = preview.videoHeight;
    if (!w || !h) { return null; }
    c.width = 192; c.height = Math.round(192 * h / w);
    c.getContext('2d').drawImage(preview, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch (e) { return null; }
}
var doneItem = null;
function showPostDone(it, shot, meta) {
  doneItem = it;
  $('#doneName').textContent = it.title;
  $('#donePrice').textContent = fmtKM(it.price);
  $('#doneMeta').textContent = meta;
  var img = $('#doneImg');
  if (shot) { img.src = shot; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
  $('#doneText').hidden = !(it.processing);
  var f = $('#doneFollowers');
  if (typeof pFollowers === 'number' && pFollowers > 0) {
    f.querySelector('span').textContent = pFollowers + ' ' + butikMnozina(pFollowers, 'pratilac ga vidi', 'pratioca ga vide', 'pratilaca ga vidi') + ' u „Praćeni”';
    f.hidden = false;
  } else { f.hidden = true; }
  $('#doneShare').hidden = !it.id;
  postForm.hidden = true; $('#postDone').hidden = false;
  $('#doneTitle').focus();
}
preview.addEventListener('loadedmetadata', function () {
  var d = Math.round(preview.duration || 0), m = Math.floor(d / 60), s = d % 60;
  var dir = preview.videoHeight >= preview.videoWidth ? 'uspravno' : 'vodoravno';
  $('#pvInfo span').textContent = 'Video ' + m + ':' + (s < 10 ? '0' : '') + s + ', ' + dir;
});
var objavaKljuc = null;
postForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (uploading) { return; }
  var title = fTitle.value.trim(), price = fPrice.value.trim();
  clearPostInvalid();
  if (!pendingFile) { postFail('Dodaj video proizvoda.', $('#pickBox')); return; }
  if (title.length < 2) { postFail('Upiši naziv, npr. Crna saten haljina, M.', fTitle); return; }
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(price.replace(/\s/g, ''))) { postFail('Upiši cijenu u KM brojem, npr. 65 ili 64,90.', fPrice); return; }

  var needSizes = sizeSet(fCat.value).length > 0;
  if (needSizes && !postSizes.length) { postFail('Izaberi bar jednu veličinu.', null); return; }

  // Polja idu prije videa, da ih server ima i kad je video velik.
  var data = new FormData();
  data.append('title', title);
  data.append('price', price);
  data.append('category', fCat.value);
  if (needSizes) { data.append('sizes', postSizes.join(',')); }
  data.append('video', pendingFile);

  uploading = true;
  postErr.textContent = '';
  var shot = captureFrame();
  postSubmit.disabled = true; postSubmit.setAttribute('aria-busy', 'true'); postSubmit.innerHTML = '<span class="spin" aria-hidden="true"></span>Šaljem video…';
  progress.hidden = false;

  // Idempotency-Key (talas 4): isti ključ dok se ne izabere drugi snimak ili objava ne uspije — ponovni pokušaj
  // poslije pukle veze ne pravi drugi oglas ako je prvi ipak stigao.
  if (!objavaKljuc) { objavaKljuc = noviKljuc(); }
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/listings');
  xhr.withCredentials = true;
  xhr.setRequestHeader('Idempotency-Key', objavaKljuc);
  xhr.upload.onprogress = function (ev) {
    if (ev.lengthComputable) { progressBar.style.width = Math.round(ev.loaded / ev.total * 100) + '%'; }
  };
  function fail(msg) {
    uploading = false;
    postErr.textContent = msg;
    postSubmit.disabled = false; postSubmit.removeAttribute('aria-busy'); postSubmit.textContent = 'Objavi';
    progress.hidden = true; progressBar.style.width = '0';
    postErr.scrollIntoView({ block: 'center' });
  }
  xhr.onload = function () {
    var res = {};
    try { res = JSON.parse(xhr.responseText); } catch (err) {}
    zabiljeziOdgovor(xhr.status, xhr.getResponseHeader('Retry-After'));
    if (xhr.status === 201) {
      uploading = false;
      objavaKljuc = null;
      var added = res.oglas || { id: null, title: title, price: parseFloat(price.replace(',', '.')), shopName: me ? me.name : '' };
      var meta = [fCat.value].concat(postSizes.length ? [(/^\d/.test(postSizes[0]) ? 'Br. ' : 'Vel. ') + postSizes.map(sizeLabel).join(' · ')] : []).join(' · ');
      resetPost();
      showPostDone(added, shot, meta);
      shop = null; brand.hidden = false; shopbar.hidden = true;
      // Poslije objave butik vidi svoj oglas u kartici „Novo”.
      filter = 'Sve'; kartica = 'novo'; karticaRucno = true; renderChips(); show('feed', true); loadFeed(true);
    } else if (xhr.status === 401) {
      fail('Prijava je istekla. Prijavi se ponovo, pa objavi.');
    } else {
      fail(res.greska || 'Objava nije uspjela. Pokušaj ponovo.');
    }
  };
  xhr.onerror = function () { fail('Nema veze sa serverom. Provjeri internet i pokušaj ponovo.'); };
  xhr.send(data);
});
$('#postClose').addEventListener('click', closePost);
$('#doneClose').addEventListener('click', closePost);
$('#doneAgain').addEventListener('click', function () {
  $('#postDone').hidden = true; postForm.hidden = false;
  postForm.scrollTop = 0;
});
$('#doneShare').addEventListener('click', function () { if (doneItem && doneItem.id) { shareListing(doneItem); } });
postSheet.addEventListener('click', function (e) { if (e.target === postSheet) { closePost(); } });
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') { return; }
  if (!$('#confirmSheet').hidden) { closeConfirm(); return; }
  if (!moreSheet.hidden) { closeMore(); }
  if (!postSheet.hidden) { closePost(); }
  if (!editSheet.hidden) { closeEdit(); }
  if (!reportSheet.hidden) { closeReport(); }
  if (!contactSheet.hidden) { closeContact(); }
  if (!buyerMoreSheet.hidden) { closeBuyerMore(); }
  if (!searchSheet.hidden) { closeSearch(); }
});
