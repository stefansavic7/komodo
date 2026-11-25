# Komodo — dizajn sistem i ekrani (pravac A „Noćni izlog”)

Stanje: grana `redizajn`, 24.11.2026. Stefan je izabrao pravac A (`design/pravci/a-nocni-izlog.html`) i odobrio:
„Pitaj butik” umjesto „Kontaktiraj butik” (poništeno 25.11.2026.: dugme na kartici je samo „Kontaktiraj”, naslov prozora kontakta „Kontaktiraj butik”); kraj objave „Oglas je u izlogu” s dugmadima „Podijeli oglas” i „Objavi
još jedan”; isti obrazac za prvu poruku (kartica proizvoda na vrhu razgovora i status radnog vremena); na kartici
feeda „Provjeren butik” i „otvoreno do”.

Nalazi koje ovo rješava su u `docs/DIZAJN-REVIZIJA.md` (oznake F-1, P-2, M-1, J-1…). Referentna implementacija
tokena i svih komponenti je `design/ekrani/sistem.css` — iste klase kao u `web/` gdje god je moglo, pa frontend
prenosi pravila, a ne izmišlja ih. Nacrti ekrana: `design/ekrani/*.html`, slike `design/ekrani/png/*.png` (390×844).

Vanjske smjernice pročitane na početku (komodo-dizajn, odj. 1): `ceorkm/mobile-app-ui-design` SKILL.md i Vercel
`web-interface-guidelines/command.md`. Smjernica za mobilni UI ne propisuje trajanja animacija — ona u 1.8 su naša.

---

## 0. Ključne odluke (sažetak)

1. **Svaka jarka boja ima jednu ulogu.** Koral = jedna glavna radnja na ekranu (i značka nepročitanih). Žuta = samo
   cijena (i logo). Zelena = povjerenje i „otvoreno”. Losos (`--c-sale`) = sniženje. Crvena = greška. „Prati”,
   „Sniženo”, linkovi i fokus više nisu ni koral ni žuti.
2. **4 veličine slova (12/14/16/24), 2 debljine (400/700)**, Bricolage samo 700 i samo za naslove, cijenu, avatare i
   brojke. Figtree 500 i 600 se više ne preuzimaju (manje fontova).
3. **Mreža 8 px** (4 samo na 5 mjesta, 1.3), dodirna površina uvijek ≥ 44×44 (vizuelno može biti 32/36, površina se
   proširuje `::after`).
4. **Kartica u 3 nivoa**: butik (+ provjera + „otvoreno do”) → naziv i cijena (+ ušteda) → veličine kao okviri; jedna
   glavna radnja „Kontaktiraj” preko cijele širine u zoni palca; kolona radnji samo srce, podijeli, više.
5. **Zvuk je prekidač cijelog feeda** u gornjoj traci (ispod lupe), ne dugme na svakoj kartici. Odstupanje od nacrta A
   (tamo je bio tablet preko videa): ovako ništa ne leži preko proizvoda i prekidač je poravnat s lupom.
6. **Prozori (bottom sheet)** imaju naslov + „×” gore i glavnu radnju pričvršćenu dolje (zona palca); „Zatvori” kao
   puno dugme nestaje.
7. **Greške su samo crvene i uz polje**; forma nikad ne šalje grešku u toast (U-03 ostaje).
8. **Vrhunci toka**: „Oglas je u izlogu” (butik) i kartica proizvoda + radno vrijeme u prvoj poruci (kupac).

---

## 1. Dizajn sistem

### 1.1 Boje po ulogama (60/30/10)

| Udio | Uloga | Token | Vrijednost | Gdje |
|---|---|---|---|---|
| 60 | pozadina ekrana | `--c-bg` | `#16121a` | svi ekrani, donji meni |
| 60 | van aplikacije | `--c-page` | `#0d0a10` | `body` na širem ekranu |
| 60 | površina 1 | `--c-surface` | `#241d2a` | prozori, kartica povjerenja, stavke liste, mjehurić sagovornika |
| 60 | površina 2 | `--c-surface-2` | `#2f2636` | skeleton, krug praznog stanja, kartica u prozoru, tableti na površini |
| 60 | polje forme | `--c-field` | `#120e15` | `input`, `select`, prekidači veličina |
| 60 | podloga preko videa | `--c-veil` | `rgba(22,18,26,.8)` | dugmad i tableti preko snimka |
| 60 | zatamnjenje iza prozora | `--c-backdrop` | `rgba(8,6,10,.72)` | `.sheet` |
| 30 | tekst | `--c-text` | `#f7f1ea` | naslovi, tijelo, aktivno |
| 30 | tekst 2 | `--c-text-2` | `#cfc4d2` | opisi, adresa na kartici, neaktivne kartice feeda |
| 30 | tekst 3 | `--c-text-3` | `#b9adbd` | vrijeme, oznake, placeholder, neaktivan meni |
| 30 | razdjelnik | `--c-line` | `#3b3142` | **samo** linije između redova (dekor) |
| 30 | okvir kontrole | `--c-border` | `#857890` | polja, sekundarna dugmad, segment |
| 10 | glavna radnja | `--c-accent` | `#ff6a4d` | `.btn-main`, `.cta`, „Objavi”, značka, tačka nepročitanog |
| 10 | pritisnuta glavna | `--c-accent-press` | `#f0583b` | `:active` |
| 10 | moja poruka | `--c-accent-tint` | `#452424` | mjehurić `.msg.mine` |
| 10 | tekst na koralu | `--c-on-accent` | `#16121a` | uvijek tamno, **bijelo na koralu je zabranjeno (2,52:1)** |
| 10 | cijena | `--c-price` / `--c-on-price` | `#ffd95a` / `#16121a` | samo etiketa cijene i logo |
| 10 | povjerenje | `--c-ok` | `#6fd98c` | „Provjeren butik”, „otvoreno do”, uspjeh, prekidač uključen |
| 10 | sniženje | `--c-sale` | `#ff8f78` | „Sniženo”, „−40 KM” |
| 10 | greška | `--c-danger` | `#ff7a7a` | greške polja, brisanje |
| 10 | podloga greške | `--c-danger-tint` | `#3e2834` | `.err` (greška cijele forme) |
| 10 | ikona greške na toastu | `--c-toast-err` | `#b42318` | samo na svijetlom toastu |
| — | fokus | `--c-focus` | `#f7f1ea` | prsten `:focus-visible` (+ tamni oreol `--c-bg`) |

#### Izmjereni kontrasti (WCAG 2.1, izračunato iz vrijednosti; skripta u izvještaju dizajnera)

Tekst (traži ≥ 4,5:1; veliki tekst 24 px ≥ 3:1):

| Par | Odnos |
|---|---|
| `--c-text` na `--c-bg` / `--c-surface` / `--c-surface-2` | 16,49 / 14,58 / 12,90 |
| `--c-text-2` na bg / surface / surface-2 | 10,99 / 9,72 / 8,60 |
| `--c-text-3` na bg / surface / surface-2 / field | 8,61 / 7,61 / 6,74 / 8,89 |
| `--c-on-accent` na `--c-accent` / `--c-accent-press` | 6,53 / 5,43 |
| `--c-on-price` na `--c-price` | 13,50 |
| `--c-bg` na `--c-text` (inverzni tablet, toast, „Prodato”) | 16,49 |
| `--c-ok` na bg / surface / surface-2 | 10,55 / 9,33 / 8,25 |
| `--c-sale` na bg / surface | 8,32 / 7,36 |
| `--c-danger` na bg / surface / field | 7,32 / 6,48 / 7,57 |
| `--c-text` na `--c-danger-tint` | 12,02 |
| `--c-text` / `--c-text-3` na `--c-accent-tint` (moja poruka, vrijeme) | 12,23 / 6,39 |
| `--c-toast-err` (ikona) i `#1f7a3d` (ikona uspjeha) na toastu `#f7f1ea` | 5,86 / 4,79 |

Ne-tekstualni elementi (traži ≥ 3:1):

| Par | Odnos |
|---|---|
| `--c-border` na bg / surface / surface-2 / field | 4,48 / 3,96 / 3,50 / 4,63 |
| fokus `--c-focus` na bg / surface | 16,49 / 14,58 |
| koral značka/tačka na bg / surface | 6,53 / 5,78 |
| prekidač uključen (`--c-ok`) na field | 10,90 |
| `--c-line` na bg | 1,50 — **zato je samo dekor, nikad okvir kontrole** |

**Preko videa** (najgori slučaj: bijeli piksel snimka ispod providne podloge):

| Mjesto | Podloga | Odnos |
|---|---|---|
| gornja traka, gdje je tekst | gradijent ≥ 0,85 (`#39363c` na bijelom) | aktivna kartica `--c-text` 10,60; neaktivna `--c-text-2` 7,06 (bilo 2,54) |
| tablet kategorije / dugme / lupa | `--c-veil` 0,8 (`#454148`) | tekst 8,91; okvir tableta `rgba(247,241,234,.56)` ≥ 3,5 |
| blok podataka na kartici | scrim ≥ 0,85 od dna do vrha `.meta` | `--c-text` 10,60, `--c-text-2` 7,06, `--c-ok` 6,78, `--c-sale` 5,35, okvir veličine 4,53 |

Pravilo: tekst se nikad ne stavlja na video ispod 0,8 pokrivenosti; `text-shadow` je ukras, ne zamjena za scrim.

Površine `--c-surface` naspram `--c-bg` (1,13:1) se namjerno ne podižu na 3:1 — prozor se odvaja zatamnjenjem,
ručicom i sjenom, a kartica nije kontrola; kontrole unutra imaju svoj okvir ≥ 3:1.

### 1.2 Tipografija

| Token | Veličina / prored | Font i debljina | Upotreba |
|---|---|---|---|
| `--fs-1` / `--lh-1` | 12 / 16 | Figtree 400, 700 | meni, brojači, vrijeme, natpisi pločica, oznake |
| `--fs-2` / `--lh-2` | 14 / 20 | Figtree 400, 700 | sporedni tekst, tableti, mala dugmad, greške, natpisi polja |
| `--fs-3` / `--lh-3` | 16 / 24 | Figtree 400, 700 | tijelo, polja (16 sprečava zumiranje u iOS), dugmad, poruke |
| `--fs-4` / `--lh-4` | 24 / 28 | Bricolage 700, `letter-spacing:-.01em`, `text-wrap:balance` | naslovi ekrana i prozora, naziv oglasa, cijena, brojke statistike |

