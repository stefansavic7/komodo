// Talas 4 „otpornost” u pregledniku: Idempotency-Key pri slanju poruke (isti ključ pri ponovnom pokušaju),
// eksponencijalno čekanje tajmera poslije 503 uz Retry-After i povratak na normalno, režim sa servera
// (X-Komodo-Rezim → /api/config, hitni režim ne šalje preglede) i prekidač u administraciji.
import { LOZINKA, butik, expect, otvoriProfil, registrujApi, test } from './pomoc.mjs';

let oglas;
// Oglas butika upisan direktno u bazu: prijava butika je ograničena po nalogu (cijeli e2e je već troši).
test.beforeAll(async () => {
  const { default: pg } = await import('../../api/node_modules/pg/lib/index.js');
  const c = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await c.connect();
  try {
    const r = await c.query(
      `insert into listings(user_id, title, price_cents, category, video_path, video_status, sizes)
       select id, 'Otporna jakna', 12000, 'Jakne i kaputi', 'nema.mp4', 'ready', array['M'] from users where email = $1
       returning id`,
      [butik().email],
    );
    oglas = { id: r.rows[0].id };
  } finally {
    await c.end();
  }
});

async function admin(request) {
  const r = await request.post('/api/auth/login', { data: { email: 'admin@e2e.ba', password: LOZINKA } });
  if (r.status() !== 200) await registrujApi(request, 'admin@e2e.ba', 'Administrator');
}

test('poruka: Idempotency-Key se šalje, a ponovni pokušaj istog teksta nosi isti ključ', async ({ page, context }) => {
  await registrujApi(context.request, 'otporni.kupac@e2e.ba', 'Otporni Kupac');
  const r = await context.request.post('/api/conversations', { data: { shop: butik().handle, listingId: oglas.id } });
  const razgovor = (await r.json()).razgovor;
  const kljucevi = [];
  let prvi = true;
  await page.route(`**/api/conversations/${razgovor}/messages`, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    kljucevi.push(req.headers()['idempotency-key']);
    if (prvi) { prvi = false; return route.abort('connectionreset'); } // „pukla veza”
    return route.continue();
  });
  await page.goto(`/?poruke=${razgovor}`);
  await expect(page.locator('#chat')).toBeVisible();
  await page.locator('#chatInput').fill('Ima li u M?');
  await page.locator('#chatForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('Nema veze sa serverom');
  await expect(page.locator('#chatInput')).toHaveValue('Ima li u M?');
  await page.locator('#chatForm button[type="submit"]').click();
  await expect(page.locator('#chatLog .msg.mine')).toHaveCount(1);
  expect(kljucevi.length).toBe(2);
  expect(kljucevi[0]).toMatch(/^[0-9a-f]{32}$/);
  expect(kljucevi[1]).toBe(kljucevi[0]);
  // Nova poruka → novi ključ.
  await page.locator('#chatInput').fill('Hvala');
  await page.locator('#chatForm button[type="submit"]').click();
  await expect(page.locator('#chatLog .msg.mine')).toHaveCount(2);
  expect(kljucevi[2]).not.toBe(kljucevi[0]);
});

