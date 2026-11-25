// Administrator: otvara prijavu oglasa, odbacuje je i otvara novi butik.
import { request as apiRequest } from '@playwright/test';
import { butik, expect, objaviApi, otvoriProfil, prijaviApi, registrujApi, test } from './pomoc.mjs';

test('kupac prijavljuje oglas u aplikaciji, admin vidi i rješava prijavu', async ({ browser }) => {
  const b = butik();
  const shopReq = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(shopReq, b.email, b.password);
  const oglas = await objaviApi(shopReq, 'Sumnjiv oglas za prijavu', '15', 'Ostalo');
  await shopReq.dispose();

  // Kupac prijavljuje oglas kroz aplikaciju.
  const kupacCtx = await browser.newContext({ baseURL: process.env.E2E_URL, viewport: { width: 390, height: 844 } });
  const kupac = await kupacCtx.newPage();
  await kupacCtx.route('**/*', (r) => (new URL(r.request().url()).host === new URL(process.env.E2E_URL).host ? r.continue() : r.abort()));
  await registrujApi(kupacCtx.request, 'prijavljuje@e2e.ba', 'Prijavljuje');
  await kupac.goto(`/?o=${oglas.id}`);
  const card = kupac.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  await card.locator('[data-act="more"]').click();
  await kupac.locator('#buyerMoreSheet [data-act="report"]').click();
  await expect(kupac.locator('#reportSheet')).toBeVisible();
  await kupac.locator('#reportReason').selectOption('Prevara ili lažan oglas');
  await kupac.locator('#reportForm button[type="submit"]').click();
  await expect(kupac.locator('#toast')).toHaveText('Prijava je poslana. Pregledaćemo je.');
  await kupacCtx.close();

  // Admin.
  const ctx = await browser.newContext({ baseURL: process.env.E2E_URL, viewport: { width: 390, height: 844 } });
  await ctx.route('**/*', (r) => (new URL(r.request().url()).host === new URL(process.env.E2E_URL).host ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const greske = [];
  page.on('pageerror', (e) => greske.push(String(e)));
  await registrujApi(ctx.request, 'admin@e2e.ba', 'Administrator');
  await page.goto('/');
  await otvoriProfil(page);
  await expect(page.locator('#adminOpen')).toBeVisible();
  await page.locator('#adminOpen').click();
  await expect(page.locator('#admin')).toBeVisible();
  const prijava = page.locator('#admReports li', { hasText: 'Sumnjiv oglas za prijavu' });
  await expect(prijava).toBeVisible();
  await expect(prijava).toContainText('Prevara ili lažan oglas');
  await expect(prijava).toContainText('Prijavljuje');
  await expect(prijava.locator('video')).toHaveCount(1);

  await prijava.locator('[data-res="odbaci"]').click();
  await expect(page.locator('#toast')).toHaveText('Prijava je odbačena.');
  await expect(page.locator('#admReportsHint')).toHaveText('Nema otvorenih prijava.');
  expect((await ctx.request.get(`/api/listings/${oglas.id}`)).status()).toBe(200);

  // Novi butik iz administracije.
  await page.locator('#admName').fill('Butik Iz Admina');
  await page.locator('#admEmail').fill('novi.butik@e2e.ba');
  await page.locator('[id="admShopForm"] button[type="submit"]').click();
  await expect(page.locator('#admShopDone')).toBeVisible();
  const lozinka = await page.locator('#admShopDone strong').nth(1).innerText();
  const nov = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(nov, 'novi.butik@e2e.ba', lozinka);
  expect((await (await nov.get('/api/me')).json()).korisnik.role).toBe('butik');
  await nov.dispose();
  await expect(page.locator('#admUsers')).toContainText('novi.butik@e2e.ba');
  expect(greske).toEqual([]);
  await ctx.close();
});

test('kupac nema dugme Administracija i ne vidi admin podatke', async ({ page, context }) => {
  await registrujApi(context.request, 'obican@e2e.ba', 'Običan');
  await page.goto('/');
  await otvoriProfil(page);
  await expect(page.locator('#me')).toBeVisible();
  await expect(page.locator('#adminOpen')).toBeHidden();
  expect((await context.request.get('/api/admin/reports')).status()).toBe(404);
});
