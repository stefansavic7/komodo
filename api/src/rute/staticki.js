// index.html s oznakom verzije. Ostale fajlove iz web/ služi @fastify/static (src/app.js), a nepoznate
// putanje van /api/ i /media/ dobijaju index.html (setNotFoundHandler u src/server.js).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from '../app.js';

// Oznaka verzije (otisak sadržaja svih web/js/*.js i web/style.css) ide kao ?v= na svaki lokalni
// <script src="/..."> i stylesheet u index.html, pa keš u Nginxu i pregledniku nikad ne služi stari JS
// uz novi index.html. Računa se jednom pri startu.
const JS_DIR = path.join(WEB_DIR, 'js');
const jsFiles = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
const hash = createHash('sha1');
for (const f of jsFiles) hash.update(f).update(readFileSync(path.join(JS_DIR, f)));
hash.update(readFileSync(path.join(WEB_DIR, 'style.css')));
export const verzija = hash.digest('hex').slice(0, 10);

// Lokalno = putanja počinje jednom kosom crtom (ne "//" i ne "https://"); postojeći ?query se ne dira.
const LOCAL = (attr) => new RegExp(`(\\b${attr}=")(\\/(?!\\/)[^"?#]+)(")`);
const INDEX_HTML = readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*>/g, (tag) => tag.replace(LOCAL('src'), `$1$2?v=${verzija}$3`))
  .replace(/<link\b[^>]*>/g, (tag) => (/\brel="stylesheet"/.test(tag) ? tag.replace(LOCAL('href'), `$1$2?v=${verzija}$3`) : tag));

export function sendIndex(reply) {
  return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(INDEX_HTML);
}

export default function rute(app) {
  app.get('/', (req, reply) => sendIndex(reply));
  app.get('/index.html', (req, reply) => sendIndex(reply));
}
