# Komodo — dizajn revizija (prije redizajna)

Stanje: grana `redizajn`, 24.11.2026. Prolaz u pregledniku (Playwright, Chrome, `is_mobile`, DPR 2) kao gost, kupac,
butik i administrator na 360×780, 390×844 i 430×932. Podaci: 4 butika (Moda Bojana, Butik Lana, Kaldrma Shoes,
Torbica BL) s adresom i radnim vremenom, 22 oglasa (3 sniženja, 1 prodat), 6 kupaca, sviđanja, praćenja, 4 razgovora,
1 prijava. Snimci su kratki klipovi s obrisom proizvoda na gradijentu.

Slike: `design/prije/<širina>-<uloga>-<ekran>.png` (44 po veličini, ukupno 132). Npr. `390-gost-feed-zatebe.png`,
`390-gost-oglas-snizen.png`, `390-gost-profil-butika.png`, `390-butik-objava-popunjena.png`, `430-butik-objava-popunjena.png`.

Vanjske smjernice pročitane na početku: `ceorkm/mobile-app-ui-design` (SKILL.md i industry-conventions.md) i Vercel
`web-interface-guidelines/command.md`. Pravilo „Title Case” iz Vercel liste ne važi za Komodo (komodo-dizajn, odj. 2).

Ozbiljnost: **visoka** = šteti povjerenju, konverziji ili pristupačnosti na glavnom toku; **srednja** = primjetno,
ali tok radi; **niska** = dorada.

---

## 0. Izmjereno iz CSS-a

### Kontrast (WCAG, izračunato iz vrijednosti u `web/style.css`)

| Par | Odnos | Ocjena |
|---|---|---|
| `--text #f7f1ea` na `--ink #16121a` | 16,49 | dobro |
| `--muted #b9adbd` na `--ink` / `--surface #241d2a` | 8,61 / 7,61 | dobro |
| `--ink` na `--accent #ff6a4d` (tekst dugmadi) | 6,53 | dobro |
| `--ink` na `--tag #ffd95a` (cijena) | 13,50 | odlično |
| `--tag` kao tekst linka na `--ink` | 13,50 | dobro (ali žuta ima dvije uloge, vidi B-3) |
| `--accent` kao tekst („Obriši oglas”, greška obrade) na `--ink` | 6,53 | dobro |
| `--danger #ff7a7a` na `--ink` | 7,32 | dobro |
| zelena „Otvoreno” `#6fd98c` na `--ink` | 10,55 | dobro |
| **`--line #3b3142` na `--ink`** (okvir polja, dugmadi `.btn`) | **1,50** | **ispod 3:1 za ne-tekstualne elemente** (WCAG 1.4.11) |
| **`--line` na `--surface`** | **1,33** | ispod 3:1 |
| **`--surface` na `--ink`** (kartice, prozori naspram pozadine) | **1,13** | površine se skoro ne razlikuju |
| bijeli tekst na `--accent` (ne koristi se, ali opasno za buduća dugmad) | 2,52 | zabraniti u sistemu |
| **neaktivna kartica feeda (`--muted`) na svijetlom videu** (izmjereno na pikselu slike `390-gost-feed-zatebe.png`, pozadina `#616a78`) | **2,54** | ispod 4,5:1 — `.ftab` ima samo `text-shadow` |

### Tipografija

13 veličina slova (11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28 px + `clamp()` za `.ph-word`) i 4 debljine
(400, 500, 600, 700) u tri CSS fajla. Smjernica: najviše 4 veličine i 2 debljine. Dva fonta (Bricolage + Figtree) su
u redu.

### Razmaci

Vrijednosti `padding/gap/margin`: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28 px. Van mreže
4/8: 3, 5, 7, 9, 11, 13 (npr. `.chip` 8/13, `.price` 9/13/10, `.msg` 10/13, `.panel` 22/16/24). Grupisanje po
blizini ne postoji: unutar grupe i između grupa je gotovo isti razmak (10–14 px), pa se ekrani čitaju kao jedna lista.

### Boje (60/30/10)

Osnova tamna (60) je dobra za video. Ali naglasak (10) ima **tri** jarke boje koje se bore: žuta etiketa cijene,
koral dugme/„SNIŽENO”/značka/okvir nepročitane poruke, i bijeli „Prati”/aktivni tablet. Na kartici oglasa u jednom
pogledu su 4 jarka elementa (cijena, „Sniženo”, „Kontaktiraj butik”, „Prati”) — ništa nije jasno prvo.

