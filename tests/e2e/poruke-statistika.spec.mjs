// P5: brza pitanja, „Više” i blokiranje u razgovoru, traka potvrde emaila, statistika butika, admin brojke i pretraga.
import { mkdirSync } from 'node:fs';
import { request as apiRequest } from '@playwright/test';
import pg from '../../api/node_modules/pg/lib/index.js';
import { noviButik } from '../../api/test/pomoc/okolina.mjs';
import { expect, LOZINKA, otvoriProfil, prijaviApi, registrujApi, test } from './pomoc.mjs';

const SLIKE = '/tmp/p5-slike';
// Vlastiti butik ovog fajla: ne troši ograničenje prijava zajedničkog butika i ima vlastiti keš statistike.
const NAZIV = 'Butik Poruke E2E';
let moj = null;
const butik = () => moj;
test.beforeAll(async () => {
  moj = await noviButik({ url: process.env.E2E_DATABASE_URL }, { butik: NAZIV, email: 'poruke.e2e@e2e.ba' });
  moj.name = NAZIV;
});
mkdirSync(SLIKE, { recursive: true });

async function baza(sql, params) {
  const c = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}
async function butikOglas(title, extra = {}) {
  const b = butik();
  const ctx = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(ctx, b.email, b.password);
  const fd = { title, price: '89,90', category: 'Haljine', ...extra };
  const { readFile } = await import('node:fs/promises');
  const { VIDEO } = await import('./pomoc.mjs');
  const r = await ctx.post('/api/listings', { multipart: { ...fd, video: { name: 's.mp4', mimeType: 'video/mp4', buffer: await readFile(VIDEO) } } });
  expect(r.status()).toBe(201);
  const oglas = (await r.json()).oglas;
  await ctx.dispose();
  return oglas;
}

test('kupac: brza pitanja, „Više” → blokiranje s potvrdom → odblokiranje', async ({ page, context }) => {
  const oglas = await butikOglas('Haljina za brza pitanja', { sizes: 'S,M' });
  await registrujApi(context.request, 'brza@e2e.ba', 'Brza Pitanja');
  const r = await context.request.post('/api/conversations', { data: { shop: butik().handle, listingId: oglas.id } });
  const id = (await r.json()).razgovor;
  await page.goto(`/?poruke=${id}`);
  await expect(page.locator('#chat')).toBeVisible();
  await expect(page.locator('#chatName')).toHaveText(NAZIV);

  const quick = page.locator('#chatQuick .quick');
  await expect(quick).toHaveText(['Je li još dostupno?', 'Imate li S?', 'Imate li M?', 'Može li dostava i koliko košta?', 'Mogu li doći da probam?']);
  await page.screenshot({ path: `${SLIKE}/razgovor-brza-pitanja.png` });
  await quick.nth(2).click();
  await expect(page.locator('#chatInput')).toHaveValue('Imate li ovo u veličini M?');
  await expect(page.locator('#chatQuick')).toBeHidden();
  await page.locator('#chatInput').fill('');
  await expect(page.locator('#chatQuick')).toBeVisible();
  await quick.nth(0).click();
  await expect(page.locator('#chatInput')).toHaveValue('Je li još dostupno?');
  await page.locator('#chatForm button[type="submit"]').click();
  await expect(page.locator('#chatLog .msg.mine')).toHaveText(/Je li još dostupno\?/);
  await expect(page.locator('#chatQuick')).toBeVisible();

  // „Više”
  await page.locator('#chatMore').click();
  await expect(page.locator('#chatMoreSheet')).toBeVisible();
  await expect(page.locator('#chatBlock')).toHaveText(`Blokiraj ${NAZIV}`);
  await expect(page.locator('#chatReport')).toHaveText('Prijavi poruku');
  await page.screenshot({ path: `${SLIKE}/razgovor-vise.png` });
  await page.locator('#chatBlock').click();
  await expect(page.locator('#confirmTitle')).toHaveText(`Blokirati ${NAZIV}?`);
  await expect(page.locator('#confirmText')).toHaveText('Više ti neće moći pisati, a ni ti njemu. Možeš ga odblokirati kasnije.');
  await page.screenshot({ path: `${SLIKE}/razgovor-blokiraj-potvrda.png` });
  await page.locator('#confirmNo').click();
  await expect(page.locator('#chatInput')).toBeEnabled();
  await page.locator('#chatMore').click();
  await page.locator('#chatBlock').click();
  await page.locator('#confirmYes').click();
  await expect(page.locator('#chatInput')).toBeDisabled();
  await expect(page.locator('#chatQuick')).toBeHidden();
  await page.screenshot({ path: `${SLIKE}/razgovor-blokiran.png` });
  await page.locator('#chatMore').click();
  await expect(page.locator('#chatBlock')).toHaveText(`Odblokiraj ${NAZIV}`);
  await page.locator('#chatBlock').click();
  await expect(page.locator('#chatInput')).toBeEnabled();
  await expect(page.locator('#chatQuick')).toBeVisible();

  // Spisak: naslov oglasa ispod imena (U-08).
  await page.locator('#chatBack').click();
  await expect(page.locator('#inboxList .ltitle')).toHaveText('Haljina za brza pitanja');
  await page.screenshot({ path: `${SLIKE}/spisak-razgovora.png` });
});

