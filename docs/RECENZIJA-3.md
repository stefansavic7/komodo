# Recenzija 3 — talas 4 „otpornost” (cf22969..256f6cb)

Recenzent: nezavisni pregled, 24.11.2026. Pregledano: rokovi (`api/src/db.js` — `opcije`, `poolPosao`,
`uTransakciji`, `bazaNeOdgovara`; `app.js` — Fastify rokovi, `preopterecen`, `onSend`; `server.js` — rukovalac
greškama), „veliki crveni prekidač” (`rute/rezim.js`, `/api/config`, `web/js/osnova.js` — `tajmer`,
`zabiljeziOdgovor`, `provjeriRezim`; `admin.js`), stari keš feeda (`rute/feed.js` — `zadnjeDobro`, `cachedIliStaro`),
vruć brojač (`listing_likes_delta`, `LIKE_SQL`, `saberiSvidjanja`, brisanje naloga), outbox (`outbox.js`,
`snizenje.js`, `rute/push.js`, `rute/poruke.js`, `rute/oglasi.js`), `Idempotency-Key` (`app.js` — `idempotentno`,
`web/js/poruke.js`, `objava.js`), imenovane naredbe, Nginx (`@komodo_429`/`@komodo_503`, `location = /api/config`),
migracija 013, novi testovi.

## Presuda

**Spremno za spajanje: DA. Spremno za objavu: uz uslove** — prije objave riješiti R3-01 (zaglavljen
`Idempotency-Key` blokira slanje iste poruke 35 min, potvrđeno) i R3-02 (jedan „tuđi” push token može
oboriti cijelu seriju pusha drugih korisnika; nepotvrđeno pokretanjem). Ostalo može kasnije. Nijedan nalaz ne
blokira spajanje; svi testovi su zeleni, a mjerenja ne pokazuju pogoršanje (vruć brojač je jasno bolji).

| Ozbiljnost | Broj | Nalazi |
|---|---|---|
| blokira | 0 | – |
| prije objave | 2 | R3-01, R3-02 |
| može kasnije | 7 | R3-03 … R3-09 |

Pokrenuto (sve zeleno):

| Komanda | Ishod |
|---|---|
| `cd api && npm test` | 241/241, 0 preskočeno, 41,9 s |
| `npm run test:istovremenost` | 16 provjera OK („Sve provjere su prošle”), 12,3 s |
| `cd tests && CHROME_PATH=/usr/bin/google-chrome npx playwright test` | 36/36 (2,0 min) |
| `node --test mobile/navigacija.test.mjs` | 6/6 |

Nije pokrenuto: `nginx -t` s novom konfiguracijom (VM se restartovao usred recenzije; konfiguracija je pregledana
čitanjem — vidi „Provjereno i u redu”).

## Nalazi

### R3-01 Zaglavljen `Idempotency-Key`: poruka koja nije upisana ne može se poslati 35 min

- **Ozbiljnost:** prije objave (dešava se baš u situaciji za koju je talas napravljen — baza ne stiže).
- **Fajl i funkcija:** `api/src/app.js` — `idempotentno` (`IDEM_ZAGLAVLJEN_MIN = 35`, `catch` grana i brisanje
  ključa u `onSend`), `web/js/poruke.js` — submit `#chatForm` (isti ključ za isti tekst u istom razgovoru).
- **Scenarij:** ključ se upiše sa `status = null`, rukovalac padne (istekao `statement_timeout` → 503), a
  brisanje ključa (`delete … .catch(() => {})` ili u `onSend`) i samo istekne jer je baza i dalje preopterećena —
  ili proces padne/restartuje se (objava nove verzije) dok zahtjev radi. Red ostaje `status = null`. Klijent
  vrati tekst u polje; korisnik pritisne „Pošalji” ponovo → isti ključ → **409 „Ova radnja je već u toku”** idućih
  35 minuta, iako poruka nikad nije upisana. Isto za objavu (ključ po snimku): butik ne može objaviti isti snimak
  35 min osim ako izabere snimak ponovo.
- **Dokaz (potvrđeno):** API 3965 (`WORKERS=2`, production), razgovor 1, kupac 101. Sesija A drži
  `lock table messages in access exclusive mode` 8 s; 0,7 s poslije zahtjeva sesija B drži
  `lock table idempotency_keys` 12 s. Prvi `POST …/messages` s `Idempotency-Key` → **503 za 10,0 s** (5 s upis
  poruke + 5 s brisanje ključa). Poslije oslobađanja brava: dva ponovna slanja istim ključem → **409, 409**;
  u bazi: `idempotency_keys.status = null`, `messages` u razgovoru: **0**.
