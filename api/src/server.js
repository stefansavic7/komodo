// Ulazna tačka jednog API procesa: spaja zajednički kontekst (src/app.js), rute (src/rute/*.js) i
// pozadinske poslove (src/poslovi.js), pa sluša na PORT. `npm run dev` pokreće ovaj fajl direktno, a
// src/index.js ga pokreće u više procesa (cluster). Struktura: docs/ARHITEKTURA.md.
import { bazaNeOdgovara, migrate, zatvoriBazu } from './db.js';
import { CATEGORIES, HOST, MAX_VIDEO_MB, PORT, app, bad, preopterecen } from './app.js';
import { pokreniPoslove } from './poslovi.js';
import staticki, { sendIndex } from './rute/staticki.js';
import opste from './rute/opste.js';
import auth from './rute/auth.js';
import profil from './rute/profil.js';
import push from './rute/push.js';
import butici from './rute/butici.js';
import oglasi from './rute/oglasi.js';
import svidjanjaPregledi from './rute/svidjanja-pregledi.js';
import poruke from './rute/poruke.js';
import prijaveAdmin from './rute/prijave-admin.js';
import rezimRute from './rute/rezim.js';

export { CATEGORIES };

/* ---------- rute ---------- */

// Svaka datoteka u src/rute/ izvozi funkciju (app) => void koja registruje svoje rute na zajedničkoj
// instanci (bez app.register, pa nema zasebnog opsega: isti hookovi, isti rukovalac greškama).
for (const registruj of [staticki, opste, auth, profil, push, butici, oglasi, svidjanjaPregledi, poruke, prijaveAdmin, rezimRute]) {
  registruj(app);
}

/* ---------- greške ---------- */

app.setErrorHandler((err, req, reply) => {
  if (err.code === 'FST_REQ_FILE_TOO_LARGE') return bad(reply, 413, `Video je prevelik. Najviše ${MAX_VIDEO_MB} MB.`);
  if (err.statusCode && err.statusCode < 500) return bad(reply, err.statusCode, 'Zahtjev nije ispravan.');
  // Talas 4: istekao rok upita, baza ne prima veze ili je bazen pun → 503 s Retry-After, nikad 500.
  if (bazaNeOdgovara(err)) {
    req.log.warn({ code: err.code, msg: err.message, url: req.url }, 'Baza ne odgovara na vrijeme (503)');
    return preopterecen(reply);
  }
  req.log.error(err);
  return bad(reply, 500, 'Greška na serveru. Pokušaj ponovo.');
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) return bad(reply, 404, 'Ne postoji.');
  return sendIndex(reply);
});

/* ---------- start ---------- */

// S više procesa (src/index.js) migracije pokreće primarni proces (KOMODO_MIGRATE=0 u radnicima),
// a pozadinske poslove samo jedan radnik (KOMODO_JOBS=1). `npm run dev` pokreće sve u jednom procesu.
const JOBS = process.env.KOMODO_JOBS !== '0';
if (process.env.KOMODO_MIGRATE !== '0') await migrate(app.log);
await app.listen({ port: PORT, host: HOST });

const timers = JOBS ? pokreniPoslove() : [];

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    for (const t of timers) clearInterval(t);
    await app.close();
    await zatvoriBazu();
    process.exit(0);
  });
}