- Debljine: `--fw-r: 400`, `--fw-b: 700`. Hijerarhija: veličina, zatim debljina, zatim boja (`--c-text` → `-2` → `-3`).
- Bricolage se koristi i za cijenu na pločici i inicijale avatara u 12/14/24 — to su iste 4 veličine, ne nove.
- Brojevi: `font-variant-numeric: tabular-nums` na cijenama, brojačima, statistici i tabelama.
- Izbacuje se: 11, 13, 15, 17, 18, 20, 22, 26, 28 px i `clamp()` (`.ph-word`), debljine 500 i 600.
- Fontovi: `web/fonts/fonts.css` zadržava samo Figtree 400/700 i Bricolage 700 (`font-display: swap`); datoteke
  500/600 mogu ostati na disku, ali se ne referenciraju.

### 1.3 Razmaci

Tokeni: `--s-1: 4px`, `--s-2: 8px`, `--s-3: 12px`, `--s-4: 16px`, `--s-5: 24px`, `--s-6: 32px`, `--s-7: 48px`.
Ivica ekrana je 16. Unutar grupe 8, između grupa 24 (npr. polje: natpis → polje 8; polje → sljedeće polje 16;
odjeljak → odjeljak 24). 12 je dozvoljen (višekratnik 4) za razmak cijena–ušteda, kolonu radnji i unutrašnjost reda.

4 px samo ovdje (obrazloženje: elementi koji se čitaju kao jedna cjelina):
1. ikona ↔ natpis u donjem meniju i koloni radnji;
2. unutrašnji odmak segmentiranog prekidača (`.seg`) i tableta;
3. naslov ↔ podnaslov u istom bloku (ime butika ↔ `@handle`, naziv ↔ cijena u kartici proizvoda);
4. pločica ↔ njen natpis u mreži;
5. odmak etikete cijene od ugla pločice.

Visine: dodir `--tap: 44px`, dugme `--btn-h: 48px`, malo dugme/tablet `--btn-h-sm: 36px` (površina 44 kroz `::after`
od −4 px), donji meni `--nav-h: 64px` + sigurna zona.

### 1.4 Radijusi

`--r-1: 4px` (etiketa na pločici, „Obrađuje se”), `--r-2: 8px` (okviri veličina na kartici, sličice), `--r-3: 12px`
(polja, pločice, prekidači veličina, stavke administracije), `--r-4: 16px` (kartica povjerenja, kartica proizvoda,
toast, pločice statistike), `--r-5: 24px` (gornji uglovi prozora), `--r-pill: 999px` (dugmad, tableti, značka).
Etiketa cijene zadržava oblik etikete `6px 16px 16px 6px` i nagib −2° (dio brenda).

### 1.5 Površine i sjene

Nivoi: `--c-bg` → `--c-surface` (prozor, kartica) → `--c-surface-2` (element u prozoru). Sjene tonirane ka pozadini,
nikad sivo/crno:
- `--sh-sheet: 0 -8px 32px rgba(8,6,10,.56)` — prozor;
- `--sh-pop: 0 8px 24px rgba(8,6,10,.56)` — toast;
- `--sh-text: 0 1px 8px rgba(8,6,10,.64)` — tekst preko videa (dopuna scrimu, ne zamjena);
- `--sh-btn: inset 0 1px 0 rgba(255,255,255,.24)` — svijetla ivica glavnog dugmeta.

Bez `backdrop-filter` (cijena na slabijim Android telefonima u WebViewu).

### 1.6 Ikone

Ručno pisani SVG, `viewBox="0 0 24 24"`, crtež 24 px (u gustim redovima 20, u tabletima 16), linija 1,8
(`stroke-linecap/linejoin: round`, `fill: none`), aktivno srce dobija `fill: currentColor`. Dodirna površina oko
ikone uvijek ≥ 44×44. Ikona uz tekst je `aria-hidden="true"`; dugme samo s ikonom ima `aria-label`.

Preporuka za kod: jedan SVG `<symbol>` sprite na vrhu `body` u `index.html`, a `ICON.*` u `osnova.js` postaje
`<svg class="i" aria-hidden="true"><use href="#i-heart"/></svg>` (kraći HTML po kartici). Putanje su u
`design/ekrani/*.html` (prvi `<svg>` u fajlu).

| Ime | Gdje | Ime | Gdje |
|---|---|---|---|
| `home` | meni Početna | `chat` | meni Poruke, „Kontaktiraj”, Viber |
| `user` | meni Profil | `plus` | „Objavi”, dodaj link |
| `search` | lupa | `sliders` | prazno stanje filtera |
| `heart` | sviđanje | `share` | podijeli oglas/profil |
| `more` | „Više” (⋯) | `check` | provjeren, uspjeh, toast |
| `sound-on` / `sound-off` | zvuk feeda | `back` | nazad |
| `chev-r` / `chev-d` | red liste / otvori | `x` | zatvori, ukloni |
| `pin` | adresa | `clock` | radno vrijeme, obrada |
| `phone` | pozovi | `link` | linkovi butika |
| `video` | birač videa | `flag` | prijavi |
| `edit` | izmijeni | `trash` | obriši |
| `chart` | statistika | `bell` | obavještenja, najava sniženja |
| `arrow-up` | uputa za prevlačenje | `wifi-off` | bez interneta, greška feeda |
| `refresh` | pokušaj ponovo, starije | `tag` | prodato, prazna kategorija |
| `alert` | greška | `lock` | lozinka |
| `logout` | odjava | `send` | pošalji poruku |
| `shop` | profil butika, nepostojeći butik | `ban` | blokiraj |
| `users` | pratioci, Praćeni | `mail` | potvrda emaila |
| `copy` | kopiraj link | `eye`, `info`, `globe` | rezerva (statistika, napomene, sajt) |

Brend ikone (Instagram, TikTok, Viber logo) se ne crtaju — `link`/`chat` + tekst.

### 1.7 Stanja

| Stanje | Pravilo | Primjer nacrta |
|---|---|---|
| Prazno | krug 72 (`--c-surface-2`) s ikonom 32, naslov 24, tekst 16 `--c-text-2`, jedno glavno dugme; tekstovi iz SPEC | `feed-praceni-gost.png`, `feed-prazna-kategorija.png`, `poruke-prazno.png` |
| Učitavanje | skeleton (`.sk`, `--c-surface-2`, sjaj 1,2 s) u obliku sadržaja; tekst „Učitavam…” ostaje u `role="status"` za čitač ekrana | `feed-ucitavanje.png`, `statistika-ucitavanje.png` |
| Greška polja | okvir 2 px `--c-danger`, `aria-invalid`, ispod polja ikona `alert` + tekst 14 `--c-danger`, fokus na prvo pogrešno polje | `registracija-greske.png`, `objava-greske.png` |
| Greška forme | `.err`: podloga `--c-danger-tint`, ikona `--c-danger`, tekst `--c-text` | `prijava.png`, `uredi-profil-greska.png` |
| Greška ekrana | prazno stanje s `wifi-off` + „Pokušaj ponovo” | `feed-greska.png` |
| Uspjeh | toast s ikonom `check`; za vrhunac toka cijeli prozor (`.done`) | `profil-butika-vlastiti.png`, `objava-u-izlogu.png` |
| `:active` | dugmad `transform: scale(.98)` + `--c-accent-press` / `rgba(247,241,234,.08)`; dugmad u koloni `scale(.92)`; `--t-fast` | — |
| `:focus-visible` | `outline: 2px solid var(--c-focus); outline-offset: 2px; box-shadow: 0 0 0 2px var(--c-bg)` — tamni oreol drži prsten vidljivim i na svijetlom videu; nikad `outline:none` bez zamjene | — |
| Onemogućeno | `opacity:.4; pointer-events:none` + `disabled`/`aria-disabled`; dugme „Pošalji” prazno → `--c-surface-2` | `razgovor-prvi.png` |
| Zauzeto | `aria-busy="true"`, spinner 20 + isti tekst, dugme ostaje iste širine | `objava-slanje.png` |
| Hover | samo `@media (hover:hover)`: isto kao `:active` bez skaliranja (telefon ga ne vidi) | — |

### 1.8 Pokret

| Token | Vrijednost | Za |
|---|---|---|
| `--t-fast` | 120 ms | pritisak, prekidači |
| `--t-base` | 200 ms | toast ulaz/izlaz, prekidač |
| `--t-slow` | 280 ms | prozor ulazi (`translateY(24px)` + `opacity`) |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | ulasci |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | izlasci (200 ms) |

Samo `transform` i `opacity`, nikad `transition: all`. `prefers-reduced-motion: reduce` → sva tri trajanja 1 ms,
skeleton bez sjaja, uputa bez skakanja strelice, spinner usporen na 2,4 s (ostaje znak rada). Video feeda se i dalje
pušta (to je sadržaj, ne ukras), ali bez automatskog skrolanja.

### 1.9 Sigurne zone