test('butik u razgovoru vidi odgovore butika (P1)', async ({ page, context, browser }) => {
  const oglas = await butikOglas('Haljina za odgovore');
  const kupac = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await registrujApi(kupac, 'pita@e2e.ba', 'Pita Kupac');
  const id = (await (await kupac.post('/api/conversations', { data: { shop: butik().handle, listingId: oglas.id } })).json()).razgovor;
  await kupac.post(`/api/conversations/${id}/messages`, { data: { body: 'Ima li?' } });
  await kupac.dispose();
  await prijaviApi(context.request, butik().email, butik().password);
  await page.goto(`/?poruke=${id}`);
  await expect(page.locator('#chatQuick .quick')).toHaveText(['Da, dostupno je.', 'Nažalost, prodato je.', 'Dostava je moguća. Pošaljite adresu i broj telefona.', 'Izvolite u radnju, tu smo.']);
  await page.locator('#chatQuick .quick').nth(0).click();
  await expect(page.locator('#chatInput')).toHaveValue('Da, dostupno je.');
});

test('nepotvrđen email: traka, onemogućeno slanje, „Pošalji ponovo” i 429 poruka', async ({ page, browser }) => {
  const oglas = await butikOglas('Haljina za nepotvrđene');
  const reg = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await registrujApi(reg, 'nepotvrdjen@e2e.ba', 'Nepotvrđen');
  await reg.dispose();
  await baza("update users set email_verified_at = null where email = 'nepotvrdjen@e2e.ba'");
  const ctx = await browser.newContext({ baseURL: process.env.E2E_URL, viewport: { width: 390, height: 844 } });
  const own = new URL(process.env.E2E_URL).host;
  await ctx.route('**/*', (route) => (new URL(route.request().url()).host === own ? route.continue() : route.abort()));
  await prijaviApi(ctx.request, 'nepotvrdjen@e2e.ba', LOZINKA);
  const id = (await (await ctx.request.post('/api/conversations', { data: { shop: butik().handle, listingId: oglas.id } })).json()).razgovor;
  const p = await ctx.newPage();
  await p.goto(`/?poruke=${id}`);
  await expect(p.locator('#chatBar')).toBeVisible();
  await expect(p.locator('#chatBarText')).toHaveText('Potvrdi email da bi poslao poruku. Link smo poslali na nepotvrdjen@e2e.ba.');
  await expect(p.locator('#chatInput')).toBeDisabled();
  await expect(p.locator('#chatForm button[type="submit"]')).toBeDisabled();
  await expect(p.locator('#chatQuick')).toBeHidden();
  await p.screenshot({ path: `${SLIKE}/razgovor-nepotvrdjen.png` });
  for (let k = 0; k < 3; k++) {
    await p.locator('#chatResend').click();
    await expect(p.locator('#toast')).toContainText('Link je poslan na nepotvrdjen@e2e.ba.');
  }
  await p.locator('#chatResend').click();
  await expect(p.locator('#chatBarErr')).toContainText('Link je već poslan');
  await p.screenshot({ path: `${SLIKE}/razgovor-nepotvrdjen-429.png` });
  await ctx.close();
});