---

## 1. Nalazi po ekranu

### Feed (Za tebe / Novo / Praćeni) — `390-gost-feed-zatebe.png`, `390-gost-oglas-snizen.png`, `360-gost-feed-zatebe.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| F-1 | **Hijerarhija kartice:** ispod videa 6 redova (butik+Prati, naziv, cijena+sniženo+kategorija, veličine, dugme) + desno 4 dugmeta s natpisima („Podijeli”, „Bez zvuka”, „Prijavi”). Sve ima sličnu težinu; cijena je jaka, ali „Sniženo” i „Kontaktiraj butik” istom koral bojom vuku pogled. Smjernica „ne daj svakom elementu istu težinu”. | visoka |
| F-2 | Kolona radnji zauzima ~60 px desne strane i 290 px visine; s natpisima ispod je najglasniji element nakon cijene. „Prijavi” (rijetka radnja) ima isto mjesto kao srce. Zvuk je u koloni iako je stanje cijele aplikacije. | srednja |
| F-3 | **Kontrast gornje trake na svijetlom videu:** neaktivne kartice „Novo/Praćeni” 2,54:1 (izmjereno). Gradijent `.topbar` ide od 90 % do 0 na samo ~120 px. | visoka (pristupačnost) |
| F-4 | Veličine („Vel. S · M · L”) su sitan tekst 14 px bez okvira, ispod kategorije; kupac ih ne pročita „za sekundu”. Kategorija (`--muted`) je manje važna od veličina, a stoji iznad njih. | srednja |
| F-5 | Tableti kategorija su ~30 px visoki (`.chip` 8 px padding) — ispod 44 px. | srednja |
| F-6 | Prvi ulazak: uputa „Prevuci gore…” je tamna kutija preko sredine videa (`390-gost-feed-zatebe-uputa.png`) — prekriva proizvod 4 s. | niska |
| F-7 | Oglas bez videa/u učitavanju: crna pozadina dok video ne krene (u lokalnom načinu nema `poster`). | niska |
| F-8 | Zona palca: „Kontaktiraj butik” je dolje lijevo (dobro za lijevu ruku, srednje za desnu); srce je desno na ~60 % visine — u redu. | — |

### Pretraga i filter — `390-gost-filter.png`, `390-gost-filter-rezultat.png`, `390-gost-kategorija-obuca.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| P-1 | Panel pretrage se otvara **preko videa** (bez pozadine) i ostaje otvoren poslije „Traži” — rezultat (naziv, cijena) je ispod gomile dugmadi. | visoka |
| P-2 | **Filter veličine odjeće ostaje aktivan u kategoriji „Obuća”**: s „M” izabranim, „Obuća” i „Ostalo” daju „Nema oglasa u tvojoj veličini” iako ima 5 pari cipela. Veličine se pamte u `localStorage` pa korisnik to vidi i sutra. | visoka |
| P-3 | Veličine odjeće i obuće (14 dugmadi) su uvijek obje vidljive, bez naslova „Odjeća / Obuća”; brojevi 42–46 sakriveni horizontalnim skrolom bez naznake. | srednja |
| P-4 | „Poništi” pored „Traži” ima istu težinu kao pomoćna radnja; „Poništi veličine” je podvučeni link ~20 px. | niska |

### Oglas (link `/?o=`), kontakt — `390-gost-oglas-snizen.png`, `390-gost-kontakt.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| O-1 | Sniženje: precrtana stara cijena je `--muted` 16 px lijevo od etikete i čita se prva; „SNIŽENO” je treća jarka mrlja. Iznos uštede („−40 KM”) se ne vidi. | srednja |
| O-2 | Povjerenje na kartici: nema nijedne oznake butika osim imena i inicijala (adresa, „Provjeren”, „otvoreno” su tek na profilu). | srednja |
| O-3 | Prozor „Kontakt” je dobar sadržajno (adresa, status, Pozovi, Viber, linkovi), ali je 7 jednako teških redova; „Zatvori” je na dnu kao puno dugme iako je prozor zatvoriv dodirom van. | niska |

