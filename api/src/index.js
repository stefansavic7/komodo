// Pokretanje u više procesa (node:cluster): primarni proces jednom pokrene migracije, pa pokrene
// WORKERS radnika (zadano: broj jezgara) koji svi slušaju isti port. Pozadinske poslove (Bunny,
// email butiku, čišćenje, base_score) radi samo prvi radnik. `npm run dev` i dalje pokreće src/server.js
// direktno. Primarni proces prosljeđuje poruke o poništavanju keša između radnika.
import cluster from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Niti za scrypt (prijava, registracija) i fajlove; mora biti postavljeno prije pokretanja radnika.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '4';

const WORKERS = Math.max(1, Number(process.env.WORKERS) || os.availableParallelism());
const log = (text) => console.log(JSON.stringify({ level: 30, time: Date.now(), pid: process.pid, msg: text }));
const logError = (text) => console.error(JSON.stringify({ level: 50, time: Date.now(), pid: process.pid, msg: text }));

// Produkcija bez SMTP_URL ili COOKIE_SECRET: jasna greška odmah, a ne radnici koji padaju u krug.
{
  const { provjeriOkolinu } = await import('./provjera.js');
  try {
    provjeriOkolinu(() => {});
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

// Migracije jednom, prije radnika.
{
  const { migrate, pool } = await import('./db.js');
  try {
    await migrate({ info: log });
  } finally {
    await pool.end();
  }
}

cluster.setupPrimary({ exec: path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js') });

let stopping = false;
const roles = new Map(); // id radnika → '1' (radi poslove) ili '0'
function start(jobs) {
  if (stopping) return;
  const worker = cluster.fork({
    KOMODO_JOBS: jobs,
    KOMODO_MIGRATE: '0',
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE,
  });
  roles.set(worker.id, jobs);
}

// Poruke između radnika (R-01): radnik koji poništi keš (sesija, korisnik, feed) javlja to primarnom
// procesu, a ovaj ga prosljeđuje svim ostalim radnicima (src/app.js, javiSvima/naPoruku).
cluster.on('message', (from, m) => {
  if (!m || typeof m !== 'object' || !m.komodo) return;
  for (const w of Object.values(cluster.workers)) {
    if (w && w !== from && w.isConnected()) {
      try { w.send(m); } catch { /* radnik se upravo gasi */ }
    }
  }
});

for (let k = 0; k < WORKERS; k += 1) start(k === 0 ? '1' : '0');
log(`Pokrenuto ${WORKERS} radnika (UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}).`);

// Ako radnik padne, pokreće se novi s istom ulogom. Zaštita od beskonačne petlje: ako padne više od
// 10 radnika u minuti (npr. baza nije dostupna ili je greška u kodu), primarni proces staje.
const crashes = [];
cluster.on('exit', (worker, code, signal) => {
  const jobs = roles.get(worker.id) || '0';
  roles.delete(worker.id);
  if (stopping) {
    if (roles.size === 0) process.exit(process.exitCode ?? 0);
    return;
  }
  const now = Date.now();
  crashes.push(now);
  while (crashes.length && now - crashes[0] > 60 * 1000) crashes.shift();
  if (crashes.length > 10) {
    logError('Radnici padaju više od 10 puta u minuti. Zaustavljam sve; provjeri greške iznad.');
    stopping = true;
    for (const w of Object.values(cluster.workers)) w.process.kill('SIGTERM');
    setTimeout(() => process.exit(1), 10 * 1000).unref();
    if (roles.size === 0) process.exit(1);
    process.exitCode = 1;
    return;
  }
  logError(`Radnik ${worker.process.pid} je stao (kod ${code}, signal ${signal}). Pokrećem novog.`);
  setTimeout(() => start(jobs), 1000);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log('Zaustavljam radnike…');
    for (const w of Object.values(cluster.workers)) w.process.kill('SIGTERM');
    if (roles.size === 0) process.exit(0);
    setTimeout(() => process.exit(0), 15 * 1000).unref();
  });
}
