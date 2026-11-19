# Recenzija 1 — izmjene 56cbb64..2686506 (faza 1 i talas 1)

Recenzent: nezavisni pregled, 19.11.2026. Pregledano: podjela `api/src/server.js` i `web/app.js` na module
(poređeno s `c2cf623`), sigurnosne popravke S-01…S-18, migracije 009 i 010, testovi i CI, mobilni omotač,
Nginx, skripte i `docker-compose.yml`, frontend izmjene.

## Sažetak

**Spremno za spajanje: DA, uz uslove.** Nijedan nalaz ne blokira spajanje. Prije objave treba riješiti
R-01, R-02 i R-03 (dva su provjere/podešavanje, ne veliki kod).

| Ozbiljnost | Broj | Nalazi |
|---|---|---|
| blokira | 0 | — |
| treba prije objave | 3 | R-01, R-02, R-03 |
| može kasnije | 8 | R-04 … R-11 |

Pokrenuto (sve zeleno):

| Komanda | Ishod |
|---|---|
| `cd api && npm test` | 121 test, 121 prošao, 0 todo, ~9,7 s |
| `npm run test:istovremenost` | sve provjere OK (2.000 istovremenih sviđanja, 1.000 poruka, 20 registracija istog emaila, pregledi iza iste IP adrese, `likes_count` = broj redova) |
| `cd tests && CHROME_PATH=/usr/bin/google-chrome npx playwright test` | 5/5 prošlo (14,5 s) |
| Vlastiti API u produkciji (`NODE_ENV=production`, `WORKERS=2`, lažni SMTP, port 3965) + vlastiti Nginx s `server/nginx-komodo.conf` (port 8965) | nalazi R-01, R-04, R-06 i provjere u zadnjem odjeljku |
| Migracije 009+010 na kopiji `komodo_load` (10.000 oglasa, 476.604 sviđanja, 10.327 sesija) | najduža naredba u 009: 7 ms; u 010: 84 ms (pretvaranje sesija) |
| Migracije 001–010 kao vlasnik baze bez superusera | sve primijenjene (`pg_trgm` je „trusted”) |
| Stari API (`c2cf623`) nad bazom poslije 010 | feed, profil butika, prijava i `/api/me` rade (povratak verzije bez vraćanja baze je moguć) |

## Nalazi

### R-01 Obrisan nalog u drugom procesu daje 500 do 15 s (i odjava/nova lozinka važe do 15 s)

- **Ozbiljnost:** treba prije objave (definicija „spremno”: 0 grešaka 5xx; `nadzor.sh` broji 5xx).
- **Fajl i funkcija:** `api/src/app.js` — `currentUser`, `forgetUser`, `forgetToken` (keš prijava po procesu);
  posljedica u `api/src/rute/svidjanja-pregledi.js` (`LIKE_SQL`) i svakom upisu s `user.id`.
- **Scenarij:** `WORKERS=2`. Kupac je prijavljen, oba radnika imaju njegovu sesiju u kešu. `POST /api/me/delete`
  obradi radnik A (briše korisnika, poništi keš samo u A). Sljedećih ≤15 s zahtjevi s istim `sid` koje primi
  radnik B vide korisnika kao prijavljenog: `POST /api/listings/1/like` → **500** (`likes_user_id_fkey`).
  Isto ponašanje (bez 500) za odjavu, promjenu lozinke i gašenje naloga: ukradena sesija radi još ≤15 s na
  drugom radniku. Ponašanje postoji i u `c2cf623` (nije regresija), ali s klasterom za 20.000 korisnika postaje
  stvarno.
- **Dokaz (potvrđeno):** vlastiti klaster na 3965: poslije brisanja 20× `POST /api/listings/1/like` sa starim
  `sid` → `{"401":10,"500":10}`, u zapisu `insert or update on table "likes" violates foreign key constraint
  "likes_user_id_fkey"`. Poslije odjave 10× `/api/me` sa starim `sid` → `{"prijavljen":5,"null":5}`.
