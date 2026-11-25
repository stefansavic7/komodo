# Komodo — nezavisni pregled ugrađenog redizajna (pravac A, koral + „Sjaj”, „Kontaktiraj”)

Stanje: grana `redizajn`, `8b465a3` (25.11.2026.). Pregledao dizajner, nezavisno od ugradnje.

## Presuda

**Spremno za Stefanovo odobrenje: uz uslove.** Sistem je ugrađen dosljedno: tokeni, 4 veličine i 2 debljine slova,
gradijent „Sjaj” samo na glavnoj radnji, prozori sa × i radnjom dolje, greške uz polje, filter po grupi i „Oglas je
u izlogu” rade kako je dogovoreno. Ali na 360 px i s dužim, stvarnim sadržajem kartica feeda puca (D-01, D-02),
dugme na vrhuncu toka izlazi iz ekrana (D-03), uputa se crta preko praznog stanja (D-04), Android Nazad iz „Više”
vlasnika zatvara aplikaciju (D-05), a dio slika u `design/poslije/` pokazuje stari izgled (D-06). Stefan bi
odobravao po slikama koje ne odgovaraju kodu. Prvih 6 nalaza treba popraviti i slike ponovo snimiti, pa onda
tražiti odobrenje. Za sve to treba oko pola dana rada frontenda.

## Kako je pregledano

1. **Slike:** svih 37 parova nacrt (`design/ekrani/png/`) ↔ poslije (`design/poslije/` 360/390/430) poredani jedan
   do drugog i pregledani.
2. **Aplikacija uživo:** probna baza `komodo_pregled` (5 butika preko `novi-butik.js`, podaci iz `seed.py`), API na
   portu 3985, Chrome (Playwright, `is_mobile`, dodir, `bs-BA`, Europe/Sarajevo), 360×780 / 390×844 / 430×932.
   Dodano: butik dugog imena „Butik Elegancija i Stil Gospodske Ulice Banja Luka” s adresom „Ulica Kralja Alfonsa XIII
   broj 147, lamela B, prizemlje”, oglas s najdužim nazivom (80 znakova upisano, server čuva 60), cijenom 1.249,90 KM,
   sniženjem i svih 6 veličina, na **skoro bijelom** snimku (`#FAFAF7`), i oglas na **šarenom** snimku (testsrc2).
   Prođeno: tastatura (Tab, Escape), filter i pamćenje veličina, objava do „Oglas je u izlogu” i „Objavi još jedan”,
   „Kontaktiraj” → „Pošalji poruku” → prva poruka, prazni spisak poruka, prazno „Praćeni” s uputom, greška feeda
   (prekinut `/api/feed`), nepostojeći butik, `window.__komodoBack` iz svih prozora (lažni `ReactNativeWebView`).
   Probna baza je obrisana, a snimci koje je pregled poslao su uklonjeni iz `api/uploads`.
3. **Vanjske smjernice** (preuzete danas): Vercel `web-interface-guidelines/command.md` i `ceorkm/mobile-app-ui-design`
   SKILL.md, oba spiska anti-obrazaca su prođena ponovo (odjeljak „Vercel i ceorkm”).

## Nalazi

Ozbiljnost: **mora** = prije spajanja i prije Stefanovog odobrenja; **poželjno** = u istoj grani ako stane;
**kasnije** = poseban posao.

### D-01 — Kartica feeda: blok podataka se širi ispod kolone radnji i van ekrana · **mora**

- **Ekran:** feed, kartica oglasa; 360 (i 390 s dugim imenom butika).
- **Koraci:** butik dugog imena, oglas od 1.249,90 KM sa sniženjem (−250 KM), kartica „Novo”, 360×780.
- **Izmjereno (`getBoundingClientRect`):** `.meta` je 16–288, ali `.seller-row` ide do **385** (ekran je 360),
  `.follow-btn` „Prati” 333–385 (pola van ekrana, preko srca 304–352), `.shop-sub` do 385, `.title` do 385,
  `.save` („Sniženo −250 KM”) 216–329 preko kolone radnji (304–352). Na slici se „Prati” vidi kao „Pra”, a sniženje
  se crta ispod dugmeta „Više”.