### Profil butika (javni) — `390-gost-profil-butika.png`, `…-dno.png`, `360-gost-profil-butika.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| B-1 | **Proizvodi su ispod pregiba**: prije mreže su zaglavlje, brojke, adresa, status, 3 dugmeta i 4 reda kontakta. Na 390×844 prva pločica se vidi tek kao rub; na 360 nikako. Kupac je došao zbog robe. | visoka |
| B-2 | Pločice mreže imaju samo cijenu — bez naziva i bez oznake sniženja/prodato. | srednja |
| B-3 | Žuta ima dvije uloge: cijena (etiketa) i linkovi/„Otvori na mapi”/„Provjeren butik”. Oznaka povjerenja izgleda kao link. | srednja |
| B-4 | „Prati” je puna koral traka preko cijele širine — jača od „Pošalji poruku”, iako je poruka cilj proizvoda. | srednja |
| B-5 | Avatar je samo inicijal na koral krugu; nema slike radnje ni naslovne fotografije. | niska (zavisi od proizvoda) |
| B-6 | Nepostojeći butik (`390-gost-butik-ne-postoji.png`): tekst i dugme dobri, ekran inače prazan. | niska |

### Registracija / prijava — `390-gost-prijava.png`, `390-gost-registracija-greske.png`, `390-gost-srce-trazi-nalog.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| R-1 | Greške su ispravno ispod polja, ali boja okvira greške `--danger` i fokus-prsten `--tag` se poklapaju na prvom polju (žuto+crveno). | niska |
| R-2 | Pet podvučenih žutih linkova jedan ispod drugog (~20 px visine, ispod 44 px). | srednja |
| R-3 | Kad srce traži nalog („Napravi besplatan nalog da sačuvaš ovaj oglas.”), forma ne prikazuje oglas koji se čuva — gubi se razlog. | srednja |

### Poruke — `390-kupac-poruke.png`, `390-kupac-razgovor.png`, `390-kupac-prva-poruka.png`, `390-butik-poruke.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| M-1 | **Prva poruka (Peak-End):** prazan ekran sa „Napiši prvu poruku.” na sredini; oglas je samo sitan red u zaglavlju. Nema kartice proizvoda (slika, cijena, veličine), ni očekivanja („butik obično odgovara za…”, „otvoreno do 20:00”). Poslije slanja nema potvrde osim mjehurića. | visoka |
| M-2 | Polje za poruku dobija fokus pri otvaranju (`poruke.js:83`) — na telefonu odmah iskače tastatura i pokriva brza pitanja i historiju. | srednja |
| M-3 | Nepročitano se razlikuje samo koral okvirom; kod butika su sva tri razgovora nepročitana pa je cijela lista koral. Nema tačke/broja ni podebljanog imena. | srednja |
| M-4 | Brza pitanja su horizontalni skrol bez naznake da ih ima više. | niska |

### Vlastiti profil (butik i kupac) — `390-butik-profil.png`, `390-butik-profil-dno.png`, `390-kupac-profil.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| V-1 | **Dugme „×” za brisanje na svakoj pločici** (30×30, ispod 44) — lako se dodirne slučajno, a vizuelno prlja mrežu proizvoda. Brisanje već postoji u „Više”. | srednja |
| V-2 | Brojke (6 oglasa · 14 sviđanja · 5 pratilaca) su ispravne, ali bez veze s radnjom (dodir ne vodi nigdje). | niska |
| V-3 | „Nalog” na dnu: naslov 24 px, linkovi 14 px s velikim razmacima — djeluje nedovršeno. | niska |

### Uredi profil — `390-butik-uredi-profil.png`, `…-dno.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| U-1 | Okviri polja 1,50:1 — polja se slabo vide (vidi 0). | srednja |
| U-2 | Vrijeme u `type="time"` prati jezik uređaja (u Chromeu na engleskom „09:00 AM”). Na bs uređajima je 24 h, ali u WebViewu s engleskim sistemom nije. | niska |
| U-3 | „Sačuvaj” nije pričvršćeno — na dnu duge forme. | niska |

