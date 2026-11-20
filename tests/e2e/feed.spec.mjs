// Feed (docs/SPEC-V1.md, F-01, U-12, U-18): kartice „Za tebe” / „Novo” / „Praćeni”, razdjelnik poslije kraja
// „Za tebe”, poziv na nalog na „Praćeni” za neprijavljenog i uputa za prevlačenje.
import { request as apiRequest } from '@playwright/test';
import { LOZINKA, butik, expect, objaviApi, prijaviApi, test } from './pomoc.mjs';

test.beforeAll(async () => {
  const b = butik();
  const req = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(req, b.email, b.password);
  for (const [t, c] of [['Feed haljina', 'Haljine'], ['Feed torba', 'Torbe'], ['Feed cipele', 'Obuća']]) {
    await objaviApi(req, t, '30', c);
  }
  await req.dispose();
});

const tab = (page, ime) => page.locator('#ftabs .ftab', { hasText: ime });

test('neprijavljen: „Za tebe” je početna, uputa prvi put, razdjelnik i nastavak bez ponavljanja', async ({ page }) => {
  await page.goto('/');
  await expect(tab(page, 'Za tebe')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab(page, 'Novo')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.wordmark')).toHaveCount(0);
  await expect(page.locator('.card[data-id]').first()).toBeVisible();

  // U-12: uputa se vidi prvi put i nestaje sama (≤ 4 s); oznaka ostaje u localStorage.
  await expect(page.locator('#uputa')).toBeVisible();
  await expect(page.locator('#uputa')).toHaveText('Prevuci gore za sljedeći proizvod');
  await expect(page.locator('#uputa')).toBeHidden({ timeout: 6000 });
  expect(await page.evaluate(() => localStorage.getItem('komodo.uputa'))).toBe('1');
  await page.reload();
  await expect(page.locator('.card[data-id]').first()).toBeVisible();
  await expect(page.locator('#uputa')).toBeHidden();

  // Malo oglasa → „Za tebe” završava na prvoj strani: razdjelnik, pa najnoviji koji nisu prikazani.
  await expect(page.locator('.razdjelnik')).toHaveText('To je sve za sada u „Za tebe”. Slijede najnoviji oglasi.');
  const idjevi = await page.locator('.card[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  expect(new Set(idjevi).size).toBe(idjevi.length);
  const novo = await (await page.request.get('/api/feed?kartica=novo')).json();
  expect(idjevi.length).toBe(novo.oglasi.length);
});

test('„Novo” redom od najnovijeg; ponovni dodir osvježava; pretraga sakriva kartice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.card[data-id]').first()).toBeVisible();
  const zahtjev = page.waitForRequest((r) => r.url().includes('/api/feed?kartica=novo'));
  await tab(page, 'Novo').click();
  await zahtjev;
  await expect(tab(page, 'Novo')).toHaveAttribute('aria-pressed', 'true');
  const novo = await (await page.request.get('/api/feed?kartica=novo')).json();
  await expect(page.locator('.card[data-id]').first()).toHaveAttribute('data-id', String(novo.oglasi[0].id));
  await expect(page.locator('.razdjelnik')).toHaveCount(0);

  const opet = page.waitForRequest((r) => r.url().includes('/api/feed?kartica=novo'));
  await tab(page, 'Novo').click();
  await opet;

  await page.locator('#searchToggle').click();
  await page.locator('#qText').fill('Feed');
  await page.locator('#searchForm button[type="submit"]').click();
  await expect(page.locator('#ftabs')).toBeHidden();
  await page.locator('#searchClear').click();
  await expect(page.locator('#ftabs')).toBeVisible();
});

test('U-18: neprijavljen na „Praćeni” vidi poziv na nalog; poslije registracije se vraća na „Praćeni”', async ({ page }) => {
  await page.goto('/');
  await tab(page, 'Praćeni').click();
  const box = page.locator('.card.empty .empty-box');
  await expect(box.locator('h2')).toHaveText('Prati butike koji ti se sviđaju');
  await expect(box.locator('p')).toHaveText('Njihovi novi snimci će biti ovdje.');
  await box.locator('button', { hasText: 'Napravi nalog' }).click();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#authTitle')).toHaveText('Novi nalog');
  await page.locator('#aShop').fill('Pratilac Feed');
  await page.locator('#aEmail').fill('pratilac.feed@e2e.ba');
  await page.locator('#aPass').fill(LOZINKA);
  await page.locator('#authSubmit').click();

  await expect(page.locator('#feed')).toBeVisible();
  await expect(tab(page, 'Praćeni')).toHaveAttribute('aria-pressed', 'true');
  await expect(box.locator('h2')).toHaveText('Još ne pratiš nijedan butik');
  await expect(box.locator('p')).toHaveText('Dodirni „Prati” pored imena butika na oglasu ili na njegovom profilu.');
  await box.locator('button', { hasText: 'Idi na Za tebe' }).click();
  await expect(tab(page, 'Za tebe')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.card[data-id]').first()).toBeVisible();
});

test('prijavljen kupac koji prati butik vidi njegove oglase na „Praćeni”', async ({ page }) => {
  const b = butik();
  await page.request.post('/api/auth/register', { data: { email: 'prati.feed@e2e.ba', password: LOZINKA, name: 'Prati Feed' } });
  const f = await page.request.post(`/api/shops/${b.handle}/follow`, { data: { following: true } });
  test.skip(f.status() === 404, 'ruta za praćenje (P3) još nije spojena');
  await page.goto('/');
  await tab(page, 'Praćeni').click();
  await expect(page.locator('.card[data-id]').first()).toBeVisible();
  const handles = await page.locator('.card[data-id] .seller-btn span:last-child').allTextContents();
  expect(handles.length).toBeGreaterThan(0);
  for (const h of handles) expect(h).toBe(b.name);
});