- **Prijedlog:** radnik koji poništava keš javlja to ostalima: `process.send({forget: …})` → primarni u
  `index.js` prosljeđuje svim radnicima (`cluster.workers[*].send`) → `forgetUser`/`forgetToken`. Dodatno,
  greška `23503` na `user_id` u ruti → 401 umjesto 500. Test: klaster s 2 radnika, brisanje pa sviđanje → nikad 500.
- **Uloga:** Backend (test: QA).

### R-02 Bunny „Block direct url file access”: puštanje snimka u omotaču nije provjereno

- **Ozbiljnost:** treba prije objave (provjera na telefonu; kod se možda ne mijenja).
- **Fajl i funkcija:** `api/src/video.js` — `mediaUrls` (MP4 i `thumbnail.jpg` direktno s `https://<CDN>/…`);
  `mobile/App.js` (WebView).
- **Scenarij:** sa uključenom zaštitom Bunny pušta fajl samo uz dozvoljen `Referer`. U pregledniku `<video>` šalje
  `Referer: https://komodo.ba/` (Nginx: `strict-origin-when-cross-origin`). Na iPhoneu `<video>` u WKWebView
  dohvata AVFoundation, a na Androidu medijski sloj WebViewa; ako neki od njih ne pošalje `Referer`, feed u
  aplikaciji ostaje crn. Ništa u kodu ne zavisi od isključivanja zaštite (SPEC 8 je poštovan: OG još nije
  urađen, a nigdje se ne koristi direktna Bunny adresa van `<video>`/`poster`).
- **Dokaz:** nepotvrđeno — nema pravog Bunny naloga ni telefona u ovoj sesiji.
- **Prijedlog:** u fazi 4, prije prijave u prodavnice: probni oglas na pravom Bunnyju, pustiti ga u iOS i Android
  buildu (EAS) i u Safariju; u Bunnyju u „Allowed referrers” upisati `komodo.ba` i `www.komodo.ba`. Ako iOS ne
  šalje `Referer`: token autentikacija (potpisane adrese) umjesto provjere Referera — ne isključivanje zaštite.
- **Uloga:** Mobilni + DevOps (Stefan za Bunny podešavanje).

### R-03 `app-verzija.json` ima neispravnu App Store adresu koja prolazi provjeru

- **Ozbiljnost:** treba prije objave (prije prvog podizanja `min` za iOS).
- **Fajl i funkcija:** `web/app-verzija.json` (`"url": "https://apps.apple.com/app/id<APP_STORE_ID>"`);
  `web/js/omotac.js` — `checkAppVersion`; `mobile/App.js` — `storeUrl`.
- **Scenarij:** kad se `ios.min` podigne iznad instalirane verzije, ekran „Nadogradi” šalje omotaču ovu adresu
  (regex `^https://apps.apple.com/` je propušta) → App Store otvara nepostojeću stranicu, a stara verzija je
  zaključana. Danas `min` = `1.0.0` pa se ekran ne prikazuje.
- **Dokaz:** potvrđeno čitanjem koda (regex u `omotac.js` i `App.js`).
- **Prijedlog:** upisati pravi ID poslije prve objave, ili do tada ukloniti polje `url` za iOS (omotač tada
  koristi rezervnu adresu). U `docs/PRODAVNICE.md` dodati to u spisak koraka objave.
- **Uloga:** Mobilni (fajl je u `web/`, izmjenu radi Frontend).

### R-04 Naslov i cijena oglasa u obradi vidljivi kroz razgovor

- **Ozbiljnost:** može kasnije (curi samo naslov i cijena, ne snimak).
- **Fajl i funkcija:** `api/src/rute/poruke.js` — `POST /api/conversations` (provjera `listingId` bez
  `VISIBLE_SQL`), `GET /api/conversations` (`left join listings` bez `deleted_at`/vidljivosti),
  `GET /api/conversations/:id/messages` (`oglas` bez vidljivosti). Slično `POST /api/reports`
  (`api/src/rute/prijave-admin.js`): 201 za oglas u obradi, 404 za nepostojeći — otkriva postojanje.
- **Scenarij:** Bunny uključen, butik objavi oglas id 500 (u obradi). Kupac pošalje
  `POST /api/conversations {"shop":"<handle>","listingId":500}` (id-jevi su redom) → `GET …/messages` vraća
  `oglas: {title, price}` prije nego što je oglas javan. `GET /api/conversations` prikazuje i naslov obrisanog oglasa.