- **Uzrok:** `.meta` je `display:grid` bez šablona kolona, pa implicitna kolona `auto` dobija min-content širinu
  najdužeg reda koji ne smije da se prelomi (`white-space:nowrap` u `.shop-sub`, ime butika).
- **Izmjena:** `web/style.css:77`, `.meta{…; grid-template-columns:minmax(0,1fr)}` (isto rješenje kao `.topbar`, 2.2).
  Provjereno ubacivanjem pravila u stranicu. Poslije izmjene: `.seller-row` 16–288, ime se skraćuje
  („Butik Elegancija i Stil …”), „Prati” 236–288, `.save` prelazi u novi red ispod cijene, XXL u drugi red veličina.
  Ništa ne ulazi u kolonu radnji.

### D-02 — „otvoreno do 20:00” nestaje iza trotačke kad je adresa duža · **mora**

- **Ekran:** feed, red ispod imena butika (`.shop-sub`); 360 i 390.
- **Slika:** `design/poslije/360-gost-feed-zatebe.png` i `390-gost-feed-zatebe.png`: „TC Delta Planet, Bulevar srpske
  vojske 8 · …” / „… · otvar…”. Uživo isto za „Kralja Petra I Karađorđevića 85 · otvara u …” na 360. Odobrena
  odluka (SPEC-V1 odj. 7, t. 3) je baš status, a adresa je sporedna.
- **Izmjena:** skraćivati adresu, a status uvijek prikazati cijeli.
  - `web/js/feed.js:135-143` (`shopSubHTML`): adresa u `<span class="adr">`, status u
    `<span class="st">` s razdjelnikom unutra (`' · '` samo kad postoje oba dijela). Klasu `open` zadržati na statusu.
  - `web/style.css:88`: `.shop-sub{display:flex;…}` (`white-space:nowrap` ostaje), dodati
    `.shop-sub .adr{min-width:0;overflow:hidden;text-overflow:ellipsis}` i `.shop-sub .st{flex:none}`.
  - e2e ne čita `.shop-sub`, pa se testovi ne mijenjaju.

### D-03 — „Oglas je u izlogu” na 360: „Objavi još jedan” izlazi iz ekrana · **mora**

- **Ekran:** `#postDone`, podnožje; 360.
- **Slika i mjere:** `design/poslije/360-b0-objava-u-izlogu.png`, dugme je zalijepljeno uz desnu ivicu. Uživo
  `#doneAgain` 199–**367** (ekran 360), kolone `.btns-2` su 175 + 168 px, a mjesta ima 328.
- **Uzrok:** `.btns`/`.btns-2` koriste `1fr` kolone, a `.btn` je `white-space:nowrap` s odmakom 24 px. Zato `1fr` ne
  može biti uže od teksta. Isti rizik postoji u svim parovima „Odustani | Sačuvaj”, „Poništi | Traži” i
  „Podijeli oglas | Objavi još jedan” kad su tekstovi duži.
- **Izmjena:** `web/style.css:170-171`:
  `.btns{grid-template-columns:minmax(0,1fr) minmax(0,2fr)}`,
  `.btns-2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}`, i dodati
  `.btns .btn,.btns-2 .btn{min-width:0;padding:0 var(--s-4)}`. Provjereno: dugmad 16–176 i 184–344, tekst cijeli.

### D-04 — Uputa „Prevuci gore za sljedeći proizvod” preko praznog stanja · **mora**

- **Ekran:** feed „Praćeni” (gost, prvi ulaz); vidi se na 360, 390 i 430.
- **Slika:** `design/poslije/*-gost-praceni-gost.png`. Uputa leži preko naslova „Prati butike koji ti se sviđaju” na
  390, preko teksta na 360 i preko dugmeta „Napravi nalog” na 430. Uživo: otvori `/` bez `komodo.uputa`, pa za manje
  od 4 s dodirni „Praćeni”. Uputa ostaje preko praznog stanja.