- `web/index.html:5` → `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  (bez `user-scalable=no`).
- `:root{ --sat: env(safe-area-inset-top, 0px); --sab: env(safe-area-inset-bottom, 0px) }`.
- Gornja traka feeda i ekrani: `padding-top: calc(var(--sat) + …)`; donji meni: `height: calc(var(--nav-h) + var(--sab));
  padding-bottom: var(--sab)`; prozor: `padding-bottom: calc(16px + var(--sab))`, `max-height: calc(100% - var(--sat) - 8px)`;
  toast: `top: calc(var(--sat) + 8px)`; podnožje razgovora: `padding-bottom: var(--sab)`.
- U mobilnom omotaču `SafeAreaView` (edges top/bottom, `mobile/App.js:361`) već odmiče WebView, pa `env()` tamo daje 0 —
  nema duplog razmaka. U Safari/Chrome na telefonu s izrezom razmak dolazi iz `env()`. Nacrti glume 47/34 px.

### 1.10 CSS custom properties (zamjena za `:root` u `web/style.css`)

```css
:root{
  --c-page:#0d0a10; --c-bg:#16121a; --c-surface:#241d2a; --c-surface-2:#2f2636; --c-field:#120e15;
  --c-veil:rgba(22,18,26,.8); --c-backdrop:rgba(8,6,10,.72);
  --c-text:#f7f1ea; --c-text-2:#cfc4d2; --c-text-3:#b9adbd; --c-line:#3b3142; --c-border:#857890;
  --c-accent:#ff6a4d; --c-accent-press:#f0583b; --c-accent-tint:#452424; --c-on-accent:#16121a;
  --c-price:#ffd95a; --c-on-price:#16121a; --c-ok:#6fd98c; --c-sale:#ff8f78;
  --c-danger:#ff7a7a; --c-danger-tint:#3e2834; --c-toast-err:#b42318; --c-focus:#f7f1ea;
  --f-display:"Bricolage Grotesque","Trebuchet MS",sans-serif;
  --f-body:"Figtree",system-ui,-apple-system,"Segoe UI",sans-serif;
  --fs-1:12px; --lh-1:16px; --fs-2:14px; --lh-2:20px; --fs-3:16px; --lh-3:24px; --fs-4:24px; --lh-4:28px;
  --fw-r:400; --fw-b:700;
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px;
  --r-1:4px; --r-2:8px; --r-3:12px; --r-4:16px; --r-5:24px; --r-pill:999px;
  --tap:44px; --btn-h:48px; --btn-h-sm:36px; --icon:24px; --nav-h:64px;
  --sh-sheet:0 -8px 32px rgba(8,6,10,.56); --sh-pop:0 8px 24px rgba(8,6,10,.56);
  --sh-text:0 1px 8px rgba(8,6,10,.64); --sh-btn:inset 0 1px 0 rgba(255,255,255,.24);
  --t-fast:120ms; --t-base:200ms; --t-slow:280ms;
  --ease-out:cubic-bezier(.2,.8,.2,1); --ease-in:cubic-bezier(.4,0,1,1);
  --sat:env(safe-area-inset-top,0px); --sab:env(safe-area-inset-bottom,0px);
  color-scheme:dark;
}
@media (prefers-reduced-motion:reduce){:root{--t-fast:1ms;--t-base:1ms;--t-slow:1ms}}
button,a,input,select,textarea,label,summary{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2px solid var(--c-focus);outline-offset:2px;box-shadow:0 0 0 2px var(--c-bg)}
select{background-color:var(--c-field);color:var(--c-text)}
```

Mapa staro → novo (u koraku 1 stara imena ostaju kao privremeni alias da ništa ne pukne; brišu se u koraku 12):

| Staro (`web/style.css`) | Novo | Napomena |
|---|---|---|
| `--ink` | `--c-bg` | i `--c-on-accent`/`--c-on-price` kad je tekst na koralu/žutoj |
| `--surface` | `--c-surface` | |
| `--line` | `--c-line` (razdjelnici) **ili** `--c-border` (okvir polja, `.btn`, `.size-btn`, `.seg`, `.link-x`, `.h-row`) | svaki okvir kontrole → `--c-border` (nalaz U-1) |
| `--text` | `--c-text` | |
| `--muted` | `--c-text-3` (vrijeme, oznake) ili `--c-text-2` (opisi, `.ftab`, `.empty-box p`) | |
| `--accent` | `--c-accent` | samo glavna radnja; `.drop`→`--c-sale`, `.follow-btn`/`.vtab`→inverzno/obrub, `.btn-danger`/`.act-del`→`--c-danger`, `.inbox .unread` okvir → tačka |
| `--tag` | `--c-price` | samo `.price`, `.tile-price`; linkovi → `--c-text` s podvlakom; `:focus-visible` → `--c-focus`; `.err`, `#statErr`, `.chat-bar-err`, `.state` → `--c-danger`/`--c-text`; `.v-badge` → `--c-ok`; `.inbox .ltitle` → `--c-text-3`; `.stat-item.is-focus` → `--c-text` |
| `--danger` | `--c-danger` | |
| `#6fd98c` (tvrdo, `butik.css`) | `--c-ok` | |
| `#0d0a10` (`body`) | `--c-page` | |
| `rgba(22,18,26,.6)` (`.chip`, `.act svg`, `.icon-btn`, `.follow-btn`) | `--c-veil` | sa .6 na .8 zbog kontrasta |
| `rgba(8,6,10,.66)` (`.sheet`) | `--c-backdrop` | |
| `#ffe3dd` (`.toast-err`) | toast ostaje `--c-text`, ikona `--c-toast-err` | |
| `--display` / `--body` | `--f-display` / `--f-body` | |

---

## 2. Komponente

Mjere su u px; klase su iste kao u `sistem.css`.

### 2.1 Kartica oglasa u feedu (`cardHTML`, `feed.js`) — `feed-za-tebe.png`, `feed-novo.png`, `feed-vlastiti-oglas.png`

Raspored (odozdo): `.card-cta` 16 od dna; iznad nje 16 razmaka; `.meta` (lijevo 16, desno 72) i `.actions` (desno 8)
počinju na `bottom: 16 + 48 + 16 = 80`. Vlasnik nema „Kontaktiraj butik”, pa `.meta`/`.actions` idu na `bottom:16`.
Scrim: 64 % visine, `rgba(22,18,26,.95)` dolje → `.85` na 62 % → 0.

Nivo 1 — butik (`.seller-row`, visina 44):
- `.seller-btn` (`data-act="shop"`): avatar 32 + ime 14/700; ime je **zadnji `span`** u dugmetu (e2e čita
  `.seller-btn span:last-child`), duga imena se skraćuju trotačkom.
- `.ok-badge` 16 (zeleni krug, kvačica 12) **van** `.seller-btn`, `role="img" aria-label="Provjeren butik"`. Dodir
  ne radi ništa na kartici (objašnjenje je na profilu).
- `.follow-btn` „Prati”/„Pratiš” (`data-act="follow"`, `aria-pressed`): vizuelno 32, površina 44; „Prati” = obrub
  `rgba(247,241,234,.56)`, 12/700; „Pratiš” = bez obruba, `--c-text-2`. Više nije koral.
- `.shop-sub` 14/400 `--c-text-2`, jedan red s trotačkom: `{adresa} · {status}`. Status iz `hoursStatus(shopHours)`
  (`butik.js:144`): otvoreno → `<span class="open">otvoreno do 20:00</span>` (`--c-ok`, 700); zatvoreno →
  „otvara u 09:00” / „otvara sutra u 09:00” / „otvara u ponedjeljak u 09:00” (tekst statusa bez „Zatvoreno · ”, malim
  slovom, `--c-text-2`). Bez adrese: samo status; bez radnog vremena: samo adresa; bez oboje: red se ne prikazuje.

Nivo 2 — proizvod:
- `.title` 24/28 Bricolage, najviše 2 reda (`line-clamp`).
- `.row`: `.price` (etiketa 24, odmak 8/16/8/12) + kad je `oldPrice`: `.save` u dva reda 14 —
  `<s class="old-price">229 KM</s>` (`--c-text-2`) i `<span class="drop">Sniženo</span> <b>−40 KM</b>` (`--c-sale`, 700).
  Ušteda = `oldPrice − price` kroz `fmtKM`. „Prodato” = `.sold` (inverzno, 12/700, visina 28), etiketa cijene
  precrtana i na 64 %. Vlasnik: `.views` „128 pregleda” 14 `--c-text-2`.
- Stanje obrade/greške: `.state` 14 na `--c-veil`, ikona `clock` (greška: `alert`, `--c-danger`).

Nivo 3 — veličine (`.vel`): okviri 32 visine, min. širina 40, `--r-2`, obrub `rgba(247,241,234,.56)`, 14/700.
Tekst za čitač i e2e ostaje isti kroz skrivene dijelove:
`<p class="vel"><span class="vh">Vel. </span><b>M</b><span class="vh"> · </span><b>L</b></p>` → `textContent`
„Vel. M · L”; obuća „Br. 38 · 39”; `UNI` → jedan okvir „Jedna veličina”; > 6 → prvih 5 i okvir „+N”.

Kolona radnji (`.actions`, razmak 12): krug 48 na `--c-veil`, ikona 24; ispod srca broj 12/700 (prazno kad je 0,
U-16); redom `like`, `share`, `more` (`aria-haspopup="dialog"`). Natpisi „Podijeli/Bez zvuka/Prijavi” nestaju
(oznake ostaju u `aria-label`). **„Prijavi oglas” se seli u „Više”** za kupca; zvuk u gornju traku.

Glavna radnja: `.cta` „Kontaktiraj” (`data-act="contact"`) 48 visine, puna širina, ikona `chat` 20, otvara prozor 2.10.

Uputa (U-12): tablet 36 (`--c-veil`, strelica + tekst) iznad bloka podataka (`bottom: 340`), ne na sredini videa.

### 2.2 Gornja traka feeda — `feed-za-tebe.png`, `feed-novo.png`

`.topbar` (`grid-template-columns: minmax(0,1fr)`), `padding-top: var(--sat)+4`, dno 24, gradijent `.95` → `.85`
(24 px prije kraja) → 0. Red 1 (48): znak 32 · kartice „Za tebe/Novo/Praćeni” (16/700, površina 44, aktivna `--c-text`
s crtom 2 px, ostale `--c-text-2`) · lupa 44 (`--c-veil`; tačka 8 koral s tamnim prstenom kad je filter aktivan).
Red 2 (44): tableti kategorija (36, površina 44, `--c-veil` + obrub .56; aktivan inverzan), desna ivica reda blijedi
(`mask-image`) kao znak da ima još; na kraju reda **prekidač zvuka** `#soundToggle` (44, `aria-pressed`, ikona
`sound-off`/`sound-on`, `aria-label="Zvuk"`). Aktivan filter veličine: prvi tablet `.vtab` „Veličine: 38 ✕”
inverzan (tekst se ne mijenja). Ispravka 25.11.2026. (spajanje, slika `360-gost-feed-dugo.png`): `.vtab` više nije
`sticky` preko reda koji klizi (kategorije su se podvlačile pod njega i dodirivale ga) — stoji mirno lijevo u `#chips`, a
kategorije klize u svom pojasu `.chips-scroll` desno od njega, uvijek s razmakom 8 px; pomak pojasa se čuva pri izboru kategorije.

### 2.3 Pretraga i filter (prozor) — `filter-otvoren.png`, `feed-velicina-prazno.png`

