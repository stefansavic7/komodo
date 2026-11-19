// Komodo web — Objava novog oglasa (video) i izmjena oglasa.
// Obični skript u globalnom opsegu (bez modula, bez gradnje); redoslijed učitavanja je u web/index.html
// i opisan u docs/ARHITEKTURA.md.
'use strict';

/* ---------- izmjena oglasa ---------- */

function openEdit(item) {
  pauseAll();
  editId = item.id;
  $('#eTitle').value = item.title;
  $('#ePrice').value = (Math.round(item.price * 100) % 100 !== 0 ? item.price.toFixed(2) : String(item.price)).replace('.', ',');
  $('#eCat').value = item.category;
  $('#eSold').checked = item.sold;
  $('#editErr').textContent = '';
  editSheet.hidden = false;
  $('#eTitle').focus();
}
function closeEdit() { editSheet.hidden = true; editId = null; if (!feed.hidden) { watch(); } }
$('#editCancel').addEventListener('click', closeEdit);
editSheet.addEventListener('click', function (e) { if (e.target === editSheet) { closeEdit(); } });
$('#editForm').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!editId) { return; }
  $('#editErr').textContent = '';
  api('PATCH', '/api/listings/' + editId, {
    title: $('#eTitle').value.trim(), price: $('#ePrice').value.trim(), category: $('#eCat').value, sold: $('#eSold').checked
  }).then(function (d) {
    var item = byId(d.oglas.id), card = feed.querySelector('.card[data-id="' + d.oglas.id + '"]');
    if (item && card) {
      Object.keys(d.oglas).forEach(function (k) { item[k] = d.oglas[k]; });
      card.outerHTML = cardHTML(item);
    }
    closeEdit();
    toast('Oglas je izmijenjen.');
  }).catch(function (err) { $('#editErr').textContent = err.message; });
});

/* ---------- objava oglasa ---------- */

fCat.innerHTML = CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
$('#eCat').innerHTML = fCat.innerHTML;

function clearPending() {
  if (pendingURL) { URL.revokeObjectURL(pendingURL); }
  pendingURL = null; pendingFile = null;
}
function resetPost() {
  postForm.reset();
  preview.pause(); preview.removeAttribute('src'); preview.load(); preview.hidden = true;
  pickText.textContent = 'Snimi ili izaberi video';
  postErr.textContent = ''; progress.hidden = true; progressBar.style.width = '0';
  postSubmit.disabled = false; postSubmit.textContent = 'Objavi';
  clearPending();
}
function openPost() {
  if (!me) { needLogin('Prijavi se nalogom butika da objaviš oglas.'); return; }
  if (!isShop()) { toast('Oglase objavljuju samo butici.'); return; }
  pauseAll();
  postSheet.hidden = false;
  fVideo.focus();
}
function closePost() {
  if (uploading) { return; }
  resetPost();
  postSheet.hidden = true;
  if (!feed.hidden) { watch(); }
}
fVideo.addEventListener('change', function () {
  var f = fVideo.files && fVideo.files[0];
  if (!f) { return; }
  if (f.type.indexOf('video/') !== 0) {
    postErr.textContent = 'Ovaj fajl nije video. Izaberi video snimak.';
    fVideo.value = '';
    return;
  }
  if (f.size > 100 * 1024 * 1024) {
    postErr.textContent = 'Video je prevelik. Najviše 100 MB, a kratak snimak je sasvim dovoljan.';
    fVideo.value = '';
    return;
  }
  clearPending();
  pendingFile = f;
  pendingURL = URL.createObjectURL(f);
  preview.src = pendingURL; preview.hidden = false;
  var p = preview.play(); if (p && p.catch) { p.catch(function () {}); }
  pickText.textContent = 'Promijeni video';
  postErr.textContent = '';
});
postForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (uploading) { return; }
  var title = fTitle.value.trim(), price = fPrice.value.trim();
  if (!pendingFile) { postErr.textContent = 'Dodaj video proizvoda.'; return; }
  if (title.length < 2) { postErr.textContent = 'Upiši naziv, npr. Crna saten haljina, M.'; fTitle.focus(); return; }
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(price.replace(/\s/g, ''))) { postErr.textContent = 'Upiši cijenu u KM brojem, npr. 65 ili 64,90.'; fPrice.focus(); return; }

  // Polja idu prije videa, da ih server ima i kad je video velik.
  var data = new FormData();
  data.append('title', title);
  data.append('price', price);
  data.append('category', fCat.value);
  data.append('video', pendingFile);

  uploading = true;
  postErr.textContent = '';
  postSubmit.disabled = true; postSubmit.textContent = 'Šaljem…';
  progress.hidden = false;

  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/listings');
  xhr.withCredentials = true;
  xhr.upload.onprogress = function (ev) {
    if (ev.lengthComputable) { progressBar.style.width = Math.round(ev.loaded / ev.total * 100) + '%'; }
  };
  function fail(msg) {
    uploading = false;
    postErr.textContent = msg;
    postSubmit.disabled = false; postSubmit.textContent = 'Objavi';
    progress.hidden = true; progressBar.style.width = '0';
  }
  xhr.onload = function () {
    var res = {};
    try { res = JSON.parse(xhr.responseText); } catch (err) {}
    if (xhr.status === 201) {
      uploading = false;
      resetPost();
      postSheet.hidden = true;
      shop = null; brand.hidden = false; shopbar.hidden = true;
      filter = 'Sve'; renderChips(); show('feed', true); loadFeed(true);
      toast('Oglas je objavljen.');
    } else if (xhr.status === 401) {
      fail('Prijava je istekla. Prijavi se ponovo, pa objavi.');
    } else {
      fail(res.greska || 'Objava nije uspjela. Pokušaj ponovo.');
    }
  };
  xhr.onerror = function () { fail('Nema veze sa serverom. Provjeri internet i pokušaj ponovo.'); };
  xhr.send(data);
});
$('#postCancel').addEventListener('click', closePost);
postSheet.addEventListener('click', function (e) { if (e.target === postSheet) { closePost(); } });
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') { return; }
  if (!$('#confirmSheet').hidden) { closeConfirm(); return; }
  if (!postSheet.hidden) { closePost(); }
  if (!editSheet.hidden) { closeEdit(); }
  if (!reportSheet.hidden) { closeReport(); }
  if (!contactSheet.hidden) { closeContact(); }
});