- **Uzrok:** `showUputa()` provjerava karticu samo pri prikazu. Promjena kartice feeda ne skriva uputu
  (`uputaTimer` 4 s, a skriva je samo skrol).
- **Izmjena:** `web/js/feed.js:309` (`loadFeed`): na početku `if (reset) { hideUputa(); }`. Uputa se tada skriva
  pri svakoj promjeni kartice, kategorije ili filtera.

### D-05 — Android Nazad s otvorenim „Više” vlasnika zatvara aplikaciju · **mora**

- **Ekran:** feed, vlastiti oglas → „Više” (`#moreSheet`).
- **Koraci:** u omotaču (`?app=1`, `ReactNativeWebView`) otvori „Više” na svom oglasu, pa pozovi `window.__komodoBack()`.
  Rezultat: prozor ostaje otvoren i omotaču ide `{"type":"exit"}`. Ostali prozori se zatvaraju ispravno
  (pretraga, kontakt, „Više” kupca, prijava, potvrda, objava i izmjena, „Uredi profil”, „Više” u razgovoru i
  statistika preko svojih omotača u `profil.js`/`poruke.js`).
- **Napomena:** greška postoji i na glavnoj grani, ali kriterij 4.6/10 traži da Nazad zatvara svaki prozor.
- **Izmjena:** `web/js/omotac.js:20`: dodati `[moreSheet, closeMore]` u niz `sheets`, prije `contactSheet`.

### D-06 — Slike poslije ne odgovaraju kodu · **mora** (prije Stefanovog pregleda)

- 14 slika na 390 (i iste na 360/430) su iz `047a87a` (koraci 1–6). Neke su iz `cfa8ab9` i `606ab9e`. Na njima je još
  **„Pitaj butik”**, ravno dugme bez „Sjaja” ili uputa preko praznog stanja: `kupac-feed-kupac`, `kupac-kontakt`,
  `kupac-vise-kupac`, `kupac-prijavi`, `kupac-toast`, `gost-feed-snizeno`, `gost-feed-zatvoreno`,
  `gost-feed-ucitavanje`, `gost-feed-greska`, `gost-feed-kategorija-prazna`, `gost-filter-prazno`,
  `gost-praceni-gost`, `b0-feed-vlastiti`, `b0-confirm`. `kupac-razgovor-prvi` ne pokazuje prvi razgovor (već ima
  poruke), pa se `.pstatus` („Butik je zatvoren · otvara u 09:00. Odgovor stiže ovdje.”) nigdje ne vidi. Uživo radi.
- **Izmjena:** poslije D-01–D-05 ponovo snimiti sve `design/poslije/*` na 3 veličine. Dodati i slike koje sada fale:
  `kupac-razgovor-prvi` bez poruka, `gost-feed-dugo` (dugo ime, adresa i naziv, sniženje ≥ 1.000 KM, 6 veličina) i
  `gost-feed-svijetli` (bijeli snimak). U skripti za slike staviti `locale: 'bs-BA'` **i**
  `args: ['--lang=bs-BA']`. Inače Chrome u „Uredi profil” crta vrijeme kao „09:00 AM / 08:00 PM”
  (`390-b0-uredi-profil.png`), a telefon s bosanskim jezikom pokazuje 09:00/20:00 kao u nacrtu.

### D-07 — Prazan spisak poruka nema prazno stanje iz sistema · **poželjno**

- **Ekran:** Poruke, novi kupac (i butik bez razgovora); nacrt `poruke-prazno.png`.
- **Uživo:** jedan red sivog teksta ispod naslova, bez kruga s ikonom, naslova i razmaka iz 1.7. Svi ostali prazni
  ekrani (feed, filter, nepostojeći butik) imaju sistemski izgled.
- **Izmjena:** `web/js/poruke.js:19-21`: umjesto `#inboxHint.textContent` iscrtati `.empty-box` kao `emptyCard`
  (`feed.js:174`): ikona `chat`, naslov „Još nema poruka” (iz nacrta), tekst kupca „Na oglasu dodirni „Kontaktiraj” i
  pitaj šta te zanima.” (SPEC 7, t. 7). Butiku ide „Kad ti kupac piše zbog oglasa, razgovor se pojavi ovdje.”
  (postojeći tekst bez prve rečenice). `#inboxHint` ostaje za „Učitavam poruke…”.

