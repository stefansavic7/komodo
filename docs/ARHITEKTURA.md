# Arhitektura koda Komoda

Stanje od 20.11.2026. (faza 1; dopunjeno za v1, talase 2 i 3): `api/src/server.js` i `web/app.js` su podijeljeni na module bez promjene
ponašanja, da više ljudi može raditi u paraleli bez sudara u istom fajlu. Jedina namjerna promjena je
`/api/health` (provjerava bazu).

## API (`api/src/`)

| Fajl | Šta je u njemu |
|---|---|
| `index.js` | Pokretanje u više procesa (cluster): migracije jednom, pa `WORKERS` radnika koji izvršavaju `server.js` (`KOMODO_MIGRATE=0`, pozadinske poslove radi samo prvi: `KOMODO_JOBS=1`). |
| `server.js` | Ulazna tačka jednog procesa: registruje rute, rukovalac greškama i „ne postoji”, migracije (osim kad je `KOMODO_MIGRATE=0`), `listen`, pozadinski poslovi (osim kad je `KOMODO_JOBS=0`), gašenje na SIGINT/SIGTERM. `npm run dev` pokreće ovaj fajl direktno. |
| `app.js` | **Zajednički kontekst**: podešavanja iz okoline (`PORT`, `UPLOADS_DIR`, `APP_URL`, `ADMIN_EMAILS`…), `CATEGORIES`, Fastify instanca `app` s pluginovima (kolačići, multipart, statika `/media/` i `web/`), keš prijava i `currentUser`, sesije, `limited` (ograničenja u bazi), pomoćne funkcije (`bad`, `clean`, `isId`, `parsePrice`, `publicUser`, `publicListing`, `LISTING_SELECT`, `inTransaction`, `removeListingFiles`, `unreadCount`, `myConversation`…). |
| `poslovi.js` | Pozadinski poslovi: slanje snimaka na Bunny i provjera obrade (20 s), email butiku za nepročitanu poruku (1 min), čišćenje (10 min), ocjena oglasa `base_score` (5 min, piše samo u tabelu `listing_scores`, migracija 012 — ne zaključava redove `listings`, R2-02; `KOMODO_SCORE_MS` samo za mjerenje), brojke administratora (15 min). `sendToBunny` koristi i objava oglasa. |
| `rute/staticki.js` | `/` i `/index.html` (index s oznakom verzije `?v=` i OG oznakama), `sendIndex` za nepoznate putanje, `onSend` hook s `Cache-Control` za fajlove iz `web/` (`cacheControlZa`: `?v=` → godinu dana `immutable`, fontovi 30 dana, ostalo `max-age=0`; `/api/`, `/media/`, `/og/` se ne diraju). |
| `rute/og.js` | Pregled linka pri dijeljenju (F-02): `ogIndex` umeće `og:*` oznake neposredno prije `</head>` (bez `<!--OG-->` markera u `index.html`), `GET /og/<id>.jpg` služi sličicu s diska (`UPLOADS_DIR/og/`); preuzima je s Bunnyja sa serverske strane, a bez nje daje zajedničku `og-komodo.png`. Registruje se iz `staticki.js`. Sličica se briše kad se oglas obriše ili ugasi; keš HTML-a i podataka o oglasu briše `ocistiKesFeeda` (`ocistiKesOgOvdje`, R2-03). |
| `rute/opste.js` | `/api/health`, `/api/categories`. |
| `rute/auth.js` | `/api/auth/*`: registracija, prijava, odjava, potvrda emaila, zaboravljena i nova lozinka. |
| `rute/profil.js` | `/api/me` (čitanje, izmjena), `/api/me/password`, `/api/me/delete`. |
| `rute/push.js` | `/api/me/push-token`; `posaljiPush(log, poruke)` je jedino mjesto koje govori s Expo-om (serije po 100, zaglavlja, `EXPO_ACCESS_TOKEN`, brisanje tokena `DeviceNotRegistered`); `pushNewMessage` je gradi za poruku. |
| `snizenje.js` | `obavijestiOSnizenju` (F-07): push kupcima koji su označili oglas kad butik snizi cijenu; zove ga `PATCH /api/listings/:id` bez čekanja, šalje kroz `posaljiPush` na kanal `PUSH_SNIZENJA_KANAL` (zadano `snizenja`), u serijama (najviše 5.000 kupaca po sniženju). |
| `rute/butici.js` | `/api/shops/:handle`. |
| `rute/oglasi.js` | `/api/listings` (pretraga, profil butika, „Sviđa mi se”), jedan oglas, objava, izmjena, brisanje; registruje i `rute/feed.js`. |
| `rute/feed.js` | `GET /api/feed` (F-01): kartice „Za tebe” (ocjena `base_score` iz tabele `listing_scores`, računa je posao u `poslovi.js`; `izuzmi` do 400 id-jeva, R2-01), „Novo” i „Praćeni”; zajednička strana oglasa (`stranaOglasa`) s kešom javnog feeda 5 s i `ocistiKesFeeda` (feed + OG keš, svi procesi; zovu ga objava, izmjena, brisanje oglasa, gašenje naloga i brisanje naloga). Registruje se iz `oglasi.js`. |
| `rute/svidjanja-pregledi.js` | `/api/likes`, `/api/listings/:id/like`, `/api/views`, `/api/listings/:id/view`. |
| `rute/poruke.js` | `/api/conversations*`: razgovori, poruke, blokiranje. |
| `rute/prijave-admin.js` | `/api/report-reasons`, `/api/reports`, `/api/admin/*`; registruje i `rute/statistika.js`. |
| `rute/statistika.js` | `GET /api/me/stats` (butik, F-06) i `GET /api/admin/stats` (F-09): agregati nad `listing_views`, `likes`, `listing_contacts`, keš u procesu (5 min po butiku i periodu, 60 s admin) uz dijeljenje istovremenih upita. |
| `db.js`, `mail.js`, `nalog.js`, `video.js` | Baza, email, nalozi i lozinke, Bunny (nepromijenjeno). |