- **Dokaz:** potvrđeno čitanjem koda; nije pokrenuto s lažnim Bunnyjem. Ostale rute (`/api/listings`,
  `/api/listings/:id`, `/api/likes`, sviđanje, pregledi, `/api/shops`) test `backend-sema.test.mjs` pokriva i prolazi.
- **Prijedlog:** u `POST /api/conversations` i u čitanju oglasa za razgovor dodati `and ${VISIBLE_SQL}`
  (s `$1` = id gledaoca) i `deleted_at is null` u spisku razgovora; u `POST /api/reports` isto pravilo
  vidljivosti. Test u `backend-sema.test.mjs` (blok „Bunny uključen”).
- **Uloga:** Backend.

### R-05 Nginx `/media/` prati simboličke linkove

- **Ozbiljnost:** može kasnije (učvršćenje; danas se ne može iskoristiti jer API piše samo UUID imena).
- **Fajl:** `server/nginx-komodo.conf`, `location ^~ /media/`.
- **Scenarij:** ako se u `/srv/komodo/uploads` ikad nađe simbolički link (greška u skripti, ručna intervencija,
  budući kod), Nginx služi fajl na koji pokazuje.
- **Dokaz (potvrđeno):** vlastiti Nginx s ovim fajlom: `veza.mp4 → /etc/passwd` → `200 video/mp4`.
  Putanje van direktorija (`/media/../`, `%2e%2e`) i skriveni fajlovi (`/media/.skriveno` → 404) su u redu.
- **Prijedlog:** u `location ^~ /media/` dodati `disable_symlinks on;`.
- **Uloga:** DevOps.

### R-06 Provjera `Origin` iza Nginxa ne radi na nestandardnom portu

- **Ozbiljnost:** može kasnije (produkcija i proba na Terminkovom serveru idu na 443).
- **Fajl i funkcija:** `api/src/app.js` — `ownOrigin`; `server/nginx-komodo.conf` — `proxy_set_header Host $host`.
- **Scenarij:** `$host` nema port. Stranica na `http://server:8080`, `APP_URL` drugačiji → svaki POST/PATCH/DELETE
  iz preglednika dobija 403 („Zahtjev nije dozvoljen.”), uključujući prijavu.
- **Dokaz (potvrđeno):** kroz vlastiti Nginx: `Host: localhost:8965`, `Origin: http://localhost:8965` → 403;
  `Origin: http://localhost` → 200.
- **Prijedlog:** `proxy_set_header Host $http_host;` ili u `docs/SERVER.md` jasno: `APP_URL` mora biti tačno
  javna adresa (šema, host, port).
- **Uloga:** DevOps.

### R-07 Fontovi i JS bez dugog keša u pregledniku

- **Ozbiljnost:** može kasnije (performanse).
- **Fajl:** `server/nginx-komodo.conf` (regex `\.(js|css|png|svg|webmanifest)$` nema `woff2`);
  `api/src/app.js` (`fastifyStatic` za `web/` bez `maxAge`).
- **Scenarij:** svako otvaranje aplikacije šalje uslovni zahtjev za 11 skripti, `style.css`, `fonts.css` i
  2–6 fontova. Skripte i CSS odgovara Nginx iz keša; **fontovi idu do Node procesa** (nisu u regexu). Uz
  `?v=` oznaku skripte bi mogle biti `immutable`.
- **Dokaz (potvrđeno):** `curl -I` na `/fonts/figtree-latin-400-normal.woff2` i `/js/feed.js?v=x` →
  `cache-control: public, max-age=0`.
- **Prijedlog:** dodati `woff2` u regex; za `?v=` zahtjeve i fontove `expires 30d` (ili `Cache-Control: public,
  max-age=31536000, immutable`) u Nginxu.
- **Uloga:** DevOps.

