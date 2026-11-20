// R2-01 (docs/RECENZIJA-2.md): kraj „Za tebe” ne smije izazvati petlju zahtjeva /api/feed. Na kraju liste, za 10 s
// mirovanja, klijent smije poslati najviše 2 zahtjeva /api/feed.
//  1. Pravi server s 330 vidljivih oglasa (C∪D = 300): vlastita baza i API (da ne mijenja podatke drugih testova).
//  2. „Pokvaren” server (lažni /api/feed uvijek vraća istih 20 oglasa i kraj:false — ono što je izazivalo petlju):
//     odbrana u klijentu mora sama zaustaviti učitavanje.
import { novaBaza, pokreniApi } from '../../api/test/pomoc/okolina.mjs';
import { expect, test } from './pomoc.mjs';

const FEED = /\/api\/feed(\?|$)/;

// Skroluje do dna dok se broj kartica ne prestane mijenjati (i dok ne stigne razdjelnik).
async function doKraja(page) {
  let prije = -1;
  let isto = 0;
  for (let k = 0; k < 200 && isto < 4; k += 1) {
    await page.evaluate(() => { const f = document.getElementById('feed'); f.scrollTop = f.scrollHeight; });
    await page.waitForTimeout(250);
    const n = await page.locator('#feed .card').count();
    const razdjelnik = await page.locator('.razdjelnik').count();
    if (n === prije && razdjelnik) isto += 1; else isto = 0;
    prije = n;
  }
}

async function izmjeriMirovanje(page, brojac) {
  await page.waitForTimeout(1500); // eventualni zadnji (odgođeni) zahtjev
  const start = brojac.n;
  await page.waitForTimeout(10 * 1000);
  return brojac.n - start;
}

test('pravi server, 330 oglasa: sve do kraja bez ponavljanja, pa ≤ 2 zahtjeva u 10 s mirovanja', async ({ browser }) => {
  test.setTimeout(150 * 1000);
  const baza = await novaBaza('komodo_test_e2e_kraj');
  let api;
  let ctx;
  try {
    api = await pokreniApi(baza);
    const shops = (await baza.q(
      `insert into users(email, password_hash, shop_name, handle, role, created_at)
       select 'kraj' || g || '@e2e.ba', 'x', 'Kraj ' || g, 'kraj' || g, 'butik', now() - interval '60 days'
         from generate_series(1, 8) g returning id`,
    )).rows.map((r) => r.id);
    await baza.q(
      `with n as (
         insert into listings(user_id, title, price_cents, category, video_path, video_status, sizes, created_at, views)
         select ($1::int[])[1 + g % 8], 'Kraj ' || g, 5000, (array['Haljine','Obuća','Torbe'])[1 + g % 3], 'nema.mp4', 'ready',
                array['M'], now() - make_interval(hours => case when g <= 230 then 100 else 2 end),
                case when g <= 230 then 100 else 3 end
           from generate_series(1, 330) g
         returning id, title)
       insert into listing_scores(listing_id, base_score)
       select id, case when substr(title, 6)::int <= 230 then 0.5 + random() else 0.01 end from n`,
      [shops],
    );
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'bs-BA' });
    const own = new URL(api.url).host;
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      return u.host === own ? route.continue() : route.abort();
    });
    // Snimci ne postoje (nema.mp4): 404 bez tijela, da preglednik ne troši vrijeme.
    await ctx.route('**/media/**', (route) => route.fulfill({ status: 404, body: '' }));
    const page = await ctx.newPage();
    const greske = [];
    page.on('pageerror', (e) => greske.push(String(e)));
    const brojac = { n: 0, zatebe: 0 };
    page.on('request', (r) => {
      if (!FEED.test(r.url())) return;
      brojac.n += 1;
      if (r.url().includes('kartica=zatebe')) brojac.zatebe += 1;
    });
    await page.goto(api.url + '/');
    await expect(page.locator('.card[data-id]').first()).toBeVisible();
    await doKraja(page);

    await expect(page.locator('.razdjelnik')).toHaveCount(1);
    const idjevi = await page.locator('.card[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    expect(new Set(idjevi).size).toBe(idjevi.length);
    expect(idjevi.length).toBeGreaterThanOrEqual(300);
    expect(brojac.zatebe).toBeLessThanOrEqual(16); // 15 strana po 20 + strana s kraj:true

    const uMirovanju = await izmjeriMirovanje(page, brojac);
    expect(uMirovanju, `zahtjeva /api/feed u 10 s mirovanja (ukupno ${brojac.n})`).toBeLessThanOrEqual(2);

    // „Prikaži starije oglase” (ako je učitavanje stalo na duplikatima „Novo”) nastavlja na dodir.
    if (await page.locator('[data-act="jos"]').count()) {
      const prije = brojac.n;
      await page.locator('[data-act="jos"]').click();
      await expect.poll(() => brojac.n).toBeGreaterThan(prije);
    }
    expect(greske).toEqual([]);
  } finally {
    await ctx?.close();
    await api?.stop();
    await baza.drop();
  }
});

test('„pokvaren” server (uvijek isti oglasi, kraj:false): klijent staje, ≤ 2 zahtjeva u 10 s', async ({ page }) => {
  test.setTimeout(60 * 1000);
  const oglasi = Array.from({ length: 20 }, (_, k) => ({
    id: 900000 + k, title: `Isti ${k}`, price: 10, category: 'Haljine', videoUrl: '/media/nema.mp4', posterUrl: null,
    processing: false, videoError: false, createdAt: new Date().toISOString(), shopName: 'Petlja', handle: 'petlja',
    likes: 0, liked: false, mine: false, sold: false, sizes: [], oldPrice: null, soldAt: null,
  }));
  const brojac = { n: 0 };
  await page.route(FEED, (route) => {
    brojac.n += 1;
    const url = route.request().url();
    const body = url.includes('kartica=zatebe') ? { oglasi, kraj: false } : { oglasi };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/media/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.locator('.card[data-id]').first()).toBeVisible();
  await doKraja(page);
  // Prva strana + jedna „Za tebe” bez novih (= kraj) + najviše dvije „Novo” bez novih, pa stop.
  expect(brojac.n).toBeLessThanOrEqual(5);
  await expect(page.locator('.razdjelnik')).toHaveCount(1);
  await expect(page.locator('[data-act="jos"]')).toHaveCount(1);
  const uMirovanju = await izmjeriMirovanje(page, brojac);
  expect(uMirovanju).toBeLessThanOrEqual(2);
});
