# Recenzija 2 — izmjene 422bb1f..f9fbb35 (talasi 2 i 3, integracija)

Recenzent: nezavisni pregled, 20.11.2026. Pregledano: feed s algoritmom (`api/src/rute/feed.js`, `base_score` u
`api/src/poslovi.js`, migracija 011), praćenje i profil butika (`rute/butici.js`, `rute/profil.js`), pregled linka
(`rute/og.js`, `rute/staticki.js`), statistika i brojke administratora (`rute/statistika.js`, `daily_stats`),
poruke (brza pitanja, R-04), oglas (veličine, sniženje, `snizenje.js`, `posaljiPush`), U-04 (`komodo.posle`,
hvatanje klikova u `prijava.js`), poruke između radnika (`javiSvima`/`naPoruku`, R-01), mobilni omotač
(`mobile/navigacija.js`, `App.js`), Nginx, CI, novi testovi i web ekrani.

## Sažetak

**Spremno za spajanje: NE dok se ne riješi R2-01** (klijent u „Za tebe” upada u beskonačnu petlju zahtjeva —
potvrđeno u pregledniku, ~60 zahtjeva/s po korisniku). Popravka je mala. Poslije R2-01: **DA, uz uslov** da se
R2-02 riješi (ili izmjeri na pravom serveru i prihvati) prije objave.

| Ozbiljnost | Broj | Nalazi |
|---|---|---|
| blokira | 1 | R2-01 |
| prije objave | 1 | R2-02 |
| može kasnije | 6 | R2-03 … R2-08 |

Pokrenuto (sve zeleno):

| Komanda | Ishod |
|---|---|
| `cd api && npm test` | 215 testova, 215 prošlo, 0 preskočeno, ~25,7 s |
| `npm run test:istovremenost` | sve provjere OK (2.000 sviđanja, prekidači, 200 otvaranja razgovora, 1.000 poruka, registracije, prijave, CGNAT pregledi, `likes_count` = redovi) |
| `cd tests && CHROME_PATH=/usr/bin/google-chrome npx playwright test` | 30/30 prošlo (1,0 min) |
| `node --test mobile/navigacija.test.mjs` | 6/6 prošlo |
| `nginx -t` s `server/nginx-komodo.conf` (privremena kopija, port 3966 → API 3965) | sintaksa u redu; `/og/`, `/?o=`, `/js/*.js?v=` provjereni kroz Nginx |
| Test opterećenja na vlastitoj bazi `komodo_recenzija2_load` (napuni-bazu, 10.100 korisnika, 10.000 oglasa), API `NODE_ENV=production`, `WORKERS=2`, port 3965 | odjeljak „Mjerenja” |

## Nalazi

### R2-01 „Za tebe”: poslije ~220 prikazanih oglasa klijent šalje `/api/feed` bez prestanka (~60/s)

- **Ozbiljnost:** blokira (budžet je ≤ 0,13 zahtjeva/s po korisniku; jedan korisnik na kraju „Za tebe” troši
  ~450 korisničkih budžeta, a „kraj” i prelaz na „Novo” se nikad ne dese).
- **Fajl i funkcija:** `api/src/rute/feed.js` — `parseIzuzmi` (`MAX_IZUZMI = 200`), `slozi` (kraj tek kad ne
  ostane ni jedan kandidat van `izuzmi`); `web/js/feed.js` — `loadFeed` (prazna strana „Za tebe” bez `kraj` ne
  mijenja stanje) i `watch` (poslije svakog učitavanja ponovo posmatra karte, pa vidljiva zadnja karta odmah
  okine `loadFeed(false)`).
- **Scenarij:** kandidata ima C (200) + D (do 100) = do 300, a `izuzmi` čuva samo zadnjih 200. Kad je C∪D > 220
  (uobičajeno: novi oglasi s malo pregleda nisu u top 200 po ocjeni), poslije 11. strane prvih 20 prikazanih
  ispada iz `izuzmi` i server ih vraća ponovo (neprijavljeni bez `did` nemaju ×0,2; i prijavljenima pregledan
  oglas s ×0,2 često i dalje nadmašuje preostale slabije kandidate). Klijent ih odbaci kao duplikate → `fresh`
  prazan, `kraj: false`, `again: false` → `watch()` → zadnja karta je na ekranu → `loadFeed(false)` → isti
  zahtjev → … Server nikad ne vraća `kraj: true` (uvijek ima „slobodnih” kandidata), pa korisnik ne dobija ni
  razdjelnik ni „Novo”.
