// index.html s oznakom verzije. Ostale fajlove iz web/ služi @fastify/static (src/app.js), a nepoznate
// putanje van /api/ i /media/ dobijaju index.html (setNotFoundHandler u src/server.js).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from '../app.js';
import og, { ogIndex } from './og.js';

// Oznaka verzije (otisak sadržaja svih web/js/*.js i web/*.css) ide kao ?v= na svaki lokalni
// <script src="/..."> i stylesheet u index.html, pa keš u Nginxu i pregledniku nikad ne služi stari JS
// uz novi index.html. Računa se jednom pri startu.
const JS_DIR = path.join(WEB_DIR, 'js');
const jsFiles = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
const hash = createHash('sha1');
for (const f of jsFiles) hash.update(f).update(readFileSync(path.join(JS_DIR, f)));
// Stilovi: style.css i ostali .css u web/ (npr. butik.css), po abecedi, s imenom fajla.
for (const f of readdirSync(WEB_DIR).filter((n) => n.endsWith('.css')).sort()) {
  hash.update(f).update(readFileSync(path.join(WEB_DIR, f)));
}
export const verzija = hash.digest('hex').slice(0, 10);

// Lokalno = putanja počinje jednom kosom crtom (ne "//" i ne "https://"); postojeći ?query se ne dira.
const LOCAL = (attr) => new RegExp(`(\\b${attr}=")(\\/(?!\\/)[^"?#]+)(")`);
const INDEX_HTML = readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*>/g, (tag) => tag.replace(LOCAL('src'), `$1$2?v=${verzija}$3`))
  .replace(/<link\b[^>]*>/g, (tag) => (/\brel="stylesheet"/.test(tag) ? tag.replace(LOCAL('href'), `$1$2?v=${verzija}$3`) : tag));

export function sendIndex(reply, html = INDEX_HTML) {
  return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(html);
}

// / i /index.html: index s Open Graph oznakama za ?o= i ?b= (rute/og.js, docs/SPEC-V1.md F-02). Ostale
// putanje (setNotFoundHandler) dobijaju index bez oznaka. Nginx ne smije keširati / bez upita u ključu.
async function indexSOg(req, reply) {
  return sendIndex(reply, await ogIndex(INDEX_HTML, req.query));
}

// R-07: Cache-Control za fajlove iz web/ (@fastify/static je u app.js bez vlastitog zaglavlja, cacheControl: false).
// - /js/*.js i *.css s ?v=<oznaka>: adresa se mijenja kad se sadržaj promijeni → godinu dana, immutable.
// - fontovi (/fonts/*.woff2): imena nose težinu i podskup, sadržaj se ne mijenja → 30 dana.
// - sve ostalo iz web/ (i JS/CSS bez ?v=): provjera pri svakom otvaranju (max-age=0, ETag).
// Zaglavlje koje je već postavljeno (npr. /media/ s 7 dana) se ne dira; API, /media/ i /og/ se ne diraju.
export function cacheControlZa(url, status) {
  if (status !== 200) return null;
  const q = url.indexOf('?');
  const putanja = q < 0 ? url : url.slice(0, q);
  const upit = q < 0 ? '' : url.slice(q + 1);
  if (/^\/(api|media|og)\//.test(putanja) || putanja === '/') return null;
  if (/^\/fonts\/[^/]+\.woff2$/.test(putanja)) return 'public, max-age=2592000';
  if (/^\/(js\/[^/]+\.js|[^/]+\.css)$/.test(putanja) && /(^|&)v=[^&]+/.test(upit)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=0';
}

export default function rute(app) {
  app.addHook('onSend', (req, reply, payload, done) => {
    if (req.method === 'GET' && !reply.hasHeader('cache-control')) {
      const cc = cacheControlZa(req.raw.url, reply.statusCode);
      if (cc) reply.header('Cache-Control', cc);
    }
    done(null, payload);
  });
  app.get('/', indexSOg);
  app.get('/index.html', indexSOg);
  og(app); // /og/<id>.jpg
}
