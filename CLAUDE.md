# Komodo — pravila i stanje projekta

Komodo (komodo.ba) je video oglasnik; radni naziv je bio Snimi, pa se folder i baza i dalje zovu `snimi`. Komodo je video oglasnik: prodavač snimi kratak video, upiše naziv, cijenu i kategoriju.
Počinje s buticima u Banjoj Luci. Vlasnik je Stefan; odvojen proizvod od Terminka.

## Odluke
- Bosanski, ijekavica — u aplikaciji, dokumentima i porukama grešaka.
- Bez AI-ja u prvoj verziji: naziv, cijenu i kategoriju upisuje prodavač.
- API je običan JavaScript (ESM, Node 22, Fastify, `pg`), bez TypeScripta i bez gradnje. Web je običan HTML/CSS/JS.
- Cijene se čuvaju u feninzima (`price_cents`), prikazuju u KM.
- Uloge: `kupac` se registruje sam (sviđanja, poruke); `butik` otvara samo administrator skriptom `api/src/novi-butik.js` (kao salon u Terminku). Oglase objavljuje samo butik.
- Poruke idu kroz aplikaciju: jedan razgovor po paru kupac–butik, započinje ga kupac. Nove poruke se dovlače upitom svake 4 sekunde, bez WebSocketa.
- Profil butika uz poruke prikazuje i telefon, Viber i do 5 linkova (Instagram, Facebook, TikTok, sajt).
- Prijava: email + lozinka, sesija u kolačiću `sid` (tabela `sessions`). Lozinka se mijenja u profilu.
- Snimci su u razvoju na disku (`api/uploads`). Pred objavu idu na Bunny Stream, ne na naš server.
- Server: razvoj je samo lokalno. Pred objavu se kupuje zaseban Hetzner server (ne dijeli se s Terminkom).

## Pravila rada
- Migracija je novi `.sql` fajl u `api/migrations` (sljedeći broj); postojeće se ne mijenjaju.
- Poslije izmjene pokrenuti API i kliknuti kroz tok: otvaranje butika → objava → sviđanje → kontakt → brisanje.
- `api/.env` i `api/uploads/` se nikad ne commituju niti šalju u chat.

## Stanje (20.11.2026.)
- v1 funkcije F-01 … F-09 su urađene (spisak i kriteriji: `docs/SPEC-V1.md`): feed „Za tebe/Novo/Praćeni”, pregled
  linka pri dijeljenju (OG), veličine i filter, praćenje butika, profil i radno vrijeme, statistika butika,
  sniženja s pushom, poruke (brza pitanja), brojke administratora.
- Migracije su do 014 (`013_otpornost.sql`: `listing_likes_delta`, `outbox`, `idempotency_keys`, `app_settings`; `014_recenzija3.sql`: `idempotency_keys.vlasnik`, `outbox.zakup`, `rezim_promjene`); **sljedeća je 015**. Plan do produkcije je u `docs/PLAN-PRODUKCIJA.md`, stanje i redoslijed
  preostalog posla u `docs/NASTAVAK.md` (ako postoji), nalazi recenzija u `docs/RECENZIJA-1.md`, `docs/RECENZIJA-2.md` i `docs/RECENZIJA-3.md` (stanje popravki na kraju).
- Testovi: 256 API testova, test istovremenosti, Playwright e2e (36), `mobile/navigacija.test.mjs` (`docs/TESTOVI.md`).
- Talas 4 „otpornost” (24.11.): rokovi za upite i HTTP (503 + `Retry-After`, nikad 500), klijent s rasipanjem i
  sve dužim čekanjem, „veliki crveni prekidač” (`/api/config`, `KOMODO_REZIM`, Administracija → Režim rada;
  `docs/RUNBOOK.md` 4a), stari keš feeda kad baza ne odgovara, sviđanja kroz `listing_likes_delta`, push kroz
  `outbox`, `Idempotency-Key` za poruku i objavu (`docs/ARHITEKTURA.md`, „Otpornost”).
