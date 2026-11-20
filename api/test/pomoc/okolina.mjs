// Zajednička okolina za testove: svježa baza, API kao poseban proces, HTTP klijent s kolačićima.
//
// Testovi su „crna kutija”: govore s API-jem samo preko HTTP-a (i, gdje treba provjeriti stanje baze,
// čitaju bazu). Zato rade i kad se kod API-ja preuredi u module.
//
// Podešavanje (sve po želji):
//   TEST_DATABASE_URL  veza na Postgres s pravom pravljenja baza
//                      (zadano postgres://postgres@127.0.0.1:55432/postgres)
//   KOMODO_ROOT        korijen repozitorija s API-jem (zadano: ovaj repozitorij)
//   KOMODO_API_ENTRY   ulazni fajl API-ja, relativno na KOMODO_ROOT (zadano api/src/server.js)
//   KOMODO_TEST_PORTS  raspon portova, npr. 3952-3959 (zadano: slobodan port koji izabere sistem)
//   KOMODO_TEST_LOG=1  ispisuje zapis API-ja na stderr
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(process.env.KOMODO_ROOT || path.join(HERE, '..', '..', '..'));
export const API_ENTRY = process.env.KOMODO_API_ENTRY || path.join('api', 'src', 'server.js');
export const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
export const VIDEO = path.join(HERE, 'mali.mp4');
export const LOZINKA = 'lozinka123';

let dbCounter = 0;

function dbUrl(name) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

// Pravi praznu bazu i vraća { name, url, pool, drop() }. Migracije pokreće API pri startu.
export async function novaBaza(prefix = 'komodo_test') {
  dbCounter += 1;
  const name = `${prefix}_${process.pid}_${dbCounter}_${randomBytes(2).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    // Postgres odbija `create database` dok je neko drugi spojen na template1 (55006); to je kratko stanje.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await admin.query(`create database ${name}`);
        break;
      } catch (err) {
        if (err.code !== '55006' || attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  } finally {
    await admin.end();
  }
  const url = dbUrl(name);
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  // Uzrok nestabilnosti: pg-pool `end()` se završi čim pozove `client.end()` na vezama u mirovanju, tj. prije
  // nego što se utičnica stvarno zatvori. `drop database … with (force)` odmah poslije toga prekine te veze
  // („terminating connection due to administrator command”), pool emituje 'error', a bez rukovaoca Node to
  // smatra neobrađenom greškom i obara cijeli test proces. Zato rukovalac postoji i greška se ignoriše.
  pool.on('error', () => {});
  return {
    name,
    url,
    pool,
    q: (text, params) => pool.query(text, params),
    async drop() {
      await pool.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 50)); // da se veze iz poola stvarno zatvore prije prisilnog brisanja
      const c = new pg.Client({ connectionString: ADMIN_URL });
      c.on('error', () => {});
      await c.connect();
      try {
        await c.query(`drop database if exists ${name} with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

function portRange() {
  const m = /^(\d+)-(\d+)$/.exec(process.env.KOMODO_TEST_PORTS || '');
  if (!m) return [0];
  const out = [];
  for (let p = Number(m[1]); p <= Number(m[2]); p += 1) out.push(p);
  // Nasumičan početak, da se paralelni test fajlovi ne otimaju o isti port.
  const k = Math.floor(Math.random() * out.length);
  return [...out.slice(k), ...out.slice(0, k)];
}

// Pokreće API (jedan proces) nad datom bazom. Vraća { url, port, log(), stop(), uploads }.
// `env` dopunjuje ili gazi zadane varijable (npr. SMTP_URL, KOMODO_JOBS).
export async function pokreniApi(baza, env = {}) {
  const uploads = await mkdtemp(path.join(os.tmpdir(), 'komodo-uploads-'));
  // Zauzet port (drugi test fajl ili tuđi proces): sljedeći iz raspona; kad raspon ne uspije
  // tri puta zaredom, port bira sistem (0).
  const ports = portRange();
  let lastErr;
  for (let attempt = 0; attempt <= ports.length * 3; attempt += 1) {
    const port = attempt < ports.length * 3 ? ports[attempt % ports.length] : 0;
    try {
      const api = await startOnce(baza, env, port, uploads);
      return api;
    } catch (err) {
      lastErr = err;
      if (!err.portBusy) break;
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    }
  }
  await rm(uploads, { recursive: true, force: true });
  throw lastErr;
}

function startOnce(baza, env, port, uploads) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [API_ENTRY], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SYSTEMROOT: process.env.SYSTEMROOT,
        DATABASE_URL: baza.url,
        PORT: String(port),
        HOST: '127.0.0.1',
        UPLOADS_DIR: uploads,
        NODE_ENV: 'development',
        ADMIN_EMAILS: 'admin@test.ba',
        KOMODO_JOBS: '0',
        SMTP_URL: '',
        BUNNY_LIBRARY_ID: '',
        BUNNY_API_KEY: '',
        BUNNY_CDN_HOST: '',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = [];
    let settled = false;
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        lines.push(line);
        if (process.env.KOMODO_TEST_LOG === '1') process.stderr.write(`[api ${child.pid}] ${line}\n`);
        if (!settled) {
          const m = /Server listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(line);
          if (m) {
            settled = true;
            clearTimeout(timer);
            const realPort = Number(m[1]);
            resolve(api(child, realPort, lines, uploads));
          }
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`API se nije pokrenuo za 30 s. Zapis:\n${lines.slice(-30).join('\n')}`));
    }, 30000);
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = lines.join('\n');
      const err = new Error(`API je stao (kod ${code}) prije pokretanja. Zapis:\n${lines.slice(-30).join('\n')}`);
      err.portBusy = /EADDRINUSE/.test(text);
      reject(err);
    });
  });
}