### Objava oglasa — `390-butik-objava-*.png`, `430-butik-objava-popunjena.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| J-1 | **Peak-End objave:** poslije „Objavi” prozor se zatvori, a jedina potvrda je toast „Oglas je objavljen.” na vrhu; nema trenutka „tvoj oglas je u izlogu”, pregleda kako ga kupci vide, ni sljedećeg koraka (podijeli, objavi još jedan). Ovo je vrhunac toka butika. | visoka |
| J-2 | Pregled videa je 120 px širok; butik ne vidi kako će oglas izgledati u feedu (naslov + etiketa preko videa). | srednja |
| J-3 | Kad je video izabran i forma popunjena, „Objavi” je ispod pregiba prozora (na 430×932 se vidi samo pola dugmeta, na 390 treba skrolati). Glavna radnja nije pričvršćena. | srednja |
| J-4 | Greška „Dodaj video proizvoda.” je žuta (`.err` koristi `--tag`) — ista boja kao cijena i linkovi; greške polja na registraciji su crvene. Dva sistema za grešku. | srednja |
| J-5 | Birač videa je isprekidani okvir s tekstom — bez ikone kamere i bez naznake trajanja/formata. | niska |

### Statistika — `390-butik-statistika.png`, `…-oglasi.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| S-1 | Grafikon nema vrijednosti ni oznaka osim prvog i zadnjeg dana; stubovi iste koral boje kao dugmad. | niska |
| S-2 | Pločice brojki imaju 28 px broj i 13 px oznaku — dobro; poređenje sa prošlim periodom nedostaje. | niska |

### Administracija — `390-admin.png`, `390-admin-sredina.png`

| # | Nalaz | Ozbiljnost |
|---|---|---|
| A-1 | Funkcionalno u redu. Tabela ima 5 kolona na 360 px — tijesno, ali čitljivo. Dugmad „Ukloni sadržaj / Ugasi nalog” su jasna. Redizajn ovdje nije prioritet. | niska |

---

## 2. Zona palca, prazna stanja, povjerenje, Peak-End (sažetak)

- **Zona palca:** donji meni i „Objavi” su dobri; glavne radnje prozora („Objavi”, „Sačuvaj”) nisu pričvršćene uz dno (J-3, U-3).
- **Prazna stanja:** tekstovi postoje i imaju dugme (dobro). Slaba mjesta: P-2 (lažno prazno zbog filtera), prva poruka (M-1).
- **Povjerenje:** podaci postoje (adresa, radno vrijeme, „Provjeren butik”, „na Komodu od”), ali su na profilu, ispod
  ili iznad pogrešnih stvari; na kartici oglasa ih nema (O-2), a oznaka „Provjeren” izgleda kao link (B-3).
- **Peak-End:** dva vrhunca proizvoda — objava (butik) i prva poruka (kupac) — oba završavaju bez ikakvog naglaska (J-1, M-1).

---

## 3. Vercel kontrolna lista (`fajl:red – problem`)

### web/index.html

web/index.html:5 – `viewport` bez `viewport-fit=cover`: u iOS Safariju `env(safe-area-inset-*)` vraća 0, pa `.toast` (style.css:118) ne poštuje izrez
web/index.html:35 – placeholder „Naziv ili butik” bez primjera i trotačke („npr. haljina, Moda Bojana…”)
web/index.html:241 – placeholder „Napiši poruku” bez trotačke
web/index.html:58 – kategorije su `role="group"` dugmadi, a filter/kartica feeda se ne vide u URL-u (ne može se podijeliti „Obuća, vel. 38”)
web/index.html:290 – `<input type=file>` je vizuelno skriven, fokus se vidi samo preko `#fVideo:focus-visible + .pick` (dobro); nema `capture` za direktno snimanje

### web/style.css

web/style.css:19 – nigdje `touch-action:manipulation` na dugmadi i linkovima (kašnjenje dvostrukog dodira u mobilnom pregledniku)
web/style.css:20 – nije postavljen `-webkit-tap-highlight-color` (siva mrlja na Androidu preko tamnih dugmadi)
web/style.css:26 – `.topbar` bez `padding-top: env(safe-area-inset-top)` (u pregledniku s izrezom znak i kartice idu pod statusnu traku)
web/style.css:35 – `.chip` visina ~30 px, ispod 44×44
web/style.css:94 – `.tabs` bez `padding-bottom: env(safe-area-inset-bottom)` (meni pod trakom za gestove na iPhoneu u pregledniku)
web/style.css:103 – `.panel` bez `overscroll-behavior:contain` (skrol prozora prelazi na feed ispod)
web/style.css:107 – okvir polja `--line` 1,50:1 naspram pozadine (ispod 3:1)
web/style.css:113 – `.err` koristi `--tag` (žuta) za greške, a `.field-err` (style.css:214) `--danger` — dvije boje za grešku
web/style.css:115 – `.btn` nema `:hover`/`:active` stanja (cijeli style.css: 0 pravila `:hover`/`:active`); dodir nema povratnu informaciju
web/style.css:131 – `.link` kao dugme (~20 px visine) u prijavi, razgovoru, profilu — ispod 44 px
web/style.css:138 – `.tile-del` 30×30, ispod 44×44
web/style.css:148 – `.link-x` 40×40, ispod 44×44
web/style.css:163 – nepročitan razgovor označen samo bojom okvira
web/style.css:182 – `.icon-btn` (lupa) 40×40, ispod 44×44
web/style.css:231 – `.ftab` `--muted` na videu: 2,54:1 na svijetlom snimku (izmjereno)