`#searchForm` se iz gornje trake seli u prozor punog formata (`.panel.full`), otvara ga lupa:
naslov „Traži” + × · polje teksta s ikonom (`placeholder` „npr. haljina, Moda Bojana…”) · „Cijena (KM)” od/do u dvije
kolone · „Veličina odjeće” (`#qSizesOdjeca`, XS…XXL + „Jedna veličina”, prekidači 44×44, prelamaju se) s napomenom
„Važi za haljine, jakne, majice, pantalone i ostalo.” · „Broj obuće” (`#qSizesObuca`, 35–46 u dva reda, bez
vodoravnog skrola) s „Važi samo za obuću.” · `#sizesClear` · pričvršćeno dolje: „Poništi” (`#searchClear`) |
„Traži” (glavno, 1:2).

Ponašanje:
- **„Traži” zatvara prozor** (P-1) i vraća fokus na lupu; rezultat se vidi odmah.
- **Veličine se pamte po grupi** (ispravka P-2): `localStorage['komodo.velicine']` postaje
  `{"odjeca":["M"],"obuca":["38"]}` (stari niz se pri čitanju razvrsta po skupu iz F-03). Šta se šalje u `sizes=`:
  Obuća → samo `obuca`; Haljine, Jakne i kaputi, Majice i košulje, Pantalone, Ostalo → samo `odjeca`; Torbe, Nakit →
  ništa (kao sada); „Sve” → unija (server već radi uniju). `.vtab` pokazuje samo grupu koja važi za izabranu
  kategoriju („Veličine: 38 ✕” u Obući); ako u toj kategoriji grupa nema izbora, tablet se ne prikazuje. ✕ briše obje
  grupe (kao „Poništi veličine”).

### 2.4 Donja navigacija — sve slike s menijem

Visina 64 + `--sab`, `--c-bg`, gornja linija `--c-line`. Stavka: min. 64×44, ikona 24 u „pilulici” 56×28, natpis
12/700. Aktivna: `--c-text` + pilulica `rgba(247,241,234,.14)` (oblik, ne samo boja); neaktivna `--c-text-3`.
„Objavi” (butik): pilula 44, koral, ikona `plus` 20 + 14/700. Značka: 20 visine, koral, 12/700, tamni prsten 2 px,
`<span class="vh"> nepročitane</span>`.

### 2.5 Dugmad

| Vrsta | Klasa | Izgled |
|---|---|---|
| glavno | `.btn.btn-main`, `.cta` | 48, pilula, `--c-accent`, tekst `--c-on-accent` 16/700, `--sh-btn` |
| sekundarno | `.btn` | 48, obrub `--c-border`, providno, `--c-text` |
| inverzno | `.btn.btn-inv` | `--c-text` pozadina (rijetko: „Promijeni” preko videa) |
| opasno | `.btn.btn-danger` | obrub i tekst `--c-danger` |
| malo | `.btn-sm` | 36 (površina 44), 14/700, razmak 16 |
| ikona | `.icon-btn` | 44 krug; preko videa `--c-veil`, na površini `.plain` |
| tekstualno | `.link` | min. visina 44, 14/700, `--c-text`, podvlaka 50 % na 4 px — **ne žuto** |

Na ekranu je najviše jedno glavno dugme. Par „Odustani | Glavno” = `.btns` (1fr 2fr); dva ravnopravna = `.btns-2`.

### 2.6 Tableti i čipovi

Kategorija `.chip`, filter `.vtab`, brza pitanja `.quick` (na površini: `--c-surface`, obrub `--c-border`, 14/400),
segment `.seg` (pilula, unutrašnji odmak 4, dugme 40, aktivno inverzno — zamjenjuje `.stat-seg` i dugme
`#pSwitch` „Sviđa mi se/Pratim”), prekidač veličine `.size-btn` 44×44 (aktivan inverzan), prekidač `.switch`
52×32 (uključen `--c-ok`, `role="switch"`, `aria-checked`).

### 2.7 Polja forme i greške — `registracija-greske.png`, `objava-greske.png`

Natpis 14/700 iznad, razmak 8. Polje 48, `--r-3`, `--c-field`, obrub `--c-border`, tekst 16, placeholder
`--c-text-3` s primjerom i trotačkom. Fokus: obrub `--c-text` + prsten. Greška: `aria-invalid="true"`, obrub 2 px
`--c-danger`, ispod `.field-err` (ikona `alert` 20 + 14). Pomoć `.hint` 14 `--c-text-3` (npr. „Najmanje 8 znakova.”
ostaje i uz grešku). „Prikaži/Sakrij” lozinke 44 visine, `--c-text`. `select`: ista visina, strelica `chev-d`,
eksplicitno `background-color`/`color`. Vrijeme u „Uredi profil”: dva polja u koloni 1:1.

### 2.8 Prozori (bottom sheet)

`.sheet` zatamnjenje `--c-backdrop`; `.panel` `--c-surface`, gornji uglovi 24, odmak 8/16/16+`--sab`,
`overscroll-behavior: contain`, ulaz 280 ms. Ručica 36×4 (dekor). Zaglavlje 44: naslov 24 + × (`.icon-btn.plain`,
`aria-label="Zatvori"`). Meni-prozori („Više”): redovi `.menu-item` 56 visine, ikona 24 `--c-text-2` + tekst 16,
razdjelnici `--c-line`, opasna radnja `--c-danger`, „Odustani” kao sekundarno dugme na dnu. Forme
(`postForm`, `editForm`, `profSheet`, `searchForm`) su `.panel.full`, a dugmad u `.panel-foot` pričvršćena dolje
(J-3, U-3). Dodir na zatamnjenje i Escape zatvaraju (postojeće).

### 2.9 Toast

Gore (`top: var(--sat)+8`), lijevo/desno 16, `--r-4`, inverzan (`--c-text` / `--c-bg`), 14/700, ikona 20 lijevo
(`check` zelena `#1f7a3d`; greška `alert` `--c-toast-err`), sjena `--sh-pop`, ulaz 200 ms. Ostalo iz U-03 bez izmjene
(3 s / 5 s, dodir zatvara, `role="status"`). `.toast-err` gubi ružičastu podlogu.

### 2.10 „Kontaktiraj butik” (prozor kontakta) — `kontakt.png`

Zaglavlje: avatar 32 + ime 16/700 + „✓ Provjeren butik” (`--c-ok`, 12/700) + ×. Kartica (`--c-surface-2`, `.trust`)
redova 52: status (`c-status`, otvoreno `--c-ok`) i sažetak subote · adresa + „Mapa” · Pozovi · Viber · linkovi (red sa
`chev-r`). Glavno dugme **na dnu**: „Pošalji poruku” (`#contactMsg`). „Zatvori” dugme se briše (`#contactClose` →
× u zaglavlju; id može ostati na ×). Naslov `#contactTitle` postaje ime butika.

### 2.11 Kartica povjerenja na profilu — `profil-butika-javni.png`

`.trust` (`--c-surface`, `--r-4`, odmak 4/16): red adrese (ikona `pin` 20, adresa 14, `#vMap` kao `.btn-sm` „Mapa”
— ostaje `<a target="_blank" rel="noopener">`, tekst se skraćuje s „Otvori na mapi” na „Mapa” — vidi 5) i red statusa
(`#vStatus` dugme cijele širine, `aria-expanded`, `chev-d`; ispod `#vFull` 14 `--c-text-2`). „Provjeren butik”
(`#vVerified`) je u zaglavlju ispod imena: zelena kvačica + 12/700 `--c-ok`, bez okvira (B-3), dodir daje postojeći
toast. „na Komodu od …” ide u red s `@handle` (`.hint`).

### 2.12 Profil butika: dugmad i mreža — `profil-butika-javni.png`, `profil-butika-vlastiti.png`

Javni: `.p-actions` 1:1 — „Pošalji poruku” (glavno) | „Prati/Pratiš” (sekundarno, B-4); ispod vodoravni red tableta
(`.quick-links`): Pozovi, Viber, linkovi, „Podijeli profil” (`#vShare`, tekst ostaje). Vlastiti: `.p-actions3` —
„Statistika” | „Uredi profil” | podijeli (48, `aria-label="Podijeli profil"`, `#pShare`).

Mreža pločica (`.grid`, 3 kolone, razmak 8 vodoravno / 16 okomito): pločica 3:4, `--r-3`, etiketa cijene
12/700 Bricolage dolje lijevo; ispod naziv 12 `--c-text-2` u jednom redu (B-2); sniženje → drugi red „Sniženo”
`--c-sale`; „Prodato” → inverzna oznaka gore lijevo i slika na 50 %; „Obrađuje se” → oznaka na `--c-veil`.
**Bez „×” za brisanje** (V-1; brisanje ostaje u „Više” na oglasu). Prvi red mreže mora biti iznad pregiba na 390×844
(F-05 kriterij 4) — u nacrtu počinje na ~500 px.

### 2.13 Prazna stanja

Po 1.7; tekstovi iz SPEC. Prazno filtera veličine ima ikonu `sliders`. Kraj liste (`.jos`) je samo ikona `refresh` i
sekundarno dugme „Prikaži starije oglase”. Nepostojeći butik: ikona `shop`, naslov, tekst, „Na početnu”.

### 2.14 „Oglas je u izlogu” — `objava-u-izlogu.png`

Umjesto toasta poslije uspješne objave forma u istom prozoru prelazi u `#postDone` (`.panel.full`, `role="dialog"`,
`aria-labelledby="doneTitle"`, fokus na naslov): krug 72 `--c-ok` s kvačicom 36 · „Oglas je u izlogu” (24) ·
tekst U-14 „Kupci ga vide čim se video obradi (1–3 minute).” (u razvoju bez Bunnyja red se izostavlja) · kartica
`--c-surface-2`: sličica 96 (prvi kadar iz `#preview`) s etiketom cijene, naziv 16/700, „{kategorija} · Vel. …”, i —
ako je broj pratilaca poznat i > 0 — `users` + „{N} pratilaca ga vidi u „Praćeni”” (`--c-ok`, množina po SPEC) ·
dno: „Podijeli oglas” (`share`, poziva postojeće `shareListing` s novim id-jem) | „Objavi još jedan” (glavno, prazna
forma). × zatvara i vraća na feed „Novo” s tim oglasom prvim (kao sada).

### 2.15 Kartica proizvoda u razgovoru — `razgovor-prvi.png`, `razgovor.png`, `razgovor-zatvoreno.png`