### D-08 — Programski fokus otvara tastaturu ili crta prsten pri dodiru · **poželjno**

- **Ekrani:** „Traži” (`feed.js:703`, `$('#qText').focus()`), „Uredi profil” (`profil.js:40`, `#sName`),
  „Ovaj butik ne postoji” (`butik.js:291`, `#vHome`).
- **Slike:** `390-gost-filter.png` i `390-b0-uredi-profil.png` imaju bijeli prsten oko prvog polja,
  `butik-ne-postoji` ima prsten oko „Na početnu” bez tastature. Na telefonu fokus na polju otvara tastaturu koja
  pokriva veličine u filteru i radno vrijeme u profilu. Većina otvara filter zbog veličina, ne zbog teksta (Vercel:
  „autoFocus … avoid on mobile”, isto pravilo kao M-2 za razgovor).
- **Izmjena:** fokus na naslov prozora (`<h2 tabindex="-1">`, kao `#doneTitle` u `objava.js:183`) ili na ×
  (`#searchClose`, kao `#contactClose`). Za `#vHome` staviti fokus na naslov praznog stanja. Pristupačnost ostaje
  ista: fokus je u prozoru, a tastatura se ne otvara.

### D-09 — Dugo ime u spisku poruka i zaglavlju razgovora prelazi u dva reda · **poželjno**

- **Ekran:** Poruke (spisak) i `#chat`. Uživo s „Butik Elegancija i Stil Gospodske Ulice”: red spiska raste, a u
  zaglavlju ime zauzima 2 reda i gura status. Nacrt 2.15/2.16 traži jedan red.
- **Izmjena:** `web/style.css:324`: `.inbox .who>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`.
  `web/style.css:335`: `.chat-who strong{…; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}` (umjesto
  `overflow-wrap:anywhere`).

### D-10 — Nema razdjelnika dana u razgovoru · **poželjno**

- **Ekran:** `#chat`. Nacrt `razgovor.png` ima „Danas” iznad poruka, a ugradnja ne crta razdjelnike. Uz vrijeme
  „07:45” bez datuma, poruke od prije nekoliko dana izgledaju kao današnje.
- **Izmjena:** `web/js/poruke.js` (crtanje poruka): kad se dan promijeni između dvije poruke, ubaciti
  `<p class="day" role="separator">Danas | Juče | 21.11.</p>` (12/700 `--c-text-3`, centrirano, razmak 16). Za
  oznaku koristiti postojeći `fmtTime`. Nema novih zahtjeva.

### D-11 — Aktivni filter veličine se ne vidi kad je red kategorija pomjeren · **poželjno**

- **Ekran:** feed poslije filtera i izbora kategorije „Obuća”. Kupac povuče red tableta do „Obuća”, pa je
  „Veličine: 38 ✕” (`.vtab`, prvi u redu) van ekrana. Ostaje samo tačka na lupi.
- **Izmjena:** `web/style.css` (pravilo `.vtab`): `position:sticky; left:0; z-index:1`. Neaktivan tablet je inverzan,
  pa se odvaja od tableta koji prolaze ispod. Kod se ne mijenja.

### D-12 — Dokumentacija se ne slaže s ugradnjom gradijenta · **poželjno**

- `docs/DIZAJN.md` 6.2 (tabela) kaže „da” za „Objavi” (meni) i „ostala `.btn-main`”, a 6.4 navodi `.tab-post` i `.send`.
  Odluka i kod (`style.css:248-252`) kažu samo `.cta`, `#postSubmit`, `#contactMsg`, `#vMsg`, `#doneAgain` i
  `#postDone`. Ugradnja je ispravna. Tabelu i blok koda treba uskladiti s uvodom odjeljka 6, da frontend kasnije
  ne „popravi” meni. 2.1 još spominje „Kontaktiraj butik” za dugme na kartici. Nacrti `design/ekrani/*` pokazuju
  „Pitaj butik” i ravno dugme. Dovoljna je napomena u 3 da su nacrti prije odluke od 25.11.

