# Komodo — sigurnosna revizija

Vlasnik: Sigurnost. Revidiran nepromjenljiv snimak `c2cf623` („Osnova: stanje poslije optimizacije 19.11.”),
raspakovan u `/tmp/sec-snap`, jer se `api/src/server.js` i `web/app.js` u istoj fazi dijele na module. Zato su
mjesta navedena po **funkciji i ruti**, ne po broju reda.

Obuhvat: `api/src/*.js`, `api/migrations/*.sql`, `web/*.js` i `*.html`, `mobile/App.js` i `app.config.js`,
`server/nginx-komodo.conf`, `Dockerfile`, `docker-compose.yml`, `server/*.sh`.

Kako je provjereno: snimak API-ja u dva načina rada —
- **razvoj**: `PORT=3953`, baza `komodo_sigurnost`, bez SMTP-a (nalozi se odmah potvrđuju);
- **produkcija**: `NODE_ENV=production`, `PORT=3963`, baza `komodo_sigurnost_prod`, `SMTP_URL` na lažni SMTP
  server (`127.0.0.1:2599`), `APP_URL=https://komodo.ba`, `ADMIN_EMAILS=admin@proba.ba`.

Nalazi su potvrđeni stvarnim zahtjevima (curl), XSS i CSRF u Chromeu preko Playwrighta. Gdje nešto nije bilo
moguće isprobati (Nginx, telefon), piše „analiza koda”.

## Sažetak

| Rizik | Broj | Nalazi |
|---|---|---|
| Visok | 1 | S-01 |
| Srednji | 4 | S-02, S-03, S-04, S-05 |
| Nizak | 9 | S-06, S-07, S-08, S-09, S-10, S-11, S-12, S-13, S-14 |
| Informativno | 5 | S-15, S-16, S-17, S-18, S-19 |

Uslov 4 iz `docs/PLAN-PRODUKCIJA.md` („nema otvorenog nalaza visokog ili srednjeg rizika”) traži popravku
S-01 do S-05 prije objave.

Najvažnije:
1. **S-01**: ko se prvi registruje s adresom iz `ADMIN_EMAILS`, postaje administrator i bez potvrde emaila.
2. **S-02**: u produkciji klijent sam bira svoju IP adresu (`X-Forwarded-For`), pa ne radi nijedno ograničenje
   po IP adresi.
3. **S-03/S-04**: registracijama se troši dnevna email kvota (Zoho: 500), a s 31 pogrešnom prijavom se zaključa
   tuđi nalog.

XSS nije nađen (sva mjesta s `innerHTML` escape-uju korisnički sadržaj, potvrđeno u pregledniku). SQL injekcija
i IDOR nisu nađeni. `npm audit --omit=dev`: 0 ranjivosti.

---

## S-01 — Preuzimanje administratora: `ADMIN_EMAILS` ne traži potvrđen email

- **Rizik:** visok
- **Gdje:** `api/src/server.js` → `isAdmin(u)`; dobija se preko `POST /api/auth/register`; koriste ga
  `adminUser()` i sve rute `/api/admin/*` (prijave, nalozi, otvaranje butika, gašenje naloga).
- **Scenarij:** `isAdmin` gleda samo `ADMIN_EMAILS.includes(u.email)`. Napadač zna ili pogodi adresu
  administratora (npr. `stefan@komodo.ba`) i registruje je kao kupac prije Stefana, ili poslije promjene
  `ADMIN_EMAILS`. Nalog ostaje nepotvrđen, ali odmah dobija `admin: true`: vidi sve emailove korisnika, gasi
  naloge, briše oglase i otvara butike. Stefan se više ne može registrovati (409). Kad `SMTP_URL` nije upisan,
  svaki nalog je odmah „potvrđen” (`mailOn ? null : new Date()`), pa i popravka kroz potvrdu ne bi pomogla ako
  se SMTP na serveru zaboravi. Isti način rada ispisuje tokene za novu lozinku u dnevnik.
- **Dokaz** (produkcijska instanca s SMTP-om, nalog nepotvrđen):
  ```
  $ curl -X POST :3963/api/auth/register -d '{"email":"admin@proba.ba","password":"napadac123","name":"Napadac"}'
  {"korisnik":{... "verified":false,"admin":true ...}}
  $ curl -b padm.jar :3963/api/admin/users
  {"nalozi":[{"id":1,"name":"Napadac", ... "email":"admin@proba.ba" ...}]}
  ```
- **Popravka (backend):**
  ```js
  function isAdmin(u) {
    return !!u && u.email_verified_at !== null && ADMIN_EMAILS.includes(u.email);
  }
  // odmah poslije definicije konstanti, prije app.listen:
  if (PROD && !mailOn) {
    throw new Error('SMTP_URL je obavezan u produkciji (potvrda emaila, nova lozinka, administracija).');
  }
  ```
  Operativno (devops, `docs/SERVER.md`): prije otvaranja domene javnosti Stefan registruje i potvrdi
  administratorski nalog. Tek onda se adresa upisuje u `ADMIN_EMAILS` i API se restartuje.
- **Popravlja:** backend (+ devops za korak u uputstvu)
- **Status (backend):** popravljeno u commitu „Backend: sigurnost i šema v1”: `isAdmin` traži `email_verified_at`; `NODE_ENV=production` bez `SMTP_URL` (ili `COOKIE_SECRET`) → API ne starta, s porukom šta nedostaje (`api/src/provjera.js`). Dokaz ponovljen (test `api/test/backend-sigurnost.test.mjs`, S-01): registracija adrese iz `ADMIN_EMAILS` → `admin:false`, `/api/admin/users` 404; poslije potvrde `admin:true`. Devops korak u `docs/SERVER.md` ostaje otvoren.

## S-02 — Lažiranje IP adrese kroz `X-Forwarded-For` (sva ograničenja po IP-u se zaobilaze)

- **Rizik:** srednji
- **Gdje:** `api/src/server.js` → `Fastify({ trustProxy: PROD })`; `server/nginx-komodo.conf` →
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Pogođeni su ključevi `reg:ip:` (`POST
  /api/auth/register`), `login:ip:` (`POST /api/auth/login`) i `forgot:ip:` (`POST /api/auth/forgot`).