- **Prijedlog:** (1) rok „u toku” po ruti: poruka ~60 s (zahtjev bez uploada ne može trajati duže od
  `statement_timeout` × nekoliko upita), objava = `HTTP_REQUEST_TIMEOUT_MS`; (2) u redu ključa čuvati i
  `pid`/oznaku procesa i vrijeme posljednjeg „otkucaja”, ili brisanje ključa poslije greške pokušati ponovo
  kroz `poolPosao` / kasnije; (3) klijent: 409 dva puta zaredom za istu poruku → novi ključ samo ako server
  potvrdi da poruka ne postoji (npr. `GET …/messages?after=` ne sadrži tekst). Test: simulacija iz dokaza (dvije
  brave) → treći pokušaj poslije ~60 s mora proći i upisati tačno jednu poruku.
- **Uloga:** Backend (test: QA; klijent: Frontend).

### R3-02 Outbox: jedan neispravan/tuđi Expo token obara cijelu seriju (do 100 primalaca), sada i za poruke drugih korisnika

- **Ozbiljnost:** prije objave.
- **Fajl i funkcija:** `api/src/outbox.js` — `obradiOutbox` (pakuje redove `poruka` različitih primalaca u isti
  zahtjev), `neuspjeh`; `api/src/rute/push.js` — `posaljiPushSeriju` (`!resp.ok` → greška za cijelu seriju);
  `POST /api/me/push-token` (prihvata svaki token oblika `ExponentPushToken[…]`).
- **Scenarij:** Expo cijeli zahtjev odbija (HTTP 4xx) kad je u njemu token iz drugog Expo projekta
  (`PUSH_TOO_MANY_EXPERIENCE_IDS`) ili token koji ne prođe validaciju zahtjeva. Prije talasa 4 push o poruci je
  išao zasebnim zahtjevom po primaocu, pa je loš token kvario samo svoje obavještenje. Sada se redovi više
  korisnika pakuju zajedno: kupac koji registruje token iz svoje Expo aplikacije (oblik prolazi regex) i ima
  razgovore/sviđanja trajno kvari serije u koje upadne — 6 pokušaja, pa `dead_at` za sve redove serije (do 100
  primalaca), u svakom prolazu ispočetka. Isto za serije sniženja (100 kupaca).
- **Dokaz:** nepotvrđeno pokretanjem — lokalno nema pravog Expo-a, a provjera Expo dokumentacije nije bila
  moguća u ovoj sesiji; ponašanje 4xx za cijeli zahtjev je po poznatom ugovoru Expo push API-ja. Kod:
  `posaljiPushSeriju` baca grešku na svaki `!resp.ok`, `neuspjeh` je primjenjuje na sve `redovi` serije.
- **Prijedlog:** na 4xx (ne 429/5xx) seriju podijeliti (polovine, pa pojedinačno) i neuspješan pojedinačni red
  odmah označiti mrtvim (i obrisati token iz `push_tokens`); 429/5xx ostaju ponovni pokušaj cijele serije.
  Opciono: pri `PUSH_TOO_MANY_EXPERIENCE_IDS` iz `details` izbaciti tokene drugog projekta. Test s lažnim Expo-om
  koji vraća 400 kad serija sadrži određen token: ostali primaoci dobiju push.
- **Uloga:** Backend (test: QA).

### R3-03 `bazaNeOdgovara` pretvara i neke stvarne greške u 503 (maskiranje)

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/db.js` — `bazaNeOdgovara` (`'55000'`, `ENOTFOUND`, regex poruka).
- **Scenarij:** `55000` (object_not_in_prerequisite_state) nije preopterećenje — npr. `currval` prije `nextval`,
  greške u logici upita. Takva greška u kodu bi postala 503 s `Retry-After` i logom `warn` umjesto `error`, pa
  nadzor 5xx/500 ne bi pokazao bug, a javni feed bi služio stari keš bez kraja. `ENOTFOUND` je greška
  konfiguracije (DNS imena baze), ne trenutno opterećenje.
- **Dokaz:** potvrđeno čitanjem koda.
- **Prijedlog:** izbaciti `55000` i `ENOTFOUND`; ostaviti `57014`, `25P03`, `57P0x`, `53300`, `08xxx`, mrežne
  greške. Brojati 503 iz ove grane u nadzoru (`docs/RUNBOOK.md` 3) kao zaseban signal.
- **Uloga:** Backend.

### R3-04 Stari keš feeda (`zadnjeDobro`) ne prati brisanje/gašenje

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/rute/feed.js` — `zadnjeDobro`, `ocistiKesFeeda`/`naPoruku('feed')`.
- **Scenarij:** administrator ugasi butik ili ukloni oglas zbog prijave (sadržaj koji mora nestati), a kasnije
  baza zapne → neprijavljeni u „Novo”/„Za tebe” ponovo vide uklonjeni oglas (dok baza ne proradi), u svakom
  procesu. Privatni podaci ne cure: keširane strane su javni upiti (`$1 = 0`, samo `ready`), a `liked` za
  prijavljene traži bazu → 503 (provjereno čitanjem).