### D-13 — Sličica u kartici proizvoda (razgovor, registracija) je ikona kamere · **kasnije**

- U razvoju bez Bunnyja `posterUrl` je prazan, pa `.pcard` i mini oglas U-04 pokazuju ikonu `video` na
  `--c-surface-2` (`390-kupac-razgovor.png`). Nacrt ima sliku proizvoda. Isto se dešava i u produkciji dok se snimak
  obrađuje (do 3 min). Provjeriti s pravim Bunnyjem da `thumbnail.jpg` stiže. Ikona kao rezerva je u redu.

### D-14 — Sitnice · **kasnije**

- `.btn` ima prelaz `background-color` (`style.css:149-151`), a `.tab>span` takođe (`style.css:140`). Pravilo 1.8 je
  samo `transform`/`opacity`. Trošak je zanemarljiv, pa je dovoljno uskladiti pravilo ili ukloniti prelaz boje.
- Placeholderi bez tropočke (`index.html:192, 256, 258, 306, 311`) već su zapisani u `NASTAVAK-REDIZAJN.md`.
- Vlastiti profil na 430 nema broj uz „Moji oglasi” (nacrt ima „6” desno). Broj je već u `pCount`, pa nije potreban.

## Šta je provjereno i u redu

- **Gradijent „Sjaj”** je samo na glavnoj radnji ekrana (`style.css:248-252`), a onemogućeno je ravno. Nema ga na
  meniju „Objavi”, „Pošalji” u razgovoru, cijeni, znački, tabletima ni statistici. Zeleni sjaj iza kvačice je samo
  na `#postDone`. Na svakom ekranu je najviše jedan gradijent (kontakt prozor prekriva karticu zatamnjenjem).
- **Boje po ulogama:** žuta je samo cijena i logo, zelena povjerenje i „otvoreno”, a losos samo sniženje. „Prati” i
  linkovi više nisu koral. U CSS-u nema tvrdih veličina slova ni debljina mimo tokena (`grep` prazan).
- **Preko snimka:** na skoro bijelom snimku gornja traka ostaje tamna (pozadina iza kartica `#28252C`, neaktivna
  kartica `--c-text-2` 8,97:1). Scrim drži naziv, cijenu i „Kontaktiraj” čitljivim i na bijelom i na šarenom snimku.
- **Tastatura:** Tab ide redom: kartice feeda → lupa → tableti → zvuk. Svaki fokus ima prsten 2 px s tamnim oreolom.
  Escape zatvara „Traži” i vraća fokus na lupu. Kontakt prozor fokusira ×, a „Oglas je u izlogu” naslov.
- **`:active`:** `.btn` `scale(.98)`, kolona radnji i ikone `scale(.92)`, a glavna radnja dobija `--g-accent-press`.
  Hover je samo pod `@media (hover:hover)`. `prefers-reduced-motion` gasi trajanja, skeleton i strelicu upute.
- **Filter:** „Traži” zatvara prozor. `komodo.velicine` = `{"odjeca":["M"],"obuca":["38"]}`. Obuća šalje
  `sizes=38`, Haljine `sizes=M`, Torbe bez `sizes`, a `.vtab` pokazuje samo važeću grupu („Veličine: 38 ✕” / „Veličine: M ✕”).
- **Objava:** greška bez videa crta crveni okvir izbora i `.err` uz formu. Pregled preko snimka se mijenja dok se
  kuca. Naziv je ograničen na 60 znakova (`maxlength`) i lomi se u 2 reda u pregledu, na kartici i u „Oglas je u
  izlogu”. „Objavi još jedan” vraća praznu formu.
- **Prva poruka:** kartica proizvoda i „Butik je zatvoren · otvara u 09:00. Odgovor stiže ovdje.” su na vrhu. Polje
  nema fokus pri otvaranju (M-2). Status nestaje poslije prve poruke.