- **Scenarij:** s `trustProxy: true` Fastify vjeruje cijelom lancu i za `req.ip` uzima **krajnju lijevu**
  adresu. `$proxy_add_x_forwarded_for` zaglavlje koje klijent pošalje ne briše, nego mu dodaje pravu adresu
  na kraj (`"10.7.1.1, <prava>"`). Napadač u svaki zahtjev upiše drugu adresu, pa svako ograničenje po IP-u
  počinje ispočetka. Nginx `limit_req` (po `$binary_remote_addr`) i dalje radi, ali dozvoljava 10 zahtjeva/s
  na `/api/auth/`, a to je ~36.000 registracija na sat umjesto 60. To pojačava S-03 i S-04.
- **Dokaz** (produkcijska instanca, zaglavlje u obliku koji šalje Nginx):
  ```
  62× register s "X-Forwarded-For: 10.0.0.1"  → 201 ×60, pa 429 429
  4×  register s "X-Forwarded-For: 10.0.1.65..68" → 201 201 201 201   (ograničenje zaobiđeno)
  rate_limits: reg:ip:10.0.0.1|62, reg:ip:10.0.1.65|1, ...
  31× login s "X-Forwarded-For: 10.7.$i.1, 127.0.0.1" → u bazi ključevi login:ip:10.7.11.1:..., login:ip:10.7.17.1:...
  ```
- **Popravka (oboje, bilo koja od dvije sama zatvara rupu):**
  - devops, `server/nginx-komodo.conf` (u `server` bloku):
    ```nginx
    proxy_set_header X-Forwarded-For $remote_addr;   # pregazi ono što je poslao klijent
    ```
  - backend, `api/src/server.js`:
    ```js
    // Jedan proxy ispred (Nginx). Uzima se adresa koju je upisao on, ne ono što je poslao klijent.
    const app = Fastify({ ..., trustProxy: PROD ? 1 : false });
    ```
- **Popravlja:** devops + backend
- **Status (backend):** popravljeno u commitu „Backend: sigurnost i šema v1”: `trustProxy: PROD ? (addr, hop) => hop === 0 : false`. **Pažnja:** predloženi `trustProxy: 1` u Fastify 5.12.8 izmjereno uopšte ne čita `X-Forwarded-For` (`req.ip` ostaje 127.0.0.1, pa bi sva ograničenja po IP-u iza Nginxa bila zajednička za sve korisnike). Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-02): `X-Forwarded-For: 10.7.1.1, 198.51.100.7` → ključ `reg:ip:198.51.100.7`, nema `10.7.1.1`. Provjera 2 iza pravog Nginxa ostaje za fazu 4.

## S-03 — Registracijom se troši email kvota i šalju se emailovi na tuđe adrese

- **Rizik:** srednji
- **Gdje:** `api/src/server.js` → `POST /api/auth/register` → `sendVerification()`; ograničenja `reg:ip`
  (60/h) i `reg:did` (5/h).
- **Scenarij:** svaka registracija s novom adresom šalje email za potvrdu. Ograničenje po uređaju (`did`) ne
  vrijedi ništa, jer klijent može izostaviti kolačić. Ostaje ograničenje po IP-u: 60 na sat, odnosno 1.440 na
  dan s **jedne** adrese, i to bez S-02. Zoho šalje 500 emailova dnevno (`docs/PLAN-PRODUKCIJA.md`, odj. 4), pa
  jedan napadač za ~8 sati potroši dnevnu kvotu. Poslije toga nikome ne stiže ni potvrda ni nova lozinka. Uz to
  servis šalje neželjenu poštu na tuđe adrese i kvari ugled domene (spam liste). Nalozi napravljeni ovako mogu
  lajkati i prijavljivati (S-08).
- **Dokaz:** razvojna instanca, bez kolačića: 7× `register` → `201` ×7 (granica po uređaju je 5).
  Produkcijska: 60 registracija s iste adrese prošlo (vidi S-02), i za svaku je lažni SMTP primio email.
- **Popravka (backend):**
  ```js
  // POST /api/auth/register, prije upisa:
  if (await limited(`reg:ip:dan:${req.ip}`, 200, 24 * 60 * MIN)) return bad(reply, 429, 'Previše novih naloga s ove adrese danas.');
  // sendVerification(): globalni budžet emailova za potvrdu; preko njega nalog nastaje, a email se ne šalje
  // (korisnik ga kasnije traži dugmetom „Pošalji ponovo”, POST /api/auth/resend).
  if (await limited('mail:potvrda:sat', Number(process.env.MAIL_POTVRDA_SAT || 300), 60 * MIN)) {
    log.warn('Budžet emailova za potvrdu je potrošen'); return;
  }
  ```
  Uz to treba servis za transakcione emailove (već u planu, odj. 4) i upozorenje u nadzoru kad se budžet
  potroši (devops).
- **Popravlja:** backend (+ devops za upozorenje)
- **Status (backend):** popravljeno u commitu „Backend: sigurnost i šema v1”: `reg:ip:dan:` 200/24 h; globalni budžet `mail:potvrda:sat` (`MAIL_POTVRDA_SAT`, zadano 300) — preko njega nalog nastaje bez emaila, u dnevnik ide `Budžet emailova za potvrdu je potrošen`, a „Pošalji ponovo” vraća 429. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-03). Devops: upozorenje u nadzoru na taj tekst.

## S-04 — Zaključavanje tuđeg naloga pogrešnim prijavama

- **Rizik:** srednji
- **Gdje:** `api/src/server.js` → `POST /api/auth/login`, ključ `login:email:${email}` (30 / 15 min).
- **Scenarij:** ograničenje po emailu se provjerava prije lozinke i vrijedi za sve adrese zajedno. Ko zna email
  butika (često je na Instagramu), pošalje 31 pogrešnu prijavu svakih 15 minuta, s bilo koje adrese, i vlasnik
  se ne može prijaviti ni s tačnom lozinkom. Ograničenje po IP-u ne pomaže: napadač ima više adresa ili koristi
  S-02.