### R-08 `known_devices` se ne upisuje pri registraciji i postavljanju nove lozinke

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/rute/auth.js` — `register`, `reset` (upis je samo u `login`).
- **Scenarij:** korisnik se registruje (sesija odmah), nikad se ne prijavljuje ponovo. Kad se odjavi ili mu sesija
  istekne, napad s 30 pogrešnih lozinki s drugih adresa ga zaključa 15 min — kao da S-04 ne postoji. Isto važi
  za prvi ulazak u mobilnu aplikaciju (WebView ima svoj kolačić `did`). Izlaz postoji: „Zaboravljena lozinka”
  postavlja sesiju bez ograničenja prijave.
- **Dokaz:** potvrđeno čitanjem koda; test `backend-sigurnost.test.mjs` (S-04) mora vlasnika prvo prijaviti
  da bi uređaj postao poznat.
- **Prijedlog:** isti `insert into known_devices … on conflict do update` u `register` i `reset`.
- **Uloga:** Backend.

### R-09 Granica pregleda po IP adresi i CGNAT

- **Ozbiljnost:** može kasnije (gubi se samo brojanje pregleda).
- **Fajl i funkcija:** `api/src/rute/svidjanja-pregledi.js` — `countViews` (`views:ip:` 600/min).
- **Scenarij:** neprijavljeni šalju `/api/views` ~2×/min. Iza jedne javne adrese operatera (CGNAT) više od ~300
  aktivnih neprijavljenih → 429, pregledi se gomilaju u klijentu i gube. Uz to svi oni pišu u isti red
  `rate_limits` (vruć red pod opterećenjem).
- **Dokaz:** nepotvrđeno pod opterećenjem — procjena iz koda i budžeta iz `docs/SPEC-V1.md` (0).
- **Prijedlog:** test opterećenja u fazi 4 s mnogo neprijavljenih iza jedne adrese; po potrebi granicu dići
  (npr. 3.000/min) — od zloupotrebe već štiti potpisan `did` i granica po uređaju.
- **Uloga:** Backend (mjerenje: QA).

### R-10 Povratak na verziju prije 010 i ponovni prelaz

- **Ozbiljnost:** može kasnije (dokumentacija).
- **Fajl:** `api/migrations/010_sigurnost.sql`, `docs/RUNBOOK.md`.
- **Scenarij:** objava → problem → povratak na `c2cf623` (radi, provjereno) → stari API pravi sesije sa sirovim
  tokenom u bazi → ponovna objava: 010 se ne pokreće ponovo, pa su svi prijavljeni u tom periodu odjavljeni,
  a sirovi tokeni ostaju u bazi do isteka (30 dana). Linkovi `#potvrda=` iz emailova poslanih prije povratka ne
  rade u starom webu.
- **Dokaz:** stari API nad novom šemom potvrđen (gore); posljedice zaključene iz koda.
- **Prijedlog:** u RUNBOOK („Vraćanje prethodne verzije”) dodati: poslije ponovne objave pokrenuti
  `update sessions set token = encode(sha256(convert_to(token,'UTF8')),'hex') where length(token) <> 64`.
- **Uloga:** DevOps (SQL potvrđuje Backend).

### R-11 CI `node --check` ne provjerava `mobile/App.js` i `mobile/app.config.js`

- **Ozbiljnost:** može kasnije.
- **Fajl:** `.github/workflows/ci.yml`, korak „node --check svih .js/.mjs”.
- **Scenarij:** u Node 22.23 `node --check` za `.js` bez `"type": "module"` koji sadrži `import` vraća 0 i kad je
  sintaksa pogrešna (a JSX ionako ne zna pročitati). Korak daje lažnu sigurnost za mobilni kod; `api/` i `web/`
  se provjeravaju ispravno.
- **Dokaz (potvrđeno):** kopija `mobile/App.js` + red `const x = ;` → `node --check` izlaz 0; isti red u kopiji
  `web/js/feed.js` → izlaz 1.
- **Prijedlog:** isključiti `mobile/` iz koraka i dodati zaseban korak `cd mobile && npm ci && npx expo export
  --platform android` (ili bar parsiranje Babelom).
- **Uloga:** QA.

## Provjereno i u redu