Prvi element u `#chatLog` (ne poruka i ne sistemska poruka — klijent je crta iz `oglas` odgovora): `.pcard` dugme
(otvara `/?o=id`), sličica 64 (3:4, `posterUrl`), naziv 16/700, etiketa cijene 14 + precrtana stara cijena, veličine
14 `--c-text-3`. Ispod, samo kupcu i samo dok razgovor nema poruka: `.pstatus` (ikona `clock` `--c-ok`) „Butik je
otvoren do 20:00. Odgovor stiže ovdje.” / zatvoreno „Butik je zatvoren · otvara sutra u 09:00. Odgovor stiže ovdje.”
Zaglavlje razgovora: nazad 44 · avatar 32 · ime 16/700 + status 12 (`--c-ok` kad je otvoreno) · „Više” 44.
**Polje ne dobija fokus pri otvaranju** (M-2, `poruke.js:83`). Mjehurići: sagovornik `--c-surface`, moj
`--c-accent-tint`, ugao 4 prema pošiljaocu, vrijeme 12 `--c-text-3` desno. Dno: brza pitanja (red s blijeđenjem desne
ivice, M-4) + polje-pilula 48 + okruglo „Pošalji” 48 (`send`; prazno polje → onemogućeno). Blokiran / nepotvrđen
email: `.chat-bar` (`--c-surface`) s ikonom i postojećim tekstom + malo dugme; brza pitanja skrivena.

### 2.16 Spisak razgovora — `poruke-spisak.png`, `poruke-butik.png`

Red 72 bez okvira, razdjelnici `--c-line`, kroz cijelu širinu: avatar 40 (inicijal) · ime 16/700 + vrijeme 12 ·
naslov oglasa 12 `--c-text-3` (U-08) · zadnja poruka 14 jedan red. Nepročitano: zadnja poruka `--c-text` 700 +
koral tačka 10 desno (`aria-label="Nepročitano"`) — više ne koral okvir (M-3).

### 2.17 Statistika — `statistika.png`, `statistika-ucitavanje.png`

Nazad „Profil” · naslov 24 · `.seg` 7/30 dana · 2×2 pločice (`--c-surface`, `--r-4`, broj 24 Bricolage, oznaka 14
`--c-text-3`) · grafikon u kartici: naslov „Pregledi po danu” 14/700 + „najviše {N}” desno; stubovi `--c-text-2`,
najveći dan `--c-text` (ne koral — S-1), osa: prvi, srednji i zadnji datum · „Oglasi” lista (sličica 48, naziv
16/700, cijena i brojke 14 `--c-text-3`; istaknut oglas: `--c-surface` + lijeva crta 4 `--c-text`). Učitavanje:
skeleton; greška: `.err` + „Pokušaj ponovo”.

### 2.18 Administracija (osnovno) — `admin.png`

Samo tokeni: pločice brojki `--c-surface` (oznaka 12, broj 24, „juče N” 12), tabela 12 s `tabular-nums` i
razdjelnicima `--c-line`, prijave kao kartice `--c-surface` sa `.btn-sm` (opasne `.btn-danger`), polja po 2.7.
Raspored i logika bez izmjena.

### 2.19 Nadogradnja i bez interneta — `nadogradnja.png`, `bez-interneta.png`

`.gate`: znak 56, naslov 24, tekst 16 `--c-text-2`, „Nadogradi” glavno puna širina (max 320). Bez interneta je
nativni ekran omotača (`mobile/App.js:424-442`, posao mobilnog developera): `errorTitle` 26 → **24**/28;
`errorText` 16/24 boja `#cfc4d2` (sada `#b9adbd`); iznad naslova krug 56 `#2f2636` s ikonom `wifi-off`
(`react-native-svg` ako već postoji, inače izostaviti krug — ne dodavati zavisnost samo za to); dugme visina 48,
`borderRadius` 24, `paddingHorizontal` 24, ikona `refresh` opciono; razmaci 16 (sada `gap: 12`, `marginTop: 8`).
Ugrađeno 25.11.2026. (spajanje): naslov 24/28, tekst 16/24 `#cfc4d2`, `gap` 16, dugme 48 / radijus 24 / 24 px, koral ravno
`#ff6a4d` (pritisnuto `#f0583b`, `scale(.98)`); `react-native-svg` ne postoji, pa nema kruga s ikonom ni gradijenta „Sjaj”.

---

## 3. Nacrti ekrana

> Napomena (25.11.2026.): nacrti u `design/ekrani/` i `design/ekrani/png/` su stariji od odluke o „Kontaktiraj” i „Sjaju”: pokazuju „Pitaj butik” (ili „Kontaktiraj butik”) i ravno dugme. Važe odluka i kod; stvarni izgled su slike u `design/poslije/`.

HTML: `design/ekrani/01-feed.html`, `02-profil.html`, `03-objava.html`, `04-poruke.html`, `05-nalog-ostalo.html`
(sve dijele `design/ekrani/sistem.css`). PNG (390×844, sigurne zone 47/34) u `design/ekrani/png/`:

| Tok | Slike |
|---|---|
| Feed | `feed-za-tebe`, `feed-novo` (filter veličine, „Pratiš”, zatvoreno), `feed-vlastiti-oglas`, `feed-uputa`, `feed-ucitavanje`, `feed-greska` |
| Feed prazno | `feed-praceni-gost`, `feed-praceni-prazno`, `feed-prazna-kategorija`, `feed-velicina-prazno`, `feed-razdjelnik`, `feed-kraj` |
| Filter i prozori oglasa | `filter-otvoren`, `vise-kupac`, `vise-vlasnik`, `kontakt`, `prijavi-oglas` |
| Profil | `profil-butika-javni`, `profil-butika-vlastiti` (s toastom), `profil-butika-ne-postoji`, `uredi-profil`, `uredi-profil-greska`, `profil-kupca`, `profil-kupca-pratim` |
| Objava | `objava-prazna`, `objava-popunjena`, `objava-greske`, `objava-slanje`, `objava-u-izlogu`, `izmjena-snizenje` |
| Poruke | `poruke-spisak`, `poruke-butik`, `poruke-prazno`, `razgovor-prvi` (kartica + brza pitanja), `razgovor`, `razgovor-zatvoreno`, `razgovor-blokiran`, `razgovor-nepotvrden`, `razgovor-vise` |
| Nalog | `prijava`, `registracija-greske` (lead U-04 i oglas) |
| Ostalo | `statistika`, `statistika-ucitavanje`, `admin`, `nadogradnja`, `bez-interneta` |

Slike stanja prije: `design/prije/390-*.png` (360 i 430 su obrisane; nove za 3 veličine idu u `design/poslije/`).

---

## 4. Implementacija (za frontend, grana `redizajn`)

Princip: mijenja se markup i klase, logika samo gdje je navedeno (označeno **logika**). ES5 stil, bez novih
biblioteka, bez novih tajmera.

### 4.1 Redoslijed i procjena

| # | Korak | Fajlovi | Trud |
|---|---|---|---|
| 1 | Tokeni (1.10) + aliasi starih imena, osnova (`touch-action`, fokus, `select`), `viewport-fit=cover`, sigurne zone, fontovi samo 400/700 | `web/style.css` (`:root`, osnova), `web/index.html:5`, `web/fonts/fonts.css` | 0,5 d |
| 2 | Osnovne komponente: `.btn*`, `.link`, `.field`, `.err`, `.field-err`, `.hint`, `.size-btn`, `.seg`, `.switch`, `.sheet/.panel/.panel-head/.panel-foot/.menu-item`, `.toast`, `.badge`, `.sk`, `.empty-box`; SVG sprite + `ICON` | `style.css`, `index.html` (sprite), `js/osnova.js` (`ICON`, `toast` dodaje ikonu) | 1 d |
| 3 | Gornja traka + zvuk + donji meni | `index.html` (topbar, `#soundToggle`, `.tab` markup), `style.css`, `js/feed.js` (**logika**: zvuk se veže na `#soundToggle` umjesto `data-act="sound"`) | 0,5 d |
| 4 | Kartica oglasa (2.1) | `js/feed.js` (`cardHTML`, `sizesLine` → HTML okvira, `followBtnHTML`, uputa), `style.css` | 1 d |
| 5 | Filter u prozoru + veličine po grupi (2.3) | `index.html` (`#searchForm` u `.sheet`), `style.css`, `js/feed.js` (**logika**: zatvaranje na „Traži”, `komodo.velicine` po grupi, `activeSizes()` po kategoriji, tekst `.vtab`) | 0,75 d |
| 6 | Prozori oglasa: „Više” kupca (novo: `#buyerMoreSheet` s „Prijavi oglas”), „Više” vlasnika, „Kontaktiraj butik”, „Prijavi” | `index.html`, `style.css`, `js/feed.js` (`data-act="more"` za kupca otvara novi prozor), `js/butik.js` (`openContact` markup) | 0,5 d |
| 7 | Profil butika javni/vlastiti, „Uredi profil”, profil kupca, Nalog | `butik.css`, `index.html`, `js/butik.js`, `js/profil.js` (markup pločica, bez `.tile-del`) | 1 d |
| 8 | Objava, „Oglas je u izlogu”, izmjena | `index.html` (`#postDone`, `.panel-foot`), `style.css`, `js/objava.js` (**logika**: poslije uspjeha prikaz `#postDone` umjesto toasta, pregled naziva/cijene preko videa na `input`, bez `eTitle.focus()`) | 1 d |
| 9 | Poruke: spisak, kartica proizvoda, status, mjehurići, polje | `statistika.css` (dio razgovora), `index.html` (`#chat`), `js/poruke.js` (**logika**: bez `chatInput.focus()` pri otvaranju; kartica i status iz odgovora) | 0,75 d |
| 10 | Prijava/registracija (dugmad umjesto linkova, mini oglas za U-04) | `index.html`, `js/prijava.js` (kartica iz `komodo.posle` ako je `like`/`chat` — podaci iz `items` u memoriji, bez zahtjeva) | 0,5 d |
| 11 | Statistika, administracija, nadogradnja | `statistika.css`, `js/statistika.js`, `js/admin.js` (samo klase) | 0,5 d |
| 12 | Čišćenje: brisanje aliasa i mrtvih pravila (`.wordmark`, `.pill`, `.city`, `.ph-word`, `.tile-del`, `.link-x`), Vercel lista, slike poslije na 3 veličine, e2e | sve | 0,75 d |
| — | API (4.5) | `api/src/app.js`, `api/src/rute/poruke.js`, testovi | backend 0,5 d |