- **Dokaz:** potvrđeno čitanjem koda (komentar „Ne briše se pri ocistiKesFeeda” je namjeran).
- **Prijedlog:** pri `ocistiKesFeeda` iz `zadnjeDobro` izbaciti oglase s id-jem koji je ugašen/obrisan (poruka
  nosi id-jeve), ili bar kod gašenja i brisanja isprazniti `zadnjeDobro`. Uz to: dok baza ne odgovara, svaki
  zahtjev i dalje čeka do 5 s prije starog keša (nema „prekidača kola”) — razmotriti da se 10 s poslije prve
  greške stari keš služi odmah.
- **Uloga:** Backend.

### R3-05 Statistika butika čita `likes_count` bez nesabranih razlika

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/rute/statistika.js` — red 40 (`l.likes_count as likes_all`).
- **Scenarij:** svugdje gdje se broj prikazuje (`LISTING_SELECT` → feed i keš feeda, `/api/likes`, odgovor na
  sviđanje) čita se `likes_count + delta`, osim statistike butika. Normalno kasni ≤ 1 s, ali dok posao ne radi
  (pad radnika s poslovima, `KOMODO_JOBS=0` greškom, stalni `lock_timeout`) statistika i ekran se razilaze.
  `base_score` (posao svakih 5 min) namjerno čita samo `likes_count` — u redu. OG ne prikazuje sviđanja.
- **Dokaz:** potvrđeno čitanjem koda (`grep likes_count api/src`).
- **Prijedlog:** isti izraz kao u `LISTING_SELECT`; u `/api/health` ili nadzoru broj redova u
  `listing_likes_delta` (> ~10.000 = posao ne radi).
- **Uloga:** Backend (nadzor: DevOps).

### R3-06 Brisanje naloga: sviđanje upisano u istom trenutku može ostati u brojaču (+1)

- **Ozbiljnost:** može kasnije (isti korisnik, prozor od nekoliko ms).
- **Fajl i funkcija:** `api/src/rute/profil.js` — `POST /api/me/delete` (`with d as (delete from likes … returning)`
  pa `delete from users`).
- **Scenarij:** u READ COMMITTED naredba `delete from likes` vidi snimak s početka naredbe. Sviđanje istog
  korisnika iz drugog prozora potvrđeno poslije tog snimka, a prije `delete from users`, briše se kaskadno bez
  −1 u `listing_likes_delta` → brojač oglasa trajno za 1 veći od broja redova.
- **Dokaz:** nepotvrđeno pokretanjem — zaključeno iz redoslijeda naredbi; isti prozor je postojao i prije.
- **Prijedlog:** na početku transakcije `select 1 from users where id = $1 for update` (upis u `likes` tada čeka
  na `FOR KEY SHARE` i poslije pada s 23503 → 404).
- **Uloga:** Backend.

### R3-07 Outbox: payload poruke čuva tekst poruke 7–30 dana, i poslije brisanja naloga

- **Ozbiljnost:** može kasnije (privatnost).
- **Fajl i funkcija:** `api/src/rute/poruke.js` (`jsonb_build_object(… 'tekst', $6 …)`), `poslovi.js` — `cleanup`
  (poslani 7 dana, mrtvi 30 dana).
- **Scenarij:** korisnik obriše nalog (poruke nestaju), a prvih 140 znakova poruka ostaje u `outbox.payload`
  do 7 (mrtvi do 30) dana; u kopijama baze i duže. `docs/RUNBOOK.md` 13 (čuvanje podataka) to ne navodi.
- **Prijedlog:** poslije slanja isprazniti `payload` (`payload = '{}'`), ili tekst ne upisivati nego ga pri
  slanju pročitati iz `messages` (id poruke u payloadu); zapis u RUNBOOK 13 i politici privatnosti.
- **Uloga:** Backend (+ Proizvod i UX za politiku).

### R3-08 Outbox: zakup 120 s i dugi prolazi; sniženje bez roka važenja

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/outbox.js` — `obradiOutbox`, `ZAKUP_S`; `snizenje.js` — `rasporediSnizenje`.
- **Scenarij:** (a) prolaz zakupi do 500 redova i šalje serijski, svaki zahtjev do 10 s; ako Expo odgovara sporo
  ali uspješno (> 12 zahtjeva × ~10 s), zakup istekne usred prolaza i drugi prolaz (posao ili `obradiUskoro` u
  drugom procesu — ili u istom, jer `obradiUskoro` i `jedanPoJedan` nemaju zajedničku zastavicu) pošalje iste
  redove ponovo. (b) Red `snizenje`/`push` nema rok: kad Expo ne radi satima, kupci kasnije dobiju „sniženje”
  za cijenu koja je u međuvremenu možda ponovo podignuta ili je oglas prodat/obrisan (`rasporediSnizenje` ne
  provjerava trenutno stanje oglasa). (c) Expo `ok` s greškom u tiketu osim `DeviceNotRegistered` (npr.
  `MessageRateExceeded`) se označi kao poslano i izgubi.