- **Greške i prazna stanja feeda:** „Oglasi se nisu učitali” s `wifi-off` i „Pokušaj ponovo”, prazna kategorija,
  prazni filter veličine i nepostojeći butik prate 1.7.
- **Sigurne zone, `viewport-fit=cover`** bez `user-scalable=no`, `theme-color` `#16121a`, `color-scheme:dark`, a
  `select` ima eksplicitne boje.

## Vercel i ceorkm (ponovo, nezavisno)

Vercel `command.md`, `fajl:red – nalaz`:

- `web/style.css:77` – flex/grid dijete bez `min-width:0` / `minmax(0,1fr)`, pa sadržaj prelijeva (D-01)
- `web/style.css:170-171` – sadržaj prelijeva kontejner, „fix content overflow” (D-03)
- `web/js/feed.js:135-143` – dugi korisnički sadržaj nije predviđen, a važan dio se skraćuje (D-02)
- `web/js/feed.js:703`, `web/js/profil.js:40` – „autoFocus sparingly … avoid on mobile” (D-08)
- `web/index.html:192, 256, 258, 306, 311` – placeholder bez `…` (poznato, D-14)
- `web/style.css:140, 149-151` – animira se `background-color`, a pravilo je samo `transform`/`opacity` (D-14)
- ✓ `outline:none` ne postoji, `:focus-visible` je svuda, a `transition: all` ne postoji
- ✓ `user-scalable`/`maximum-scale` nisu postavljeni, `touch-action: manipulation` i tap highlight su namjerni
- ✓ `overscroll-behavior: contain` na `.panel`, `env(safe-area-inset-*)`, `theme-color`, `color-scheme`
- ✓ dugmad s ikonom imaju `aria-label`, ikone uz tekst `aria-hidden`, a toast ima `role="status"`
- ✓ `tabular-nums` na cijenama i brojkama, `text-wrap: balance` na naslovima, `…` u „Učitavam…”
- ✓ e-mail polja: `spellcheck="false"`, `autocomplete` i `type` su ispravni (korak 12)
- Pravilo „Title Case” ne važi za Komodo (komodo-dizajn 2).

ceorkm anti-obrasci:

- Pretjerani gradijenti: **ne**, jedan po ekranu i samo na radnji (6.2 je ispoštovan u kodu).
- Više od 4 veličine ili 3 debljine: **ne** (12/14/16/24, 400/700).
- Nasumični razmaci: **ne**, na mreži 8 s dozvoljenim 4/12.
- Ključni sadržaj sakriven: **da**. Status radnog vremena se gubi (D-02), aktivni filter je van ekrana (D-11), a
  uputa pokriva prazno stanje (D-04).
- Radnja van zone palca: **ne**. „Kontaktiraj”, „Objavi”, „Pošalji poruku”, „Traži” i „Sačuvaj” su dolje.
- Generičko prazno stanje bez uputstva: **djelimično**. Spisak poruka (D-07) ima uputstvo, ali nema sistemski izgled.
- Sve iste težine: **ne**. Kartica je u 3 nivoa: butik → naziv i cijena → veličine.
- Oznaka jača od vrijednosti: **ne**. Statistika: broj 24, oznaka 14.
- Siva/crna sjena na boji: **ne**, sjene su tonirane `rgba(8,6,10,…)`.

## Redoslijed za frontend

1. D-01, D-03 (CSS, 10 min), D-02 (`shopSubHTML` + CSS, 30 min), D-04 i D-05 (po jedan red).
2. Ponovo snimiti `design/poslije/` na 3 veličine uz nove slike iz D-06. Dizajner ih pregleda.
3. Ako stane: D-07–D-11. D-12 radi dizajner u `docs/DIZAJN.md`.
4. Tek onda tražiti Stefanovo odobrenje i recenziju za spajanje.

## Stanje popravki (frontend, 25.11.2026.)

Nalazi gore ostaju netaknuti. Popravke su na grani `redizajn`; slike su ponovo snimljene skriptom
`design/snimi-slike.py` (64 ekrana × 360/390/430 = 192 slike u `design/poslije/`, stare su obrisane). Pregledane su
slike na 360 i 390; nijedan nalaz D-01…D-06 se na njima ne vidi.