- **Dokaz** (produkcijska instanca):
  ```
  31× login zrtva@proba.ba, pogrešna lozinka, XFF 10.7.$i.1 → 401 ×30, 429
  login zrtva@proba.ba, TAČNA lozinka, druga adresa → {"greska":"Previše pokušaja prijave. Pokušaj ponovo za 15 minuta."}
  ```
- **Popravka (backend):** uređaj s kog je prijava već uspjela ne podliježe ograničenju po emailu (samo onom po
  IP+email). Za to treba nova migracija:
  ```sql
  -- api/migrations/0NN_poznati_uredjaji.sql
  create table known_devices (
    user_id integer not null references users(id) on delete cascade,
    did     text not null,
    seen_at timestamptz not null default now(),
    primary key (user_id, did)
  );
  ```
  ```js
  // POST /api/auth/login
  const tooManyIp = await limited(`login:ip:${req.ip}:${email}`, 10, 15 * MIN);
  if (tooManyIp) return bad(reply, 429, ...);
  const res = await q('select * from users where email = $1', [email]);
  const user = res.rows[0];
  const did = req.cookies.did;
  const known = user && did && (await q('select 1 from known_devices where user_id = $1 and did = $2', [user.id, did])).rowCount > 0;
  if (!known && await limited(`login:email:${email}`, 30, 15 * MIN)) return bad(reply, 429, ...);
  ... // poslije uspješne prijave:
  await q('insert into known_devices(user_id, did) values ($1, $2) on conflict do update set seen_at = now()', [user.id, deviceId(req, reply)]);
  ```
  (`did` mora biti potpisan, vidi S-07.)
- **Popravlja:** backend
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: migracija `010_sigurnost.sql` (`known_devices`), prijava s poznatog (potpisanog) `did` ne podliježe `login:email:`. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-04): 31 pogrešna prijava s drugih adresa → vlasnik s poznatog uređaja 200, nepoznat uređaj i nepotpisan `did` 429.

## S-05 — Prekinut ili prevelik snimak ostaje na disku zauvijek

- **Rizik:** srednji (raspoloživost: disk se puni)
- **Gdje:** `api/src/server.js` → `POST /api/listings` (petlja `for await (const part of req.parts())`,
  `pipeline(part.file, createWriteStream(...))`).
- **Scenarij:** kad je snimak veći od `MAX_VIDEO_MB`, `@fastify/multipart` baca `FST_REQ_FILE_TOO_LARGE`, a kad
  telefon izgubi vezu, baca `aborted`. Greška izlazi iz rute prije nego što se `videoFile` upiše, pa se
  djelimičan fajl nikad ne briše (brisanje radi samo grana `if (problem)`). Zbog čestih prekida pri slanju s
  telefona fajlovi se gomilaju i bez napada. Zlonamjeran ili preuzet nalog butika pošalje ~100 MB po zahtjevu,
  bez ograničenja broja objava, i napuni disk. Tada stane i baza (isti disk).
- **Dokaz** (razvoj, `MAX_VIDEO_MB=1`):
  ```
  3× POST /api/listings s 3 MB → 413 {"greska":"Video je prevelik. Najviše 1 MB."}
  /tmp/sec-up: 3 nova fajla po 1048576 B; select count(*) from listings → 1 (nijedan oglas)
  POST prekinut poslije 2 s (--max-time 2) → u dnevniku "aborted", fajl 261683 B ostao
  ```
- **Popravka (backend):**
  ```js
  let partial = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        ...
        const name = `${randomUUID()}.${ext}`;
        partial = path.join(UPLOADS_DIR, name);
        await pipeline(part.file, createWriteStream(partial));
        partial = null;
        videoFile = name;
        ...
      } else { fields[part.fieldname] = part.value; }
    }
  } catch (err) {
    if (partial) await unlink(partial).catch(() => {});
    if (videoFile) await unlink(path.join(UPLOADS_DIR, videoFile)).catch(() => {});
    throw err;
  }
  ```
  Uz to: ograničenje objava po butiku, provjereno prije čitanja tijela
  (`if (await limited(\`upload:${user.id}\`, 30, 60 * MIN)) return bad(reply, 429, 'Previše objava. Pokušaj za sat.')`),
  i u `cleanup()` brisanje fajlova u `UPLOADS_DIR` starijih od 2 sata koje nijedan `listings.video_path` ne
  spominje (siroče od pada procesa usred slanja).
- **Popravlja:** backend
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: djelimičan/upisan fajl se briše kad slanje pukne; `upload:<id>` 30/h prije čitanja tijela; `cleanup()` briše snimke starije od 2 h koje ne spominje nijedan oglas. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-05): 3× 3 MB uz `MAX_VIDEO_MB=1` → 413 i 0 novih fajlova; prekinuto slanje → 0 novih fajlova; 31. objava → 429.

## S-06 — Token za novu lozinku putuje u URL-u (`/?lozinka=`) i završava u dnevniku Nginxa

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `POST /api/auth/forgot` (link `${APP_URL}/?lozinka=${token}`), isto
  `sendVerification()` (`/api/auth/verify?token=`); `web/app.js` → start (`params.get('lozinka')`,
  `history.replaceState` tek poslije uspješne promjene); `server/nginx-komodo.conf` (zadani `access_log`
  bilježi cijeli URI).
- **Scenarij:** token je u upitu, pa ga Nginx upiše u `access.log` (čita ga svako ko ima pristup serveru ili
  kopijama dnevnika), a ostaje i u istoriji preglednika. Ako je korisnik već prijavljen (`resetToken && !me`
  nije ispunjeno), token ostaje u adresnoj traci i ne iskoristi se. Rizik je nizak jer token vrijedi 1 sat,
  može se iskoristiti samo jednom i novi poništava stari. `Referer` ne curi:
  `Referrer-Policy: strict-origin-when-cross-origin` prema Google Fonts šalje samo origin.
