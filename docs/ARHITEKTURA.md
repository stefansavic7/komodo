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
| `poslovi.js` | Pozadinski poslovi (kroz bazen `poolPosao`, rok upita 2 min): sabiranje razlika sviđanja `saberiSvidjanja` (1 s, talas 4), outbox (1 s, `outbox.js`), slanje snimaka na Bunny i provjera obrade (20 s), email butiku za nepročitanu poruku (1 min), čišćenje (10 min), ocjena oglasa `base_score` (5 min, piše samo u tabelu `listing_scores`, migracija 012 — ne zaključava redove `listings`, R2-02; `KOMODO_SCORE_MS` samo za mjerenje), brojke administratora (15 min). `sendToBunny` koristi i objava oglasa. |
| `rute/staticki.js` | `/` i `/index.html` (index s oznakom verzije `?v=` i OG oznakama), `sendIndex` za nepoznate putanje, `onSend` hook s `Cache-Control` za fajlove iz `web/` (`cacheControlZa`: `?v=` → godinu dana `immutable`, fontovi 30 dana, ostalo `max-age=0`; `/api/`, `/media/`, `/og/` se ne diraju). |
| `rute/og.js` | Pregled linka pri dijeljenju (F-02): `ogIndex` umeće `og:*` oznake neposredno prije `</head>` (bez `<!--OG-->` markera u `index.html`), `GET /og/<id>.jpg` služi sličicu s diska (`UPLOADS_DIR/og/`); preuzima je s Bunnyja sa serverske strane, a bez nje daje zajedničku `og-komodo.png`. Registruje se iz `staticki.js`. Sličica se briše kad se oglas obriše ili ugasi; keš HTML-a i podataka o oglasu briše `ocistiKesFeeda` (`ocistiKesOgOvdje`, R2-03). |
| `rute/opste.js` | `/api/health`, `/api/categories`. |
| `rute/auth.js` | `/api/auth/*`: registracija, prijava, odjava, potvrda emaila, zaboravljena i nova lozinka. |
| `rute/profil.js` | `/api/me` (čitanje, izmjena), `/api/me/password`, `/api/me/delete`. |
| `rute/push.js` | `/api/me/push-token`; `posaljiPushSeriju(serija)` je jedino mjesto koje govori s Expo-om (jedan zahtjev do 100 poruka, zaglavlja, `EXPO_ACCESS_TOKEN`, rok 10 s, brisanje tokena `DeviceNotRegistered`; baca grešku da outbox pokuša ponovo); `posaljiPush` je omotač bez ponavljanja. Push o poruci i sniženju ide kroz outbox. |
| `snizenje.js` | Sniženje (F-07): `zakaziSnizenje` upisuje red `snizenje` u outbox u transakciji `PATCH /api/listings/:id`; `rasporediSnizenje` (zove ga outbox) u serijama po 100 zauzme kupce (`likes.price_notified_at`, 24 h, `push_enabled`, blokade, `skip locked`) i u istoj transakciji upiše redove `push` (kanal `PUSH_SNIZENJA_KANAL`, najviše 5.000 kupaca po sniženju). |
| `outbox.js` | Odgođeni poslovi koji se ne gube (talas 4): `obradiOutbox` zakupi redove (`for update skip locked`, `run_at` + zakup), pošalje push u serijama do 100 (`posaljiPushSeriju`), greška → ponovo s rastućim čekanjem, poslije `OUTBOX_POKUSAJA` „mrtav” red; `obradiUskoro` (proces koji je upisao red odmah pokrene prolaz). |
| `rute/rezim.js` | „Veliki crveni prekidač” (talas 4): `GET /api/config` (intervali i zastavice po režimu, keš 30 s), `GET/POST /api/admin/rezim`; režim se čita iz `app_settings` pri startu i svakih 30 s, a promjena ide svim procesima preko `javiSvima('rezim')`. |
| `rute/butici.js` | `/api/shops/:handle`. |
| `rute/oglasi.js` | `/api/listings` (pretraga, profil butika, „Sviđa mi se”), jedan oglas, objava, izmjena, brisanje; registruje i `rute/feed.js`. |
| `rute/feed.js` | `GET /api/feed` (F-01): kartice „Za tebe” (ocjena `base_score` iz tabele `listing_scores`, računa je posao u `poslovi.js`; `izuzmi` do 400 id-jeva, R2-01), „Novo” i „Praćeni”; zajednička strana oglasa (`stranaOglasa`) s kešom javnog feeda 5 s i `ocistiKesFeeda` (feed + OG keš, svi procesi; zovu ga objava, izmjena, brisanje oglasa, gašenje naloga i brisanje naloga). Registruje se iz `oglasi.js`. |
| `rute/svidjanja-pregledi.js` | `/api/likes`, `/api/listings/:id/like`, `/api/views`, `/api/listings/:id/view`. |
| `rute/poruke.js` | `/api/conversations*`: razgovori, poruke, blokiranje. |
| `rute/prijave-admin.js` | `/api/report-reasons`, `/api/reports`, `/api/admin/*`; registruje i `rute/statistika.js`. |
| `rute/statistika.js` | `GET /api/me/stats` (butik, F-06) i `GET /api/admin/stats` (F-09): agregati nad `listing_views`, `likes`, `listing_contacts`, keš u procesu (5 min po butiku i periodu, 60 s admin) uz dijeljenje istovremenih upita. |
| `db.js` | Bazen API-ja (`statement_timeout` 5 s, `idle_in_transaction_session_timeout` 10 s), bazen poslova `poolPosao`/`qPosao` (rok 2 min, 3 veze), `uTransakciji` (transakcija s rukovaocem greške veze), `bazaNeOdgovara(err)` (greške → 503), migracije (bez roka). |
| `mail.js`, `nalog.js`, `video.js` | Email, nalozi i lozinke, Bunny (nepromijenjeno). |