Ukupno ≈ **8,75 dana frontenda + 0,5 dana backenda**. Koraci 1–2 idu prvi i sami po sebi ne smiju promijeniti nijedan
e2e rezultat; poslije svakog koraka slika ekrana 390×844 dizajneru.

### 4.2 Šta se NE smije mijenjati

**Id-jevi koje koriste e2e testovi** (`grep -rhoE "#[a-zA-Z][a-zA-Z0-9_]*" tests/e2e/*.mjs`, 138): `#aEmail #aPass
#aShop #admEmail #admName #admReports #admReportsHint #admSearch #admShopDone #admStatsBody #admUsers #admin
#adminOpen #authErr #authForm #authLead #authShopField #authSubmit #authTitle #chat #chatBack #chatBar #chatBarErr
#chatBarText #chatBlock #chatForm #chatInput #chatLog #chatMore #chatMoreSheet #chatName #chatQuick #chatReport
#chatResend #chips #confirmNo #confirmSheet #confirmText #confirmTitle #confirmYes #contactList #contactMsg
#contactSheet #delForm #delPass #delToggle #eDrop #ePrice #eSold #eTitle #editCancel #editForm #editSheet #fCat
#fEmpty #fList #fPrice #fSizes #fSizesBox #fSizesLbl #fTitle #fVideo #feed #ftabs #gateGo #hFrom_rd #hFrom_sub
#hOn_ned #hOn_rd #hOn_sub #hTo_rd #hTo_sub #inboxList #logout #me #moreSheet #nalogTitle #pBadge #pCount #pCountLbl
#pEdit #pFollow #pFollowLbl #pGrid #pGridTitle #pHandle #pName #pShare #pStatsOpen #pSwitch #postErr #postSheet
#postSubmit #preview #profSheet #profTitle #profile #qSizesObuca #qSizesOdjeca #qText #reportForm #reportReason
#reportSheet #sAddress #sAddressHint #sName #searchClear #searchDot #searchForm #searchToggle #shopCancel #shopErr
#shopSave #shopView #statBack #statBody #statScreen #tabPost #toast #updateGate #uputa #vAddrText #vAvatar
#vContact #vCount #vFollow #vFollowers #vFull #vGrid #vHandle #vHome #vMap #vMissing #vMsg #vName #vShare
#vStatus #vVerified`.

**Atributi:** `[data-id]`, `data-act` = `like follow contact more shop report clearsizes jos edit del`,
`data-more` = `edit sold stats del close`, `data-go` = `feed profile`, `data-k`, `data-size`, `aria-pressed` na
`.ftab`/`.follow-btn`/`.size-btn`.

**Klase koje testovi čitaju:** `.card .title .price .old-price .drop .sold .vel .seller-btn .vtab .ftab .chip
.size-btn .tile .msg .mine .quick .ltitle .empty .empty-box .razdjelnik .uputa .c-status .f-item .stat-item .tab
.hint .adm-table .adm-tile .adm-total`; `.wordmark` mora ostati nepostojeća.

**Tekstovi:** svi iz `docs/SPEC-V1.md` i oni koje testovi provjeravaju (npr. „Vel. M”, „Br. 38 · 39”,
„Veličine: 38 ✕”, „Sniženo”, „Prati/Pratiš”, „Podijeli profil”, „Uredi profil”, „Nalog”, „Moji oglasi”, poruke
toasta). Izuzeci su samo odobreni (odj. 0) i novi tekstovi iz 5.

**Omotač:** `window.__komodoBack`, `__komodoOpenChat`, `__komodoOpenListing`, `__komodoOpenUrl`, `__komodoPush`
i `toApp({type: 'ready'|'chat'|'share'|'push'|'exit'|'update'})` (`omotac.js`, `docs/PRODAVNICE.md` odj. 9) — bez
izmjena; `__komodoBack` mora zatvarati i nove prozore (`#searchForm` u prozoru, `#buyerMoreSheet`, `#postDone`) istim
redom kao postojeće.

**Budžet zahtjeva:** nijedan novi tajmer i nijedan novi zahtjev po kartici; kartica proizvoda u razgovoru i status
dolaze iz postojećih odgovora (4.5).

### 4.3 Testovi koje odobrene izmjene mijenjaju (vlasnik testova)

1. `tests/e2e/butik.spec.mjs:35` i `:98` — očekuju toast „Oglas je objavljen.”; poslije koraka 8 provjeravaju
   `#postDone` i naslov „Oglas je u izlogu” (Stefanova odluka). Alternativa bez izmjene testa nije preporučena (dupla
   potvrda).
2. `tests/e2e/admin.spec.mjs:20` — klik na `card [data-act="report"]`; „Prijavi” je sad u „Više”: klik na
   `card [data-act="more"]`, pa `#buyerMoreSheet [data-act="report"]`.
3. `tests/e2e/oglas.spec.mjs:99` ostaje ispravan (vlasnik nema `follow`).
4. Nema testa koji čita tekst „Kontaktiraj butik” (provjereno grep-om); svi koriste `[data-act="contact"]`.

### 4.4 Šta se mijenja po ekranu

| Ekran | `index.html` | CSS | JS (markup/klase) |
|---|---|---|---|
| Gornja traka | `#topbar`: `.chips-row` omotač, `#soundToggle`; `#searchForm` premješten u `<div class="sheet" id="searchSheet">` | `style.css` `.topbar .brand .ftab .chips .chip .vtab .icon-btn` | `feed.js` `renderTabs`, kategorije (`.chip` markup isti), zvuk |
| Kartica | — | `style.css` `.card .scrim .meta .seller-* .ok-badge .follow-btn .shop-sub .title .row .price .save .old-price .drop .sold .vel .state .views .actions .act .card-cta .uputa` | `feed.js` `cardHTML`, `sizesLine`, `followBtnHTML`, `likeCount`, `soundBtnInner` (briše se), `#uputa` mjesto |
| Prazna stanja feeda | — | `.empty .empty-box .empty-ico` | `feed.js` `emptyHTML`, `emptySizesHTML`, razdjelnik, `.jos`, greška (`wifi-off`) |
| Filter | `#searchSheet` (2.3) | `.panel.full .size-btn .sizes` | `feed.js` pretraga, veličine |
| Prozori oglasa | `#moreSheet` u `.menu-list`; novi `#buyerMoreSheet`; `#contactSheet` (2.10); `#reportSheet` | `.sheet .panel .menu-item` | `feed.js`, `butik.js` `openContact` |
| Profil butika | `#shopView` (2.11, 2.12) | `butik.css` (`.v-*`, `.trust`, `.p-actions`, `.quick-links`) | `butik.js` render profila, `tileHTML` u `osnova.js` |
| Vlastiti profil / kupac | `#me` (`.p-actions3`, `.seg` za `#pSwitch`, „Nalog” kao `.list-card`) | `butik.css` | `profil.js` |
| „Uredi profil” | prozor (pravi ga `profil.js`/`butik.js`), `.panel-foot` | `butik.css` `.h-row` → `.trust-row`, `.switch` | isto |
| Objava, izmjena | `#postForm`, `#editForm` (`.panel.full`, `.prev`, `.panel-foot`), novi `#postDone` | `style.css` `.pick .prev .pv .done*` | `objava.js` |
| Poruke | `#inbox`, `#chat` (`.chat-head`, `.chat-foot`, `.send`) | `statistika.css` (razgovor), `style.css` `.inbox .msg` | `poruke.js` (redovi spiska, `.pcard`, `.pstatus`) |
| Prijava | `#authForm`, `#forgotForm`, `#resetForm` (`.link` → `.btn` za `#authSwitch`) | `style.css` `.auth` | `prijava.js` (mini kartica U-04) |
| Statistika | — | `statistika.css` `.stat-*`, `.chart*` | `statistika.js` `statDaysChart` |
| Admin | — | `statistika.css` `.adm-*` | — |
| Nadogradnja | `#updateGate` (klase) | `.gate*` | — |

### 4.5 Izmjena API-ja (minimalna, bez novih upita)

**Kartica feeda** — `users` je već spojen u `LISTING_SELECT` (`api/src/app.js:183`), pa su dovoljna 2 stupca:

```js
// LISTING_SELECT: dodati u listu kolona
u.shop_name, u.handle, u.address as shop_address, u.hours as shop_hours,
// publicListing: dodati
shopAddress: r.shop_address || '',   // string ≤ 120; kartica ga skraćuje
shopHours: r.shop_hours ?? null,     // isti oblik kao butik.hours: { rd:[od,do]|null, sub, ned } ili null
```

- **Bez `shopOpenUntil` sa servera**: „otvoreno do” zavisi od trenutka, a odgovor feeda je keširan (javni 5 s,
  kandidati „Za tebe” 60 s); klijent već ima `hoursStatus()` (`butik.js:144`, zona Europe/Sarajevo) — računa ga pri
  crtanju kartice, bez zahtjeva.
- **Bez `shopVerified`**: po SPEC odj. 7 oznaka je tačna za svaki butik, a oglase objavljuje samo butik — klijent je
  uvijek prikazuje. Ako Stefan jednom uvede provjeru po butiku, tada se dodaje `shopVerified` iz kolone u istom spoju.
- Važi za sve rute koje koriste `LISTING_SELECT`/`publicListing` (`/api/feed`, `/api/listings`, jedan oglas, OG
  — OG ih ignoriše). Veličina: ~60–150 B po oglasu, ~2 KB po strani od 20 (prije kompresije). Indeksi i ključevi keša
  se ne mijenjaju; `KAND_SELECT` se gradi zamjenom teksta i dalje radi (provjera regexom u `api/src/rute/feed.js:133` gleda samo
  `select l.id,` i `join users`).
- Preporuka (jeftino): `PATCH /api/me` kad butik promijeni naziv, adresu ili radno vrijeme zove `ocistiKesFeeda()`,
  inače kartice do 60 s pokazuju staro (isto važi i danas za `shopName`).

**Razgovor** — `GET /api/conversations/:id/messages` (`api/src/rute/poruke.js:80-89`), u **istim** upitima:
- upit oglasa: dodati `l.video_path, l.video_provider, l.video_status, l.bunny_guid, l.video_res, l.old_price_cents,
  l.price_dropped_at`, a `oglas` dobija `posterUrl` (kroz `mediaUrls`) i `oldPrice` (kroz postojeću `oldPrice`, treba
  je izvesti iz `app.js`);
