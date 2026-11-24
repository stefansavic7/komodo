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
   # 10.000 korisnika 180 s, klijent v1 (feed „Za tebe”), p95 i po prozorima od 15 s
   BASE_URL=http://127.0.0.1:3910 LIGHT=1 FEED=1 PROZORI=1 node test/opterecenje/opterecenje.mjs mix 10000 180
   # jedna ruta: 200 istovremenih zahtjeva 20 s
   BASE_URL=http://127.0.0.1:3910 node test/opterecenje/opterecenje.mjs endpoint feed_user 200 20
   ```

   **`mix` mora trajati ≥ 180 s** (generator upozori ako je kraće): sljedeća strana feeda dolazi poslije 20 videa
   (~160 s), pa kraće mjerenje vidi samo prve strane. `LIGHT=1` rasipa kao pravi klijent (`web/js/osnova.js`,
   `tajmer`; nalaz iz `docs/RECENZIJA-3.md`, „Mjerenja”): korisnik otvara aplikaciju u nasumičnom trenutku
   0–`START_S` s (zadano 30; tada prva strana feeda i `/api/me`), prvi poziv svakog tajmera je u nasumičnom trenutku
   20–100 % intervala, a svaki sljedeći interval ±20 %. Ranije su svi tajmeri 10.000 korisnika okidali u istih 15 s,
   pa je p95 mjerio talase generatora, ne API. `PROZORI=1` ispisuje i p95/broj zahtjeva po prozorima od 15 s
   (feed posebno). Prvi prolaz na svježe napunjenoj bazi je „hladan” (vidi mjerenje ispod) — za poređenje verzija
   uzimati drugi prolaz.

   Izmjereno 24.11.2026. (2 jezgra, generator + API `WORKERS=2`, `NODE_ENV=production` + Postgres zajedno, uz
   tuđe procese na mašini; svježa baza iz `napuni-bazu.mjs`; `mix 10000 180`, `LIGHT=1 FEED=1`, novi generator):

   | Prolaz | feed | likes | me | like | view | ukupno | greške | load 1 min prije → poslije |
   |---|---|---|---|---|---|---|---|---|
   | 1 (hladan, odmah poslije punjenja baze) | 1.789 | 3.119 | 3.204 | 2.602 | 4.619 ms | 995/s | 0 | 2,12 → 4,82 (najviše 8,00) |
   | 2 (API i baza zagrijani) | 12 | 8 | 8 | 10 | 15 ms | 1.010/s | 0 | 2,61 → 2,91 |

   (p95.) U prvom prolazu sporo je samo prvih 60 s (p95 ostalih ruta po prozorima: 95, 2.548, 5.462, 3.419 ms, pa
   od 60. s 8–266 ms); u drugom svi prozori ≤ 23 ms.

   Rute za `endpoint`: `feed_anon`, `feed_user`, `feed_page`, `feed_category`, `search`, `likes_poll`, `me`,
   `like`, `like_viral`, `view`, `conversations`, `shop`, `feed_zatebe_anon`, `feed_zatebe`, `feed_zatebe_cat`,
   `feed_novo`, `feed_praceni`. `like_viral` (talas 4, „vruć brojač”): različiti kupci prekidačem označavaju ISTI
   oglas (`VIRAL=<id>`, zadano `LMIN`) — porediti sa `like` (nasumični oglasi) na istom broju istovremenih:

   ```bash
   BASE_URL=http://127.0.0.1:3910 node test/opterecenje/opterecenje.mjs endpoint like 200 15
   BASE_URL=http://127.0.0.1:3910 node test/opterecenje/opterecenje.mjs endpoint like_viral 200 15
   ```

   Izmjereno 24.11.2026. (2 jezgra, generator + API `WORKERS=2` + Postgres zajedno, 200 istovremenih, 15 s, dva
   prolaza): prije (`update listings` po sviđanju) `like` 1.814 / 1.842 zahtjeva/s (p95 178 / 209 ms), `like_viral`
   1.099 / 1.057/s (p95 289 / 360 ms; čekanje na red: `Lock:transactionid`); poslije (`listing_likes_delta`, talas 4)
   `like` 1.698 / 1.763/s (p95 240 / 187 ms), `like_viral` 1.607 / 1.463/s (p95 199 / 230 ms). Rasponi id-jeva: `LMIN`/`LMAX` (oglasi, zadano 1–10000),
   `UMIN`/`UMAX` (kupci, zadano 101–10100), `BUTIKA` (zadano 100) — zadane vrijednosti odgovaraju
   `napuni-bazu.mjs` bez dodatnih opcija.

   Isto preko npm-a: `npm run test:opterecenje -- mix 1000 180` (uz `BASE_URL` u okruženju).

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
