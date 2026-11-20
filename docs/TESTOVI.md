# Testovi Komoda

Svi testovi rade „spolja”, preko HTTP-a i preglednika: sami naprave **svježu bazu** (`komodo_test_…`),
pokrenu API kao poseban proces (`api/src/server.js`), a na kraju ga ugase i bazu obrišu. Ne diraju bazu
`snimi` ni `api/.env`. Email i Bunny nisu podešeni (osim u testu koji pokreće lažni SMTP server).

| Šta | Gdje | Pokretanje (iz foldera) |
|---|---|---|
| API testovi (node:test, 222 testa u 18 fajlova, ~32 s u cloud sesiji) | `api/test/*.test.mjs` | `api`: `npm test` |
| Test istovremenosti | `api/test/opterecenje/istovremenost.mjs` | `api`: `npm run test:istovremenost` |
| Test opterećenja | `api/test/opterecenje/opterecenje.mjs` | vidi `api/test/opterecenje/README.md` |
| Punjenje probne baze (samo lokalno) | `api/test/opterecenje/napuni-bazu.mjs` | vidi isti README |
| Testovi mobilne navigacije (6 testova, bez zavisnosti) | `mobile/navigacija.test.mjs` | repozitorij: `node --test mobile/navigacija.test.mjs` |
| E2E u pregledniku (Playwright, 390×844) | `tests/e2e/*.spec.mjs` (9 fajlova, 33 testa) | `tests`: `npx playwright test` |
| CI na svaki push i pull request | `.github/workflows/ci.yml` | GitHub Actions |

## Spisak test fajlova (stanje 20.11.2026.)

API (`api/test/`, ukupno 222): `admin` 14, `backend-sema` 10, `backend-sigurnost` 24, `butik-pracenje` 9,
`butik-profil` 8, `butik-sati` 11, `feed-algoritam` 16, `feed-r01-klaster` 4, `nalog` 23, `og-pregled` 15,
`oglas-snizenje` 8, `oglas-velicine` 4, `oglasi` 25, `poruke-r04-blokiranje` 7, `poruke` 14, `sigurnost` 15,
`statistika-admin` 7, `statistika-me` 8.

E2E (`tests/e2e/`): `admin`, `butik-profil`, `butik`, `feed`, `feed-kraj`, `kupac`, `nadogradnja`, `oglas`,
`poruke-statistika`. Mobilni: `mobile/navigacija.test.mjs` (6).

Dodano uz Recenziju 2 (`docs/RECENZIJA-2.md`, „Stanje popravki”): `feed-algoritam` — straničenje „Za tebe” s 330
vidljivih oglasa (C∪D = 300) do `kraj:true` bez ponavljanja i bez prazne strane (R2-01, R2-08); `oglas-snizenje` —
„digni pa spusti” i rok 72 h (R2-07), sniženje oglasa u obradi uz lažni Bunny bez pusha (R2-08); `butik-pracenje` —
praćenje butika koji se upravo briše → 404 (R2-06, deterministički: brisanje drži red zaključan); `admin` — gašenje
i brisanje butika čiste keš feeda i OG (R2-03); `backend-sema` — migracija 012. E2E `feed-kraj` — kraj „Za tebe” na
pravom serveru (330 oglasa) i na „pokvarenom” (lažni `/api/feed` uvijek isti, `kraj:false`): ≤ 2 zahtjeva u 10 s
mirovanja (R2-01); vlastita baza i API, ne dira zajedničke podatke.

## API testovi — šta pokrivaju (osnovni fajlovi; ostali su imenovani po temi, vidi spisak iznad)

- `nalog.test.mjs` — registracija (provjere, dupli email, isto ime), potvrda emaila (link iz emaila, ponovno
  slanje, nepotvrđen ne šalje poruke), prijava i odjava, zaboravljena lozinka (link, jednokratni token,
  gašenje starih sesija), `/api/me` i izmjena profila (kupac/butik, telefon, linkovi), promjena lozinke,
  brisanje naloga (vraća `likes_count`, briše oglase butika), ograničenja 429 (registracija po uređaju,
  prijava, ponovno slanje, zaboravljena lozinka). Pokreće lažni SMTP server (`pomoc/smtp.mjs`).
- `oglasi.test.mjs` — objava (multipart, provjera polja, vrsta fajla, fajl se ne ostavlja na disku),
  izmjena, prodato, brisanje, dozvole (kupac ne objavljuje, tuđi oglas 404), feed i filteri (`category`,
  `q`, `min`/`max`, `shop`, `liked`, `before`, `ukupno`), sviđanja (`{liked}`, prekidač, `/api/likes`),
  pregledi (`/api/views`, kolačić `did`, vlasnik se ne broji, 429).