- upit sagovornika: `select shop_name, handle, role, hours` → `sagovornik.hours` (samo kad je `butik`, inače `null`).
- Nova polja samo kad je `after = 0` (prvo otvaranje); dovlačenje svake 4 s ostaje iste veličine.

**Kraj objave (opciono)** — `publicUser` (`app.js:129`) dobija `followersCount: Number(u.followers_count ?? 0)`
(kolona je već u redu korisnika i kešu prijava). Bez toga red „{N} pratilaca ga vidi…” se prikazuje samo ako je broj
već učitan na profilu (`pFollowers`), inače se izostavlja.

Testovi API-ja: `publicListing` ima `shopAddress`/`shopHours`; poruke s `after=0` imaju `posterUrl`, `oldPrice`,
`sagovornik.hours`, a s `after>0` nemaju.

### 4.6 Kriteriji prihvatanja

1. Vercel kontrolna lista (`docs/DIZAJN-REVIZIJA.md` odj. 3) ponovo prođena na novom kodu: **nijedan visok ni srednji
   nalaz otvoren**; svaki zatvoren nalaz zapisan `fajl:red – riješeno`.
2. Kontrasti: svaki par tekst/pozadina iz 1.1 ≥ 4,5:1 (24 px ≥ 3:1), okviri kontrola i fokus ≥ 3:1; preko videa
   izmjereno na pikselu slike `design/poslije/390-gost-feed-zatebe.png` (svijetli snimak) — neaktivna kartica ≥ 4,5.
3. U CSS-u najviše 4 veličine slova (12/14/16/24) i 2 debljine (400/700): `grep -oE "font[^;]*[0-9]+px" web/*.css`.
4. Svaka dodirna površina ≥ 44×44 na 360, 390 i 430 (Playwright: `boundingBox` svih `button, a, [role=switch]`
   vidljivih na ekranu, uz `::after` proširenja izmjereno `elementFromPoint` na rubu).
5. Svi e2e testovi zeleni (uz izmjene iz 4.3), `node --check` za `web/js/*.js`, API testovi zeleni s novim poljima.
6. Broj API zahtjeva u minuti po korisniku isti (≈ 7): mjereno Playwrightom 3 minute u feedu i 3 minute u razgovoru
   prije i poslije (`page.on('request')` za `/api/`).
7. Nijedan novi font ni debljina; ukupna težina fontova koje stranica preuzme ≤ današnje.
8. `prefers-reduced-motion` (Playwright `reducedMotion: 'reduce'`): nema animacija osim spinnera.
9. Slike poslije u `design/poslije/<širina>-<uloga>-<ekran>.png` na 360×780, 390×844 i 430×932 za iste ekrane kao
   `design/prije/`, plus `objava-u-izlogu` i `razgovor-prvi`; dizajner ih pregleda prije spajanja.
10. Mobilni omotač: `__komodoBack` zatvara svaki prozor redom, `toApp` poruke nepromijenjene (`mobile/navigacija.test.mjs`).

---

## 5. Novi tekstovi (prijedlog, nisu u SPEC — trebaju Stefanovu potvrdu prije koraka 4)

| Gdje | Tekst |
|---|---|
| Kartica, zatvoren butik | „otvara sutra u 09:00” (status bez „Zatvoreno · ”, da stane u jedan red) |
| Filter | naslovi „Veličina odjeće” / „Broj obuće”, napomene „Važi za haljine, jakne, majice, pantalone i ostalo.” / „Važi samo za obuću.”; naslov prozora „Traži”; placeholder „npr. haljina, Moda Bojana…” |
| „Više” kupca | „Profil butika {Butik}”, „Kopiraj link oglasa”, „Prijavi oglas” |
| Profil butika | „Mapa” umjesto „Otvori na mapi” (uži red) |
| Objava | „Ovako ga vide kupci”, „Naziv i cijena se upisuju preko snimka dok kucaš.”, „Video 0:12, uspravno”, „Šaljem video…”, „{N} pratilaca ga vidi u „Praćeni”” |
| Izmjena | „Bila 89,90 KM” ispod polja cijene |
| Prva poruka | „Butik je otvoren do {do}. Odgovor stiže ovdje.” / „Butik je zatvoren · otvara {kad}. Odgovor stiže ovdje.” |
| Spisak poruka (prazno, kupac) | „Na oglasu dodirni „Kontaktiraj” i pitaj šta te zanima.” (posljedica odobrenog naziva; sada „…dodirni Pošalji poruku…”) |
| Razgovor, blokiran | traka „Razgovor je blokiran.” + „Odblokiraj {ime}” (danas samo placeholder polja) |

---

## 6. Prijedlog: gradijent za glavnu radnju (Stefanovo pitanje, 24.11.2026.)

**Izabrano 25.11.2026.: koral + Sjaj.** Stefan je izabrao varijantu (b1) „Sjaj” i zadržao koral kao glavnu boju (odjeljak 7 se
ne primjenjuje). Ugrađeno u `web/style.css` (tokeni `--g-accent`, `--g-accent-press`, `--g-glow-ok`) samo na: „Kontaktiraj”
(`.cta`), „Objavi” u formi objave (`#postSubmit`), „Pošalji poruku” (`#contactMsg`, `#vMsg`), „Objavi još jedan” (`#doneAgain`) i
zeleni sjaj iza kvačice na „Oglas je u izlogu” (`#postDone`). Nigdje drugo (ne na meniju „Objavi”, „Pošalji” u razgovoru,
cijeni, znački, tabletima, statistici ni mjehurićima); ostale `.btn-main` ostaju ravne. Onemogućeno je ravno. Izmjereno na pikselima
slika ekrana (`design/poslije/390-kupac-feed-sjaj.png`, `390-b0-objava-u-izlogu.png`, `390-kupac-kontakt-sjaj.png`): najslabija tačka
dugmeta pod tamnim tekstom 5,29:1 (mirovanje, računato sa ivicama), najjača 7,5:1; pritisnuto najslabije 5,31:1 — sve ≥ 4,5:1.

Nacrt: `design/ekrani/06-gradijenti.html`; slike `design/ekrani/png/grad-dugmad.png` (sve varijante, mirovanje /
`:active` / onemogućeno, s izmjerenim kontrastom), `grad-gdje.png` (gdje da, gdje ne), `grad-feed-zar.png`,
`grad-feed-zalazak.png`, `grad-feed-sjaj.png`, `grad-profil-sjaj.png`, `grad-u-izlogu-sjaj.png`,
`grad-u-izlogu-ravno.png`. Ovo je prijedlog — u `web/` se ništa ne mijenja dok Stefan ne izabere.

### 6.1 Varijante (tekst uvijek `#16121a`, kontrast na najslabijoj tački gradijenta)

| Varijanta | Mirovanje | Najslabije | `:active` | Najslabije |
|---|---|---|---|---|
| (a) ravno, sadašnje | `#ff6a4d` | 6,53:1 | `#f0583b` | 5,43:1 |
| (b1) **„Sjaj”** — ista nijansa, svjetlo odozgo | `linear-gradient(180deg,#ff8466 0%,#ff6a4d 55%,#f45f42 100%)` | 5,78:1 (`#f45f42`) | `linear-gradient(180deg,#f9714f 0%,#f0583b 55%,#e65538 100%)` | 5,04:1 |
| (b2) „Žar” — koral → topla magenta | `linear-gradient(100deg,#ff6a4d 0%,#f2547a 100%)` | 5,57:1 (`#f2547a`) | `linear-gradient(100deg,#f0583b 0%,#e2486e 100%)` | 4,74:1 |
| (b3) „Zalazak” — koral → narandžasta | `linear-gradient(100deg,#ff5f48 0%,#ff8a3d 100%)` | 6,15:1 (`#ff5f48`) | `linear-gradient(100deg,#f0583b 0%,#f27a33 100%)` | 5,43:1 |

Onemogućeno u svim varijantama: ravno `--c-surface-2` + tekst `--c-text-3` (6,74:1) — bez gradijenta, da se odmah
vidi da dugme ne radi. Granica: ni jedna tačka gradijenta ispod 4,5:1 ni u `:active`; zato „Žar” ne smije tamnije od
`#e2486e` (već `#d9466c` daje 4,44:1).

### 6.2 Gdje da, gdje ne (granica anti-obrasca)

Smjernica `ceorkm` navodi pretjerane gradijente kao anti-obrazac. Granica za Komodo: **gradijent samo na jednom
elementu po ekranu, i samo na onom koji je i ravan bio najglasniji** (glavna radnja), nikad na tekstu, podacima ni
cijeni. Jedini izuzetak je vrhunac toka „Oglas je u izlogu”, gdje uz dugme ide i tiho zeleno svjetlo iza kvačice.

| Mjesto | Odluka | Zašto |
|---|---|---|
| „Kontaktiraj” (`.cta`), „Objavi” u prozoru objave (`#postSubmit`), „Pošalji poruku” (`#contactMsg`, `#vMsg`), „Objavi još jedan” (`#doneAgain`) | **da** | jedna radnja po ekranu, gradijent joj daje dubinu i „pritiskivost” |
| „Objavi” u donjem meniju (`.tab-post`), „Pošalji” u razgovoru (`.send`), ostala `.btn-main` (npr. „Sačuvaj”, „Traži”, „Napravi nalog”) | **ne** | ostaju ravno koral; ugrađeno tako (25.11.2026.) i ne mijenja se |
| „Oglas je u izlogu”: `radial-gradient(70% 55% at 50% 0%, rgba(111,217,140,.18), transparent 70%)` iza kvačice | **da** | Peak-End; tekst na najjačem dijelu svjetla `#f7f1ea` 9,79:1, `#cfc4d2` 6,53:1 |
| logo | ostaje kakav je | ravna žuta + koral su brend |
| etiketa cijene | **ne** | žuta ostaje samo za cijenu i ravna — to je potpis koji se čita za sekundu |
| značka nepročitanih (20 px) | **ne** | na toj veličini se gradijent ne vidi, samo prlja ivicu |
| prsten oko avatara butika | **ne** | obećava „priče” kojih nemamo i liči na tuđu aplikaciju |
| pločice i grafikon statistike | **ne** | podaci moraju biti neutralni (S-1) |
| tableti, meni, mjehurići, pozadine, kartice | **ne** | video je sadržaj; sve oko njega mora biti tiše |