- **Dokaz:** potvrđeno čitanjem koda; nije mjereno.
- **Prijedlog:** zakupljivati onoliko redova koliko stane u ~60 s (npr. 100) ili produžavati zakup poslije svake
  serije; u `rasporediSnizenje` provjeriti da je cijena i dalje `newCents`, oglas nije prodat/obrisan i
  `created_at` reda < 24 h, inače `sent_at` bez slanja; `MessageRateExceeded` → ponovni pokušaj.
- **Uloga:** Backend.

### R3-09 Admin prekidač režima: audit samo u logu, s emailom administratora

- **Ozbiljnost:** može kasnije.
- **Fajl i funkcija:** `api/src/rute/rezim.js` — `POST /api/admin/rezim`.
- **Scenarij:** ko je i kada uključio hitni režim vidi se samo u logu procesa (koji se rotira), a `app_settings`
  čuva samo `updated_at`. RUNBOOK 4a traži zapis u dnevnik ručno. Email u logu je lični podatak u logovima.
- **Prijedlog:** u `app_settings.value` (ili zasebnoj tabeli) čuvati `{rezim, user_id, at}`; u logu id umjesto
  emaila; prikaz „ko i kada” u Administraciji.
- **Uloga:** Backend (+ Frontend za prikaz).

## Mjerenja

Mašina: 2 jezgra, generator, API (`WORKERS=2`, `NODE_ENV=production`, bez Bunnyja) i Postgres 16 na istoj mašini;
drugih procesa koji troše CPU nije bilo (provjereno `ps`). Baza `komodo_recenzija3_load` iz `napuni-bazu.mjs`
(10.100 korisnika, 10.000 oglasa, 299.551 sviđanje), starost oglasa 0–30 dana i pregledi 0–200 kao u
Recenziji 2; poslije mjerenja obrisana. „Nova” = 256f6cb, „stara” = cf22969 (`git archive` u `/tmp`, ista baza).
Generator je kopija `opterecenje.mjs` koja uz isti izvještaj daje i p95 po prozorima od 15 s (ruta feeda posebno).
„svjež” = generator kreće čim `/api/health` vrati 200; „zagrijan” = 60 s poslije starta. Uz svaki prolaz:
`uptime` prije/poslije, uzorak svake 2 s (loadavg, redova u `listing_likes_delta`, outbox na čekanju, upiti koji
čekaju bravu), `top` u 45. s.

### Mix 10.000 × 90 s, `LIGHT=1 FEED=1` (ms, p95; 0 grešaka u svim prolazima, 885–889 zahtjeva/s)

| Prolaz | feed | likes | me | like | view | Opterećenje (load 1 min prije → poslije) |
|---|---|---|---|---|---|---|
| nova, svjež 1 (prvi na svježe napunjenoj bazi) | 336 | 244 | 596 | 195 | 233 | 0,24 → 2,24 |
| nova, svjež 2 | 57 | 60 | 68 | 28 | 66 | 1,90 → 1,77 |
| nova, svjež 3 | 45 | 37 | 49 | 24 | 40 | 2,14 → 1,83 |
| nova, svjež 4 | 107 | 63 | 171 | 30 | 67 | 1,88 → 1,49 |
| nova, zagrijan | 186 | 475 | 322 | 224 | 461 | 0,77 → 1,97 |
| stara, svjež 1 | 156 | 143 | 251 | 58 | 157 | 1,62 → 2,14 |
| stara, svjež 2 | 127 | 328 | 224 | 104 | 318 | 1,61 → 1,87 |
| stara, svjež 3 | 192 | 566 | 337 | 326 | 488 | 1,49 → 2,70 |

`top` u 45. s (nova, svjež 1): dva Node radnika 33 % i 25 % CPU, Postgres procesi 8–17 %. `listing_likes_delta`
tokom svih prolaza 0–91 red (posao stiže), outbox 0, upita koji čekaju bravu 0.

p95 ostalih ruta po prozorima od 15 s (0–15, 15–30, … s):

| Prolaz | prozori |
|---|---|
| nova 1/2/3/4 | 732 4 217 467 171 184 / 109 4 62 4 53 4 / 78 4 38 4 34 10 / 207 4 57 5 64 23 |
| nova zagrijan | 382 4 552 4 64 6 |
| stara 1/2/3 | 350 4 190 5 84 7 / 251 4 50 19 354 194 / 429 6 609 5 340 6 |

