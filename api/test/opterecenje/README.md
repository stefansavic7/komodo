# Test istovremenosti i test opterećenja

Tri skripte (pokreću se iz foldera `api`):

| Skripta | Šta radi |
|---|---|
| `napuni-bazu.mjs` | Puni **praznu probnu** bazu: 100 butika, 10.000 kupaca, 10.000 oglasa, ~300.000 sviđanja, sesije `'tok'‖id` za sve. Odbija bazu koja nije na `localhost`/`127.0.0.1`, čije ime ne sadrži `load`, `test` ili `proba`, i bazu u kojoj već ima korisnika. **Nikad na produkcijskoj bazi.** |
| `istovremenost.mjs` | Provjerava ispravnost pri istovremenim zahtjevima: 2.000 sviđanja istog oglasa, dupli dodiri, 200 otvaranja istog razgovora, 1.000 poruka, istovremene registracije (isti email, isto ime), 200 prijava, korisnici iza iste IP adrese, pregledi, `likes_count` = broj redova. Izlazni kod 1 ako nešto ne valja. |
| `opterecenje.mjs` | Generator opterećenja: jedna ruta što brže (`endpoint`) ili realni korisnici s pauzama (`mix`). Ispisuje broj zahtjeva, p50/p95/p99 i greške (5xx i prekinute veze) po ruti. Izlazni kod 1 ako je bilo grešaka. |

Kolačić `sid=tok123` je prijava korisnika s id-jem 123 (sesije pravi `napuni-bazu.mjs`; u bazi se čuva sha256 heks tokena, S-18). Starija probna baza sa sirovim tokenima se pretvara migracijom 010 pri prvom startu API-ja. U produkcijskom načinu API traži `SMTP_URL` i `COOKIE_SECRET`; neprijavljeni pregledi traže potpisan `did`.

## Test istovremenosti (lokalno)

Najjednostavnije — skripta sama napravi svježu bazu, napuni je (2.200 kupaca, 10 butika, 300 oglasa),
pokrene API s `NODE_ENV=production` (da API vjeruje zaglavlju `X-Forwarded-For`, pa zahtjevi izgledaju kao
da dolaze s različitih adresa), provjeri sve i na kraju obriše bazu:

```bash
cd api
npm run test:istovremenost
```

Veza na Postgres se uzima iz `TEST_DATABASE_URL` (korisnik mora smjeti praviti baze), zadano
`postgres://postgres@127.0.0.1:55432/postgres`. Na Windows laptopu (PowerShell), s lozinkom baze:

```powershell
cd api
$env:TEST_DATABASE_URL = "postgres://postgres:LOZINKA@127.0.0.1:5432/postgres"
npm run test:istovremenost
```

Protiv već pokrenutog API-ja: baza mora biti napunjena skriptom `napuni-bazu.mjs`, a API pokrenut s
`NODE_ENV=production` (ili iza proksija koji prosljeđuje `X-Forwarded-For`). Skripta direktno čita i mijenja
tu bazu (briše i pravi sviđanja, razgovore i probne naloge `isti@proba.ba`, `ime*@proba.ba`, `cgnat*@proba.ba`):

```bash
BASE_URL=http://127.0.0.1:3910 DATABASE_URL=postgres://postgres@127.0.0.1:55432/komodo_load node test/opterecenje/istovremenost.mjs
```

## Test opterećenja (lokalno)

1. Napravi praznu probnu bazu i napuni je (traje nekoliko sekundi):

   ```bash
   psql -h 127.0.0.1 -p 55432 -U postgres -c "create database komodo_load_proba"
   node test/opterecenje/napuni-bazu.mjs postgres://postgres@127.0.0.1:55432/komodo_load_proba
   ```

   Manje podataka: `--kupaca 2000 --butika 10 --oglasa 500 --svidjanja 10000`.

2. Pokreni API nad tom bazom u više procesa (`src/index.js`), s `NODE_ENV=production`:

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:55432/komodo_load_proba PORT=3910 NODE_ENV=production node src/index.js
   ```

3. Iz drugog terminala:

   ```bash
   # 10.000 korisnika 120 s, tajmeri klijenta iz docs/SKALIRANJE.md
   BASE_URL=http://127.0.0.1:3910 LIGHT=1 node test/opterecenje/opterecenje.mjs mix 10000 120
   # jedna ruta: 200 istovremenih zahtjeva 20 s
   BASE_URL=http://127.0.0.1:3910 node test/opterecenje/opterecenje.mjs endpoint feed_user 200 20
   ```

   Rute za `endpoint`: `feed_anon`, `feed_user`, `feed_page`, `feed_category`, `search`, `likes_poll`, `me`,
   `like`, `view`, `conversations`, `shop`. Rasponi id-jeva: `LMIN`/`LMAX` (oglasi, zadano 1–10000),
   `UMIN`/`UMAX` (kupci, zadano 101–10100), `BUTIKA` (zadano 100) — zadane vrijednosti odgovaraju
   `napuni-bazu.mjs` bez dodatnih opcija.

   Isto preko npm-a: `npm run test:opterecenje -- mix 1000 60` (uz `BASE_URL` u okruženju).

Generator i API na istoj mašini dijele procesor, pa su lokalni brojevi samo orijentacija.

## Na pravom serveru (uslov 2 iz docs/PLAN-PRODUKCIJA.md)

Opterećenje se pušta **s druge mašine** (npr. privremeni mali server ili laptop na dobroj vezi), nikad sa
samog servera, i **prije lansiranja**, nad probnom bazom — ne nad produkcijskom.

- Na drugoj mašini treba samo Node 22 i ovaj folder (skripta `opterecenje.mjs` nema zavisnosti):

  ```bash
  BASE_URL=https://komodo.ba LIGHT=1 node api/test/opterecenje/opterecenje.mjs mix 20000 300
  ```

  Generator je jedan Node proces: ako je njegov procesor pun, mjerenje laže. Tada ga pokreni u više
  procesa ili na više mašina (npr. 4 × `mix 5000`) i saberi rezultate.
- Server mora imati probne podatke sa sesijama `'tok'‖id`. `napuni-bazu.mjs` namjerno odbija bazu
  koja nije na `localhost`, a na serveru je baza u Docker kontejneru (`db`), pa način punjenja probne
  baze na serveru (npr. prenos lokalno napunjene baze u zasebnu bazu na serveru i privremeno
  preusmjeravanje API-ja) određuje DevOps i upisuje u `docs/RUNBOOK.md`. Poslije testa probna baza se briše.
- Nginx postavlja stvarnu adresu klijenta, pa svi zahtjevi izgledaju kao da dolaze s jedne adrese (druge
  mašine). Ograničenja po IP adresi (prijava, registracija) zato test ne smije gađati; `mix` ih ne gađa.
- Cilj: p95 < 300 ms i 0 grešaka (5xx i prekinute veze) za 20.000 korisnika.
