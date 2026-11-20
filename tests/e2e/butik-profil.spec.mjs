// P3 Butik: profil butika (adresa, radno vrijeme, mapa, „Provjeren butik”), praćenje, profil kupca, nepostojeći butik.
// Bez butik.css izgled je drugačiji, ali sve mora raditi.
import { request as apiRequest } from '@playwright/test';
import { LOZINKA, butik, expect, objaviApi, otvoriProfil, prijaviApi, registrujApi, test } from './pomoc.mjs';

let oglas;

test.beforeAll(async () => {
  const b = butik();
  const req = await apiRequest.newContext({ baseURL: process.env.E2E_URL });
  await prijaviApi(req, b.email, b.password);
  oglas = await objaviApi(req, 'Haljina za profil butika', '79', 'Haljine');
  await req.dispose();
});

test('butik uređuje profil: adresa i radno vrijeme se vide na javnom profilu', async ({ page, context }) => {
  const b = butik();
  await page.goto('/');
  await prijaviApi(context.request, b.email, b.password);
  await page.reload();
  await otvoriProfil(page);
  await expect(page.locator('#pHandle')).toHaveText(`@${b.handle}`);
  await expect(page.locator('#pName')).toHaveText(b.name);
  await expect(page.locator('#pBadge')).toContainText('Provjeren butik');
  await expect(page.locator('#pGridTitle')).toHaveText('Moji oglasi');
  await expect(page.locator('#pStatsOpen')).toBeVisible();
  await expect(page.locator('#pShare')).toBeVisible();
  // Forma je u prozoru „Uredi profil”, a nalog je na dnu pod naslovom „Nalog”.
  await expect(page.locator('#profSheet')).toBeHidden();
  await expect(page.locator('#nalogTitle')).toHaveText('Nalog');
  await expect(page.locator('#logout')).toBeVisible();

  await page.locator('#pEdit').click();
  await expect(page.locator('#profSheet')).toBeVisible();
  await expect(page.locator('#profTitle')).toHaveText('Uredi profil');
  await expect(page.locator('#sName')).toHaveValue(b.name);
  await expect(page.locator('#sAddressHint')).toHaveText('Adresa radnje u Banjoj Luci. Kupci je vide na profilu i otvaraju na mapi.');

  // Neispravno: zatvaranje prije otvaranja.
  await page.locator('#sAddress').fill('Kralja Petra I 12');
  await page.locator('#hOn_rd').check();
  await page.locator('#hFrom_rd').fill('20:00');
  await page.locator('#hTo_rd').fill('09:00');
  await page.locator('#shopSave').click();
  await expect(page.locator('#shopErr')).toHaveText('Radno vrijeme upiši kao 09:00–20:00, a zatvaranje mora biti poslije otvaranja.');
  await expect(page.locator('#profSheet')).toBeVisible();

  // Ispravno: radnim danima 00:00–23:59 (uvijek otvoreno u radne dane), subota 09:00–15:00, nedjelja ne radi.
  await page.locator('#hFrom_rd').fill('00:00');
  await page.locator('#hTo_rd').fill('23:59');
  await page.locator('#hOn_sub').check();
  await page.locator('#hFrom_sub').fill('09:00');
  await page.locator('#hTo_sub').fill('15:00');
  await expect(page.locator('#hOn_ned')).not.toBeChecked();
  await page.locator('#shopSave').click();
  await expect(page.locator('#toast')).toHaveText('Profil je sačuvan.');
  await expect(page.locator('#profSheet')).toBeHidden();
  const me = (await (await context.request.get('/api/me')).json()).korisnik;
  expect(me.address).toBe('Kralja Petra I 12');
  expect(me.hours).toEqual({ rd: ['00:00', '23:59'], sub: ['09:00', '15:00'], ned: null });

  // Odustani zatvara prozor bez izmjena; Escape također.
  await page.locator('#pEdit').click();
  await page.locator('#sAddress').fill('Nešto drugo');
  await page.locator('#shopCancel').click();
  await expect(page.locator('#profSheet')).toBeHidden();
  await page.locator('#pEdit').click();
  await expect(page.locator('#sAddress')).toHaveValue('Kralja Petra I 12');
  await page.keyboard.press('Escape');
  await expect(page.locator('#profSheet')).toBeHidden();
});