- **Dokaz:** analiza koda; `GET /api/auth/reset` jednokratnost provjerena (vidi „Provjereno i u redu”).
- **Popravka:**
  - backend: link `${APP_URL}/#lozinka=${token}`. Fragment se ne šalje serveru, ne ulazi u dnevnik i ne ide u
    `Referer`.
  - frontend, `web/app.js` (start):
    ```js
    var hash = new URLSearchParams(location.hash.slice(1));
    var rawReset = hash.get('lozinka') || params.get('lozinka') || '';   // upit još radi za stare linkove
    resetToken = /^[a-f0-9]{20,100}$/.test(rawReset) ? rawReset : null;
    if (rawReset || confirmed || chatParam) { history.replaceState(null, '', '/'); }   // odmah, ne tek poslije uspjeha
    if (resetToken) { authView = 'reset'; show('profile'); }   // i kad je neko prijavljen
    ```
  - devops: u Nginxu `log_format` bez upita, npr.
    `log_format komodo '$remote_addr [$time_local] "$request_method $uri" $status $body_bytes_sent $request_time';`
    i `access_log /var/log/nginx/komodo.log komodo;`.
- **Popravlja:** backend + frontend + devops
- **Status (backend):** popravljeno u commitu „Backend: sigurnost i šema v1”: linkovi `${APP_URL}/#lozinka=TOKEN` i `${APP_URL}/#potvrda=TOKEN`; nova ruta `POST /api/auth/verify {token}`; stari `GET /api/auth/verify?token=` radi za već poslane emailove. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-06). Frontend (čitanje fragmenta, čišćenje adrese) i devops (`log_format`) otvoreni.

## S-07 — Brojač pregleda se naduvava, a svaki anonimni zahtjev upisuje redove u bazu

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `countViews()` (`POST /api/views`, `POST /api/listings/:id/view`),
  `deviceId()`.
- **Scenarij:** gledalac bez prijave se prepoznaje po kolačiću `did`, a njega bira klijent: ili ga ne pošalje
  (server napravi novi), ili pošalje bilo koji niz koji odgovara regexu. Svaki zahtjev je tako „novi gledalac”:
  pregled se broji, ograničenje `views:` (30/min) ne važi, a u bazu se upišu red u `listing_views` i red u
  `rate_limits`. Ishod: butik vidi lažne preglede (i statistika iz v1 bi bila lažna), a baza dobija dva upisa po
  zahtjevu (Nginx dozvoljava 100 zahtjeva/s po adresi).
- **Dokaz:** 100× `curl -X POST :3953/api/listings/1/view` bez kolačića → `views = 102`,
  `listing_views` 102 reda, `rate_limits` 100 novih ključeva `views:d…`.
- **Popravka (backend):** potpisan `did` i broje se samo uređaji koji su već imali kolačić.
  ```js
  await app.register(cookie, { secret: process.env.COOKIE_SECRET });   // obavezno u produkciji
  function deviceId(req, reply) {
    const raw = req.cookies.did && req.unsignCookie(req.cookies.did);
    if (raw && raw.valid && /^[A-Za-z0-9_-]{16,64}$/.test(raw.value)) return raw.value;
    const fresh = randomBytes(16).toString('base64url');
    reply.setCookie('did', fresh, { path: '/', httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 365 * 24 * 3600, signed: true });
    req.freshDevice = true;
    return fresh;
  }
  // countViews(): ako je uređaj tek dobio kolačić, pregled se ne broji (broji se od sljedećeg zahtjeva)
  if (!user && req.freshDevice) return { ok: true };
  if (await limited(`views:ip:${req.ip}`, 600, MIN)) return bad(reply, 429, ...);
  ```
  `COOKIE_SECRET` ide u `server/env.api.primjer` (devops).
- **Popravlja:** backend (+ devops za varijablu)
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: `did` potpisan (`COOKIE_SECRET`, u produkciji obavezan); uređaj bez ispravnog potpisa dobija novi kolačić i ne broji se (ni upis u `rate_limits`); `views:ip:` 600/min. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-07): 100× bez kolačića i 100× izmišljen `did` → `views` 0, `listing_views` 0, `rate_limits` bez novih ključeva. Devops: `COOKIE_SECRET` u `server/env.api.primjer`.

## S-08 — Nepotvrđeni nalozi mogu lajkati i prijavljivati

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `POST /api/listings/:id/like`, `POST /api/reports` (provjera
  `email_verified_at` postoji samo u `POST /api/conversations/:id/messages`).
- **Scenarij:** nalozi napravljeni kao u S-03, s tuđim ili izmišljenim adresama, lažno dižu broj sviđanja (na
  njemu će raditi algoritam „Za tebe”, v1) ili zatrpaju administratora prijavama (20/h po nalogu).
- **Dokaz** (produkcijska instanca, nepotvrđen nalog): `like` → `{"liked":true,"likes":1}`; `reports` →
  `{"ok":true}`.
- **Popravka (backend):** u `POST /api/reports` isti uslov kao kod poruka
  (`if (!user.email_verified_at) return bad(reply, 403, 'Potvrdi email da bi prijavio sadržaj.')`). Kod
  sviđanja: ili isti uslov (Proizvod odlučuje o UX-u), ili ostaviti sviđanje, ali ga algoritam feeda ne broji
  dok nalog nije potvrđen.
- **Popravlja:** backend (+ Proizvod za odluku)
- **Status:** odluka (19.11.): sviđanja **ne** traže potvrđen email (UX); ništa nije mijenjano ni u `POST /api/reports`. Algoritam „Za tebe” (P2) treba odlučiti hoće li brojati sviđanja nepotvrđenih naloga.

## S-09 — Push token se može preoteti drugom nalogu

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `POST /api/me/push-token`
  (`on conflict (token) do update set user_id = excluded.user_id`); `pushNewMessage()` šalje bez Expo access
  tokena.
- **Scenarij:** ko sazna Expo push token tuđeg uređaja (vidi S-10), prijavi ga na svoj nalog. Žrtvi tada prestaju
  stizati obavještenja o njenim porukama, a stižu tuđa. Bez „Enhanced push security” u Expo projektu
  procureli token dozvoljava i slanje lažnih obavještenja na taj telefon direktno preko Expo API-ja (phishing
  „Komodo: potvrdi nalog na …”).
