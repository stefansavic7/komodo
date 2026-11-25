// Glavni tok butika: prijava → objava videa → izmjena → prodato → brisanje s potvrdom.
import { VIDEO, butik, expect, otvoriProfil, test } from './pomoc.mjs';

test('butik: prijava, objava, izmjena, prodato i brisanje s potvrdom', async ({ page, context }) => {
  const b = butik();
  await page.goto('/');
  await otvoriProfil(page);
  await page.locator('#aEmail').fill(b.email);
  await page.locator('#aPass').fill('pogresna-lozinka');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#authErr')).toHaveText('Email ili lozinka nisu tačni.');
  await page.locator('#aPass').fill(b.password);
  await page.locator('#authSubmit').click();
  await expect(page.locator('#me')).toBeVisible();
  await expect(page.locator('#pHandle')).toHaveText(`@${b.handle}`);
  await expect(page.locator('#tabPost')).toBeVisible();

  // Objava: prvo provjera polja, pa ispravan oglas.
  await page.locator('#tabPost').click();
  await expect(page.locator('#postSheet')).toBeVisible();
  await page.locator('#postSubmit').click();
  await expect(page.locator('#postErr')).toHaveText('Dodaj video proizvoda.');
  await page.locator('#fVideo').setInputFiles(VIDEO);
  await expect(page.locator('#preview')).toBeVisible();
  await page.locator('#fTitle').fill('Crna saten haljina, M');
  await page.locator('#fPrice').fill('65');
  await page.locator('#fCat').selectOption('Haljine');
  await page.locator('#fSizes [data-size="M"]').click();
  const objava = page.waitForResponse((r) => r.url().endsWith('/api/listings') && r.request().method() === 'POST');
  await page.locator('#postSubmit').click();
  const odgovor = await objava;
  expect(odgovor.status()).toBe(201);
  const oglas = (await odgovor.json()).oglas;
  // Redizajn (docs/DIZAJN.md 4.3): umjesto toasta „Oglas je objavljen.” prozor „Oglas je u izlogu”.
  await expect(page.locator('#postDone')).toBeVisible();
  await expect(page.locator('#doneTitle')).toHaveText('Oglas je u izlogu');
  await expect(page.locator('#doneShare')).toBeVisible();
  await expect(page.locator('#doneAgain')).toBeVisible();
  await page.locator('#doneClose').click();
  await expect(page.locator('#postSheet')).toBeHidden();

  // Novi oglas je u feedu (prvi, jer je najnoviji). POZNATA GREŠKA: javni feed ima keš od 5 s, pa ga
  // butik odmah poslije objave ne vidi (vidi poseban test ispod); zato se ovdje stranica osvježava dok se ne pojavi.
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(async () => {
    if (!(await card.isVisible())) await page.reload();
    await expect(card).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  await expect(page.locator('.card[data-id]').first()).toHaveAttribute('data-id', String(oglas.id));
  await expect(card.locator('.title')).toHaveText('Crna saten haljina, M');
  await expect(card.locator('.price')).toContainText('65');

  // Izmjena i oznaka prodato.
  await card.locator('[data-act="more"]').click();
  await page.locator('#moreSheet [data-more="edit"]').click();
  await expect(page.locator('#editSheet')).toBeVisible();
  await expect(page.locator('#eTitle')).toHaveValue('Crna saten haljina, M');
  await page.locator('#eTitle').fill('Crna saten haljina, S');
  await page.locator('#ePrice').fill('59,90');
  await page.locator('#eSold').check();
  await page.locator('#editForm button[type="submit"]').click();
  await expect(page.locator('#editSheet')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Oglas je izmijenjen.');
  await expect(card.locator('.title')).toHaveText('Crna saten haljina, S');
  await expect(card).toHaveClass(/is-sold/);
  await expect(card.locator('.sold')).toHaveText('Prodato');
  const poslije = await (await context.request.get(`/api/listings/${oglas.id}`)).json();
  expect(poslije.oglas).toMatchObject({ title: 'Crna saten haljina, S', price: 59.9, sold: true });

  // Brisanje traži potvrdu; Odustani ne briše.
  await card.locator('[data-act="more"]').click();
  await page.locator('#moreSheet [data-more="del"]').click();
  await expect(page.locator('#confirmSheet')).toBeVisible();
  await expect(page.locator('#confirmTitle')).toHaveText('Obrisati oglas?');
  await page.locator('#confirmNo').click();
  await expect(page.locator('#confirmSheet')).toBeHidden();
  expect((await context.request.get(`/api/listings/${oglas.id}`)).status()).toBe(200);
  await card.locator('[data-act="more"]').click();
  await page.locator('#moreSheet [data-more="del"]').click();
  await page.locator('#confirmYes').click();
  await expect(page.locator('#toast')).toHaveText('Oglas je obrisan.');
  expect((await context.request.get(`/api/listings/${oglas.id}`)).status()).toBe(404);
  await expect(page.locator(`.card[data-id="${oglas.id}"]`)).toHaveCount(0);
});

// Popravljeno (backend): zahtjev prijavljenog butika ide mimo keša javnog feeda (5 s).
test('butik odmah poslije objave vidi novi oglas u feedu', async ({ page }) => {
  const b = butik();
  await page.request.post('/api/auth/login', { data: { email: b.email, password: b.password } });
  // Keš se puni svježe (stari unos iz ranijeg testa mora isteći), pa se objavljuje unutar 5 s.
  await page.goto('/');
  await page.waitForTimeout(5500);
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  await page.locator('#tabPost').click();
  await page.locator('#fVideo').setInputFiles(VIDEO);
  await page.locator('#fTitle').fill('Odmah vidljiv oglas');
  await page.locator('#fPrice').fill('20');
  await page.locator('#fSizes [data-size="L"]').click();
  const objava = page.waitForResponse((r) => r.url().endsWith('/api/listings') && r.request().method() === 'POST');
  await page.locator('#postSubmit').click();
  const oglas = (await (await objava).json()).oglas;
  await expect(page.locator('#doneTitle')).toHaveText('Oglas je u izlogu');
  await expect(page.locator(`.card[data-id="${oglas.id}"]`)).toBeVisible({ timeout: 3000 });
});