- `poruke.test.mjs` — razgovor (jedan po paru, započinje kupac), poruke, nepročitane, `after=`,
  blokiranje, tuđi razgovor 404, 429; prijave oglasa i poruka, 429.
- `admin.test.mjs` — admin rute za ostale 404, prijave (spisak, odbaci, ukloni oglas/poruku), otvaranje
  butika (API i skripta `novi-butik.js`), spisak naloga, gašenje i vraćanje naloga.
- `sigurnost.test.mjs` — bez sesije 401, kolačić `sid` (HttpOnly, SameSite), lažna sesija, lozinka se ne
  vraća, push token, 413/400 za loš ulaz, čudni parametri pretrage, putanje van `/media/`, razvoj bez emaila
  (link za lozinku u zapisu API-ja).

Poznate greške aplikacije su označene kao `todo` (node:test) ili `test.fail` (Playwright) s opisom — ne
obaraju CI. Kad se greška popravi, `test.fail` počne „neočekivano prolaziti” i CI to javi: tada se oznaka
skida.

## Pokretanje lokalno

Treba: Node 22 i PostgreSQL. Korisnik baze mora smjeti praviti baze (`postgres`).

Veza se zadaje u `TEST_DATABASE_URL` (baza u adresi je samo za spajanje; testovi prave svoje).
Zadano: `postgres://postgres@127.0.0.1:55432/postgres` (cloud sesija).

### Windows laptop (PowerShell)

```powershell
cd api
npm install
$env:TEST_DATABASE_URL = "postgres://postgres:LOZINKA@127.0.0.1:5432/postgres"
npm test
npm run test:istovremenost
```

E2E (jednom `npm install` i preglednik, pa testovi; `TEST_DATABASE_URL` kao gore):

```powershell
cd tests
npm install
npx playwright install chromium
npx playwright test
```

`LOZINKA` je lozinka korisnika `postgres` na laptopu (ista kao u `DATABASE_URL` u `api/.env`).
Varijabla važi dok je prozor PowerShella otvoren.

### Linux / cloud sesija

```bash
cd api && npm test && npm run test:istovremenost
cd ../tests && CHROME_PATH=/usr/bin/google-chrome npx playwright test
```

`CHROME_PATH` koristi već instalirani Chrome umjesto Playwrightovog Chromiuma.

### Korisne varijable

| Varijabla | Značenje |
|---|---|
| `TEST_DATABASE_URL` | veza na Postgres s pravom pravljenja baza |
| `KOMODO_TEST_PORTS` | raspon portova za API, npr. `3952-3959` (zadano: slobodan port po izboru sistema) |
| `KOMODO_ROOT` | korijen repozitorija čiji se API pokreće (npr. nepromjenljiv snimak u `/tmp`) |
| `KOMODO_API_ENTRY` | ulazni fajl API-ja (zadano `api/src/server.js`) |
| `KOMODO_TEST_LOG=1` | ispisuje zapis API-ja tokom testova |
| `CHROME_PATH` | (e2e) putanja do Chromea |

## CI (GitHub Actions)

`.github/workflows/ci.yml`, na svaki push i pull request, bez tajni:

1. posao **api**: Postgres 16 kao servis, `npm ci` u `api/`, `node --check` svih `.js/.mjs/.cjs` u
   repozitoriju osim `mobile/` (`node --check` tamo lažno prolazi za kod bez `"type": "module"` i ne čita JSX, R-11),
   `node --test mobile/navigacija.test.mjs`, `npm test`, `npm run test:istovremenost`;
2. posao **e2e**: Postgres 16, `npm ci` u `api/` i `tests/`, `npx playwright install --with-deps chromium`,
   `npx playwright test`; ako padne, izvještaj i snimci ekrana su u artefaktu `playwright-izvjestaj`.

## Pravila za nove testove

- Svaki test fajl pravi svoju bazu i svoj API (`okolina()` iz `api/test/pomoc/okolina.mjs`), pa su fajlovi
  nezavisni i idu paralelno. Unutar fajla testovi idu redom.
- Javni feed ima keš od 5 s po kombinaciji filtera: test koji provjerava feed neka koristi svoju
  kombinaciju (npr. jedinstvenu riječ u `q=`).
- Ograničenja učestalosti su u bazi i važe za `127.0.0.1`: jedan fajl smije napraviti najviše 60
  registracija.
- Test koji ponekad padne je greška u testu ili kodu — istraži, ne ponavljaj.