- **Dokaz:** kupac (id 10) prijavi `ExponentPushToken[zrtvinUredjaj123]` → `push_tokens: …|10`. Butik
  prijavi isti token → `push_tokens: …|1`.
- **Popravka:** backend:
  ```sql
  on conflict (token) do update set session_token = excluded.session_token, created_at = now()
    where push_tokens.user_id = excluded.user_id
  ```
  (Odjava briše sesiju, a s njom kaskadno i token, pa legitimna prijava drugog naloga na istom telefonu ne
  udara u konflikt.) Mobilni/Stefan: u Expo projektu uključiti „Enhanced Security for Push Notifications”.
  Backend tada u `pushNewMessage` šalje `Authorization: Bearer ${process.env.EXPO_ACCESS_TOKEN}`.
- **Popravlja:** backend + mobilni
- **Status (backend):** popravljeno u commitu „Backend: sigurnost i šema v1”: `on conflict … do update … where push_tokens.user_id = excluded.user_id`; `EXPO_ACCESS_TOKEN` (ako je upisan) ide u `Authorization`. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-09). Mobilni/Stefan: uključiti Enhanced Security u Expo.

## S-10 — Mobilni omotač: provjera „svoje” adrese preko `startsWith` i token u svaku stranicu

- **Rizik:** nizak (analiza koda; nije isprobano na telefonu)
- **Gdje:** `mobile/App.js` → `isOwnUrl()`, `onShouldStart`, `deliverToken` (`onLoadEnd`), props `WebView`
  (`originWhitelist={['*']}`, `allowFileAccess`).
- **Scenarij:** `'https://komodo.ba.zlo.com'.startsWith('https://komodo.ba')` je `true`, pa se takva adresa
  otvara **unutar** WebViewa, s mostom `ReactNativeWebView`. `onLoadEnd` tada ubaci push token u tu stranicu
  (`window.__komodoPush(token)`) i ona ga ukrade (S-09). Isto važi za `data:` adrese, koje `onShouldStart`
  izričito dozvoljava. Danas je teško dovesti korisnika na takvu adresu unutar WebViewa: linkovi profila imaju
  `target="_blank"` i idu u vanjski preglednik, a poruke se ne pretvaraju u linkove. Zato je rizik nizak, ali bi
  svaki budući link bez `target` otvorio ovu rupu.
- **Popravka (mobilni):**
  ```js
  const APP_ORIGIN = new URL(APP_URL).origin;
  function isOwnUrl(url) {
    try { return new URL(url).origin === APP_ORIGIN; } catch { return false; }
  }
  // onShouldStart: dozvoliti samo isOwnUrl, 'about:blank' i 'blob:' + APP_ORIGIN; ukloniti data:
  // deliverToken / sendToWeb: samo kad je trenutna adresa svoja (pratiti onNavigationStateChange → currentUrl.current)
  ```
  WebView: `originWhitelist={[APP_ORIGIN]}`, `allowFileAccess={false}`.
- **Popravlja:** mobilni

## S-11 — Sadržaj snimka se ne provjerava; API ne šalje `nosniff`

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `POST /api/listings` (tip se uzima iz `part.mimetype`, koji šalje klijent);
  posluživanje `/media/` (`fastifyStatic`, `root: UPLOADS_DIR`).
- **Scenarij:** butik može poslati bilo kakav fajl s oznakom `video/mp4`. Ime fajla i ekstenziju pravi server
  (`randomUUID()` + ekstenzija iz bijele liste), pa path traversal **nije** moguć. Fajl se poslužuje kao
  `video/mp4` i preglednik ga ne izvršava kao HTML (provjereno). Ostaje: smeće na disku i na Bunnyju (Bunny ga
  označi kao grešku), i oslanjanje na Nginx za `nosniff` ako se API ikad posluži mimo njega.
- **Dokaz:** objavljen `fake.mp4` sa sadržajem `<html><script>alert(document.domain)</script></html>` i
  `filename=../../../etc/passwd` → `201`, fajl `/tmp/sec-up/b2374770-….mp4` (ime od servera). `GET /media/…` →
  `content-type: video/mp4`, bez `x-content-type-options`. Chrome otvori adresu: 0 `<script>` u DOM-u, nijedan
  `alert`.
- **Popravka (backend):** provjeriti prvih 12 bajtova prije upisa u bazu (MP4/MOV: `ftyp` na pomaku 4; WebM:
  `1A 45 DF A3`), inače `problem = 'Video mora biti MP4, MOV ili WebM.'`. I u API dodati zaglavlje za sve
  odgovore:
  ```js
  app.addHook('onSend', async (req, reply) => { reply.header('X-Content-Type-Options', 'nosniff'); });
  ```
- **Popravlja:** backend
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: prvih 12 bajtova (MP4/MOV kutija na pomaku 4, WebM `1A45DFA3`); `X-Content-Type-Options: nosniff` na svim odgovorima API-ja. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-11).

## S-12 — CSRF zaštita počiva samo na `SameSite=Lax`; GET mijenja stanje

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `startSession()` (kolačić `sid`), sve POST/PATCH/DELETE rute; `POST
  /api/listings` (multipart); `POST /api/auth/logout` (prihvata `text/plain`); `GET
  /api/conversations/:id/messages` (upisuje `*_read_at`).
- **Scenarij:** stanje mijenjaju i zahtjevi koje može poslati obična HTML forma s drugog sajta: multipart (objava
  oglasa) i `text/plain` (odjava). Danas ih štiti samo `SameSite=Lax`, koji preglednik ne šalje uz POST s drugog
  sajta, i to je provjereno. Zaštita ne važi za napadača na istom sajtu (svaki poddomen `*.komodo.ba`, npr.
  budući blog ili landing kod treće strane) ni za stare preglednike. `form-urlencoded` Fastify odbija (415 → 400).