- Struktura koda: `docs/ARHITEKTURA.md`; server i Nginx: `docs/SERVER.md`, `server/nginx-komodo.conf`; kako vratiti verziju
  i bazu: `docs/RUNBOOK.md`.

## Stanje iz ranijih etapa (13.11.2026.)
Urađeno (etapa 1, isprobano u pregledniku): feed s kategorijama, pretragom i rasponom cijene; javni profil butika;
objava videa (samo butik); izmjena oglasa i oznaka „prodato”; broj pregleda (vidi ga vlasnik); sviđanja; poruke
kupac–butik sa značkom nepročitanih, blokiranjem i prijavom; prijava oglasa; administracija (`ADMIN_EMAILS`):
prijave, otvaranje butika, gašenje naloga; potvrda emaila, zaboravljena lozinka, brisanje naloga; ograničenja
učestalosti (prijava, registracija, poruke, prijave); email butiku za poruku nepročitanu 15 minuta; logo i ikonice;
nacrti uslova korištenja i politike privatnosti (`web/uslovi.html`, `web/privatnost.html`).

Migracije 009 (v1 šema) i 010 (sigurnost) su dodane (kasnije do 011, vidi gore). Produkcija (`NODE_ENV=production`) traži `SMTP_URL`, `COOKIE_SECRET` i `APP_URL`, bez prva dva API ne starta.

Otvoreno:
- Uslovi i privatnost su nacrti: upisati operatera i kontakt, dati pravniku.
- Skaliranje (19.11.): `docs/SKALIRANJE.md`. API radi u više procesa (`api/src/index.js`, `WORKERS`), ograničenja i pregledi su u bazi (migracija 008), `likes_count` u `listings`, keš prijava 15 s i javnog feeda 5 s, index.html dobija oznaku verzije za web/js/*.js i style.css; struktura koda: `docs/ARHITEKTURA.md`. Klijent ~7 zahtjeva/min po korisniku. Izmjereno na 2 jezgra: 10.000 korisnika bez grešaka (p95 < 25 ms), granica ~2.500 zahtjeva/s. Za lansiranje CCX23, pred reklame CCX33 (`docs/SERVER.md`, odjeljak 8).
- Etapa 2 (kod gotov): snimci na Bunny Stream (`api/src/video.js`). Snimak ide na disk, pa u pozadini na Bunny;
  dok se obrađuje svi ga gledaju s našeg servera, a lokalni fajl se briše 30 min poslije završetka (`ready_at`). Puštanje: MP4 `play_<rez>.mp4`, najveća od 1080p/720p/360p/240p (Bunny biblioteka 808418, Frankfurt, rezolucije 240/360/720/1080), sličica `thumbnail.jpg`.
  Isprobano samo s lažnim Bunny serverom; sa pravim nalogom provjeriti nazive polja (`status`,
  `availableResolutions`) i da je u biblioteci uključen MP4 fallback.
- Etapa 3 (u toku): `mobile/` je Expo SDK 58 omotač (WebView) s push obavještenjima o porukama (`push_tokens`,
  token vezan za sesiju), prekidačem u profilu, dijeljenjem i Android dugmetom Nazad. Isprobano: JS bundle se gradi,
  web dio u pregledniku s lažnim omotačem. Nije isprobano na telefonu. Fali: `eas init`, Firebase za Android push,
  materijal za prodavnice. Zatim server, domena komodo.ba, SMTP.
- Server: `Dockerfile`, `docker-compose.yml`, `server/` i uputstvo `docs/SERVER.md` (nije prođeno na pravom serveru;
  slika nije izgrađena ovdje jer je Docker Hub bio blokiran).
- Prodavnice: `docs/PRODAVNICE.md` (tekstovi, data safety, napomena za recenzente) i `web/brisanje-naloga.html`.