### web/butik.css

web/butik.css:7 (`.v-badge`) – oznaka povjerenja ima isti izgled (žuti okvir) kao link „Otvori na mapi” (butik.css:16)
web/butik.css:29 – jedino `:hover` pravilo u projektu (`.v-follow.is-on:hover`)

### web/statistika.css

✓ pass (osim zajedničkih nalaza o `--line` i `:active`)

### web/js/osnova.js

web/js/osnova.js:69 – `toLocaleString('de-DE')` umjesto `Intl.NumberFormat('bs-BA')` (isti izlaz danas, ali tvrdo kodiran jezik)
web/js/osnova.js:71 – „ KM” s običnim razmakom: cijena se može prelomiti „89 / KM”; treba ` `
web/js/osnova.js:74 – `<img class="tile-img">` bez `width`/`height` (kontejner ima `aspect-ratio`, pa je pomak mali)

### web/js/feed.js

web/js/feed.js:113 – `<video>` bez `aria-label` i bez `poster` u lokalnom načinu (crn ekran do učitavanja)
web/js/feed.js:61 – `activeSizes()` šalje veličine odjeće i u kategoriju „Obuća” (i obratno) → lažno prazan feed (P-2)
web/js/feed.js:129 – zvuk kao radnja po kartici (`data-act="sound"`), a stanje je globalno

### web/js/poruke.js

web/js/poruke.js:83 – `chatInput.focus()` pri svakom otvaranju razgovora (tastatura iskače na telefonu; smjernica: autofokus samo na desktopu)

### web/js/objava.js

web/js/objava.js:38 – `eTitle.focus()` pri otvaranju izmjene (tastatura pokriva prozor)
web/js/objava.js:173 – kraj objave je samo toast (J-1)

### web/js/butik.js, prijava.js, profil.js, prikazi.js, start.js, admin.js, statistika.js, omotac.js

✓ pass (napomena: butik.js:131 koristi `Intl.DateTimeFormat('en-US')` namjerno, samo za čitanje dijelova datuma — u redu)

---

## 4. Pet najvažnijih problema

1. **Kartica oglasa nema hijerarhiju** (F-1, F-2, O-1): 6 redova teksta + 4 dugmeta s natpisima + 4 jarke mrlje
   (cijena, „Sniženo”, „Kontaktiraj”, „Prati”). Cijena i veličine se ne čitaju „za sekundu”, a kolona radnji je
   glasnija od proizvoda.
2. **Nema vizuelnog sistema:** 13 veličina slova i 4 debljine, razmaci van mreže, okviri polja 1,50:1 i površine 1,13:1
   naspram pozadine, žuta u tri uloge (cijena, link, greška), dvije boje za grešku, nula `:active` stanja.
3. **Vrhunci toka su prazni (Peak-End):** objava oglasa završava toastom (J-1), prva poruka kupca praznim ekranom
   bez proizvoda i očekivanja (M-1). To su dva trenutka koja odlučuju da li će butik objaviti drugi oglas i kupac
   pisati drugi put.
4. **Filter i pretraga zbunjuju** (P-1, P-2): panel stoji preko videa poslije pretrage, a zapamćena veličina „M”
   daje prazan feed u „Obući” — kupac misli da nema robe.
5. **Profil butika krije robu i povjerenje** (B-1…B-4, V-1): proizvodi ispod pregiba, pločice bez naziva, oznaka
   „Provjeren butik” izgleda kao link, a na vlastitom profilu „×” za brisanje na svakoj pločici. Uz to sigurne zone
   (index.html:5, style.css:26, :94) nisu riješene za mobilni preglednik.