**Tvrdnja „p95 feeda u prvih 15 s je češće visok poslije izmjena”: nije potvrđena.** Nova verzija nije lošija od
stare (feed u prvom prozoru: nova 45–186 ms osim prvog, hladnog prolaza 336 ms; stara 127–192 ms). Uzrok visokog
p95 u prvih 15 s je generator, ne kod: u 90-sekundnom prolazu **99,5 % zahtjeva feeda pada u prvih 15 s**
(9.953–9.988 od 10.000) — svaki virtuelni korisnik učita prvu stranu u nasumičnom trenutku 0–15 s, a sljedeću tek
poslije 20 videa (~160 s, van prozora). Prvih 15 s je dakle ~670 ličnih „Za tebe” upita/s plus ~670 `/api/me`/s
(kapacitet „Za tebe” prijavljen na ovoj mašini ~1.370/s, R2), i p95 feeda = p95 tog naleta. Isti obrazac daje
talase u 30–45 s i 60–75 s (svi tajmeri `likes`/`views` 30 s i `me` 60 s pokrenuti u istih 15 s), dok su prozori
između gotovo prazni (p95 4 ms). Provjereni kandidati iz zadatka: imenovane naredbe (nova je brža, ne sporija),
`poolPosao` (3 veze, poslovi nisu u sudaru — 0 čekanja na bravu), `saberiSvidjanja` (tabela razlika ≤ 91 red, bez
čekanja), outbox (prazan u ovom testu), `base_score` pri startu (promijenjeno 0–6.466 redova; nema veze s
rasipanjem — zagrijan prolaz bez posla u prozoru je bio među lošijima). Najveći izvor rasipanja je hladan keš
(prvi prolaz) i sinhronizovani talasi generatora. Prijedlog za QA: generator neka i prve strane i tajmere
rasipa kao pravi klijent (`tajmer`: prvi poziv 20–100 % intervala, ±20 %), i neka mjeri ≥ 180 s da uđu i
sljedeće strane feeda; bez toga se p95 feeda ne može porediti između verzija.

### Vruć brojač: `endpoint like` / `like_viral`, 200 istovremenih, 15 s

| Verzija | like (zahtjeva/s, p95) | like_viral (zahtjeva/s, p95) | load 1 min na početku |
|---|---|---|---|
| nova | 2.815 / 123 ms; 2.288 / 189 ms | 2.412 / 164 ms; 2.350 / 142 ms | 1,74 / 3,05 / 3,62 / 5,38 |
| stara | 1.662 / 201 ms; 1.892 / 218 ms | 1.050 / 340 ms; 960 / 328 ms | 3,46 / 5,17 / 5,26 / 5,74 |

0 grešaka. Viralni oglas: **~1.000 → ~2.400 sviđanja/s**, p95 ~335 → ~150 ms; nasumični oglasi takođe brže
(imenovana naredba, nema `update listings`). Apsolutni brojevi su viši nego u izvještaju talasa (1.463–1.607/s),
odnos je isti. Poslije svih sviđanja (nova): `listing_likes_delta` prazna za < 3 s, i
`likes_count + delta = count(likes)` za **svih 10.000 oglasa** (0 neslaganja).

### Rokovi (ručna provjera, `PG_IDLE_TX_TIMEOUT_MS=500`, `PG_STATEMENT_TIMEOUT_MS=1000`)

- Transakcija kroz `uTransakciji` koja miruje 1,5 s: greška „Client has encountered a connection error…”
  (`bazaNeOdgovara` → 503), proces živ, pokvarena veza **nije** vraćena u bazen (0 veza), sljedećih 12 upita OK.
- `pg_sleep(2)` u transakciji: `57014`, rollback, veza ispravna, 12 upita OK.
- Ista situacija s golim `pool.connect()` bez rukovaoca: **proces pada** (neobrađen `error`). U kodu je jedino
  takvo mjesto `migrate()`, koje ne miruje u transakciji — u redu, ali novi kod mora ići kroz `uTransakciji`.

## Provjereno i u redu

- **Rokovi:** `statement_timeout`/`idle_in_transaction_session_timeout` kao opcije veze (oba bazena), migracija s
  `set local statement_timeout = 0`, poslovi kroz `poolPosao` (2 min). `uTransakciji` hvata `error` i ne vraća
  pokvarenu vezu. Rukovalac greškama: 503 + `Retry-After` samo za greške baze; ostalo i dalje 500 (osim R3-03).
  Fastify `connectionTimeout` je rok neaktivnosti — test s uploadom koji teče 4 s prolazi.
- **Retry-After i zaglavlja:** svaki 429/503 iz API-ja ga dobija (`onSend`), vrijednosti nasumične 5–10 s /
  30–60 s; `X-Komodo-Rezim` otkriva samo javni režim; poruka 503 ne sadrži interno stanje (detalji samo u logu).
  Nginx: `limit_req_status 429` postoji, pa `error_page 429 = @komodo_429` stvarno radi; 502/504 → JSON 503 s
  `Retry-After: 15`; odgovori API-ja prolaze nepromijenjeni (bez `proxy_intercept_errors`); `add_header` samo u
  imenovanim blokovima (sigurnosna zaglavlja za JSON greške nisu potrebna, `nosniff` je tu).
- **Klijentski `tajmer`:** sljedeći poziv tek kad prethodni završi (ili 60 s), `zakazi` jednom po koraku (nema
  dupliranja), greška u `fn` ne gasi tajmer, `staniTajmer` usred poziva ne zakazuje ponovo; čekanje ×2 po grešci,
  najviše 5 min, `Retry-After` najviše 300 s; prvi uspjeh vraća `kvarova = 0`, pa razgovor ne staje trajno.
  `preslozITajmere` za vrijeme poziva u toku može dati jedan dodatni poziv — zanemarivo.