test('tajmer poslije 503 s Retry-After čeka duže (eksponencijalno), a poslije oporavka se vraća na normalno', async ({ page, context }) => {
  test.setTimeout(90 * 1000);
  await registrujApi(context.request, 'tajmer.kupac@e2e.ba', 'Tajmer Kupac');
  // Kratki intervali sa „servera”, da se ponašanje vidi u sekundama.
  await page.route('**/api/config*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'X-Komodo-Rezim': 'normalno' },
    body: JSON.stringify({ rezim: 'normalno', intervali: { likes: 600000, me: 400, profil: 600000, chat: 600000, views: 600000, config: 600000 }, licniFeed: true, pregledi: true }),
  }));
  let pao = false;
  const pozivi = [];
  await page.route('**/api/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    pozivi.push({ t: Date.now(), pao });
    if (pao) return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '2' }, body: '{"greska":"Server je trenutno preopterećen. Pokušaj ponovo za trenutak."}' });
    return route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#feed .card').first()).toBeVisible();
  // Konfiguracija primijenjena, tajmer značke radi ~svakih 400 ms.
  await page.waitForFunction(() => window.KONFIG && window.KONFIG.intervali.me === 400);
  await page.evaluate(() => { unreadTimer = staniTajmer(unreadTimer); unreadTimer = tajmer('me', tickUnread, 0); });
  await page.waitForTimeout(3000);
  const normalno = pozivi.filter((p) => !p.pao && p.t > Date.now() - 3000).length;
  expect(normalno).toBeGreaterThanOrEqual(5);

  pao = true;
  const t0 = Date.now();
  await page.waitForTimeout(9000);
  const zaPada = pozivi.filter((p) => p.pao && p.t >= t0);
  // Bez čekanja bi bilo ~22 poziva; Retry-After 2 s i udvostručavanje: najviše ~5.
  expect(zaPada.length).toBeGreaterThanOrEqual(1);
  expect(zaPada.length).toBeLessThanOrEqual(5);
  for (let k = 1; k < zaPada.length; k += 1) expect(zaPada[k].t - zaPada[k - 1].t).toBeGreaterThanOrEqual(1900);

  pao = false;
  // Prvi uspjeh vraća na normalno (najkasnije poslije trenutno zakazanog čekanja, ≤ ~13 s).
  await expect.poll(() => pozivi.filter((p) => !p.pao && p.t > t0).length, { timeout: 30000 }).toBeGreaterThanOrEqual(1);
  const oporavak = pozivi.filter((p) => !p.pao && p.t > t0)[0].t;
  await page.waitForTimeout(3000);
  expect(pozivi.filter((p) => !p.pao && p.t > oporavak).length).toBeGreaterThanOrEqual(5);
  // Razmaci imaju nasumičan pomak (nisu svi isti).
  const posl = pozivi.filter((p) => !p.pao && p.t > oporavak).map((p) => p.t);
  const razmaci = posl.slice(1).map((t, k) => t - posl[k]);
  expect(new Set(razmaci.map((r) => Math.round(r / 20))).size).toBeGreaterThan(1);
});

test('hitni režim sa servera: zaglavlje X-Komodo-Rezim učita novu konfiguraciju, pregledi se ne šalju; admin prekidač', async ({ browser }) => {
  test.setTimeout(90 * 1000);
  const actx = await browser.newContext({ baseURL: process.env.E2E_URL });
  await admin(actx.request);
  const ctx = await browser.newContext({ baseURL: process.env.E2E_URL });
  const page = await ctx.newPage();
  const pregledi = [];
  const konfig = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/views')) pregledi.push(r.url());
    if (r.url().includes('/api/config')) konfig.push(r.url());
  });
  try {
    await page.goto(`/?o=${oglas.id}`);
    await expect(page.locator(`.card[data-id="${oglas.id}"]`)).toBeVisible();
    expect(await page.evaluate(() => KONFIG.rezim)).toBe('normalno');
    expect((await actx.request.post('/api/admin/rezim', { data: { rezim: 'hitno' } })).status()).toBe(200);
    // Bilo koji sljedeći poziv API-ja nosi X-Komodo-Rezim: hitno → klijent traži /api/config?r=hitno.
    await page.evaluate(() => api('GET', '/api/categories'));
    await expect.poll(() => page.evaluate(() => KONFIG.rezim)).toBe('hitno');
    expect(konfig.some((u) => u.endsWith('/api/config?r=hitno'))).toBe(true);
    // Pregledi: red je prazan i ništa se ne šalje (ni pri sakrivanju stranice).
    await page.evaluate(() => { queueView(12345); flushViews(); flushViewsOnHide(); });
    expect(await page.evaluate(() => viewQueue.length)).toBe(0);
    await page.waitForTimeout(500);
    expect(pregledi).toEqual([]);
    // „Za tebe” u hitnom režimu = „Novo”: kartice bez razdjelnika „To je sve za sada”.
    await page.goto('/');
    await expect(page.locator('#feed .card[data-id]').first()).toBeVisible();
    await expect(page.locator('#feed .razdjelnik')).toHaveCount(0);

    // Administracija: prekidač pokazuje hitni režim, „Štedni” ga mijenja, „Vrati” vraća na server.
    const apage = await actx.newPage();
    await apage.goto('/');
    await otvoriProfil(apage);
    await apage.locator('#adminOpen').click();
    await expect(apage.locator('#admRezim [data-rezim="hitno"]')).toHaveAttribute('aria-pressed', 'true');
    await apage.locator('#admRezim [data-rezim="stedi"]').click();
    await expect(apage.locator('#admRezim [data-rezim="stedi"]')).toHaveAttribute('aria-pressed', 'true');
    expect((await (await actx.request.get('/api/config?r=x1')).json()).rezim).toBe('stedi');
    await apage.locator('#admRezimOkolina').click();
    await expect(apage.locator('#admRezim [data-rezim="normalno"]')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await actx.request.post('/api/admin/rezim', { data: { rezim: null } });
    await ctx.close();
    await actx.close();
  }
});