- **Dokaz (potvrđeno):**
  - API (3965, baza sa C∪D = 300): simulacija klijenta (izuzmi = zadnjih 200 prikazanih, filtriranje
    duplikata): strane 1–11 po 20 novih, strane 12–16: „vraćeno 20, novih 0, kraj false”; isto za prijavljenog
    (`sid=tok500`). Kad je C∪D = 209, kraj dolazi ispravno na 11. strani.
  - Preglednik (Playwright, 390×844, isti API): poslije skrolovanja do kraja 220 kartica, za **10 s mirovanja
    597 zahtjeva `/api/feed`** (ukupno 774).
  - Postojeći test `feed-algoritam` („5 strana zaredom”) ne dolazi do 200, pa ovo ne hvata.
- **Prijedlog:** (1) server: `MAX_IZUZMI` ≥ najveći broj kandidata (300; URL ~2,1 KB, ispod Nginx granice), i
  klijent šalje zadnjih 300 — tada `kraj` dolazi pouzdano; (2) klijent, odbrana u dubinu: u „Za tebe” strana bez
  ijednog novog oglasa = kraj (`zaTebeKraj = true; again = true`), i nikad ne zvati `loadFeed` iz `watch()` dok
  zadnje učitavanje nije donijelo nove karte. SPEC F-01 (`izuzmi` ≤ 200) uskladiti. Test: 15 strana s C∪D > 220 →
  bez ponavljanja, pa `kraj: true`; e2e: na kraju „Za tebe” ≤ 2 zahtjeva u 10 s.
- **Uloga:** Backend + Frontend (test: QA; SPEC: Proizvod i UX).

### R2-02 Posao `base_score` svakih 5 min zaključava hiljade redova `listings` → skok kašnjenja svih ruta

- **Ozbiljnost:** prije objave (uslov 2: p95 < 300 ms; lokalno izmjereno p95 do 1,4 s dok posao radi).
- **Fajl i funkcija:** `api/src/poslovi.js` — `izracunajOcjene` / `SCORE_SQL` (serije od 2.000 id-jeva, upisuje
  svaki red čija se ocjena promijenila > 1 %).
- **Scenarij:** pod prometom se `views` i `likes_count` mijenjaju na većini svježih oglasa, pa posao svaki put
  prepiše hiljade redova (izmjereno 5.654, 7.221 i 6.889 redova u tri prolaza). Svaka serija drži zaključane
  redove dok traje naredba; `POST …/view` i `…/like` (update `listings`) čekaju na njima, zauzmu veze iz bazena
  (`PG_POOL` = 10), pa čekaju i rute koje ne diraju `listings` (`/api/me`, `/api/likes`).
- **Dokaz (potvrđeno lokalno, uz ogradu: 2 jezgra, generator na istoj mašini):** mix 10.000 × 90 s s `FEED=1`
  bez posla u prozoru: p95 `/api/likes` 136 ms (drugi prolaz 342 ms); isti test kad je posao pao u prozor:
  p95 `/api/likes` 1.388 ms, `/view` 1.375 ms, `/like` 949 ms, `/api/me` 741 ms, `/api/feed` 206 ms (0 grešaka).
  Prvi prolaz 10.000 × 60 s, takođe s poslom u prozoru: p95 583 ms. Sam posao bez opterećenja: 735 ms (4.929
  promijenjenih redova), 407 ms kad se ništa ne mijenja.
- **Prijedlog:** manje serije (npr. 200–500) s kratkom pauzom između; u `SCORE_SQL` uzimati redove s
  `for no key update skip locked` (red koji upravo mijenja sviđanje/pregled se preskoči do sljedećeg prolaza);
  prag promjene dići (npr. 5 % — redoslijed se ne mijenja). Ponoviti mix 20.000 na pravom serveru tako da posao
  sigurno padne u prozor mjerenja.