test('javni profil butika: adresa, mapa, status, oznaka i puno radno vrijeme', async ({ page }) => {
  const b = butik();
  await page.goto(`/?b=${b.handle}`);
  await expect(page.locator('#shopView')).toBeVisible();
  await expect(page.locator('#vName')).toHaveText(b.name);
  await expect(page.locator('#vHandle')).toContainText(`@${b.handle} · na Komodu od `);
  await expect(page.locator('#vVerified')).toHaveText(/Provjeren butik/);
  await expect(page.locator('#vAddrText')).toHaveText('Kralja Petra I 12');
  const href = await page.locator('#vMap').getAttribute('href');
  expect(href).toBe('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Kralja Petra I 12, Banja Luka'));
  await expect(page.locator('#vMap')).toHaveAttribute('target', '_blank');
  await expect(page.locator('#vMap')).toHaveAttribute('rel', 'noopener');
  await expect(page.locator('#vStatus')).toHaveText(/^(Otvoreno do 23:59|Zatvoreno · otvara .+ u \d\d:\d\d|Zatvoreno)$/);
  await expect(page.locator('#vFull')).toBeHidden();
  await page.locator('#vStatus').click();
  await expect(page.locator('#vFull')).toHaveText('Pon–pet 00:00–23:59 · Subota 09:00–15:00 · Nedjelja ne radi');
  await page.locator('#vVerified').click();
  await expect(page.locator('#toast')).toHaveText('Butike na Komodu otvara naš tim nakon provjere radnje.');
  await expect(page.locator('#vFollow')).toHaveText('Prati');
  await expect(page.locator('#vShare')).toHaveText('Podijeli profil');
  await expect(page.locator('#vMsg')).toBeVisible();
  // Neprijavljen dodir na „Prati” vodi na prijavu.
  await page.locator('#vFollow').click();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#authLead')).toHaveText(`Napravi besplatan nalog da pratiš ${b.name}.`);
});

test('kupac prati i otpraćuje butik; profil kupca ima „pratiš” i spisak „Pratim”', async ({ page, context }) => {
  const b = butik();
  await registrujApi(context.request, 'pratilac.e2e@e2e.ba', 'Pratilac E2E');
  await page.goto(`/?b=${b.handle}`);
  await expect(page.locator('#vFollow')).toHaveText('Prati');
  const followers0 = Number(await page.locator('#vFollowers').textContent());
  const odgovor = page.waitForResponse((r) => r.url().endsWith(`/api/shops/${b.handle}/follow`));
  await page.locator('#vFollow').click();
  await expect(page.locator('#vFollow')).toHaveText('Pratiš');   // odmah (optimistično)
  const r = await odgovor;
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ following: true, followers: followers0 + 1 });
  await expect(page.locator('#vFollowers')).toHaveText(String(followers0 + 1));
  await expect(page.locator('#toast')).toHaveText(`Pratiš ${b.name}. Novi snimci su u kartici Praćeni.`);

  // Poslije ponovnog učitavanja stanje je isto.
  await page.reload();
  await expect(page.locator('#vFollow')).toHaveText('Pratiš');
  await expect(page.locator('#vFollowers')).toHaveText(String(followers0 + 1));

  // Profil kupca (U-01): „sviđa ti se” i „pratiš”, bez riječi „oglasa”.
  await otvoriProfil(page);
  await expect(page.locator('#pGridTitle')).toHaveText('Sviđa mi se');
  await expect(page.locator('#pCountLbl')).toHaveText('sviđa ti se');
  await expect(page.locator('#pFollow')).toHaveText('1');
  await expect(page.locator('#pFollowLbl')).toHaveText('pratiš');
  await expect(page.locator('#me')).not.toContainText('oglasa');
  await expect(page.locator('#pEdit')).toBeVisible();
  await expect(page.locator('#pStatsOpen')).toBeHidden();
  await expect(page.locator('#pBadge')).toBeHidden();
  await page.locator('#pSwitch').click();
  await expect(page.locator('#pGridTitle')).toHaveText('Pratim');
  await expect(page.locator('#fList .f-item')).toHaveCount(1);
  await expect(page.locator('#fList .f-item')).toContainText(b.name);
  await expect(page.locator('#fList .f-item')).toContainText('Kralja Petra I 12');
  // Otpraćivanje iz spiska.
  await page.locator('#fList [data-follow]').click();
  await expect(page.locator('#toast')).toHaveText(`Više ne pratiš ${b.name}.`);
  await expect(page.locator('#pFollow')).toHaveText('0');
  await page.locator('#pSwitch').click();
  await page.locator('#pSwitch').click();
  await expect(page.locator('#fEmpty')).toHaveText('Još ne pratiš nijedan butik.');

  // Praćenje s profila butika, pa otpraćivanje dodirom na „Pratiš” bez potvrde.
  await page.goto(`/?b=${b.handle}`);
  await page.locator('#vFollow').click();
  await expect(page.locator('#vFollow')).toHaveText('Pratiš');
  await page.locator('#vFollow').click();
  await expect(page.locator('#vFollow')).toHaveText('Prati');
  await expect(page.locator('#toast')).toHaveText(`Više ne pratiš ${b.name}.`);
  expect((await (await context.request.get('/api/me/follows')).json()).butici).toEqual([]);
});

