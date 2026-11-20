// Glavni tok kupca: registracija → feed → sviđanje → profil butika → poruka.
import { request as apiRequest } from '@playwright/test';
import { LOZINKA, butik, expect, objaviApi, otvoriProfil, prijaviApi, test } from './pomoc.mjs';

let oglas;

test.beforeAll(async () => {
  const b = butik();
  const req = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(req, b.email, b.password);
  oglas = await objaviApi(req, 'Svilena bluza za kupca', '49,90', 'Majice i košulje');
  await req.dispose();
});

test('kupac: registracija, sviđanje, profil butika i poruka', async ({ page, context }) => {
  const b = butik();
  // Link oglasa (/?o=id) stavlja oglas prvi; obični feed ima namjerni keš od 5 s, pa svjež oglas
  // drugog korisnika ne mora odmah biti na početnoj.
  await page.goto(`/?o=${oglas.id}`);
  await expect(page.locator(`.card[data-id="${oglas.id}"]`)).toBeVisible();

  // Sviđanje bez prijave otvara „Novi nalog” s tekstom prema radnji (U-04).
  await page.locator(`.card[data-id="${oglas.id}"] [data-act="like"]`).click();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#authTitle')).toHaveText('Novi nalog');
  await expect(page.locator('#authLead')).toHaveText('Napravi besplatan nalog da sačuvaš ovaj oglas.');
  await expect(page.locator('#authShopField')).toBeVisible();

  // Registracija; poslije nje se sviđanje izvršava samo (vidi i oglas.spec.mjs).
  await page.locator('#aShop').fill('Ana Kupac');
  await page.locator('#aEmail').fill('ana.kupac@e2e.ba');
  await page.locator('#aPass').fill(LOZINKA);
  await page.locator('#authSubmit').click();
  await expect(page.locator('#feed')).toBeVisible();
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.title')).toHaveText('Svilena bluza za kupca');
  const heart = card.locator('[data-act="like"]');
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(heart.locator('.n')).toHaveText('1');
  const stanje = await (await context.request.get(`/api/likes?ids=${oglas.id}`)).json();
  expect(stanje.svidjanja[oglas.id]).toEqual({ likes: 1, liked: true });
  await otvoriProfil(page);
  await expect(page.locator('#me')).toBeVisible();
  await expect(page.locator('#pHandle')).toHaveText('ana.kupac@e2e.ba');
  await expect(page.locator('#tabPost')).toBeHidden();

  // Oglas je u „Sviđa mi se” na profilu.
  await otvoriProfil(page);
  await expect(page.locator('#pGridTitle')).toHaveText('Sviđa mi se');
  await expect(page.locator('#pGrid .tile')).toHaveCount(1);
  await expect(page.locator('#pCount')).toHaveText('1');

  // Profil butika.
  await page.locator('.tab[data-go="feed"]').click();
  await card.locator('[data-act="shop"]').click();
  await expect(page.locator('#shopView')).toBeVisible();
  await expect(page.locator('#vName')).toHaveText(b.name);
  await expect(page.locator('#vContact')).toContainText('065 123 456');
  await expect(page.locator('#vGrid .tile').first()).toBeVisible();

  // Poruka butiku.
  await page.locator('#vMsg').click();
  await expect(page.locator('#chat')).toBeVisible();
  await expect(page.locator('#chatName')).toHaveText(b.name);
  await page.locator('#chatInput').fill('Zdravo, ima li M?');
  await page.locator('#chatForm button[type="submit"]').click();
  await expect(page.locator('#chatLog .msg.mine')).toContainText('Zdravo, ima li M?');
  await expect(page.locator('#chatInput')).toHaveValue('');

  // Butik je dobio poruku (provjera preko API-ja u ime butika).
  const shopReq = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(shopReq, b.email, b.password);
  const me = await (await shopReq.get('/api/me')).json();
  expect(me.neprocitano).toBe(1);
  const razgovori = await (await shopReq.get('/api/conversations')).json();
  expect(razgovori.razgovori[0].last).toBe('Zdravo, ima li M?');
  await shopReq.dispose();

  // Odjava.
  await otvoriProfil(page);
  await page.locator('#logout').click();
  await expect(page.locator('#authForm')).toBeVisible();
});
