// R-03: ekran obavezne nadogradnje u omotaču ne smije otvoriti neispravnu adresu prodavnice.
import { expect, test } from './pomoc.mjs';

async function otvori(page, pravilo) {
  await page.route('**/app-verzija.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ios: pravilo, android: pravilo }),
  }));
  await page.addInitScript(() => {
    window.KOMODO_APP = { version: '1.0.0', platform: 'ios' };
    window.__poruke = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__poruke.push(JSON.parse(m)) };
  });
  await page.goto('/');
  await expect(page.locator('#updateGate')).toBeVisible();
}

// R2-04: neispravna ili izostavljena adresa → dugme ostaje i šalje { type: 'update' } bez adrese; omotač
// (mobile/App.js, storeUrl) otvara svoju rezervnu adresu prodavnice.
for (const [opis, pravilo] of [
  ['neispravna adresa (<APP_STORE_ID>)', { min: '9.0.0', url: 'https://apps.apple.com/app/id<APP_STORE_ID>' }],
  ['bez adrese', { min: '9.0.0' }],
]) {
  test(`${opis}: dugme šalje omotaču update bez adrese`, async ({ page }) => {
    await otvori(page, pravilo);
    await expect(page.locator('#gateGo')).toBeVisible();
    await page.locator('#gateGo').click();
    const poruke = await page.evaluate(() => window.__poruke);
    expect(poruke.find((p) => p.type === 'update')).toEqual({ type: 'update' });
  });
}

test('prava adresa App Storea: dugme šalje omotaču tu adresu', async ({ page }) => {
  await otvori(page, { min: '9.0.0', url: 'https://apps.apple.com/app/komodo/id123456789' });
  await expect(page.locator('#gateGo')).toBeVisible();
  await page.locator('#gateGo').click();
  const poruke = await page.evaluate(() => window.__poruke);
  expect(poruke.find((p) => p.type === 'update')).toEqual({ type: 'update', url: 'https://apps.apple.com/app/komodo/id123456789' });
});
