// P6 (docs/SPEC-V1.md, F-02): Open Graph oznake u GET / za ?o= i ?b=, te sličica /og/<id>.jpg.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ROOT, noviButik, okolina, sleep } from './pomoc/okolina.mjs';

const APP = 'https://komodo.test';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7), Buffer.from([0xff, 0xd9])]);

// Lažni Bunny CDN: thumbnail.jpg samo uz Referer s našom adresom („Block direct url file access”).
async function lazniCdn() {
  const st = { zahtjeva: 0, bezReferera: 0, odgovor: 'jpeg', kasni: 0, putanje: [] };
  const server = http.createServer(async (req, res) => {
    st.zahtjeva += 1;
    st.putanje.push(req.url);
    if (!String(req.headers.referer || '').startsWith(APP)) { st.bezReferera += 1; res.statusCode = 403; return res.end('blokirano'); }
    if (st.kasni) await sleep(st.kasni);
    const m = /^\/([^/]+)\/thumbnail\.jpg$/.exec(req.url);
    if (!m || m[1] === 'guid-nema') { res.statusCode = 404; return res.end(); }
    if (st.odgovor === 'html') { res.setHeader('content-type', 'image/jpeg'); return res.end('<html>nije slika</html>'); }
    if (st.odgovor === 'veliko') { res.setHeader('content-type', 'image/jpeg'); return res.end(Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024)])); }
    res.setHeader('content-type', 'image/jpeg');
    return res.end(JPEG);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { st, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

const meta = (html, name) => {
  const m = new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)">`).exec(html);
  return m ? m[1] : null;
};
const head = (html) => html.slice(0, html.indexOf('</head>'));
const trazi = (url, ua = 'facebookexternalhit/1.1') => fetch(url, { headers: { 'user-agent': ua } }).then(async (r) => ({ status: r.status, headers: r.headers, html: await r.text() }));