test('statistika butika: iz profila i s oglasa na vrhu, 7 i 30 dana', async ({ page, context }) => {
  const prvi = await butikOglas('Statistika prvi');
  const drugi = await butikOglas('Statistika drugi');
  const bid = (await baza("select id from users where email = $1", [butik().email])).rows[0].id;
  await baza("insert into listing_views(listing_id, viewer, day) values ($1,'dx1',current_date),($1,'dx2',current_date),($1,'dx3',current_date-9),($2,'dx1',current_date)", [prvi.id, drugi.id]);
  await baza("insert into listing_contacts(listing_id, customer_id) select $1, id from users where email = 'brza@e2e.ba'", [drugi.id]);
  await prijaviApi(context.request, butik().email, butik().password);
  await page.goto('/');
  await otvoriProfil(page);
  await page.locator('#pStatsOpen').click();
  await expect(page.locator('#statScreen')).toBeVisible();
  await expect(page.locator('#statBody')).toBeVisible();
  const item = (t) => page.locator('#statBody .stat-item', { hasText: t });
  await expect(item('Statistika prvi')).toContainText('2 pregleda');
  await expect(item('Statistika drugi')).toContainText('1 razgovor');
  await expect(page.locator('#statBody')).toContainText('Pregled = jedan kupac pogledao oglas tog dana.');
  await page.screenshot({ path: `${SLIKE}/statistika-7.png` });
  await page.locator('[data-period="30"]').click();
  await expect(item('Statistika prvi')).toContainText('3 pregleda');
  await page.screenshot({ path: `${SLIKE}/statistika-30.png` });
  await page.locator('#statBack').click();
  await expect(page.locator('#statScreen')).toBeHidden();

  // S oglasa: taj oglas je prvi i istaknut.
  await page.evaluate((id) => openStats(id), drugi.id);
  await page.locator('[data-period="7"]').click();
  await expect(page.locator('#statBody .stat-item').first()).toContainText('Statistika drugi');
  await expect(page.locator('#statBody .stat-item').first()).toHaveClass(/is-focus/);
  await page.screenshot({ path: `${SLIKE}/statistika-oglas-vrh.png` });
  // Android Nazad zatvara prozor.
  await page.evaluate(() => window.__komodoBack());
  await expect(page.locator('#statScreen')).toBeHidden();
});

test('kupac ne dobija statistiku (poruka umjesto ekrana)', async ({ page, context }) => {
  await registrujApi(context.request, 'stat.kupac@e2e.ba', 'Stat Kupac');
  await page.goto('/');
  await page.evaluate(() => openStats());
  await expect(page.locator('#statScreen')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Statistika je dostupna samo butiku.');
});

test('administracija: brojke na vrhu i pretraga naloga', async ({ page, context }) => {
  test.setTimeout(150000);
  await baza("insert into daily_stats(day, active, active_users, active_devices, registrations, listings, messages, conversations) values (current_date, 1204, 700, 504, 87, 31, 412, 60), (current_date - 1, 980, 600, 380, 40, 25, 380, 50) on conflict (day) do update set active = excluded.active, registrations = excluded.registrations, listings = excluded.listings, messages = excluded.messages");
  await registrujApi(context.request, 'admin@e2e.ba', 'Administrator').catch(async () => { await prijaviApi(context.request, 'admin@e2e.ba', LOZINKA); });
  await page.goto('/');
  await otvoriProfil(page);
  const tiles = page.locator('#admStatsBody .adm-tile');
  // API drži admin brojke u kešu 60 s: ako ih je neki raniji test već učitao, čekamo da istekne.
  await expect(async () => {
    await page.goto('/');
    await otvoriProfil(page);
    await page.locator('#adminOpen').click();
    await expect(tiles).toHaveCount(4, { timeout: 3000 });
    await expect(tiles.nth(0)).toContainText('1.204', { timeout: 1000 });
  }).toPass({ timeout: 90000, intervals: [3000] });
  await expect(tiles.nth(0)).toContainText('Aktivni danas');
  await expect(tiles.nth(0)).toContainText('juče 980');
  await expect(tiles.nth(1)).toContainText('87');
  await expect(page.locator('#admStatsBody .adm-table tbody tr')).toHaveCount(30);
  await expect(page.locator('#admStatsBody .adm-total')).toContainText('butika');
  await page.screenshot({ path: `${SLIKE}/admin-brojke.png` });
  await page.locator('#admSearch').fill('stat.kupac');
  await expect(page.locator('#admUsers li')).toHaveCount(1);
  await expect(page.locator('#admUsers')).toContainText('stat.kupac@e2e.ba');
  await page.locator('#admSearch').fill('%');
  await expect(page.locator('#admUsers')).toContainText('Nema naloga za ovu pretragu.');
  await page.screenshot({ path: `${SLIKE}/admin-pretraga.png` });
});