### Otpornost (talas 4, 24.11.2026.)

Po predavanju „Forgotten Scaling Techniques” (`docs/PLAN-PRODUKCIJA.md`, Faza 2b). Testovi: `api/test/otpornost.test.mjs`,
`tests/e2e/otpornost.spec.mjs`, `npm run test:istovremenost`.

| Tehnika | Gdje | Šta tačno |
|---|---|---|
| Rokovi | `db.js`, `app.js` (Fastify), `server.js` | Upit API-ja najviše `PG_STATEMENT_TIMEOUT_MS` (5 s, i čekanje na bravu); transakcija u mirovanju 10 s; poslovi 2 min. HTTP: `connectionTimeout` 120 s je rok **neaktivnosti** (spor upload 110 MB prolazi dok podaci teku), `requestTimeout` 30 min za cijeli zahtjev. Istekao rok / baza ne prima veze / bazen pun → `503 {"greska":"Server je trenutno preopterećen. Pokušaj ponovo za trenutak."}` + `Retry-After` (5–10 s, nasumično), nikad 500. |
| Retry-After | `app.js` (`onSend`), Nginx `@komodo_429`/`@komodo_503` | Svaki 429 i 503 ima `Retry-After` (API: 429 ~30–60 s, 503 ~5–10 s; Nginx 429 → 30 s, 502/504 → 503 s 15 s). |
| Klijent: rasipanje i čekanje | `web/js/osnova.js` (`tajmer`, `sljedeciRazmak`, `zabiljeziOdgovor`) | Svi periodični pozivi (sviđanja, značka/`/api/me`, profil, razgovor, pregledi, konfiguracija) idu kroz `tajmer(kljuc, fn)`: interval iz `/api/config` ±20 %, sljedeći poziv tek kad prethodni završi; poslije greške mreže/5xx/429 ×2 po grešci (najviše 5 min) i nikad prije `Retry-After`; prvi uspjeh vraća na normalno. Prvi poziv svakog tajmera u nasumičnom trenutku (20–100 % intervala), `/api/me/follows` 0–3 s poslije starta; feed i `/api/me` pri startu idu odmah. |
| „Veliki crveni prekidač” | `rute/rezim.js`, `app.js` (`rezim()`), `web/js/osnova.js` (`KONFIG`), `admin.js` | `GET /api/config` → `{rezim, intervali:{likes,me,profil,chat,views,config}, licniFeed, pregledi}`, keš 30 s (preglednik i Nginx). Režim: `app_settings.rezim` (administracija) ili `KOMODO_REZIM`. `stedi` = duži intervali; `hitno` = „Za tebe” vraća keširanu prvu stranu „Novo” s `kraj:true, rezim:'hitno'` (klijent nastavlja „Novo” bez razdjelnika), `/api/views` ne piše ništa, klijent ne šalje preglede, razgovor 15 s. Odgovori API-ja nose `X-Komodo-Rezim`; klijent na promjenu odmah traži `/api/config?r=<režim>`. Uputstvo: `docs/RUNBOOK.md` 4a. |
| Stari keš | `rute/feed.js` (`zadnjeDobro`, `cachedIliStaro`) | Kad baza ne odgovara: javni feed (`/api/listings`, „Novo”) i „Za tebe” za neprijavljene služe zadnji dobar sadržaj uz `X-Komodo-Zastarjelo: 1` (lični faktori neprijavljenog se preskaču). Prijavljeni i ostale rute → 503. |
| Vruć brojač | `rute/svidjanja-pregledi.js`, `poslovi.js` (`saberiSvidjanja`), `listing_likes_delta` (013) | Sviđanje upisuje +1/−1 u `listing_likes_delta` umjesto `update listings` — hiljade kupaca istog oglasa više ne čekaju jedan red. Posao svake sekunde sabere razlike u `likes_count` (zaključava redove po id-ju, `lock_timeout` 200 ms). Čitanja (`LISTING_SELECT`, `/api/likes`, odgovor na sviđanje) = `likes_count` + nesabrane razlike. Brisanje naloga briše sviđanja i upisuje −1. Izmjereno (2 jezgra, 200 istovremenih, 15 s): isti oglas 1.057–1.099 → 1.463–1.607 sviđanja/s, p95 289–360 → 199–230 ms; različiti oglasi ~1.700–1.840/s prije i poslije. |
| Outbox | `outbox.js`, `snizenje.js`, `rute/poruke.js`, `rute/oglasi.js`, tabela `outbox` (013) | Push o poruci se upisuje u istoj naredbi kao poruka (samo ako primalac ima token i uključena obavještenja), sniženje u transakciji izmjene. Slanje: zakup `for update skip locked` (dva procesa nikad isti red), serije do 100, ponovo 5 s·2^n (do 10 min, +0–20 %), poslije 6 pokušaja `dead_at`. Pad procesa usred slanja: red se ponovo pošalje kad istekne zakup (120 s). |
| Idempotency-Key | `app.js` (`idempotentno`), `idempotency_keys` (013), `web/js/poruke.js`, `objava.js` | `POST /api/conversations/:id/messages` i `POST /api/listings`: isti ključ istog korisnika u 24 h → sačuvan odgovor (`Idempotent-Replay: true`) bez novog upisa; dok prvi radi → 409 + `Retry-After: 2`; ne-2xx odgovor briše ključ. Klijent: ključ po poruci (isti pri ponovnom slanju istog teksta) i po izabranom snimku. Čišćenje poslije 24 h u `cleanup`. |

