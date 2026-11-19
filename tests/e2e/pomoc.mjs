// Zajedničko za e2e: stranica bez vanjskih zahtjeva (fontovi), brze radnje preko API-ja, praćenje grešaka.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

export const VIDEO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api', 'test', 'pomoc', 'mali.mp4');
export const LOZINKA = 'lozinka123';

export const test = base.extend({
  baseURL: async ({}, use) => { await use(process.env.E2E_URL); },
  context: async ({ context }, use) => {
    // Samo naš server: vanjski fontovi bi usporili ili zaustavili učitavanje bez mreže.
    const own = new URL(process.env.E2E_URL).host;
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.host === own || u.protocol === 'blob:' || u.protocol === 'data:') return route.continue();
      return route.abort();
    });
    await use(context);
  },
  page: async ({ page }, use) => {
    const greske = [];
    page.on('pageerror', (e) => greske.push(String(e)));
    await use(page);
    expect(greske, 'JavaScript greške na stranici').toEqual([]);
  },
});
export { expect };

export const butik = () => ({
  email: process.env.E2E_BUTIK_EMAIL,
  password: process.env.E2E_BUTIK_LOZINKA,
  handle: process.env.E2E_BUTIK_HANDLE,
  name: 'Moda Bojana',
});

// Prijava preko API-ja u kontekstu stranice (kolačić važi i za stranicu).
export async function prijaviApi(request, email, password) {
  const r = await request.post('/api/auth/login', { data: { email, password } });
  expect(r.status(), `prijava ${email}`).toBe(200);
}
export async function registrujApi(request, email, name) {
  const r = await request.post('/api/auth/register', { data: { email, password: LOZINKA, name } });
  expect(r.status(), `registracija ${email}`).toBe(201);
}

// Objava oglasa preko API-ja (za pripremu podataka), u ime prijavljenog butika iz `request`.
export async function objaviApi(request, title, price = '65', category = 'Haljine') {
  const r = await request.post('/api/listings', {
    multipart: {
      title, price, category,
      video: { name: 'snimak.mp4', mimeType: 'video/mp4', buffer: await readFile(VIDEO) },
    },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).oglas;
}

export async function otvoriProfil(page) {
  await page.locator('.tab[data-go="profile"]').click();
  await expect(page.locator('#profile')).toBeVisible();
}