| Nalog | Stanje | Šta je urađeno |
|---|---|---|
| D-01 | popravljeno | `web/style.css` `.meta{grid-template-columns:minmax(0,1fr)}`. Slika: `gost-feed-dugo` (ime se skraćuje, „Prati” u koloni, sniženje u novom redu, XXL u drugom redu veličina) |
| D-02 | popravljeno | `feed.js` `shopSubHTML`: adresa u `.adr` (trotačka), status u `.st` (uvijek cijel); `.shop-sub` je flex |
| D-03 | popravljeno | `.btns`/`.btns-2` s `minmax(0,…)`, `.btn{min-width:0;padding:0 16px}` u parovima. Skripta provjerava da je `#doneAgain` unutar ekrana |
| D-04 | popravljeno | `loadFeed(true)` zove `hideUputa()`. Slika: `gost-praceni-gost` (prvi ulaz, bez `komodo.uputa`); skripta provjerava da je uputa skrivena |
| D-05 | popravljeno | `omotac.js`: `[moreSheet, closeMore]` u nizu prozora |
| D-06 | popravljeno | nova skripta `design/snimi-slike.py` (`--seed` pravi probne podatke, bez argumenta snima; `locale bs-BA`, `--lang=bs-BA`, `LANGUAGE=bs:hr` jer samo prva dva ne daju 24-satno vrijeme u „Uredi profil” na ovom Chromeu). Sat klijenta je zadan (radni dan 12:00, odnosno 07:30 za zatvoren butik) da slike ne zavise od doba dana. Dodane: `gost-feed-dugo`, `gost-feed-svijetli`, `gost-feed-sareno`, `gost-profil-butika-dugo`, `kupac-razgovor-prvi` (prazan, s porukom o radnom vremenu), `kupac-razgovor-dugo`, `kupac-poruke-spisak-dugo`, `kupac-poruke-prazno`, `gost-feed-filter-velicina`, `gost-praceni-gost` bez upute |
| D-07 | popravljeno | `poruke.js`: `.empty-box` (ikona `chat`, „Još nema poruka”, tekst kupca / butika), `#inboxEmpty` u `index.html` |
| D-08 | popravljeno | „Traži” i „Uredi profil”: programski fokus na polje samo uz miš (`hover:hover` i `pointer:fine`), na dodir fokus ide na ×. „Ovaj butik ne postoji”: fokus na naslov (`tabindex=-1`, bez prstena) |
| D-09 | popravljeno | `.inbox .who>span` i `.chat-who strong`: jedan red s trotačkom. Slike `kupac-razgovor-dugo`, `kupac-poruke-spisak-dugo` |
| D-10 | popravljeno | `poruke.js` `dayLabel`/`msgHTML`: `<p class="day" role="separator">` Danas / Juče / datum; bez novih zahtjeva |
| D-11 | popravljeno | `.vtab{position:sticky;left:16px;z-index:1}`. Slika `gost-feed-filter-velicina` (red pomjeren do kraja, „Veličine: M ✕” ostaje) |
| D-12 | popravljeno | `docs/DIZAJN.md` 6.2 (tabela) i 6.4 (kod) usklađeni s ugradnjom; napomena na početku odjeljka 3 da su nacrti stariji od odluke o „Kontaktiraj” i „Sjaju”; 1.8 bez „aktivni tab menija” |
| D-13 | otvoreno (faza 4) | Sličica proizvoda u razgovoru je ikona `video` dok nema pravog Bunnyja; provjeriti da `thumbnail.jpg` stiže |
| D-14 | popravljeno | uklonjen prelaz `background-color` na `.btn` i `.tab>span` (pokret samo `transform`/`opacity`); placeholderi s „…” (`index.html`: poruka, od, do, naziv, cijena). Broj uz „Moji oglasi” nije potreban |

Testovi: `cd api && npm test` 229/229; e2e (`tests/`, `--workers=1`) 33/33 dva puta; `node --check web/js/*.js`.