test('kupac vidi adresu i status u prozoru „Kontaktiraj butik”', async ({ page, context }) => {
  await registrujApi(context.request, 'kontakt.e2e@e2e.ba', 'Kontakt E2E');
  await page.goto(`/?o=${oglas.id}`);
  const card = page.locator(`.card[data-id="${oglas.id}"]`);
  await expect(card).toBeVisible();
  await card.locator('[data-act="contact"]').click();
  await expect(page.locator('#contactSheet')).toBeVisible();
  const mapa = page.locator('#contactList a[href^="https://www.google.com/maps/"]');
  await expect(mapa).toContainText('Kralja Petra I 12');
  await expect(page.locator('#contactList .c-status')).toHaveText(/^(Otvoreno do 23:59|Zatvoreno.*)$/);
  await expect(page.locator('#contactList')).toContainText('065 123 456');
});

test('nepostojeći butik: poruka i „Na početnu”', async ({ page }) => {
  await page.goto('/?b=nema.ga');
  await expect(page.locator('#shopView')).toBeVisible();
  await expect(page.locator('#vMissing h2')).toHaveText('Ovaj butik ne postoji');
  await expect(page.locator('#vMissing .hint')).toHaveText('Možda je link pogrešan ili butik više nije na Komodu.');
  await expect(page.locator('#vAvatar')).toBeHidden();
  await expect(page.locator('#vCount')).toBeHidden();
  await expect(page.locator('#vMsg')).toBeHidden();
  await expect(page.locator('#vGrid')).toBeHidden();
  await expect(page.locator('#vFollow')).toBeHidden();
  await page.locator('#vHome').click();
  await expect(page.locator('#feed')).toBeVisible();
  await expect(page.locator('.card[data-id]').first()).toBeVisible();
});

test('brisanje naloga kupca koji prati butik umanjuje broj pratilaca', async ({ page, context }) => {
  const b = butik();
  await registrujApi(context.request, 'brisi.e2e@e2e.ba', 'Brisi E2E');
  const prije = (await (await context.request.get(`/api/shops/${b.handle}`)).json()).butik.followers;
  await context.request.post(`/api/shops/${b.handle}/follow`, { data: { following: true } });
  expect((await (await context.request.get(`/api/shops/${b.handle}`)).json()).butik.followers).toBe(prije + 1);
  await page.goto('/');
  await otvoriProfil(page);
  await page.locator('#delToggle').click();
  await page.locator('#delPass').fill(LOZINKA);
  await page.locator('#delForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toHaveText('Nalog je obrisan.');
  const poslije = await (await page.request.get(`/api/shops/${b.handle}`)).json();
  expect(poslije.butik.followers).toBe(prije);
});
