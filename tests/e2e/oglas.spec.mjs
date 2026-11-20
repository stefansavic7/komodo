// P4 Oglas (docs/SPEC-V1.md): U-04 (namjera se ne gubi), U-10 („Više”), F-03 (veličine), F-07 (precrtana cijena).
import { request as apiRequest } from '@playwright/test';
import pg from '../../api/node_modules/pg/lib/index.js';
import { LOZINKA, VIDEO, butik, expect, objaviApi, prijaviApi, test } from './pomoc.mjs';

let butikReq;
test.beforeAll(async () => {
  const b = butik();
  butikReq = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(butikReq, b.email, b.password);
});
test.afterAll(async () => { await butikReq.dispose(); });

async function objaviSaVelicinama(title, price, category, sizes) {
  const { readFile } = await import('node:fs/promises');
  const r = await butikReq.post('/api/listings', {
    multipart: { title, price, category, sizes, video: { name: 'snimak.mp4', mimeType: 'video/mp4', buffer: await readFile(VIDEO) } },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).oglas;
}
// Prijava butika bez novog zahtjeva za prijavu (ograničenje: 10 prijava na 15 min po emailu): kolačić iz beforeAll.
async function kaoButik(context) {
  await context.addCookies((await butikReq.storageState()).cookies);
}
async function registruj(page, ime, email) {
  await page.locator('#aShop').fill(ime);
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(LOZINKA);
  await page.locator('#authSubmit').click();
}

test('U-04: neprijavljen srce → „Novi nalog” → registracija → oglas je označen', async ({ page, context }) => {
  const oglas = await objaviApi(butikReq, 'U04 srce haljina', '40', 'Haljine');
  await page.goto(`/?o=${oglas.id}`);
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  await card.locator('[data-act="like"]').click();
  await expect(page.locator('#authTitle')).toHaveText('Novi nalog');
  await expect(page.locator('#authLead')).toHaveText('Napravi besplatan nalog da sačuvaš ovaj oglas.');
  await registruj(page, 'Srce Kupac', 'srce.kupac@e2e.ba');
  await expect(card.locator('[data-act="like"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#feed')).toBeVisible();
  await expect(page.locator('.card[data-id]').first()).toHaveAttribute('data-id', String(oglas.id));
  const stanje = await (await context.request.get(`/api/likes?ids=${oglas.id}`)).json();
  expect(stanje.svidjanja[oglas.id]).toEqual({ likes: 1, liked: true });
});

test('U-04: neprijavljen „Pošalji poruku” → registracija → otvoren razgovor', async ({ page }) => {
  const b = butik();
  const oglas = await objaviApi(butikReq, 'U04 poruka torba', '25', 'Torbe');
  await page.goto(`/?o=${oglas.id}`);
  await page.locator(`.card[data-id="${oglas.id}"] [data-act="contact"]`).click();
  await page.locator('#contactMsg').click();
  await expect(page.locator('#authTitle')).toHaveText('Novi nalog');
  await expect(page.locator('#authLead')).toHaveText(`Napravi besplatan nalog da pišeš butiku ${b.name}.`);
  await registruj(page, 'Poruka Kupac', 'poruka.kupac@e2e.ba');
  await expect(page.locator('#chat')).toBeVisible();
  await expect(page.locator('#chatName')).toHaveText(b.name);
});

test('U-04: neprijavljen „Prati” na kartici → registracija → butik je zapraćen', async ({ page }) => {
  const b = butik();
  const oglas = await objaviApi(butikReq, 'U04 prati nakit', '15', 'Nakit');
  await page.goto(`/?o=${oglas.id}`);
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card.locator('[data-act="follow"]')).toHaveText('Prati');
  await card.locator('[data-act="follow"]').click();
  await expect(page.locator('#authLead')).toHaveText(`Napravi besplatan nalog da pratiš ${b.name}.`);
  await registruj(page, 'Prati Kupac', 'prati.kupac@e2e.ba');
  await expect(card.locator('[data-act="follow"]')).toHaveText('Pratiš');
  await expect(card.locator('[data-act="follow"]')).toHaveAttribute('aria-pressed', 'true');
  const kupacApi = await page.request.get('/api/me/follows');
  expect((await kupacApi.json()).butici.map((x) => x.handle)).toContain(b.handle);
  // Ponovni dodir otprati.
  await card.locator('[data-act="follow"]').click();
  await expect(card.locator('[data-act="follow"]')).toHaveText('Prati');
});

test('U-04: neprijavljen na profilu butika „Prati” čuva radnju i vraća na profil', async ({ page }) => {
  const b = butik();
  await page.goto(`/?b=${b.handle}`);
  await page.locator('#vFollow').click();
  await expect(page.locator('#authLead')).toHaveText(`Napravi besplatan nalog da pratiš ${b.name}.`);
  await registruj(page, 'Profil Pratilac', 'profil.pratilac@e2e.ba');
  await expect(page.locator('#shopView')).toBeVisible();
  await expect(page.locator('#vFollow')).toHaveText('Pratiš');
});

