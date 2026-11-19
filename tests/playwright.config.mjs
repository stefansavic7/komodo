// E2E testovi u pregledniku (Playwright). Pokretanje: cd tests && npx playwright test
// globalSetup pravi svježu bazu, pokreće API i otvara butik; globalTeardown sve gasi i briše bazu.
// CHROME_PATH=/usr/bin/google-chrome koristi instalirani Chrome umjesto Playwrightovog Chromiuma.
import { defineConfig } from '@playwright/test';

const chrome = process.env.CHROME_PATH;

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.mjs',
  globalSetup: './e2e/priprema.mjs',
  // Svi testovi dijele jednu bazu i API, pa idu jedan za drugim.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    viewport: { width: 390, height: 844 },
    isMobile: false,
    locale: 'bs-BA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chrome
      ? { executablePath: chrome, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
});