- **Dokaz:** Playwright, butik prijavljen na `127.0.0.1:3953`, stranica s `localhost:3964` automatski pošalje
  multipart formu na `/api/listings` i `text/plain` formu na `/api/auth/logout` → odgovor
  `{"greska":"Prijavi se da objaviš oglas."}`, oglasa „CSRF oglas” 0, butik ostao prijavljen. Isti
  `text/plain` zahtjev s kolačićem (curl) → `logout 200`, što znači da bi bez SameSite prošao.
- **Popravka (backend):** provjera `Origin` za sve zahtjeve koji mijenjaju stanje:
  ```js
  const APP_ORIGIN = new URL(APP_URL).origin;
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (origin && origin !== APP_ORIGIN) return bad(reply, 403, 'Zahtjev nije dozvoljen.');
  });
  ```
  (WebView šalje `Origin` same aplikacije. Bez zaglavlja `Origin` prolaze curl i testovi.) Kasnije, kad se
  dira ugovor: oznaku pročitanosti premjestiti u `POST /api/conversations/:id/read`.
- **Popravlja:** backend
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: `onRequest` provjera `Origin` (APP_URL ili isti host kao `Host`) za sve osim GET/HEAD/OPTIONS. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-12) i ponovljen CSRF prolaz u Chromeu (`csrf.py` na portu 3961): forma s drugog sajta dobija `{"greska":"Zahtjev nije dozvoljen."}`, 0 oglasa, butik ostaje prijavljen. Premještanje oznake pročitanosti u POST nije rađeno (mijenja ugovor).

## S-13 — Kontrolni znakovi i novi redovi u imenima i nazivima

- **Rizik:** nizak
- **Gdje:** `api/src/server.js` → `clean()` (koriste ga `POST /api/auth/register` name, `PATCH /api/me` name,
  naslov oglasa); `notifyUnread()` i `sendVerification()` ubacuju ime u email.
- **Scenarij:** ime može imati `\r\n` i nevidljive znakove (npr. `‮`, obrnut smjer teksta). **Ubacivanje
  email zaglavlja nije moguće**, jer nodemailer pretvori novi red u naslovu u razmak. Ostaje lažiranje sadržaja
  emaila koji šalje `no-reply@komodo.ba` („Zdravo …\n\nVaš nalog će biti ugašen, …”, do 40 znakova) i zbunjujući
  prikaz imena.
- **Dokaz:** nodemailer 10.5.0, `streamTransport`, ime `"Ana\r\nBcc: zrtva@primjer.ba\r\nX-Inj: 1"` →
  `Subject: Nova poruka od kupca na Komodu: Ana Bcc: zrtva@primjer.ba X-Inj: 1` (jedan red), envelope
  `{"to":["butik@proba.ba"]}`. U tijelu emaila novi redovi ostaju.
- **Popravka (backend):** za jednoredna polja
  ```js
  function cleanLine(value, max) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮  ⁦-⁩]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, max);
  }
  ```
  `cleanLine` koristiti za ime, naziv butika, naslov oglasa i telefon. Poruke ostaju na `clean`.
- **Popravlja:** backend
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: `cleanLine` (`api/src/nalog.js`) za ime, naziv butika, naslov oglasa, telefon, grad i imena u emailovima/pushu. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-13).

## S-14 — Lični podaci poslije brisanja naloga i treće strane (Zakon o zaštiti ličnih podataka BiH, Sl. glasnik 12/25)

- **Rizik:** nizak (tehnička usklađenost; pravnu ocjenu daje pravnik)
- **Gdje:** `api/src/server.js` → `POST /api/me/delete`, `removeListingFiles()`, `cleanup()`, `pushNewMessage()`,
  `mail.js`; `web/index.html` (Google Fonts); `server/kopija-baze.sh`; `nginx-komodo.conf`.
- **Šta je provjereno brisanjem kupca (razvoj):** `users` 0, poruke i razgovor 0 (kaskadno, nestaju i kod
  butika), `push_tokens`, `sessions`, `email_tokens`, `likes`, `blocks`, `reports` kaskadno. **Ostaje:**
  - `listing_views` s `viewer='u<id>'` (1 red, pseudonim, briše ga `cleanup()` poslije 30 dana) — u redu;
  - `rate_limits` s emailom u ključu (`login:email:kupac@proba.ba`, 2 reda) do 2 sata — u redu;
  - snimci na Bunnyju: `deleteFromBunny` se pokuša **jednom**; ako Bunny ne odgovori, samo se zapiše
    upozorenje i snimak ostaje zauvijek (isto važi za `DELETE /api/listings/:id` i admin „ukloni”);
  - Nginx keš `/media/` do 10 min (dokumentovano) i `Cache-Control: public, max-age=604800` (7 dana u
    pregledniku gledalaca) iz `fastifyStatic` za `/media/`;
  - dnevnik: `mail.js` upisuje email primaoca kad slanje ne uspije (`Email za ${to} nije poslan`); Nginx
    access log s IP adresama; Docker dnevnici (3 × 10 MB);
  - kopije baze 14 dana (`kopija-baze.sh`), nešifrovane, na istom serveru;
  - kolačić `did` (1 godina) i za neprijavljene: služi za statistiku pregleda, pa nije nužan za rad stranice;
  - push: tekst poruke (do 140 znakova) ide preko Expo i Apple/Google servera i vidi se na zaključanom ekranu;
  - Google Fonts: svaki posjetilac šalje IP adresu Googleu (`index.html`, `<link href="https://fonts.googleapis.com/…">`).
- **Popravka:**
  - backend: tabela `bunny_deletions(guid, tries, next_at)`. `removeListingFiles` upisuje guid kad brisanje ne
    uspije, a `checkVideos` pokušava ponovo. U `mail.js` umjesto adrese bilježiti `user id` ili samo domen;
  - backend: `/media/` s `maxAge: '10m'` umjesto `'7d'` (snimak tamo ionako živi samo dok Bunny ne završi);
  - frontend: fontove poslužiti sa svog servera (`web/fonts/`), a iz CSP-a ukloniti `fonts.googleapis.com` i
    `fonts.gstatic.com`;
  - devops: kopije šifrovati prije iznošenja van servera (`gpg --symmetric` ili `age`) i rok čuvanja upisati u
    `docs/RUNBOOK.md`;
  - Proizvod/pravnik: u `web/privatnost.html` navesti `did`, rokove (pregledi 30 dana, dnevnici, kopije 14
    dana), primaoce (Bunny, Expo/Apple/Google, email servis) i da brisanje naloga briše i razgovore kod druge
    strane. Razmotriti push bez teksta poruke („Nova poruka od …”) kao zadano.