### Poruke između radnika (`javiSvima` / `naPoruku`)

Keševi su u memoriji svakog procesa (`WORKERS` > 1), pa proces koji nešto poništi (sesiju, korisnika, feed)
javlja ostalima: `javiSvima(vrsta, vrijednost)` šalje radnik → primarni proces (`index.js`) → svi ostali
radnici; ko treba da reaguje registruje `naPoruku(vrsta, fn)` (oboje u `app.js`). Bez clustera (`npm run dev`,
testovi sa `server.js`) `javiSvima` ne radi ništa, a izmjena se izvršava samo lokalno. Novi keš koji se poništava
mora ići ovim putem, inače drugi proces do 15 s služi stare podatke (nalaz R-01).

Zavisnosti idu u jednom smjeru: `rute/*` → `app.js` (i `db.js`, `mail.js`, `nalog.js`, `video.js`);
`rute/oglasi.js` → `poslovi.js` → `app.js`; `rute/poruke.js` → `rute/push.js`. `app.js` ne uvozi rute.

### Kako dodati rutu

1. Ruta ide u postojeći fajl u `rute/` po temi; nova tema → novi fajl `rute/<tema>.js`:

   ```js
   import { q } from '../db.js';
   import { bad, currentUser } from '../app.js';

   export default function rute(app) {
     app.get('/api/nesto', async (req, reply) => {
       const user = await currentUser(req);
       if (!user) return bad(reply, 401, 'Prijavi se.');
       return { ok: true };
     });
   }
   ```

2. Novi fajl dodaj u spisak u `server.js` (import i niz `for (const registruj of [...])`).
3. Rute se registruju direktno na `app` (bez `app.register`), pa vrijede isti rukovalac greškama, isti
   kolačići i isti keš prijava kao za sve ostale.
4. Pomoćna funkcija koju trebaju dva ili više fajlova ide u `app.js`; ona koju treba samo jedan fajl ostaje u njemu.
5. Keš u memoriji je po procesu (vidi komentare kod `userCache` i `feedCache`); ograničenja moraju ići
   kroz `limited` (baza), ne kroz memoriju, jer radi više procesa.
6. Posao koji se ponavlja ide u `poslovi.js` (`pokreniPoslove`) — radi samo u jednom procesu.

### `/api/health`

`select 1` s rokom od 1 s. Baza radi → `200 {"ok":true,"baza":true,"verzija":"<oznaka web fajlova>"}`;
inače `503 {"ok":false,"baza":false}`. Docker `HEALTHCHECK` (wget) i `server/nadzor.sh` gledaju samo
status. Izmjereno lokalno: baza ne sluša → 503 za 16 ms; baza prima vezu, a ne odgovara → 503 za 1,0 s.

## Web (`web/`)

Bez gradnje i bez modula: `web/js/*.js` su obični skriptovi u globalnom opsegu (ES5 stil: `var`,
`function`, `'use strict'` na vrhu svakog fajla). `index.html` ih učitava ovim redom:

| Red | Fajl | Šta je u njemu |
|---|---|---|
| 1 | `osnova.js` | `CATS`, sve zajedničko stanje (`me`, `items`, `shop`, `filter`, tajmeri…), elementi stranice (`feed`, `profile`…), `ICON`, `$`, `esc`, `fmtKM`, `toast`, `api()`, `needLogin`, `removeListing`, `confirmAction` (prozor s potvrdom). |
| 2 | `omotac.js` | Mobilni omotač: `toApp`, `registerPush`, `window.__komodoPush`, `__komodoOpenChat`, `__komodoBack`, prekidač push obavještenja. |
| 3 | `feed.js` | Kartice, učitavanje strana, sviđanja, pregledi (`/api/views`), zvuk, dijeljenje, pretraga, prijava sadržaja, kategorije, feed jednog butika. |
| 4 | `objava.js` | Objava oglasa (video) i izmjena oglasa; Escape zatvara prozore. |
| 5 | `butik.js` | Javni profil butika i kontakt. |
| 6 | `prijava.js` | Prijava, registracija, odjava, zaboravljena/nova lozinka, potvrda emaila, promjena lozinke. |
| 7 | `profil.js` | Vlastiti profil, linkovi, brisanje naloga, mreža „Moji oglasi” / „Sviđa mi se”. |
| 8 | `prikazi.js` | `show(view)` (ekrani i tajmeri), donji meni, značka poruka, `afterAuthChange`, povratak na stranicu. |
| 9 | `poruke.js` | Spisak razgovora, razgovor, dovlačenje svake 4 s, blokiranje. |
| 10 | `admin.js` | Administracija. |
| 11 | `statistika.js` | Ekran statistike butika (F-06): `openStats`, `fmtBroj`; bez tajmera. |
| 12 | `start.js` | Parametri iz adrese i prvi ekran. **Uvijek zadnji.** |

Pravilo redoslijeda: funkcija iz drugog fajla smije se **pozvati** bilo kad (pri kliku, u tajmeru), ali se
pri učitavanju smije **predati kao vrijednost** (npr. `addEventListener('click', openPost)`) samo ako je
fajl s njom učitan ranije. Inače se zamota: `function () { openPost(); }`. Kod koji se izvršava odmah pri
učitavanju (van funkcija) smije koristiti samo ono što je u istom ili ranijem fajlu. Imena su globalna:
novo ime ne smije ponoviti postojeće (`grep -n "function ime\|var ime" web/js/*.js`).

Stilovi su tri fajla, učitavaju se ovim redom: `style.css` (osnova), `butik.css` (javni i vlastiti profil butika, praćenje,
radno vrijeme, „Uredi profil”; P3) i `statistika.css` (statistika butika, razgovor, spisak razgovora, brojke
administratora; P5). Sva tri nose `?v=` oznaku.

### Globalne funkcije između skripti

Skripte dijele globalni opseg, pa ove funkcije i vrijednosti drugi fajlovi smiju zvati:

| Ime | Gdje je | Čemu služi |
|---|---|---|
| `followShop(handle, name, want)`, `isFollowing(handle)`, `ensureFollows(fresh)` | `butik.js` | Praćenje butika (F-04): skup praćenih se učita jednom po prijavi (`GET /api/me/follows`) i mijenja lokalno; koristi ih i kartica oglasa u `feed.js`. |
| `openStats(listingId?)` | `statistika.js` | Otvara ekran statistike (profil butika, kartica oglasa); nema tajmera. |
| `window.__komodoOpenListing(id)` | `feed.js` | Dodir na push o sniženju (mobilni omotač): feed „Novo” s tim oglasom prvim. |
| `window.__komodoOpenUrl(path)` | `omotac.js` | Link dok aplikacija radi (`komodo://`, `https://komodo.ba/...`): otvara `?o=`, `?b=`, `?poruke=` bez ponovnog učitavanja. |
| `needLogin(msg)` | `osnova.js` | Toast i prelazak na prijavu. Za radnju koja se ne smije izgubiti (U-04) `needAccount` u `feed.js` čuva nameru u `sessionStorage` pod `komodo.posle` (traje 30 min) i otvara „Novi nalog”; `readPosle`/`clearPosle` je vraćaju poslije prijave. |
| `LIKES_EVERY` | `osnova.js` | Najmanji razmak osvježavanja sviđanja na ekranu (30 s, B-01); koriste ga `refreshLikes` (`feed.js`) i tajmeri u `start.js` i `prikazi.js`. |

### Kako dodati ekran

1. HTML ekrana u `web/index.html` (`<section ... hidden>`), stil u `web/style.css`.
2. Novi fajl `web/js/<ekran>.js` s istim zaglavljem kao ostali, dodaj `<script src="/js/<ekran>.js"></script>`
   u `index.html` prije `start.js`.
3. Element stranice i stanje ekrana drži u svom fajlu; ako ga treba `show()`, dodaj ga u `prikazi.js`.
4. Tajmer samo dok je stranica vidljiva (`pageVisible()`), gasi se u `show()` (`docs/SKALIRANJE.md`).

### Oznaka verzije

Server pri startu računa sha1 svih `web/js/*.js` i svih `web/*.css` (po abecedi, s imenom fajla) i dodaje
`?v=<10 znakova>` na svaki lokalni `<script src="/...">` i lokalni stylesheet u `index.html`
(`rute/staticki.js`). Ista oznaka je `verzija` u `/api/health`. Novi fajl u `web/js/` ulazi u oznaku sam.