- **Uloga:** Backend (mjerenje: QA).

### R2-03 Keševi feeda i OG ne prate gašenje butika i brisanje naloga butika; Nginx drži sličicu obrisanog oglasa 1 dan

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/rute/prijave-admin.js` — `POST /api/admin/users/:id/suspend` i
  `api/src/rute/profil.js` — `POST /api/me/delete` ne zovu `ocistiKesFeeda()`; `api/src/rute/og.js` — `htmlCache`
  i `metaCache` (60 s, bez poništavanja); `server/nginx-komodo.conf` — `location ^~ /og/` (`proxy_cache_valid 200
  1d`, API šalje `max-age=86400`).
- **Scenarij:** administrator ugasi butik ili butik obriše nalog → njegovi oglasi ostaju u „Za tebe” do 60 s
  (kandidati, u svakom procesu), u „Novo” do 5 s, u OG pregledu linka do 60 s; dodir na takav oglas daje prazan
  snimak / „ne postoji”. Sličica obrisanog oglasa (`/og/<id>.jpg`, prava sličica s Bunnyja) ostaje dostupna iz
  Nginx keša i preglednika do 24 h, iako je API briše s diska.
- **Dokaz:** potvrđeno čitanjem koda i konfiguracije; Nginx keš `/og/` nije provjeren s pravom sličicom (lokalno
  nema Bunnyja; zajednička slika ima `max-age=60`).
- **Prijedlog:** `ocistiKesFeeda()` u gašenju i brisanju naloga; `max-age` za `/og/` smanjiti na 1 h (botovi
  ionako keširaju sami) ili u RUNBOOK dodati brisanje Nginx keša `/og/<id>` na zahtjev za uklanjanje sadržaja.
- **Uloga:** Backend + DevOps.

### R2-04 R-03 riješen djelimično: ekran „Nadogradi” bez dugmeta kad `url` nije ispravan ili nedostaje

- **Ozbiljnost:** može kasnije (važi tek kad se `min` podigne).
- **Fajl i funkcija:** `web/js/omotac.js` — `checkAppVersion`, `validStoreUrl`; `web/app-verzija.json`
  (i dalje `id<APP_STORE_ID>`); `mobile/App.js` — `storeUrl` (rezervna adresa pretrage).
- **Scenarij:** `ios.min` se podigne, `url` je i dalje oznaka (ili se polje ukloni, kako je predložio R-03) →
  `validStoreUrl` vraća `undefined` → dugme „Nadogradi” se sakrije, ostaje samo tekst. Korisnik stare verzije je
  zaključan bez načina da iz aplikacije stigne do prodavnice; rezervna adresa u `App.js` (pretraga App Storea /
  `market://`) se više nikad ne koristi.
- **Dokaz:** potvrđeno čitanjem koda.
- **Prijedlog:** kad `url` nije ispravan, dugme ostaje i šalje `toApp({ type: 'update' })` bez `url` (omotač
  koristi `storeUrl`). Upisati pravi App Store ID poslije prve objave (`docs/PRODAVNICE.md`, spisak koraka).
- **Uloga:** Frontend (`web/`) + Mobilni.

### R2-05 `location /` u Nginxu je sada dinamična (OG upiti u bazu), a nema `limit_req`

- **Ozbiljnost:** može kasnije.
- **Fajl:** `server/nginx-komodo.conf` — `location /`; `api/src/rute/og.js` — `ogIndex`.
- **Scenarij:** svaki novi `?o=<id>` ili `?b=<bilo šta>` je promašaj keša (ključ je vrijednost iz adrese) i jedan
  do dva upita u bazu; jedna adresa može slati neograničeno zahtjeva (sve `/api/` rute imaju 100 r/s po IP-u,
  `/` nema ništa) i usput istiskivati prave ključeve iz keša od 5.000 stavki.