- **Režim:** `/api/config` bez baze i bez kolačića (Nginx ga smije keširati), ruta admina 404 za ne-admina, Origin
  provjera je globalna; promjena stiže na sve radnike odmah (`javiSvima`, test s `WORKERS=2`) i u klijent pri
  prvom sljedećem odgovoru API-ja preko zaglavlja i `?r=<režim>` (zaseban ključ Nginx keša), pa 30 s keša ne
  usporava hitni režim; rezerva: ponovno čitanje iz baze svakih 30 s. Hitno: `/api/views` bez ijednog upita.
- **Stari keš:** samo javni upiti (`$1 = 0`, samo gotovi snimci), samo za neprijavljene, samo kad je greška
  „baza ne odgovara”; prijavljeni → 503. Oglas u obradi ne može ući u keš.
- **Vruć brojač:** `LIKE_SQL` računa odgovor iz istog snimka + vlastite razlike; prekidač istog kupca se i dalje
  serijalizuje na `likes`; brisanje naloga upisuje −1 samo za stvarno obrisane redove; brisanje oglasa (meko) i
  gašenje naloga ne diraju brojač kao ni prije; posao zaključava redove po id-ju uz `lock_timeout` 200 ms i
  ustukne; RUNBOOK 10 ima SQL za povratak prije 013. Test istovremenosti čeka praznu tabelu razlika.
- **Outbox:** upis u istoj naredbi/transakciji (poruka, sniženje), zakup `for update skip locked` (test: 2 procesa,
  300 redova, svaki tačno jednom), SIGKILL usred slanja → tačno jednom poslije zakupa, mrtvi redovi poslije 6
  pokušaja, indeks samo nad redovima na čekanju, čišćenje 7/30 dana. Pravila 24 h i 72 h su u `ZAUZMI_SQL`
  i `PATCH` kao ranije; ponovna obrada `snizenje` ne zauzima iste kupce dvaput.
- **Idempotency-Key:** ključ je `(user_id, ruta, kljuc)` — tuđi odgovor ne može procuriti; neprijavljen bez ključa;
  istovremeno 10× isti ključ → jedna poruka; ne-2xx briše ključ; različito tijelo s istim ključem vraća prvi
  odgovor (namjerno; klijent pravi novi ključ za novi tekst/snimak).
- **Imenovane naredbe:** samo upiti s izričitim kolonama, tekst stalan po procesu; dodavanje kolona u migraciji ne
  kvari pripremljen plan (Postgres ga sam poništi), a pravilo „migracije samo dodaju” isključuje promjenu tipa
  rezultata. `currentUser` (`u.*`) namjerno nije imenovan. PgBouncer se ne koristi (bez sudara s imenovanim
  naredbama).
- **Testovi:** `otpornost.test.mjs` stvarno izaziva bravu i rok (503), klaster s 2 radnika, SIGKILL usred slanja,
  dva procesa outboxa, istovremeni ključ. Ne pokrivaju: R3-01 (neuspjelo brisanje ključa), R3-02 (4xx za cijelu
  seriju), mirovanje u transakciji koje baza prekine (gore provjereno ručno), statistiku sa nesabranim razlikama.

## Ko šta treba da uradi

| Nalaz | Uloga |
|---|---|
| R3-01 | Backend (+ Frontend za 409, QA test) |
| R3-02 | Backend (QA test s lažnim Expo-om) |
| R3-03, R3-04, R3-06, R3-08 | Backend |
| R3-05 | Backend + DevOps (nadzor tabele razlika) |
| R3-07 | Backend + Proizvod i UX (politika privatnosti) |
| R3-09 | Backend + Frontend |
| generator opterećenja (rasipanje prvih strana, ≥ 180 s) | QA |

## Stanje popravki

Backend, 24.11.2026. Migracija `014_recenzija3.sql` (`idempotency_keys.vlasnik`, `outbox.zakup`, tabela
`rezim_promjene`). Testovi: `api/test/recenzija3.test.mjs` (15); svaki je pokrenut i nad kodom prije popravke (9c6d976
+ migracija 014) i tamo pada (13 od 15) — osim R3-06 (vidi tabelu) i zaštitnog testa „Expo odbija sve → tokeni
ostaju” (R3-02), koji provjerava da podjela serije ne briše tokene kad je greška naša.

