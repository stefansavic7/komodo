// Priprema za e2e: svježa baza, API (jedan proces) i butik otvoren skriptom novi-butik.js.
// Podaci idu testovima preko process.env (Playwright ih prenosi radnicima).
import { noviButik, novaBaza, pokreniApi } from '../../api/test/pomoc/okolina.mjs';

export default async function priprema() {
  const baza = await novaBaza('komodo_test_e2e');
  let api;
  try {
    api = await pokreniApi(baza, { ADMIN_EMAILS: 'admin@e2e.ba', ADMIN_STATS_CACHE_MS: '0', STATS_CACHE_MS: '0' });
    const butik = await noviButik(baza, { butik: 'Moda Bojana', email: 'bojana@e2e.ba', telefon: '065 123 456' });
    process.env.E2E_URL = api.url;
    process.env.E2E_BUTIK_EMAIL = butik.email;
    process.env.E2E_BUTIK_LOZINKA = butik.password;
    process.env.E2E_BUTIK_HANDLE = butik.handle;
    process.env.E2E_DATABASE_URL = baza.url;
  } catch (err) {
    await api?.stop();
    await baza.drop();
    throw err;
  }
  // Vraćena funkcija je globalTeardown.
  return async () => {
    await api.stop();
    await baza.drop();
  };
}
