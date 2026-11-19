// Opšte rute: provjera zdravlja i spisak kategorija.
import { q } from '../db.js';
import { CATEGORIES } from '../app.js';
import { verzija } from './staticki.js';

const HEALTH_TIMEOUT_MS = 1000;

// Baza odgovara na `select 1` u roku od 1 s → 200 {ok, baza, verzija}; inače 503. Koriste je Docker
// HEALTHCHECK (wget, gleda samo status) i nadzor. `verzija` je oznaka web fajlova (?v= u index.html).
async function bazaRadi() {
  let timer;
  const isteklo = new Promise((resolve) => { timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS); });
  try {
    return await Promise.race([q('select 1').then(() => true, () => false), isteklo]);
  } finally {
    clearTimeout(timer);
  }
}

export default function rute(app) {
  app.get('/api/health', async (req, reply) => {
    if (await bazaRadi()) return { ok: true, baza: true, verzija };
    return reply.code(503).send({ ok: false, baza: false });
  });

  app.get('/api/categories', async () => ({ kategorije: CATEGORIES }));
}