| Nalaz | Stanje | Šta je urađeno | Dokaz |
|---|---|---|---|
| R3-01 | riješeno (server) | `app.js`: rok „u toku” po ruti (`rokUToku`): poruka 60 s (≈7 upita × rok 5 s, a prvi istekao upit završava zahtjev s 503); objava `HTTP_REQUEST_TIMEOUT_MS` + 2 min = 32 min (upload smije trajati koliko i cijeli zahtjev, 30 min; kraće bi dozvolilo dva istovremena uploada istog snimka). Ključ „u toku” stariji od roka (i stariji od 24 h) preuzima novi zahtjev jednom naredbom (`insert … on conflict do update … where`), uz novu oznaku `vlasnik`; upis odgovora i brisanje idu samo `where vlasnik = …`. Brisanje poslije greške se, kad ne uspije, ponavlja u pozadini kroz bazen poslova (1, 2, 4 … 32 s; `obrisiKljuc`), van zahtjeva čiji je upit istekao. | Dokaz iz recenzije ponovljen preko `psql` (API 3970, `WORKERS=2`): brava `messages` 8 s, 0,7 s poslije zahtjeva brava `idempotency_keys` 12 s → prvi `POST` **503 za 10,0 s**; čim brave popuste ključ je obrisan (0 redova), dva ponovna slanja istim ključem → **201, 201** (drugi `Idempotent-Replay`), u razgovoru **1** poruka (prije: 409, 409, 0 poruka). Test: isto s bravama iz testa; preuzimanje ključa starog 61 s (poruka 201, objava i dalje 409). |
| R3-02 | riješeno | `push.js`: `ExpoGreska` (status, kod, `details`; privremena = mreža/429/5xx/401/403), ishod po tiketu. `outbox.js` (`posaljiSPodjelom`): 4xx za cijeli zahtjev → podjela po projektima iz `details` (`PUSH_TOO_MANY_EXPERIENCE_IDS`), inače na polovine, do pojedinačnih; pojedinačno odbijena poruka se odbacuje i token briše — samo ako je Expo u istom prolazu prihvatio bar jednu drugu poruku (inače ponovni pokušaj, tokeni ostaju: greška u našem formatu ili ključu ne briše sve tokene). Ugovor Expo-a provjeren 24.11.2026. na docs.expo.dev/push-notifications/sending-notifications (4xx/5xx s `errors[{code,message,details}]`; 429/5xx privremeno; 400 se ne popravlja sam; `PUSH_TOO_MANY_EXPERIENCE_IDS` s `details` projekat → tokeni; tiket `DeviceNotRegistered`, `MessageRateExceeded` — ponoviti s čekanjem). | Lažni Expo koji odbija cijeli zahtjev ako ijedan token nije iz „projekta”: 30 primalaca s jednim tuđim tokenom → **29 dobije push**, tuđi token obrisan, ≤ 4 zahtjeva; 400 bez `details`, 2 loša od 90 → 88 poslano (polovine); Expo odbija sve → tokeni ostaju, red čeka. Prije popravke: niko ne dobije push. |
| R3-03 | riješeno | `db.js`: lista je 57014, 25P03, 57P01–57P03, 53300, 08xxx, ECONNREFUSED/ECONNRESET/ETIMEDOUT/EPIPE, istek čekanja na vezu iz bazena i prekinuta veza (poruke `pg`). Izbačeni ENOTFOUND (pogrešno ime servera baze — podešavanje, mora biti 500 i `error`) i 55000 — osim poruke „is not currently accepting connections” (baza zatvorena za veze, npr. održavanje/`allow_connections false`; postojeći test otpornosti to koristi), jer je ostala 55000 greška u kodu. Svaki drugi SQLSTATE ili sistemski kod = 500. | Test s kodovima; `otpornost` „baza ne prima veze” i dalje zelen. |
| R3-04 | riješeno | `feed.js`: „prekidač kola” — poslije greške „baza ne odgovara” `FEED_PREKIDAC_MS` (10 s) zahtjevi s postojećim starim sadržajem ga dobijaju odmah; po ključu najviše jedan upit u pozadini pipka bazu, prvi uspjeh zatvara prekidač, nova greška ga produžava; neprijavljeni „Za tebe” za to vrijeme bez ličnih faktora. `ocistiKesFeeda({oglasi, butici})` izbacuje obrisane oglase (vlasnik, administrator kroz prijavu — tamo keš ranije nije ni čišćen) i oglase ugašenih/obrisanih butika iz `zadnjeDobro` u svim procesima. | Test: obrisan oglas i ugašen butik se ne vraćaju iz starog keša (prije: vraćali se); prvi zahtjev čeka rok (1,5 s), sljedeća dva (lista + „Za tebe”) zajedno < 600 ms (prije: svaki ~1,5 s). |
| R3-05 | riješeno | `statistika.js`: `likes_all` = `likes_count` + nesabrane razlike (isti izraz kao `LISTING_SELECT`). Nadzor broja redova u `listing_likes_delta` ostaje za DevOps. | Test bez posla sabiranja: `likesAll` 1 (prije 0). |
| R3-06 | već je bilo zaštićeno; dodan test | Brava `select … from users where id = $1 … for update` na početku transakcije brisanja naloga postoji od ranije (talas praćenja) i upravo zatvara opisani prozor: upis u `likes` provjerava strani ključ s `FOR KEY SHARE` na `users`, pa sviđanje koje počne poslije brave čeka i pada (23503 → 401). Dodan komentar u `profil.js`. | Deterministički test (brava na postojeći red sviđanja drži `delete from likes` brisanja; za to vrijeme isti korisnik označi drugi oglas) → 401, brojač 0. Isti test nad kodom **bez** te brave pada (sviđanje 200, ostaje +1) — test stvarno hvata prozor; nad kodom prije popravke (s bravom) prolazi. |
| R3-07 | riješeno (Proizvod: politika privatnosti) | `poslovi.js` `cleanup`: poslani (i odbačeni) redovi se brišu 24 h poslije slanja, mrtvi 7 dana poslije upisa (bilo 7/30 dana). `outbox.js`: poslanom redu se iz payloada briše `tekst`. `profil.js`: brisanje naloga u istoj transakciji briše redove `poruka` iz razgovora korisnika (oba smjera) i za njega kao primaoca, i njegova `snizenje`; serije `push` sa njegovim tokenom se ne šalju (tokeni se provjeravaju pri slanju). RUNBOOK 13 dopunjen. | Testovi: čišćenje (ostaju samo poslan prije 1 h i mrtav prije 2 dana), brisanje butika uklanja red s tekstom poruke i sniženje, poslije slanja nema `tekst` u payloadu. |
| R3-08 | riješeno | `MessageRateExceeded` u tiketu → privremena greška: red ide u ponovni pokušaj s rastućim čekanjem, ali samo za te tokene (`payload.preostali`, bez duplikata ostalima). Zakup s oznakom prolaza (`outbox.zakup`); prije svake serije zakup se produžava samo za redove s tom oznakom, a red koji je u međuvremenu preuzeo drugi prolaz se preskače; upis ishoda takođe `where zakup = …`. Rok važenja 24 h za sve push redove (stariji se označe gotovim s `greska` „isteklo”). Sniženje: `rasporediSnizenje` i slanje serija provjeravaju da oglas nije obrisan/prodat, butik nije ugašen i da je cijena i dalje nova (`snizenjeVazi`), inače odbačeno. | Testovi: drugi uređaj s `MessageRateExceeded` dobije push u drugom pokušaju, prvi samo jednom; red preuzet od „drugog procesa” usred prolaza nije poslan; red star 25 h nije poslan; sniženje 200 → 150 KM dok je cijena 200 KM → nijedan push (prije: poslan). |
| R3-09 | riješeno (web prikaz kratak) | Tabela `rezim_promjene` (ko, kada, staro → novo, `okolina` kad je vraćeno na `KOMODO_REZIM`), upis u istoj naredbi kao promjena; `GET`/`POST /api/admin/rezim` vraćaju `promjene` (zadnjih 10); log: `Režim rada: staro → novo (administrator id N)`, bez emaila. `admin.js`: spisak „Zadnje promjene” ispod dugmadi. | Test: dvije promjene → tačan redoslijed i ime administratora; log bez emaila. |
| Generator (QA) | urađeno | `opterecenje.mjs` (`LIGHT=1`): početak 0–`START_S` (30) s, prvi poziv tajmera 20–100 % intervala, sljedeći ±20 %; upozorenje za `mix` < 180 s; `PROZORI=1` — p95 po 15 s. README dopunjen. | Vidi mjerenje u `api/test/opterecenje/README.md`. |