### 6.3 Preporuka

**„Sjaj” (b1), samo na glavnoj radnji, + zeleno svjetlo na „Oglas je u izlogu”.** Iskreno: koral je „običan” više zbog
toga što je ravan i jedini akcenat nego zbog nijanse; „Sjaj” mu daje volumen i osjećaj fizičkog dugmeta, a ostaje
ista boja brenda, isti kontrast (5,78:1) i ne svađa se s ostatkom. „Žar” je najupadljiviji, ali na feedu stavlja treću
jaku nijansu (magenta) pored žute etikete i korala avatara i vuče paletu ka poznatim društvenim mrežama. „Zalazak”
ide ka narandžastoj i približava dugme žutoj etiketi cijene — cijena i radnja počinju da se takmiče. Ako Stefan želi
izraženije, onda „Žar”, ali isključivo na `.cta` i „Objavi”, nigdje drugo.

### 6.4 Tokeni i pravila (kad Stefan odobri; ~0,25 dana frontenda, poslije koraka 2)

```css
:root{
  --g-accent:linear-gradient(180deg,#ff8466 0%,#ff6a4d 55%,#f45f42 100%);
  --g-accent-press:linear-gradient(180deg,#f9714f 0%,#f0583b 55%,#e65538 100%);
  --g-glow-ok:radial-gradient(70% 55% at 50% 0%,rgba(111,217,140,.18),rgba(111,217,140,0) 70%);
}
/* Ugrađeno (web/style.css): samo glavna radnja ekrana, ne i meni „Objavi”, „Pošalji” u razgovoru ni ostala .btn-main */
.cta,#postSubmit,#contactMsg,#vMsg,#doneAgain{background-color:var(--c-accent);background-image:var(--g-accent);border-color:transparent}
.cta:active,#postSubmit:active,#contactMsg:active,#vMsg:active,#doneAgain:active{background-image:var(--g-accent-press)}
.cta[disabled],.cta[aria-disabled="true"],#postSubmit[disabled],#postSubmit[aria-disabled="true"],#contactMsg[disabled],#vMsg[disabled],#doneAgain[disabled]{background-image:none;background-color:var(--c-surface-2);color:var(--c-text-3);box-shadow:none;opacity:1}
#postDone{background-image:var(--g-glow-ok)}
```

`background-color` ostaje kao rezerva. Za „Žar” ili „Zalazak” mijenjaju se samo vrijednosti `--g-accent` i
`--g-accent-press` iz 6.1. Performanse: samo CSS `linear-gradient`/`radial-gradient` (bez slika i bez novih zahtjeva);
pritisak mijenja `background-image` bez prelaza i `transform: scale(.98)`, pa nema animacije boje ni dodatnog crtanja
po frejmu. Žuta ostaje samo za cijenu.

---

## 7. Prijedlog: druga glavna boja umjesto korala (Stefanovo pitanje, 24.11.2026.)

Nacrt: `design/ekrani/07-boje.html`. Uporedne table: `design/ekrani/png/boje-uporedno.png` (sve boje: ravno, „Sjaj”,
`:active`, uz žutu cijenu i sniženje, moja poruka, značka, tačka, fokus), `boje-uporedno-feed.png`,
`boje-uporedno-profil.png`, `boje-uporedno-u-izlogu.png`. Pojedinačno: `boja-<ime>-feed.png`, `boja-<ime>-profil.png`,
`boja-<ime>-u-izlogu.png` za `koral`, `ametist`, `fuksija`, `laguna`, `kobalt`. Prijedlog — `web/` se ne mijenja.

Odbačeno bez nacrta: **smaragdna/zelena** (sudara se s `--c-ok` — „Provjeren”, „otvoreno” i glavna radnja bi bili
ista porodica) i **crvena** (greška).

### 7.1 Kandidati i izmjereni kontrast

Tekst je kod svih `#16121a` — **bijeli tekst ne prolazi ni na jednoj** (2,4–3,1:1), jer boja mora biti svijetla da bi
se isticala na tamnoj pozadini. „Sjaj” = `linear-gradient(180deg, vrh 0%, boja 55%, dno 100%)` (vrh = 14 % bijelog,
dno = 6 % `#16121a`); `:active` = isto, tamnije.

| Boja | `--c-accent` | Ravno | „Sjaj” najslabije | `:active` najslabije | Boja na `--c-bg` (značka, tačka) | `--c-accent-tint` / tekst | Sniženje `--c-sale` |
|---|---|---|---|---|---|---|---|
| Koral (sadašnji) | `#ff6a4d` | 6,53 | 5,90 | 5,22 | 6,53 | `#452424` / 12,23 | `#ff8f78` (8,32) |
| Ametist | `#a685ff` | 6,53 | 5,89 | 5,21 | 6,53 | `#332948` / 12,07 | `#ff8f78` (8,32) |
| Fuksija | `#ff5ca8` | 6,47 | 5,84 | 5,15 | 6,47 | `#452136` / 12,29 | `#ffa36b` (9,43; na videu 6,06) |
| Laguna (akva) | `#3ed1d6` | 9,95 | 8,92 | 7,73 | 9,95 | `#1e3840` / 11,05 | `#ff8f78` (8,32) |
| Kobalt | `#6b8cff` | 6,01 | 5,45 | 4,81 | 6,01 | `#272a48` / 12,39 | `#ff8f78` (8,32) |

Fokus prsten ostaje `#f7f1ea` s tamnim oreolom za sve (≥ 14:1). Žuta ostaje samo cijena; logo se ne mijenja.

### 7.2 Uloge, slaganje i sličnost s drugim brendovima

| Boja | Sa žutom cijenom i logom | Sudar uloga | Liči na |
|---|---|---|---|
| Koral | topla, srodna logu (koral tačka u logu) — paleta je jedna cjelina | sniženje `#ff8f78` je blizu glavne boje (razlika samo u svjetlini) | Airbnb je crveno-ružičast, ali s bijelom pozadinom; dovoljno daleko |
| Ametist | komplementarna žutoj — cijena i dugme se najjasnije razdvajaju; koral tačka u logu ostaje usamljena | nema: sniženje i greška su topli, radnja hladna — razlikovanje uloga je **bolje** nego danas | ljubičasta porodica: Viber (`#7360f2`, tamnija i plavlja — a Viber se kod nas pojavljuje kao link butika), Twitch (`#9146ff`); ametist je svjetliji lavandin, ali asocijacija postoji |
| Fuksija | jaka i modna, ali uz žutu i koral tačku loga daje tri tople jake nijanse | sniženje se mora pomjeriti na narandžasto `#ffa36b`, koje se približava žutoj cijeni | ružičasto-magenta aplikacije za dostavu i vožnju (Lyft, foodpanda) i dio TikTok/Instagram palete |
| Laguna | hladna, „sportska”; uz žutu podsjeća na plažu/turizam | **blizu zelene povjerenja** (kvačica i avatar butika iste porodice) i najsvjetlija — najglasnija na ekranu | Wolt (svijetloplava/cijan) i TikTokova cijan nijansa |
| Kobalt | plava + žuta = **boje zastave BiH**; u Banjoj Luci to može djelovati politički — rizik za prvi grad | nema | Facebook/Messenger, LinkedIn — „bankarska” plava, gubi toplinu mode |

### 7.3 Tokeni (zamjena u 1.10 i 6.4, ako Stefan izabere)

```css
/* Ametist */
--c-accent:#a685ff; --c-accent-press:#9a7ced; --c-accent-tint:#332948; --c-sale:#ff8f78;
--g-accent:linear-gradient(180deg,#b296ff 0%,#a685ff 55%,#9d7ef1 100%);
--g-accent-press:linear-gradient(180deg,#aa8aff 0%,#9a7ced 55%,#9376e1 100%);
/* Fuksija */
--c-accent:#ff5ca8; --c-accent-press:#ec569d; --c-accent-tint:#452136; --c-sale:#ffa36b;
--g-accent:linear-gradient(180deg,#ff73b4 0%,#ff5ca8 55%,#f1589f 100%);
--g-accent-press:linear-gradient(180deg,#ff63ab 0%,#ec569d 55%,#e15296 100%);
/* Laguna */
--c-accent:#3ed1d6; --c-accent-press:#3bc2c7; --c-accent-tint:#1e3840; --c-sale:#ff8f78;
--g-accent:linear-gradient(180deg,#59d7dc 0%,#3ed1d6 55%,#3cc6cb 100%);
--g-accent-press:linear-gradient(180deg,#46d3d8 0%,#3bc2c7 55%,#39b8be 100%);
/* Kobalt */
--c-accent:#6b8cff; --c-accent-press:#6482ed; --c-accent-tint:#272a48; --c-sale:#ff8f78;
--g-accent:linear-gradient(180deg,#809cff 0%,#6b8cff 55%,#6685f1 100%);
--g-accent-press:linear-gradient(180deg,#7191ff 0%,#6482ed 55%,#607ce1 100%);
/* Koral („Sjaj” iz 6.4 ostaje) */
```

Svuda `--c-on-accent: #16121a`. Avatar butika (inicijal) prati `--c-accent`. Zamjena je samo u `:root` — nijedna
komponenta se ne mijenja; uz to toast greške i `.btn-danger` ostaju crveni. Trud: ~0,25 dana + slike poslije.

### 7.4 Preporuka

**Koral ostaje, sa „Sjajem” (odjeljak 6).** Razlozi: logo (žuta etiketa s koral tačkom) ostaje, pa je koral jedina
boja koja čini paletu cjelinom; topla je i „modna” na tamnoj pozadini; nema sudara sa zastavom, zelenom povjerenja ni
poznatim aplikacijama. Utisak „običnog” rješava gradijent, ne promjena nijanse.

Jedina alternativa koju bih podržao je **Ametist**: komplementaran žutoj cijeni (najčistije razdvajanje cijene i
radnje) i jasnije razdvaja glavnu radnju od toplih boja sniženja i greške. Cijena: koral tačka u logu ostaje bez para
(trebalo bi je kasnije uskladiti — to je odluka o brendu), i ljubičasta asocira na Viber, koji se u aplikaciji
pojavljuje kao kontakt butika. Fuksiju, Lagunu i Kobalt ne preporučujem (razlozi u 7.2).