test('U-10: „Više” za vlastiti oglas — Izmijeni, prodato/vrati, Statistika, Obriši', async ({ page, context }) => {
  const oglas = await objaviApi(butikReq, 'Vise meni oglas', '30', 'Torbe');
  await kaoButik(context);
  await page.goto('/');
  await page.goto(`/?o=${oglas.id}`);
  await expect(page.locator('#tabPost')).toBeVisible();
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  // Nema zasebnih dugmadi „Izmijeni” i „Obriši”; nema „Prati” na vlastitom oglasu.
  await expect(card.locator('[data-act="edit"], [data-act="del"], [data-act="follow"]')).toHaveCount(0);
  await card.locator('[data-act="more"]').click();
  const meni = page.locator('#moreSheet');
  await expect(meni).toBeVisible();
  await expect(meni.locator('[data-more="edit"]')).toHaveText('Izmijeni oglas');
  await expect(meni.locator('[data-more="sold"]')).toHaveText('Označi kao prodato');
  await expect(meni.locator('[data-more="del"]')).toHaveText('Obriši oglas');
  // Statistika: dugme je tu samo kad postoji openStats (P5).
  const imaStats = await page.evaluate(() => typeof openStats === 'function');
  if (imaStats) await expect(meni.locator('[data-more="stats"]')).toBeVisible(); else await expect(meni.locator('[data-more="stats"]')).toBeHidden();
  await meni.locator('[data-more="close"]').click();
  await expect(meni).toBeHidden();

  await card.locator('[data-act="more"]').click();
  await meni.locator('[data-more="sold"]').click();
  await expect(card).toHaveClass(/is-sold/);
  expect((await (await page.request.get(`/api/listings/${oglas.id}`)).json()).oglas.sold).toBe(true);
  await card.locator('[data-act="more"]').click();
  await expect(meni.locator('[data-more="sold"]')).toHaveText('Vrati u prodaju');
  await meni.locator('[data-more="sold"]').click();
  await expect(card).not.toHaveClass(/is-sold/);

  await card.locator('[data-act="more"]').click();
  await meni.locator('[data-more="edit"]').click();
  await expect(page.locator('#editSheet')).toBeVisible();
  await page.locator('#editCancel').click();

  await card.locator('[data-act="more"]').click();
  await meni.locator('[data-more="del"]').click();
  await expect(page.locator('#confirmTitle')).toHaveText('Obrisati oglas?');
  await page.locator('#confirmYes').click();
  await expect(page.locator('#toast')).toHaveText('Oglas je obrisan.');
  expect((await page.request.get(`/api/listings/${oglas.id}`)).status()).toBe(404);
});

test('F-03: forma objave — veličine po kategoriji, obavezan izbor, kartica i filter veličine', async ({ page, context }) => {
  await kaoButik(context);
  await page.goto('/');
  await page.locator('#tabPost').click();
  await page.locator('#fVideo').setInputFiles(VIDEO);
  await page.locator('#fTitle').fill('Velicine XXL haljina');
  await page.locator('#fPrice').fill('45');
  await expect(page.locator('#fSizesBox')).toBeVisible();
  await expect(page.locator('#fSizesLbl')).toHaveText('Veličine (izaberi sve koje imaš)');
  // Bez izbora: poruka klijenta.
  await page.locator('#postSubmit').click();
  await expect(page.locator('#postErr')).toHaveText('Izaberi bar jednu veličinu.');
  // Promjena kategorije briše izbor koji ne pripada novom skupu; torbe nemaju birač.
  await page.locator('#fSizes [data-size="XXL"]').click();
  await expect(page.locator('#fSizes [data-size="XXL"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fCat').selectOption('Obuća');
  await expect(page.locator('#fSizes .size-btn')).toHaveCount(12);
  await page.locator('#fCat').selectOption('Torbe');
  await expect(page.locator('#fSizesBox')).toBeHidden();
  await page.locator('#fCat').selectOption('Haljine');
  await expect(page.locator('#fSizes [data-size="XXL"]')).toHaveAttribute('aria-pressed', 'false');
  // Dodirne površine ≥ 44×44.
  const kutija = await page.locator('#fSizes [data-size="XS"]').boundingBox();
  expect(kutija.width).toBeGreaterThanOrEqual(44);
  expect(kutija.height).toBeGreaterThanOrEqual(44);
  await page.locator('#fSizes [data-size="XXL"]').click();
  const objava = page.waitForResponse((r) => r.url().endsWith('/api/listings') && r.request().method() === 'POST');
  await page.locator('#postSubmit').click();
  const oglas = (await (await objava).json()).oglas;
  expect(oglas.sizes).toEqual(['XXL']);
  // Poslije objave butik je na kartici „Novo”.
  await expect(page.locator('#ftabs .ftab[data-k="novo"]')).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.vel')).toHaveText('Vel. XXL');

  // Kupac: filter veličine u pretrazi, tablet, pamćenje i prazno stanje.
  await objaviSaVelicinama('Velicine XS druga', '12', 'Pantalone', 'XS');
  await objaviSaVelicinama('Velicine cipele', '60', 'Obuća', '38,39');
  await context.clearCookies();
  await page.goto('/');
  await page.locator('#searchToggle').click();
  await page.locator('#qSizesOdjeca [data-size="XXL"]').click();
  const tablet = page.locator('#chips .vtab');
  await expect(tablet).toHaveText('Veličine: XXL ✕');
  await expect(page.locator('#searchDot')).toBeVisible();
  await expect(page.locator('.card[data-id] .vel').first()).toHaveText(/XXL/);
  const sveVel = await page.locator('.card[data-id] .vel').allTextContents();
  expect(sveVel.length).toBeGreaterThan(0);
  expect(sveVel.every((t) => t.indexOf('XXL') !== -1)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('komodo.velicine'))).toBe('["XXL"]');
  // Preživi ponovno otvaranje.
  await page.reload();
  await expect(page.locator('#chips .vtab')).toHaveText('Veličine: XXL ✕');
  await expect(page.locator('.card[data-id] .vel').first()).toHaveText(/XXL/);
  // Obuća: red obuće, kartica „Br.”.
  await page.locator('#searchToggle').click();
  await page.locator('#qSizesOdjeca [data-size="XXL"]').click();
  await page.locator('#qSizesObuca [data-size="38"]').click();
  await expect(page.locator('#chips .vtab')).toHaveText('Veličine: 38 ✕');
  await expect(page.locator('.card[data-id] .vel').first()).toHaveText('Br. 38 · 39');
  // Prazno stanje: veličina koje nema.
  await page.locator('#qSizesObuca [data-size="38"]').click();
  await page.locator('#qSizesObuca [data-size="46"]').click();
  await expect(page.locator('.card.empty h2')).toHaveText('Nema oglasa u tvojoj veličini');
  await expect(page.locator('.card.empty p')).toHaveText('Probaj bez filtera veličine.');
  await page.locator('.card.empty [data-act="clearsizes"]').click();
  await expect(page.locator('#chips .vtab')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('komodo.velicine'))).toBe('[]');
});