Nije riješeno ovdje (druge uloge): R3-01 klijent (`web/js/poruke.js`: 409 dva puta zaredom — sada se ključ sam
oslobodi najkasnije za 60 s ili čim baza proradi, pa je izmjena klijenta manje hitna; Frontend); nadzor broja redova
u `listing_likes_delta` i broja 503 „Baza ne odgovara” (DevOps); politika privatnosti za outbox (Proizvod i UX;
podaci su u RUNBOOK 13). Expo potvrde (receipts, `getReceipts` ~15 min poslije slanja) se i dalje ne čitaju — greške
`DeviceNotRegistered`/`MessageRateExceeded` koje stignu tek u potvrdi se ne vide (otvoreno, Backend).

Pokrenuto poslije popravki (24.11.2026., cloud sesija, uz tuđe procese na mašini): `cd api && npm test` 3× —
256/256 (44,7 s, 52,1 s, 49,7 s); `npm run test:istovremenost` — „Sve provjere su prošle”; Playwright 36/36 dva puta
zaredom (2,1 i 2,0 min; od pet prolaza ukupno dva — dok je na mašini radio i Playwright drugog agenta, load ~5 — imala
su po 2 pada, U-18 i U-04 (registracija → povratak na „Praćeni”/označen oglas), koji se poslije nisu ponovili;
uzrok nije potvrđen); `node --test mobile/navigacija.test.mjs`
6/6. Mjerenje `mix 10000 180 LIGHT=1 FEED=1` novim generatorom: `api/test/opterecenje/README.md`.