- **Podjela na module:** sve 37 ruta iz `c2cf623:api/src/server.js` postoje u `api/src/rute/*` (nova je samo
  `POST /api/auth/verify`); isti rukovalac greškama i „ne postoji”. Web: sve funkcije i elementi iz starog
  `app.js` postoje (osim `params/startId/startShop`, zamijenjeni sa `readLink`); nema dupliranih globalnih imena.
  Namjerne promjene: brojanje oglasa butika i `/api/likes` po pravilu vidljivosti, `#lozinka`/`#potvrda`,
  forma za novu lozinku i za prijavljenog.
- **Oglas u obradi (PLAN 4):** `VISIBLE_SQL` u feedu, jednom oglasu, ukupnom broju, `/api/shops` (broj i
  sličica samo `ready`), `/api/likes`, sviđanju i pregledima; javni keš feeda se puni s `$1 = 0` pa ne može
  sadržati oglas u obradi; butik ide mimo keša. Test s lažnim Bunnyjem prolazi. OG (F-02) još ne postoji.
- **Sesije:** sha256 u bazi, migracija 010 pretvara sesije i (kaskadom) `push_tokens.session_token`
  (provjereno na kopiji). Odjava, nova lozinka, brisanje i gašenje brišu sesije u bazi.
- **S-04:** nepotpisan ili tuđ `did` ne važi kao poznat uređaj; `known_devices` je po (korisnik, uređaj).
- **S-07:** potpisan `did`; novi uređaj se ne broji i ne piše u bazu.
- **S-02:** kroz pravi Nginx klijentov `X-Forwarded-For: 6.6.6.6` se pregazi (ključ `login:ip:127.0.0.1:…`).
  API vjeruje prvom skoku bez obzira na adresu, što je sigurno samo jer je port vezan na `127.0.0.1`
  (`docker-compose.yml`) — tako i ostaviti.
- **S-12 Origin i omotač:** WebView učitava `https://komodo.ba` i šalje isti `Origin` za fetch, XHR multipart i
  `sendBeacon` (isti sajt) → prolazi; `Origin: null` i tuđi → 403; bez `Origin` → prolazi (SameSite=Lax).
  `www.` varijanta prolazi preko poređenja s `Host`.
- **Nginx:** `nginx -t` prolazi; CSP bez Google fontova, bez inline skripti u `index.html`; HSTS, `nosniff`,
  `X-Frame-Options` se nasljeđuju i u `/media/` (`expires` ih ne gazi); `/media/` ne izlazi iz direktorija i ne
  služi skrivene fajlove; dnevnik bez upita iz adrese.
- **Skripte:** `bash -n` za sve; `kopija-baze.sh` lokalno (lažni `KOPIJA_DUMP`) pravi i provjerava kopiju, a pad
  dumpa ne ostavlja fajl; `nadzor.sh` sa `SUHO=1` radi; SMTP lozinka ide kroz `curl -K -`, ne u `ps`.
  `db-init/10-komodo-app.sh`: komodo_app bez superusera; migracije kao vlasnik baze rade.
- **Migracije 009/010:** samo zadane konstante (bez prepisivanja tabela), indeksi na 10.000 oglasa za
  milisekunde; zaključavanje velikih tabela traje <0,1 s. Nisu „idempotentne” same po sebi, ali ih štiti
  `schema_migrations` + transakcija po fajlu, a pokreće ih samo primarni proces.
- **Performanse:** nema novog upita po zahtjevu na čestim rutama, osim `views:ip:` za neprijavljene (R-09);
  `known_devices` samo pri prijavi (PK); Origin u memoriji; heš sesije samo kad nema keša. Klijent ne dodaje
  tajmer; `app-verzija.json` jednom po pokretanju omotača, keširan 5 min u Nginxu.
- **Testovi:** provjeravaju stanje u bazi (npr. `likes_count` = redovi, 0 fajlova poslije prekida, ključevi u
  `rate_limits`), a ne samo statuse; portovi i baze nasumični, pa paralelni pokreti ne sudaraju. CI: Node 22,
  `postgres:16` servis, Playwright Chromium — isti koraci prošli lokalno.
- **SPEC 7 i 8:** „Provjeren butik” = `verified: true` za sve butike; ništa ne zavisi od isključivanja Bunny
  zaštite.