- **Popravlja:** backend + frontend + devops (+ Proizvod za tekst)

## S-15 — Enumeracija emaila

- **Rizik:** informativno
- **Gdje:** `POST /api/auth/register` (409 „Nalog s ovom email adresom već postoji”), `POST /api/auth/login`
  (scrypt se računa samo kad nalog postoji), `POST /api/auth/forgot` (čeka slanje emaila samo kad nalog
  postoji).
- **Scenarij:** registracija i inače izričito kaže da adresa postoji, a to je svjestan izbor zbog UX-a. Mjerenje
  vremena prijave zato ne otkriva ništa novo.
- **Dokaz:** prijava nepostojećeg emaila 2,7–3,9 ms, postojećeg 42–52 ms (`curl -w %{time_total}`).
- **Popravka:** ništa obavezno. Ako se 409 kod registracije ikad ukloni, u prijavi za nepostojeći nalog računati
  scrypt nad lažnim hashom, a `forgot` slati u pozadini (`sendMail(...).catch()` bez `await`).
- **Popravlja:** —

## S-16 — Nginx: nema HSTS, verzija servera je vidljiva

- **Rizik:** informativno
- **Gdje:** `server/nginx-komodo.conf` (`server` blok).
- **Scenarij:** bez HSTS prvi zahtjev na `http://komodo.ba` može presresti napadač na istoj mreži (javni WiFi).
  Kolačići su `Secure` u produkciji (provjereno), pa ne cure, ali preusmjerenje može. Certbot dodaje
  preusmjerenje, a HSTS ne dodaje.
- **Popravka (devops):** u HTTPS `server` blok
  `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` (pa tek poslije
  sedmicu dana bez problema `preload`), a u `http {}` `server_tokens off;`. Pazi: `add_header` u
  `server` bloku, ne u `location` (napomena u fajlu već postoji).
- **Popravlja:** devops

## S-17 — Aplikacija se na bazu spaja kao superuser

- **Rizik:** informativno
- **Gdje:** `docker-compose.yml` (`POSTGRES_USER: komodo` = superuser, `DATABASE_URL` API-ja koristi njega).
- **Scenarij:** SQL injekcija nije nađena. Kad bi se ikad pojavila, superuser može `COPY … PROGRAM`, odnosno
  izvršiti komandu u kontejneru baze.
- **Popravka (devops):** superuser ostaje za migracije (`pg_trgm`), a API radi kao zaseban korisnik:
  `create role komodo_app login password '…'; grant connect on database komodo to komodo_app;
  grant select, insert, update, delete on all tables in schema public to komodo_app;
  grant usage on all sequences in schema public to komodo_app;` + `alter default privileges …`. Migracije pokreće
  `index.js` s `MIGRATE_DATABASE_URL`.
- **Popravlja:** devops (+ backend za odvojen URL migracija)

## S-18 — Tokeni sesija u bazi u čistom tekstu; scrypt ispod preporuke

- **Rizik:** informativno
- **Gdje:** `api/src/server.js` → `startSession()`, `currentUser()`, `emailToken()`; `api/src/nalog.js` →
  `hashPassword()` (Node zadano N=16384, r=8, p=1).
- **Scenarij:** ko dođe do kopije baze (S-14, kopije), dobija važeće sesije do 30 dana. Za scrypt OWASP
  preporučuje N=2^17. Uz 20.000 korisnika i keš prijava to je pitanje kapaciteta, ne hitna rupa.
- **Popravka (backend):** u bazi čuvati `sha256(token)`, a u kolačiću sirovi token (jedna nova migracija;
  postojeće sesije se poništavaju). scrypt podići na N=2^15 i parametre upisati u hash (`N:r:p:salt:hash`), uz
  mjerenje opterećenja (QA).
- **Popravlja:** backend
- **Status:** popravljeno u commitu „Backend: sigurnost i šema v1”: u `sessions.token` je sha256 tokena (migracija `010_sigurnost.sql` pretvara postojeće sesije, niko nije odjavljen). scrypt N=2^15 sa zapisom `s2:N:r:p:so:hash` se čita uvijek, a **piše** tek uz `KOMODO_SCRYPT_V2=1` (prethodna verzija API-ja ne zna pročitati novi zapis); uključiti u sljedećem izdanju. Dokaz (test `api/test/backend-sigurnost.test.mjs`, S-18).

## S-19 — Odjava i gašenje naloga kasne do 15 s u ostalim procesima

- **Rizik:** informativno (svjesna odluka, `docs/SKALIRANJE.md`)
- **Gdje:** `api/src/server.js` → `currentUser()` (`userCache`, `USER_TTL = 15 s`).
- **Scenarij:** ugašen nalog ili ukradena sesija poslije odjave radi još najviše 15 s u drugim radnicima.
- **Popravka:** nije potrebna za v1. Ako bude potrebno: `LISTEN/NOTIFY` za poništenje keša u svim procesima.
- **Popravlja:** —

---

## Provjereno i u redu

- **Kolačić `sid`:** 256-bitni nasumični token, `HttpOnly`, `SameSite=Lax`, a u produkciji i `Secure`
  (provjereno: `set-cookie: sid=…; HttpOnly; Secure; SameSite=Lax`). Istek 30 dana i u bazi i u kolačiću.
- **Odjava** briše sesiju u bazi i kešu; push token kaskadno nestaje.
- **Promjena lozinke** traži trenutnu i gasi ostale sesije. **Nova lozinka**: token 192 bita, 1 sat, jednokratan
  (`delete … returning`), novi poništava stari, gasi sve sesije. Poruke ne otkrivaju postoji li nalog.
