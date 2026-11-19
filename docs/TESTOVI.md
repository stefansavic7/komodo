# Testovi Komoda

Svi testovi rade „spolja”, preko HTTP-a i preglednika: sami naprave **svježu bazu** (`komodo_test_…`),
pokrenu API kao poseban proces (`api/src/server.js`), a na kraju ga ugase i bazu obrišu. Ne diraju bazu
`snimi` ni `api/.env`. Email i Bunny nisu podešeni (osim u testu koji pokreće lažni SMTP server).

| Šta | Gdje | Pokretanje (iz foldera) |
|---|---|---|
| API testovi (node:test, 121 test, ~7 s u cloud sesiji) | `api/test/*.test.mjs` | `api`: `npm test` |
| Test istovremenosti | `api/test/opterecenje/istovremenost.mjs` | `api`: `npm run test:istovremenost` |
| Test opterećenja | `api/test/opterecenje/opterecenje.mjs` | vidi `api/test/opterecenje/README.md` |
| Punjenje probne baze (samo lokalno) | `api/test/opterecenje/napuni-bazu.mjs` | vidi isti README |
| E2E u pregledniku (Playwright, 390×844) | `tests/e2e/*.spec.mjs` | `tests`: `npx playwright test` |
| CI na svaki push i pull request | `.github/workflows/ci.yml` | GitHub Actions |

## API testovi — šta pokrivaju

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
   repozitoriju, `npm test`, `npm run test:istovremenost`;
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