- **Dokaz:** potvrđeno čitanjem konfiguracije i koda; nije mjereno.
- **Prijedlog:** `limit_req zone=komodo_api burst=200 nodelay;` i u `location /` (isto kao `/og/`).
- **Uloga:** DevOps.

### R2-06 Rijetka 500 pri praćenju butika koji se upravo briše

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/rute/butici.js` — `FOLLOW_SQL`; `api/src/app.js` — `onRoute` omotač (23503 → 401
  samo kad je sesija pozivaoca nevažeća).
- **Scenarij:** kupac pritisne „Prati” dok butik briše nalog. Brisanje drži red butika `for update`; upis u
  `follows` čeka provjeru stranog ključa i poslije potvrde brisanja pada s 23503. Sesija kupca je važeća, pa
  omotač grešku propušta → 500 (isto važi za poruku/sviđanje u istom trenutku).
- **Dokaz:** nepotvrđeno pokretanjem — zaključeno iz redoslijeda zaključavanja; prozor je dužina transakcije
  brisanja.
- **Prijedlog:** u `follow` (i opšte u omotaču) 23503 na `shop_id`/`listing_id` → 404 „Ovaj butik ne postoji.”.
- **Uloga:** Backend.

### R2-07 Sniženje: butik može „napraviti” sniženje dizanjem pa spuštanjem cijene

- **Ozbiljnost:** može kasnije (u skladu sa SPEC F-07; butike otvara tim, a push je najviše 1 po kupcu po oglasu
  u 24 h).
- **Fajl i funkcija:** `api/src/rute/oglasi.js` — `PATCH /api/listings/:id` (okidač poredi samo s trenutnom
  cijenom).
- **Scenarij:** 50 KM → izmjena na 500 KM → izmjena na 50 KM: svi koji su označili oglas dobiju push „500 KM →
  50 KM”, a kartica pokazuje precrtanih 500 KM.
- **Dokaz:** potvrđeno čitanjem koda.
- **Prijedlog:** za `old_price_cents` i okidač uzeti najnižu cijenu zadnjih 7 dana (ili cijenu staru bar 24 h);
  odluka je proizvodna.
- **Uloga:** Proizvod i UX (SPEC), pa Backend.

### R2-08 Testovi ne pokrivaju dva važna slučaja

- **Ozbiljnost:** može kasnije (osim dijela koji ide uz R2-01).
- **Fajl:** `api/test/feed-algoritam.test.mjs`, `api/test/oglas-snizenje.test.mjs`.
- **Šta fali:** (1) straničenje „Za tebe” preko 200 prikazanih (vidi R2-01); (2) sniženje oglasa u obradi s
  uključenim (lažnim) Bunnyjem — kod provjerava `video_status === 'ready'`, ali nijedan test ne potvrđuje da
  kupci ne dobiju push za oglas koji ne smiju vidjeti.
- **Prijedlog:** dodati oba testa; drugi u blok s lažnim Bunnyjem po uzoru na `poruke-r04-blokiranje`.
- **Uloga:** QA.

## Stanje nalaza iz Recenzije 1

| Nalaz | Stanje | Provjera |
|---|---|---|
| R-01 keš prijava u klasteru | riješeno | `javiSvima`/`naPoruku` (radnik → primarni → ostali), `onRoute` 23503 → 401; test `feed-r01-klaster` (pravi klaster, nove TCP veze) prolazi. Ostatak: R2-06. |
| R-02 Bunny Referer u omotaču | otvoreno | i dalje traži telefon i pravi Bunny (faza 4). Odluka da zaštita ostaje je poštovana: `og:image` nikad ne pokazuje na Bunny. |
| R-03 App Store adresa | djelimično | nepostojeća stranica se više ne otvara, ali ekran ostaje bez dugmeta (R2-04); `app-verzija.json` ima oznaku. |
| R-04 oglas u obradi u razgovoru i prijavi | riješeno | `VISIBLE_SQL` u otvaranju razgovora, spisku (i `deleted_at`), porukama i `POST /api/reports`; test s lažnim Bunnyjem prolazi. |
| R-05 symlinkovi u `/media/` | riješeno | `disable_symlinks on;` |
| R-06 Origin na nestandardnom portu | riješeno | `proxy_set_header Host $http_host;` |
| R-07 keš fontova i JS | riješeno | izmjereno: `/js/*.js?v=` i `*.css?v=` → `max-age=31536000, immutable`; `woff2` → 30 dana; bez `?v=` → `max-age=0`; Nginx regex uključuje `woff2`, poštuje zaglavlje API-ja; `objava.sh` briše Nginx keš. |
| R-08 `known_devices` pri registraciji i novoj lozinci | riješeno | `zapamtiUredjaj` u `register`, `login`, `reset`. |
| R-09 granica pregleda po IP (CGNAT) | otvoreno | i dalje 600/min (`views:ip:`); mjerenje u fazi 4. |
| R-10 povratak prije 010 | riješeno drugačije | RUNBOOK opisuje posljedice i namjerno ne pretvara sesije SQL-om (sirov token i sha256 su oba 64 hex znaka — opravdano). |
| R-11 CI i `mobile/` | djelimično | `mobile/` izuzet iz `node --check`, dodan `navigacija.test.mjs`; `App.js` i `app.config.js` se i dalje ne parsiraju u CI-ju. |

## Mjerenja

Mašina: 2 jezgra, generator, API (`WORKERS=2`, `NODE_ENV=production`, bez Bunnyja) i Postgres na istoj mašini —
brojevi su orijentacija, ne dokaz za 20.000. Baza `komodo_recenzija2_load` iz `napuni-bazu.mjs` (10.000 oglasa,
299.559 sviđanja), pa starost oglasa raspoređena na 30 dana i pregledi 0–200 (da `base_score` i D liče na stvarne).

| Test | Zahtjeva | Ukupno/s | p95 po ruti | Greške |
|---|---|---|---|---|
| mix 4.000 × 60 s, `LIGHT=1 FEED=1` | 18.401 | 307 | feed 5, likes 4, me 7, like 5, view 7 ms | 0 |
| mix 10.000 × 60 s, `LIGHT=1 FEED=1` (posao `base_score` u prozoru) | 45.991 | 767 | feed 41, likes 583, me 73, like 328, view 545 ms | 0 |
| mix 10.000 × 90 s, `LIGHT=1 FEED=1` (bez posla), 1. prolaz | 79.906 | 888 | feed 25, likes 342, me 178, like 214, view 355 ms | 0 |
| isto, 2. prolaz | 79.798 | 887 | feed 29, likes 136, me 77, like 101, view 144 ms | 0 |
| isto, posao `base_score` u prozoru | 79.689 | 885 | feed 206, likes 1.388, me 741, like 949, view 1.375 ms | 0 |
| poređenje: mix 10.000 × 90 s, `LIGHT=1` (stari klijent, `/api/listings`, sviđanja 15 s) | 109.814 | 1.220 | listings 6, likes 37, me 62, like 35, view 122 ms | 0 |

Jedna ruta, 100 istovremenih, 15 s: `/api/listings` (keš) 3.310/s, p95 56 ms; `/api/feed` „Za tebe” prijavljen
(lični upit) 1.366/s, p95 116 ms; „Za tebe” neprijavljen bez `did` 7.242/s, p95 28 ms; „Praćeni” 2.004/s, p95 82 ms.
Potreba za 20.000 korisnika je ~125 strana feeda/s, pa „Za tebe” troši ~10 % kapaciteta ove mašine.

Ostalo: posao `base_score` bez opterećenja 735 ms (4.929 promjena) / 407 ms (bez promjena) za 10.000 oglasa;
`daily_stats` brojanje različitih gledalaca nad 94.000 redova `listing_views` 15 ms. Budžet klijenta (čitanjem
tajmera): sviđanja 30 s, pregledi 30 s, nepročitane 60 s, strana feeda ~160 s, sviđanje ~80 s ≈ 6/min — u okviru
≤ 7/min, osim petlje iz R2-01.

Napomena za tumačenje: rasipanje p95 između dva prolaza bez posla (136 i 342 ms) je u generatoru (tajmeri
sviđanja, pregleda i `/api/me` su u istoj sekundi za sve korisnike unutar 15 s); jasan skok je samo dok radi
`base_score` (R2-02).

## Provjereno i u redu

- **Oglas u obradi vidi samo vlasnik:** „Za tebe” (C i D uz `$1 = 0`, D još i `video_status = 'ready'`),
  „Novo” (javni keš s `$1 = 0`, butik mimo keša), „Praćeni” (`$1` = gledalac, a sebe ne može pratiti), OG HTML i
  `/og/<id>.jpg` (`$1 = 0`, kratak negativni keš 10 s), profil butika (broj i sličica), `/api/me/follows`,
  statistika (samo vlastiti oglasi), poruke i prijave (R-04), sniženje (push samo za `ready`).
- **XSS:** OG vrijednosti kroz `esc` (`& < > " '`), zamjene s funkcijom (nema `$&` zamki); u novim ekranima
  (kartica, profil i javni profil butika, kontakt i adresa, „Pratim”, statistika, administracija, brza pitanja,
  razgovor) korisnički tekst ide kroz `esc()` ili `textContent`; `mapsURL` kodira adresu.
- **SSRF u OG:** adresa sličice se gradi iz `bunny_guid` iz baze (`mediaUrls`), iz zahtjeva se uzima samo cijeli
  broj; `redirect: 'manual'`, rok 5 s, najviše 2 MB, provjera JPEG potpisa, upis preko privremenog fajla i `rename`,
  jedno preuzimanje po id-u, najviše 8 istovremenih po procesu.
- **Autorizacija:** `/api/me/stats` samo butik i samo svoji oglasi; `/api/admin/stats` i pretraga naloga samo
  administrator (404 inače), `ilike` s escape-ovanjem; Origin provjera je globalna (test za praćenje prolazi).
- **Push:** `posaljiPush` je jedino mjesto prema Expo-u; tokeni sniženja se biraju u bazi po sviđanju,
  `push_enabled`, ugašenim i blokiranjima (oba smjera); zauzimanje kupaca je atomsko (`skip locked`), 24 h pravilo,
  najviše 5.000 po sniženju; PATCH ne čeka slanje.
- **Brojači pratilaca:** jedna naredba po praćenju, delta samo za stvarno promijenjen red; brisanje naloga
  zaključava pogođene redove po id-u i umanjuje oba brojača; testovi istovremenosti (50× isti kupac, 40 kupaca) i
  brisanja prolaze.
- **Klaster:** `javiSvima` za sesije, korisnike i feed; primarni ne vraća poruku pošiljaocu; bez clustera se ne
  šalje ništa.
- **U-04 i omotač:** `komodo.posle` je u `sessionStorage` (isti sajt), `runPosle` izvršava samo poznate radnje s
  provjerom id-a; `__komodoOpenUrl` odbija tuđi origin (i `javascript:`); `toAppUrl` prihvata samo naš host i
  `komodo://`; obavještenje o sniženju ide na `__komodoOpenListing`, a poruke kroz `__komodoOpenUrl`; Android kanal
  „snizenja” postoji.
- **Migracija 011:** dva mala indeksa; `listings_scored_idx` je djelimičan. `base_score` = 0 za obrisane, ugašene,
  stare i davno prodate (test prolazi).
- **CI:** `node --check` bez `mobile/`, dodan test navigacije; isti koraci prošli lokalno.
- **SPEC i odluke:** Bunny zaštita ostaje uključena (OG preko naše adrese, otkazana stavka u SPEC 5 i 8);
  „Provjeren butik” je `verified: true` za sve butike.

## Stanje popravki (20.11.2026., Backend + Frontend)

Tekst nalaza iznad je nepromijenjen. Migracija za popravke: `api/migrations/012_ocjene_i_cijena.sql`.

| Nalaz | Stanje | Šta je urađeno | Dokaz |
|---|---|---|---|
| R2-01 | riješeno | Server: `MAX_IZUZMI` 200 → 400 (≥ C 200 + D 100, rezerva za smjenu kandidata); strana nikad ne sadrži izuzet oglas, `kraj: true` čim nema novih. Zapis ostaje csv u GET-u (≈ 3,2 KB za 400 id-jeva po 7 cifara, ispod 8 KB Nginx granice; POST/kompaktan zapis nije potreban). Klijent (`web/js/feed.js`): šalje zadnjih 400; strana „Za tebe” bez ijednog novog oglasa = kraj (razdjelnik, prelaz na „Novo”); poslije strane bez novih oglasa sljedeća najranije za 1 s, poslije 2 zaredom stop i dugme „Prikaži starije oglase”. SPEC F-01 usklađen. | API test `feed-algoritam` „R2-01: 330 vidljivih” (15 strana do `kraj:true`, bez ponavljanja i prazne strane; isto prijavljen s pregledanim oglasima) — sa starom granicom 200 pada („id 179 se ponovio na strani 12”). E2E `feed-kraj`: pravi server s 330 oglasa i „pokvaren” lažni `/api/feed` (uvijek isti, `kraj:false`) → ≤ 2 zahtjeva u 10 s mirovanja; stari `feed.js` pada na oba. |
| R2-02 | riješeno | `base_score` u zasebnoj tabeli `listing_scores` (samo ocjene > 0; 0 = brisanje reda). Posao čita `listings` bez zaključavanja i piše samo `listing_scores` (upis novog reda uzima `FOR KEY SHARE` na oglasu, što se ne sudara s `update likes_count/views`). Feed čita ocjenu spojem. Indeksi nad `listings.base_score` uklonjeni; kolona ostaje zbog povratka. `KOMODO_SCORE_MS` (samo mjerenje). | Mjerenja ispod. |
| R2-03 | riješeno | `ocistiKesFeeda()` (svi procesi, `javiSvima`) u gašenju/vraćanju naloga (admin) i brisanju naloga butika; isti poziv briše i OG keš (HTML i podatke za `/og/<id>.jpg`, `ocistiKesOgOvdje`), pa i izmjena/brisanje oglasa. `/og/<id>.jpg`: `max-age` 86400 → 3600, Nginx `proxy_cache_valid 200` 1d → 1h; 404 se ne kešira. `docs/RUNBOOK.md`: „Hitno uklanjanje sličice iz keša”. | Test `admin` „R2-03” (Za tebe, Novo i OG odmah poslije gašenja, vraćanja i brisanja naloga); `og-pregled` (max-age 3600). |
| R2-04 | riješeno | Ekran nadogradnje: neispravna ili izostavljena adresa → dugme ostaje i šalje `{type:'update'}` bez `url`; omotač (`mobile/App.js`, `storeUrl`) otvara rezervnu adresu (bez izmjene u `mobile/`). Pravi App Store ID i dalje treba upisati poslije prve objave. | E2E `nadogradnja` (oznaka `<APP_STORE_ID>` i bez `url` → `{type:'update'}`; prava adresa → s `url`); `mobile/navigacija.test.mjs` 6/6. |
| R2-05 | riješeno | `limit_req zone=komodo_api burst=200 nodelay;` u `location /`. | `nginx -t` na privremenoj kopiji (port 3971 → API 3970): u redu; `/?o=` 200; 400 zahtjeva `/?o=` s 50 istovremenih: 341 × 200, 59 × 429. |
| R2-06 | riješeno | Omotač `onRoute`: 23503 uz važeću sesiju → `*_shop_id_fkey` 404 „Ovaj butik ne postoji.”, `*_listing_id_fkey` 404 „Ovaj oglas ne postoji.” (praćenje, sviđanje, razgovor…). | Test `butik-pracenje` „R2-06”: transakcija briše butika i drži red, praćenje čeka na zaključanom redu (provjera u `pg_stat_activity`), poslije potvrde → 404; bez popravke 500. |
| R2-07 | riješeno (odluka tima) | Push o sniženju samo ako je cijena prije izmjene važila ≥ 72 h (`listings.price_set_at`, migracija 012; postojeći oglasi: zadnje sniženje ili objava). Precrtana cijena po starom pravilu. Vlasnik dobija `pushSnizenje`; forma izmjene to kaže. SPEC F-07 (pravilo, kriteriji 7–9). | `oglas-snizenje`: „digni pa spusti” (50 → 500 → 50: bez pusha, `oldPrice` 500, kupac ne troši 24 h), 71 h / 73 h; e2e `oglas` F-07 (napomena za svjež i za stari oglas). |
| R2-08 | riješeno | Testovi: straničenje > 200 (R2-01) i sniženje oglasa u obradi uz lažni Bunny (push se ne šalje, kupac nije označen). | `feed-algoritam`, `oglas-snizenje` (blok „sniženje oglasa u obradi”). |

### Mjerenja R2-02 (prije/poslije)

Ista mašina i ograda kao gore (2 jezgra, generator + API `WORKERS=2`, `NODE_ENV=production` + Postgres zajedno).
Dvije probne baze iz `napuni-bazu.mjs` (10.000 oglasa, ~300.000 sviđanja), starost 0–30 dana, pregledi 0–200:
„prije” = kod iz `695237f` (migracije do 011), „poslije” = ovaj kod. Svaki red: mix 10.000 × 90 s, `LIGHT=1 FEED=1`,
API svaki put iznova; prije prozora ocjene pomaknute ×0,9 (bez opterećenja), pa posao u prozoru prepisuje (skoro) sve
ocjene. Uz generator radi sonda (POST `/view` i GET `/api/likes` svakih 50 ms) koja razdvaja zahtjeve tokom posla od ostalih.
„Jednom” = jedan prolaz posla u 40. s (≈ 10.000 promjena; recenzija je vidjela 5–7 hiljada po prolazu).
„Petlja” = najgori slučaj: posao kroz cijeli prozor (pomak ×0,9 pa prolaz, svake ~2 s; 18 prolaza prije, 32 poslije).

| Verzija | Posao u prozoru | likes p95 | me p95 | like p95 | view p95 | feed p95 | Sonda view p95 tokom posla / van | Greške |
|---|---|---|---|---|---|---|---|---|
| prije | bez | 56 | 400 | 32 | 64 | 221 | – / 36 | 0 |
| prije | jednom (1,6 s) | 110 | 389 | 59 | 121 | 217 | 410 / 39 | 0 |
| prije | petlja (1,5–4,4 s po prolazu) | **3.309** | **3.291** | **2.864** | **4.243** | 210 | 596 / 149 | 0 |
| poslije | bez | 107 | 303 | 49 | 120 | 184 | – / 31 | 0 |
| poslije | jednom (0,9 s) | 309 | 468 | 238 | 313 | 259 | 157 / 96 | 0 |
| poslije | petlja (0,3–1,0 s po prolazu) | **185** | **297** | **110** | **191** | 174 | 188 / 79 | 0 |

(ms; ~79.800 zahtjeva po prolazu, 885–888/s.) Tumačenje: najgori slučaj jasno pokazuje sudar u staroj šemi (p95 do
4,2 s, kao i 1,4 s iz recenzije) i njegov nestanak u novoj — sa stalnim poslom p95 ostaje u rasponu prolaza bez posla.
Pojedinačni prolazi jednog posla su unutar rasipanja ove mašine (dva prolaza bez posla daju 56 i 107 ms za `likes`;
„poslije, jednom” je bio bučan i van posla, sonda van posla 96 ms). Posao sam: prije 1,5–4,4 s pod opterećenjem,
poslije 0,3–1,0 s. Na pravom serveru ponoviti mix 20.000 tako da posao padne u prozor (`KOMODO_SCORE_MS=60000`).

### Pokrenuto poslije popravki

| Komanda | Ishod |
|---|---|
| `cd api && npm test` (3× zaredom) | 222/222, 0 preskočeno; 33,5 s, 33,6 s, 30,8 s |
| `npm run test:istovremenost` | sve provjere OK |
| `cd tests && CHROME_PATH=/usr/bin/google-chrome npx playwright test` (2×) | 33/33 (1,6 min i 1,7 min) |
| `node --test mobile/navigacija.test.mjs` | 6/6 |
| `nginx -t` (privremena kopija) | u redu |