### Poruke između radnika (`javiSvima` / `naPoruku`)

Keševi su u memoriji svakog procesa (`WORKERS` > 1), pa proces koji nešto poništi (sesiju, korisnika, feed)
javlja ostalima: `javiSvima(vrsta, vrijednost)` šalje radnik → primarni proces (`index.js`) → svi ostali
radnici; ko treba da reaguje registruje `naPoruku(vrsta, fn)` (oboje u `app.js`). Bez clustera (`npm run dev`,
testovi sa `server.js`) `javiSvima` ne radi ništa, a izmjena se izvršava samo lokalno. Novi keš koji se poništava
mora ići ovim putem, inače drugi proces do 15 s služi stare podatke (nalaz R-01).

Zavisnosti idu u jednom smjeru: `rute/*` → `app.js` (i `db.js`, `mail.js`, `nalog.js`, `video.js`);
`rute/oglasi.js` → `poslovi.js` → `app.js`; `rute/poruke.js`, `rute/oglasi.js`, `poslovi.js` → `outbox.js` →
`rute/push.js`, `snizenje.js`. `app.js` ne uvozi rute.

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
| 1 | `osnova.js` | `CATS`, sve zajedničko stanje (`me`, `items`, `shop`, `filter`, tajmeri…), elementi stranice (`feed`, `profile`…), `ICON`, `$`, `esc`, `fmtKM`, `toast`, `api()` (+ dodatna zaglavlja), `needLogin`, `removeListing`, `confirmAction` (prozor s potvrdom); talas 4: `KONFIG`, `tajmer`/`staniTajmer`, `sljedeciRazmak`, `zabiljeziOdgovor`, `ucitajKonfig`, `noviKljuc`. |
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
| `KONFIG`, `tajmer(kljuc, fn)`, `intervalZa(kljuc)` | `osnova.js` | Talas 4: intervali sa servera (`/api/config`) i periodični tajmeri (vidi „Otpornost”). Sviđanja na ekranu: `tajmer('likes', refreshLikes)` u `start.js` i `prikazi.js`; `refreshLikes` sam ne ide češće od 75 % intervala (B-01). `LIKES_EVERY` ostaje samo kao zadana vrijednost. |

### Kako dodati ekran

1. HTML ekrana u `web/index.html` (`<section ... hidden>`), stil u `web/style.css`.
2. Novi fajl `web/js/<ekran>.js` s istim zaglavljem kao ostali, dodaj `<script src="/js/<ekran>.js"></script>`
   u `index.html` prije `start.js`.
3. Element stranice i stanje ekrana drži u svom fajlu; ako ga treba `show()`, dodaj ga u `prikazi.js`.
4. Tajmer samo dok je stranica vidljiva (`pageVisible()`), gasi se u `show()` (`docs/SKALIRANJE.md`). Periodični
   poziv servera ide kroz `tajmer('<ključ iz KONFIG.intervali>', fn)` (ne `setInterval`): dobija interval sa
   servera, rasipanje ±20 % i čekanje poslije grešaka; `fn` neka vrati obećanje poziva.

### Oznaka verzije

Server pri startu računa sha1 svih `web/js/*.js` i svih `web/*.css` (po abecedi, s imenom fajla) i dodaje
`?v=<10 znakova>` na svaki lokalni `<script src="/...">` i lokalni stylesheet u `index.html`
(`rute/staticki.js`). Ista oznaka je `verzija` u `/api/health`. Novi fajl u `web/js/` ulazi u oznaku sam.