- **scrypt** sa `timingSafeEqual` i nasumičnom solju po lozinki.
- **Autorizacija (IDOR), provjereno curlom:** tuđi razgovor (čitanje, pisanje, blokiranje) → 404; tuđi oglas
  (`PATCH`, `DELETE`) → 404; kupac objavljuje → 403; butik započinje razgovor → 403; kupac ne može postaviti
  ulogu, telefon ni linkove; sve `/api/admin/*` za kupca → 404; ugašen nalog nema sesiju i ne vidi se u feedu ni
  na profilu.
- **XSS:** svih ~22 mjesta s `innerHTML`/`insertAdjacentHTML`/`outerHTML` u `web/app.js` prolaze kroz `esc()`
  (escape `& < > " '`) ili ubacuju brojeve s API-ja. Tekstovi idu kroz `textContent`. Linkovi profila su
  samo `http(s)` (`normalizeLinks`, `javascript:` → 400), a `URL.href` kodira `" < >`. Playwright s
  naslovom `<img onerror>`, imenom butika `<svg onload>`, imenom kupca, porukama `<script>`/`<img onerror>`,
  linkom `https://a.ba/x'"><img onerror>`, kroz feed, kontakt, profil butika, poruke, razgovor i
  administraciju → **0 izvršenih `alert`**.
- **CSP** u Nginxu je stroga (`script-src 'self'`, bez inline skripti, `object-src 'none'`,
  `frame-ancestors 'self'`). Uz nju idu `nosniff`, `Referrer-Policy`, `X-Frame-Options` i `Permissions-Policy`.
- **SQL:** svi upiti su parametrizovani. Dinamički dijelovi (`mineCol`, `VIDEO_COLS`, `UNREAD_SQL`, `where` iz
  `add()`) su konstante iz koda. `ilike` escape-uje `\ % _`. Nema dinamičkog `ORDER BY`.
- **Veličine ulaza:** `bodyLimit` 64 KB, poruka 1000 znakova, linkova ≤ 5 × 200, `ids` u `/api/views` ≤ 50
  (cijeli brojevi < 2^31), u `/api/likes` ≤ 100, pretraga 60 znakova. Regexi su jednostavni, a ulaz kratak, pa
  ReDoS nije moguć.
- **Upload:** ime fajla pravi server (UUID + ekstenzija iz bijele liste), pa path traversal nije moguć; tip je
  iz bijele liste; najviše 1 fajl i 10 polja; veličina `MAX_VIDEO_MB`; Nginx ograničava tijelo na 110 MB samo
  na `= /api/listings`.
- **Bunny:** `BUNNY_API_KEY` se koristi samo u `video.js` na serveru i ne ide klijentu. Klijent dobija samo
  CDN adrese s nepogodivim guidom.
- **Email:** ubacivanje zaglavlja nije moguće (S-13, dokaz). Tijelo je čist tekst.
- **Push:** token može prijaviti samo prijavljen korisnik i vezan je za sesiju. `DeviceNotRegistered` se briše.
- **Docker:** kontejner radi kao `node` (ne root); baza nije izložena (nema `ports`); API sluša samo na
  `127.0.0.1:3002`; tajne su u `.env` i `api/.env`, koji su izvan slike (`.dockerignore`); dnevnici se
  rotiraju.
- **Zavisnosti:** `npm audit --omit=dev` → `found 0 vulnerabilities` (fastify 5.12.8, @fastify/cookie 11.1.5,
  @fastify/multipart 10.1.8, @fastify/static 10.1.10, nodemailer 10.5.0, pg 8.23.1; Node 22.23.4).
- **`server/kopija-baze.sh`:** `set -euo pipefail`, provjera sadržaja i privremeni fajl. Lozinka baze se ne
  pojavljuje u komandnoj liniji.

## Provjere koje treba ponoviti poslije popravki

1. S-01: registracija adrese iz `ADMIN_EMAILS` bez potvrde → `admin:false`, `/api/admin/users` → 404; poslije
   potvrde → `admin:true`. `NODE_ENV=production` bez `SMTP_URL` → API ne starta.
2. S-02: iza pravog Nginxa (server, faza 4) `register` s `X-Forwarded-For: 1.2.3.4` → u `rate_limits` ključ s
   pravom adresom klijenta, ne `1.2.3.4`.
3. S-03: 201. registracija s iste adrese u danu → 429; potrošen budžet → nalog nastaje, email se ne šalje,
   upozorenje stiže u nadzor.
4. S-04: 31 pogrešna prijava s drugih adresa → vlasnik s poznatog uređaja se prijavljuje (200), nepoznat
   uređaj → 429.
5. S-05: prevelik i prekinut upload → u `UPLOADS_DIR` nema novih fajlova; 31. objava u satu → 429.
6. S-06: link iz emaila ima `#lozinka=`; u Nginx dnevniku nema tokena; adresa se čisti odmah po učitavanju.
7. S-07: 100 zahtjeva bez kolačića i 100 s izmišljenim `did` → `views` se ne mijenja.
8. S-08: nepotvrđen nalog → `POST /api/reports` 403.
9. S-09: drugi nalog prijavljuje tuđi token → `user_id` se ne mijenja.
10. S-10: na telefonu `https://komodo.ba.primjer.com` se otvara van aplikacije; `data:` se ne učitava.
11. S-11: tekstualni fajl s oznakom `video/mp4` → 400; `/media/…` i `/api/…` imaju `X-Content-Type-Options`.
12. S-12: `POST` sa `Origin: https://zlo.ba` → 403; aplikacija u pregledniku i WebViewu i dalje radi (e2e).
13. Ponovo cijeli XSS prolaz (`/tmp/sec-tools/xss.py`) i CSRF prolaz (`/tmp/sec-tools/csrf.py`) na verziji
    poslije podjele `server.js` i `app.js` na module: podjela ne smije izgubiti nijedan `esc()`.
14. `npm audit --omit=dev` pri svakoj promjeni `package-lock.json` (u CI, QA).
15. Poslije faze 4: `curl -sI https://komodo.ba` → HSTS, CSP i ostala zaglavlja; `ss -ltn` na serveru → 5432 i
    3002 samo lokalno.