test('F-07: sniženje u izmjeni — napomena, toast, precrtana stara cijena na kartici', async ({ page, context }) => {
  const oglas = await objaviSaVelicinama('Sniz kartica haljina', '89,90', 'Haljine', 'M');
  // Jedan kupac je označio oglas.
  const kupac = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  const reg = await kupac.post('/api/auth/register', { data: { email: 'sniz.kupac@e2e.ba', password: LOZINKA, name: 'Sniz Kupac' } });
  expect(reg.status()).toBe(201);
  expect((await kupac.post(`/api/listings/${oglas.id}/like`, { data: { liked: true } })).status()).toBe(200);
  await kupac.dispose();

  await kaoButik(context);
  await page.goto('/');
  await page.goto(`/?o=${oglas.id}`);
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.old-price')).toHaveCount(0);
  // R2-07: cijena upravo objavljenog oglasa nije stara 72 h — napomena kaže da obavještenja neće biti.
  await card.locator('[data-act="more"]').click();
  await page.locator('#moreSheet [data-more="edit"]').click();
  await page.locator('#ePrice').fill('69,90');
  await expect(page.locator('#eDrop')).toHaveText('Cijena je mijenjana u zadnja 3 dana, pa kupci ovaj put neće dobiti obavještenje o sniženju.');
  await page.locator('#editCancel').click();
  // Cijena važi 4 dana: sniženje javlja kupcima.
  const c = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await c.connect();
  await c.query("update listings set price_set_at = now() - interval '4 days' where id = $1", [oglas.id]);
  await c.end();
  await page.goto(`/?o=${oglas.id}`);
  await expect(card).toBeVisible();
  await card.locator('[data-act="more"]').click();
  await page.locator('#moreSheet [data-more="edit"]').click();
  await expect(page.locator('#ePrice')).toHaveValue('89,90');
  await expect(page.locator('#eDrop')).toBeHidden();
  await page.locator('#ePrice').fill('69,90');
  await expect(page.locator('#eDrop')).toHaveText('Kupci koji su označili ovaj oglas (1) dobiće obavještenje o sniženju.');
  await page.locator('#ePrice').fill('88');
  await expect(page.locator('#eDrop')).toBeHidden();
  await page.locator('#ePrice').fill('69,90');
  await page.locator('#editForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toHaveText('Oglas je izmijenjen. Obavijestili smo kupce o sniženju.');
  await expect(card.locator('.old-price')).toHaveText('89,90 KM');
  await expect(card.locator('.price')).toHaveText('69,90 KM');
  await expect(card.locator('.drop')).toHaveText('Sniženo');
  await expect(card.locator('.vel')).toHaveText('Vel. M');
  // Izmjena bez sniženja: običan toast.
  await card.locator('[data-act="more"]').click();
  await page.locator('#moreSheet [data-more="edit"]').click();
  await page.locator('#editForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toHaveText('Oglas je izmijenjen.');
});