describe('OG oznake i sličica (razvoj, bez Bunnyja)', () => {
  let o; let shop; let butik; let l1;
  const NASLOV = 'Haljina <script>alert("x")</script> & \'ok\'';
  before(async () => {
    o = await okolina({ APP_URL: APP });
    butik = await noviButik(o.baza, { butik: 'Butik Bojana & Ko', email: 'og.butik@test.ba', grad: 'Banja Luka' });
    shop = o.klijent();
    await shop.prijavi(butik.email, butik.password);
    l1 = (await shop.objavi({ title: NASLOV, price: '89,90' })).body.oglas;
  });
  after(async () => { await o?.stop(); });

  test('?o=<id>: naslov je escape-ovan, cijena u formatu aplikacije, apsolutni URL-ovi', async () => {
    for (const ua of ['facebookexternalhit/1.1', 'WhatsApp/2.23.20 A', 'Viber']) {
      const r = await trazi(`${o.url}/?o=${l1.id}`, ua);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control'), /no-cache/);
      const h = head(r.html);
      assert.ok(!h.includes('<script>alert'), 'neescape-ovan naslov u <head>');
      const title = meta(h, 'og:title');
      assert.equal(title, 'Haljina &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;ok&#39; · 89,90 KM');
      assert.match(h, new RegExp(`<title>${title.replace(/[()]/g, '\\$&')}</title>`));
      assert.equal(meta(h, 'og:url'), `${APP}/?o=${l1.id}`);
      assert.equal(meta(h, 'og:type'), 'website');
      assert.equal(meta(h, 'og:site_name'), 'Komodo');
      assert.equal(meta(h, 'twitter:card'), 'summary_large_image');
      assert.equal(meta(h, 'og:description'), 'Butik Bojana &amp; Ko · Banja Luka. Pogledaj video na Komodu.');
      assert.equal(meta(h, 'og:image'), `${APP}/og-komodo.png`, 'lokalni snimak: zajednička slika');
      assert.ok(h.length < 4096);
    }
  });

  test('cijena: cijeli iznos bez decimala, prodato, sniženje', async () => {
    const a = (await shop.objavi({ title: 'Jakna', price: '1200' })).body.oglas;
    assert.equal(meta((await trazi(`${o.url}/?o=${a.id}`)).html, 'og:title'), 'Jakna · 1.200 KM');
    await o.baza.q('update listings set old_price_cents = 150000, price_dropped_at = now() where id = $1', [a.id]);
    // keš 60 s: drugi ključ za svježu provjeru
    const b = (await shop.objavi({ title: 'Torba', price: '50' })).body.oglas;
    await o.baza.q('update listings set old_price_cents = 7000, price_dropped_at = now() where id = $1', [b.id]);
    assert.equal(meta((await trazi(`${o.url}/?o=${b.id}`)).html, 'og:title'), 'Torba · 50 KM (bilo 70 KM)');
    const c = (await shop.objavi({ title: 'Cipele', price: '40' })).body.oglas;
    await o.baza.q('update listings set sold = true where id = $1', [c.id]);
    assert.equal(meta((await trazi(`${o.url}/?o=${c.id}`)).html, 'og:title'), 'Cipele · Prodato');
  });

  test('obrisan, nepostojeći i neispravan id → opšti pregled, bez curenja naslova, kod 200', async () => {
    const d = (await shop.objavi({ title: 'Tajni naslov obrisanog', price: '10' })).body.oglas;
    assert.equal((await shop.del(`/api/listings/${d.id}`)).status, 200);
    for (const u of [`/?o=${d.id}`, '/?o=999999', '/?o=abc', '/?o=1&o=2', '/?b=nema', '/?o=', '/']) {
      const r = await trazi(o.url + u);
      assert.equal(r.status, 200, u);
      assert.ok(!r.html.includes('Tajni naslov'), u);
      assert.equal(meta(r.html, 'og:title'), 'Komodo — video oglasi butika iz Banje Luke', u);
      assert.equal(meta(r.html, 'og:image'), `${APP}/og-komodo.png`);
      assert.equal(meta(r.html, 'og:url'), `${APP}/`);
    }
  });

  test('/index.html i ugašen butik', async () => {
    const r = await trazi(`${o.url}/index.html?o=${l1.id}`);
    assert.match(meta(r.html, 'og:title'), /· 89,90 KM$/);
    await noviButik(o.baza, { butik: 'Ugasen Butik', email: 'og.ugasen@test.ba' });
    await o.baza.q("update users set suspended_at = now() where email = 'og.ugasen@test.ba'");
    const h = (await o.baza.q("select handle from users where email = 'og.ugasen@test.ba'")).rows[0].handle;
    const u = await trazi(`${o.url}/?b=${h}`);
    assert.equal(meta(u.html, 'og:title'), 'Komodo — video oglasi butika iz Banje Luke');
  });

  test('?b=<handle>: naslov, opis s brojem oglasa, og:url', async () => {
    const r = await trazi(`${o.url}/?b=${encodeURIComponent(butik.handle.toUpperCase())}`);
    assert.equal(meta(r.html, 'og:title'), 'Butik Bojana &amp; Ko na Komodu');
    assert.match(meta(r.html, 'og:description'), /^\d+ oglas(a)? · Banja Luka\. Pogledaj snimke proizvoda\.$/);
    assert.equal(meta(r.html, 'og:url'), `${APP}/?b=${butik.handle}`);
    assert.equal(meta(r.html, 'og:image'), `${APP}/og-komodo.png`);
  });

  test('keš HTML-a: izmjena naslova u bazi se ne vidi unutar 60 s', async () => {
    const a = (await shop.objavi({ title: 'Prvi naslov', price: '10' })).body.oglas;
    assert.match(meta((await trazi(`${o.url}/?o=${a.id}`)).html, 'og:title'), /^Prvi naslov/);
    await o.baza.q("update listings set title = 'Drugi naslov' where id = $1", [a.id]);
    assert.match(meta((await trazi(`${o.url}/?o=${a.id}`)).html, 'og:title'), /^Prvi naslov/);
  });

  test('/og/: samo cijeli broj, nema SSRF; lokalni oglas dobija zajedničku sliku; nepostojeći 404', async () => {
    for (const p of ['abc.jpg', '1.png', '1', '..%2F..%2Fetc%2Fpasswd', 'http%3A%2F%2Fevil.test%2Fx.jpg', '1.jpg%00', '12345678901.jpg', '-1.jpg', '1e3.jpg']) {
      const r = await fetch(`${o.url}/og/${p}`);
      assert.equal(r.status, 404, p);
    }
    assert.equal((await fetch(`${o.url}/og/999999.jpg`)).status, 404);
    const r = await fetch(`${o.url}/og/${l1.id}.jpg`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const slika = Buffer.from(await r.arrayBuffer());
    assert.deepEqual(slika, await readFile(path.join(ROOT, 'web', 'og-komodo.png')));
    assert.equal((await fetch(`${o.url}/og-komodo.png`)).status, 200);
  });
});

describe('sličica s Bunnyja (lažni CDN koji traži Referer)', () => {
  let o; let cdn; let shop; let butik;
  const ids = {};
  before(async () => {
    cdn = await lazniCdn();
    o = await okolina({
      APP_URL: APP, BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k', BUNNY_CDN_HOST: 'cdn.test',
      BUNNY_API_BASE: 'http://127.0.0.1:1', OG_THUMB_BASE: cdn.url,
    });
    butik = await noviButik(o.baza, { butik: 'Bunny Butik', email: 'og.bunny@test.ba', grad: 'Prijedor' });
    shop = o.klijent();
    await shop.prijavi(butik.email, butik.password);
    const napravi = async (kljuc, naslov, guid, status = 'ready') => {
      const l = (await shop.objavi({ title: naslov, price: '30' })).body.oglas;
      await o.baza.q("update listings set video_provider = 'bunny', video_status = $2, bunny_guid = $3, video_res = '720p' where id = $1", [l.id, status, guid]);
      ids[kljuc] = l.id;
    };
    await napravi('a', 'Gotov oglas', 'guid-a');
    await napravi('obrada', 'U obradi', 'guid-o', 'processing');
    await napravi('html', 'Lažna slika', 'guid-html');
    await napravi('veliko', 'Prevelika slika', 'guid-veliko');
    await napravi('nema', 'Bez sličice', 'guid-nema');
    await napravi('spor', 'Spor Bunny', 'guid-spor');
    await napravi('b', 'Zadnji gotov', 'guid-b');
  });
  after(async () => { await o?.stop(); await cdn?.close(); });

  test('og:image oglasa je naša adresa /og/<id>.jpg, nikad Bunny', async () => {
    const r = await trazi(`${o.url}/?o=${ids.a}`);
    assert.equal(meta(r.html, 'og:image'), `${APP}/og/${ids.a}.jpg`);
    assert.ok(!r.html.includes('cdn.test') && !r.html.includes('b-cdn'));
    assert.equal(meta(r.html, 'twitter:image'), `${APP}/og/${ids.a}.jpg`);
  });

  test('oglas u obradi: opšti pregled (kupac ga ne vidi, bez curenja naslova)', async () => {
    const r = await trazi(`${o.url}/?o=${ids.obrada}`);
    assert.equal(meta(r.html, 'og:title'), 'Komodo — video oglasi butika iz Banje Luke');
    assert.ok(!r.html.includes('U obradi'));
    assert.equal((await fetch(`${o.url}/og/${ids.obrada}.jpg`)).status, 404);
  });

  test('butik: og:image je sličica zadnjeg gotovog oglasa', async () => {
    const r = await trazi(`${o.url}/?b=${butik.handle}`);
    assert.equal(meta(r.html, 'og:image'), `${APP}/og/${ids.b}.jpg`);
    assert.match(meta(r.html, 'og:description'), /^6 oglasa · Prijedor\./);
  });

  test('/og/<id>.jpg: preuzima s Refererom, JPEG, ETag, 304, keš na disku (drugi zahtjev ne ide na Bunny)', async () => {
    const prije = cdn.st.zahtjeva;
    const r = await fetch(`${o.url}/og/${ids.a}.jpg`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('cache-control'), /public, max-age=3600/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPEG);
    assert.equal(cdn.st.zahtjeva, prije + 1);
    assert.equal(cdn.st.bezReferera, 0);
    const etag = r.headers.get('etag');
    assert.ok(etag);
    const r2 = await fetch(`${o.url}/og/${ids.a}.jpg`);
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('etag'), etag);
    const r3 = await fetch(`${o.url}/og/${ids.a}.jpg`, { headers: { 'if-none-match': etag } });
    assert.equal(r3.status, 304);
    assert.equal(cdn.st.zahtjeva, prije + 1, 'keš: nema novog zahtjeva prema Bunnyju');
    const fajl = await readFile(path.join(o.api.uploads, 'og', `${ids.a}.jpg`));
    assert.deepEqual(fajl, JPEG);
  });

  test('istovremeni zahtjevi za isti id: jedno preuzimanje', async () => {
    cdn.st.kasni = 300;
    const prije = cdn.st.zahtjeva;
    const rs = await Promise.all(Array.from({ length: 10 }, () => fetch(`${o.url}/og/${ids.b}.jpg`)));
    cdn.st.kasni = 0;
    for (const r of rs) { assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg'); await r.arrayBuffer(); }
    assert.equal(cdn.st.zahtjeva, prije + 1);
  });

  test('ne-JPEG, prevelika sličica, 404 i spor Bunny → zajednička slika, ništa na disku', async () => {
    cdn.st.odgovor = 'html';
    let r = await fetch(`${o.url}/og/${ids.html}.jpg`);
    assert.equal(r.headers.get('content-type'), 'image/png');
    cdn.st.odgovor = 'veliko';
    r = await fetch(`${o.url}/og/${ids.veliko}.jpg`);
    assert.equal(r.headers.get('content-type'), 'image/png');
    cdn.st.odgovor = 'jpeg';
    r = await fetch(`${o.url}/og/${ids.nema}.jpg`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    for (const k of ['html', 'veliko', 'nema']) {
      await assert.rejects(readFile(path.join(o.api.uploads, 'og', `${ids[k]}.jpg`)));
    }
    // poslije neuspjeha Bunny se 30 s ne pita ponovo
    const prije = cdn.st.zahtjeva;
    await fetch(`${o.url}/og/${ids.html}.jpg`);
    assert.equal(cdn.st.zahtjeva, prije);
  });

  test('timeout 5 s: spor Bunny ne drži zahtjev duže od ~5 s', async () => {
    cdn.st.kasni = 8000;
    const t = Date.now();
    const r = await fetch(`${o.url}/og/${ids.spor}.jpg`);
    cdn.st.kasni = 0;
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.ok(Date.now() - t < 7000, `trajalo ${Date.now() - t} ms`);
  });

  test('obrisan oglas: sličica 404 i Bunny se ne pita', async () => {
    const l = (await shop.objavi({ title: 'Za brisanje', price: '5' })).body.oglas;
    await o.baza.q("update listings set video_provider = 'bunny', video_status = 'ready', bunny_guid = 'guid-del' where id = $1", [l.id]);
    assert.equal((await shop.del(`/api/listings/${l.id}`)).status, 200);
    const prije = cdn.st.zahtjeva;
    assert.equal((await fetch(`${o.url}/og/${l.id}.jpg`)).status, 404);
    assert.equal(cdn.st.zahtjeva, prije);
  });
});