function api(child, port, lines, uploads) {
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    port,
    uploads,
    pid: child.pid,
    log: () => lines.join('\n'),
    // Čeka da se u zapisu API-ja pojavi red koji odgovara izrazu (npr. email koji nije poslan).
    async cekajLog(re, ms = 5000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = lines.find((l) => re.test(l));
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`U zapisu API-ja nema ${re}`);
    },
    async stop() {
      if (child.exitCode === null) {
        const gone = new Promise((r) => child.once('exit', r));
        child.kill('SIGTERM');
        const t = setTimeout(() => child.kill('SIGKILL'), 5000);
        await gone;
        clearTimeout(t);
      }
      await rm(uploads, { recursive: true, force: true });
    },
  };
}

// Svježa baza + API. Vraća { baza, api, url, klijent(), stop() }.
export async function okolina(env = {}) {
  const baza = await novaBaza();
  let a;
  try {
    a = await pokreniApi(baza, env);
  } catch (err) {
    await baza.drop().catch(() => {});
    throw err;
  }
  const res = await fetch(`${a.url}/api/health`);
  if (res.status !== 200) throw new Error(`/api/health vraća ${res.status}`);
  return {
    baza,
    api: a,
    url: a.url,
    klijent: () => new Klijent(a.url),
    async stop() {
      await a.stop().catch(() => {});
      await baza.drop().catch(() => {});
    },
  };
}

// Otvara butik skriptom api/src/novi-butik.js (isti put kao u README-u) i vraća { email, password, handle }.
export function noviButik(baza, { butik, email, telefon, grad } = {}) {
  const args = [path.join('api', 'src', 'novi-butik.js'), '--butik', butik, '--email', email];
  if (telefon) args.push('--telefon', telefon);
  if (grad) args.push('--grad', grad);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: baza.url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => {
      const pass = /Privremena lozinka:\s+(\S+)/.exec(out);
      const handle = /Profil:\s+\/\?b=(\S+)/.exec(out);
      if (code !== 0 || !pass) return reject(new Error(`novi-butik.js nije uspio (kod ${code}):\n${out}`));
      resolve({ email: email.toLowerCase(), password: pass[1], handle: handle ? handle[1] : null, izlaz: out });
    });
  });
}

// HTTP klijent s vlastitim kolačićima (jedan „preglednik”).
export class Klijent {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  primiKolacice(res) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => {
        const [k, v] = a.trim().split('=');
        if (/^max-age$/i.test(k)) return Number(v) <= 0;
        if (/^expires$/i.test(k)) return new Date(v).getTime() < Date.now();
        return false;
      });
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async zahtjev(method, url, { json, body, headers = {}, redirect = 'manual' } = {}) {
    const h = { ...headers };
    const c = this.cookieHeader();
    if (c) h.cookie = c;
    let payload = body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect });
    this.primiKolacice(res);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  }

  get(url, opts) { return this.zahtjev('GET', url, opts); }
  post(url, json, opts = {}) { return this.zahtjev('POST', url, { ...opts, json }); }
  patch(url, json, opts = {}) { return this.zahtjev('PATCH', url, { ...opts, json }); }
  del(url, opts) { return this.zahtjev('DELETE', url, opts); }

  async registruj(email, name = 'Kupac Test', password = LOZINKA) {
    const r = await this.post('/api/auth/register', { email, password, name });
    if (r.status !== 201) throw new Error(`Registracija ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.korisnik;
  }

  async prijavi(email, password = LOZINKA) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`Prijava ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.korisnik;
  }

  // Objava oglasa (multipart). `polja` gazi zadana polja; `video: null` šalje oglas bez videa.
  async objavi(polja = {}, { video = VIDEO, mime = 'video/mp4' } = {}) {
    const fd = new FormData();
    const p = { title: 'Crna haljina', price: '65', category: 'Haljine', ...polja };
    for (const [k, v] of Object.entries(p)) if (v !== undefined) fd.append(k, String(v));
    if (video) fd.append('video', new Blob([await readFile(video)], { type: mime }), 'snimak.mp4');
    return this.zahtjev('POST', '/api/listings', { body: fd });
  }
}

// Zatvori vezu na portu (pomoć za provjeru je li port slobodan).
export function portSlobodan(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
