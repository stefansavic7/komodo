# Komodo v1 — specifikacija funkcija

Vlasnik: Proizvod i UX. Osnova: `docs/PLAN-PRODUKCIJA.md` (odjeljak 3 obim, 4 odluke), `docs/SKALIRANJE.md`,
analiza 19.11. (odjeljci 4 i 6). Pregledan kod: commit `c2cf623` (`api/src/server.js`, migracije 001–008,
`web/app.js`, `web/index.html`, `web/style.css`). Prolaz u pregledniku (390×844) kao kupac, butik i administrator,
19.11.2026.; slike ekrana su van repozitorija.

Dokument je za inženjere. Gdje piše tekst pod navodnicima, to je tačan tekst u aplikaciji.

## 0. Pregled

| ID | Funkcija | Prioritet | Paket |
|---|---|---|---|
| F-01 | Feed: kartice „Za tebe”, „Novo”, „Praćeni” | P0 | P2 |
| F-02 | Pregled linka pri dijeljenju (Open Graph) + „Podijeli profil” | P0 | P6 |
| F-03 | Veličine na oglasu i filter po veličini | P0 | P4 |
| F-04 | Praćenje butika | P0 (lista „Pratim” P1) | P3 |
| F-05 | Adresa, radno vrijeme, link na mapu, oznaka „Provjeren butik” | P0 | P3 |
| F-06 | Statistika za butik | P0 (grafikon po danima P1) | P5 |
| F-07 | Sniženje: push onima koji su označili oglas + precrtana stara cijena | P0 | P4 |
| F-08 | Brza pitanja u poruci | P0 kupac, P1 butik | P5 |
| F-09 | Brojke za administratora | P0 | P5 |
| U-01 … U-18 | UX popravke iz prolaza (odjeljak 2) | P0 osim gdje piše P1 | razno |

### Konvencije (provjereno u kodu, ne mijenjati)

- Greška: HTTP kod + `{ "greska": "Tekst za korisnika." }`. Neprijavljen → 401, tuđe/zabranjeno → 403,
  nema → 404, pogrešan ulaz → 400, previše → 429. Admin rute za ne-admina vraćaju 404 `{greska:'Ne postoji.'}`.
- Omotač odgovora je bosanski (`oglasi`, `oglas`, `butik`, `korisnik`, `razgovori`, `poruke`, `svidjanja`,
  `prijave`, `nalozi`, `ukupno`), polja unutar objekata camelCase kao do sada (`shopName`, `handle`, `price`,
  `likes`, `liked`, `videoUrl`, `posterUrl`, `createdAt`). Nova polja prate isto.
- Cijena u API-ju je KM broj (`price: 89.9`), u bazi `price_cents`. Ulaz cijene ide kroz postojeći `parsePrice`.
- Idempotentne radnje šalju željeno stanje (`{liked:true}`), kao sviđanje (SKALIRANJE, ugovor 1).
- Ograničenja učestalosti preko postojećeg `limited(key, max, windowMs)` (tabela `rate_limits`).
- Keš u procesu preko `boundedSet` s TTL-om; isti obrazac kao `feedCache` (istovremeni zahtjevi čekaju isti upit).
- Linkovi koji se dijele: oglas `/?o=<id>`, butik `/?b=<handle>` (`shareListing`, start u `app.js`). Ostaju takvi.
- Sva nova polja u bazi idu u **jednu** migraciju `api/migrations/009_v1.sql` (odjeljak 4), da paralelni paketi ne
  sudaraju brojeve.
- Množina u tekstovima (pomoćna funkcija `mnozina(n, '1', '2-4', '5+')`): oblik 1 kad `n%10==1 && n%100!=11`;
  oblik 2–4 kad `n%10 ∈ {2,3,4} && n%100 ∉ {12,13,14}`; inače oblik 5+.
  Primjeri: pregled/pregleda/pregleda, sviđanje/sviđanja/sviđanja, razgovor/razgovora/razgovora,
  pratilac/pratioca/pratilaca, oglas/oglasa/oglasa.

### Budžet zahtjeva (20.000 istovremenih, klijent ≤ 0,13 zahtjeva/s po korisniku)

Sadašnji klijent u feedu (tajmeri iz `app.js`): sviđanja oglasa na ekranu 15 s (0,067), `/api/me` 60 s (0,017),
pregledi 30 s (0,033), strana feeda ~svakih 160 s (0,006), sviđanje ~1 na 80 s (0,013) ≈ **0,135/s**. Izmjereno u
SKALIRANJE: 0,13. **Nema rezerve.** Pravila za v1:

1. Nijedna nova funkcija ne dodaje tajmer. Sve nove rute se zovu samo na radnju korisnika ili otvaranje ekrana.
2. **B-01 (P0, frontend):** `refreshLikes` sa 15 s na 30 s → ~0,10/s. Rezerva ~0,03/s za radnje (praćenje,
   kartice, statistika, brza pitanja).
3. Novo stanje koje treba stalno (broj praćenih) ide u red `users` (već je u kešu prijava) — bez novog upita u `/api/me`.

## 1. Nalazi iz prolaza u pregledniku

Kupac (neprijavljen → registracija → sviđanje → poruka), butik (prijava → profil → objava → izmjena), admin.

| # | Šta se vidi | Težina |
|---|---|---|
| 1 | Profil kupca prikazuje „1 oglasa” — broj je zapravo broj sviđanja (`pCount` iz `ukupno` za `liked=1`). Kupac nema oglase. | greška |
| 2 | Link na nepostojeći butik (`/?b=nema.ga`) otvara „profil” s avatarom „B”, „0 oglasa” i dugmetom „Pošalji poruku”; ispod sitno „Ovaj butik ne postoji.” | greška |
| 3 | Obavještenje (toast) je dno ekrana, iznad menija: u feedu pokriva cijenu i „Kontaktiraj butik”, u prozoru „Novi oglas” pokriva grešku forme i kategoriju, u „Izmijeni oglas” pokriva „Prodato”. Traje 4,5 s. | visoka |
| 4 | Neprijavljen kupac dodirne srce ili „Pošalji poruku” → prebaci ga na „Prijava” (ne „Novi nalog”), a poslije prijave ostane na profilu; namjera (sviđanje, poruka) je izgubljena. | visoka (konverzija) |
| 5 | Registracija: nigdje ne piše da lozinka mora imati 8 znakova dok ne pogriješi; greška je jedna, ispod svih polja, polje nije označeno; nema „Prikaži lozinku”. | srednja |
| 6 | Nepotvrđen email saznaje tek kad pošalje poruku (greška u toastu). | srednja |
| 7 | Profil butika: forma (naziv, telefon, linkovi, odjava, lozinka, brisanje) zauzima cijeli ekran; „Moji oglasi” počinju ispod pregiba. Butik najčešće dolazi da vidi oglase i brojke, a ne da mijenja telefon. | srednja |
| 8 | Spisak razgovora prikazuje samo ime i zadnju poruku; butik ne vidi o kojem oglasu je riječ (API već vraća `listingTitle`). | srednja |
| 9 | U razgovoru su „Blokiraj” i „Prijavi” sitni podvučeni linkovi jedan do drugog (~20 px visine), blokiranje je bez potvrde. | srednja |
| 10 | Vlastiti oglas u feedu ima 5 dugmadi u koloni (srce, podijeli, zvuk, izmijeni, obriši); kolona ulazi u naslov i toast. | niska |
| 11 | „Izmijeni oglas” prikazuje cijenu „89,9” umjesto „89,90”. | niska |
| 12 | Prvi utisak: kad su oglasi tu, nema nikakvog nagovještaja da se prevlači gore (posjetilac s reklame na webu). | srednja |
| 13 | Prazna kategorija: „Butici uskoro dodaju prve snimke. Svrati opet.” — slijepa ulica, nema dugmeta nazad na sve. | niska |
| 14 | Poslije objave: „Video se još obrađuje na Bunnyju. Kupci ga već vide.” — interni naziv i suprotno odluci 4 (oglas u obradi vidi samo vlasnik). | srednja |
| 15 | Povjerenje kupca: na oglasu i profilu nema adrese radnje, radnog vremena, od kada je butik na Komodu, ni naznake da butik nije bilo ko. Profil butika se ne može podijeliti. | visoka |
| 16 | Dijeljenje oglasa šalje link bez slike i cijene (`/?o=1` vraća samo `<title>Komodo</title>`, 0 `og:` oznaka). | visoka (rast) |
| 17 | Pretraga „kaput” ne nalazi oglas u kategoriji „Jakne i kaputi” čiji naziv nema tu riječ. | niska, van v1 |
| 18 | Administracija: samo prijave i spisak naloga (max 500, bez pretrage); nema nijedne brojke. | pokriva F-09 |

## 2. UX popravke (male, važne)

| ID | Popravka | Paket |
|---|---|---|
| U-01 | Profil kupca: brojke „sviđa ti se” (`ukupno` iz `liked=1`) i „pratiš” (`me.followingCount`). Riječ „oglasa” samo za butik. | P3 |
| U-02 | Nepostojeći/ugašeni butik (`/api/shops/:handle` → 404): sakriti avatar, broj, „Pošalji poruku” i mrežu. Prikazati naslov „Ovaj butik ne postoji”, tekst „Možda je link pogrešan ili butik više nije na Komodu.” i dugme „Na početnu”. | P3 |
| U-03 | Toast ide **na vrh** (ispod sigurne zone, `top: calc(env(safe-area-inset-top) + 12px)`), iznad prozora (z-index iznad `.sheet`), 3 s (greške 5 s), dodir ga zatvara, `role="status"`. Greške forme nikad ne idu u toast nego u `.err` forme. | P6 |
| U-04 | Namjera se ne gubi. Neprijavljen dodir na srce / „Pošalji poruku” / „Prati” čuva radnju u `sessionStorage['komodo.posle']` (`{t:'like',id}`, `{t:'chat',handle,listingId}`, `{t:'follow',handle}`), otvara formu u režimu **„Novi nalog”** s naslovom prema radnji (ispod), a poslije uspješne registracije ili prijave izvršava radnju i vraća korisnika na oglas (feed s tim oglasom prvim, kao `loadFeed(true, id)`) ili otvara razgovor. Tekstovi: srce → „Napravi besplatan nalog da sačuvaš ovaj oglas.”; poruka → „Napravi besplatan nalog da pišeš butiku {Butik}.”; prati → „Napravi besplatan nalog da pratiš {Butik}.”. Kartica Poruke ostaje „Prijavi se da vidiš poruke.” u režimu „Prijava”. | P4 |
| U-05 | Registracija: ispod lozinke stalno „Najmanje 8 znakova.”; dugme „Prikaži”/„Sakrij” (44×44) u polju lozinke; greška ide ispod polja na koje se odnosi, polje dobija crveni okvir i fokus (mapiranje po tekstu greške servera nije potrebno: klijent provjerava ime ≥2, email `@`, lozinku ≥8 prije slanja s istim tekstovima kao server). Kad je email uključen, poslije registracije na vrhu profila: „Skoro gotovo! Poslali smo link na {email}. Potvrdi ga da bi mogao pisati buticima.” | P6 |
| U-06 | Razgovor kad email nije potvrđen: iznad polja za unos traka „Potvrdi email da bi poslao poruku. Link smo poslali na {email}.” + dugme „Pošalji ponovo” (`POST /api/auth/resend`); polje i „Pošalji” onemogućeni, brza pitanja sakrivena. | P5 |
| U-07 | Profil butika preuređen (raspored u F-05). Forma za izmjenu ide u prozor „Uredi profil”; nalog (lozinka, brisanje, odjava, uslovi) na dno pod naslovom „Nalog”. | P3 |
| U-08 | Spisak razgovora: ispod imena sitno „{naslov oglasa}” ako postoji `listingTitle`. | P5 |
| U-09 | Zaglavlje razgovora: umjesto dva linka jedno dugme „Više” (⋯, 44×44) → prozor: „Blokiraj {ime}” / „Odblokiraj {ime}”, „Prijavi poruku”, „Odustani”. Blokiranje traži potvrdu: naslov „Blokirati {ime}?”, tekst „Više ti neće moći pisati, a ni ti njemu. Možeš ga odblokirati kasnije.”, dugme „Blokiraj”. | P5 |
| U-10 | Vlastiti oglas u feedu: „Izmijeni” i „Obriši” zamjenjuje jedno dugme „Više” → prozor: „Izmijeni oglas”, „Označi kao prodato” / „Vrati u prodaju”, „Statistika” (otvara F-06 s tim oglasom na vrhu), „Obriši oglas” (postojeća potvrda). | P4 |
| U-11 | Cijena u formi izmjene: dvije decimale kad nije cijeli broj („89,90”). | P4 |
| U-12 | Prvi ulazak (nema `localStorage['komodo.uputa']`): preko prve kartice poluprozirna traka „Prevuci gore za sljedeći proizvod” sa strelicom; nestaje na prvo skrolanje ili poslije 4 s; postavlja oznaku. | P2 |
| U-13 | Prazna kategorija: dugme „Pogledaj sve oglase” (postavlja „Sve”). | P2 |
| U-14 | Tekstovi obrade (odluka 4): na kartici vlasnika „Obrađuje se — kupci će ga vidjeti za 1–3 minute.”; poslije objave toast „Oglas je objavljen. Kupci ga vide čim se video obradi (1–3 minute).”; greška obrade „Obrada videa nije uspjela. Obriši oglas i objavi video ponovo.” (bez riječi „Bunny”). U razvoju bez Bunnyja ostaje „Oglas je objavljen.” | P4 |
| U-15 | Admin spisak naloga: polje „Traži po imenu ili emailu” (P1, `GET /api/admin/users?q=` ≤60 znakova, ilike na `shop_name`/`email`). | P5 |
| U-16 | Broj sviđanja 0 na kartici: prikazati samo srce bez „0”. | P4 |
| U-17 | „Kontaktiraj butik”: u prozoru i adresa i status radnog vremena (F-05). | P3 |
| U-18 | Neprijavljen kupac na kartici „Praćeni”: vidi poziv na nalog (F-01), ne praznu listu. | P2 |

## 3. Funkcije

---

### F-01 Feed: „Za tebe”, „Novo”, „Praćeni” (P0)

**Zašto:** feed po redu objave daje vrh onome ko najviše objavljuje i svaki put iste snimke; dobar redoslijed drži
kupca duže i daje šansu novim oglasima.

**Priča:** Kao kupac, kad otvorim Komodo želim prvo vidjeti ono što će mi se vjerovatno svidjeti, bez ponavljanja,
a kad hoću — samo najnovije ili samo butike koje pratim.

#### Ekran

- Gornja traka feeda, red 1: znak (30 px) lijevo | kartice „Za tebe” · „Novo” · „Praćeni” (tekst, aktivna bijela
  i podvučena, ostale `--muted`, dodirna površina ≥ 44 px visine) | lupa desno. Natpis „komodo.” i „Banja Luka”
  se iz feeda uklanjaju (ostaju u OG, ikoni i praznom stanju). Red 2: kategorije kao sada (+ filter veličine, F-03).
- Početna kartica pri svakom otvaranju: „Za tebe”. Dodir na već aktivnu karticu = osvježi od početka (skrol na vrh).
- Pretraga (tekst ili cijena) i pregled jednog butika: kartice se sakrivaju, rezultat je redom „Novo” (kao sada).
- Kategorija i veličine važe u sve tri kartice.
- Kad „Za tebe” vrati `kraj: true`, klijent ubaci karticu-razdjelnik „To je sve za sada u „Za tebe”. Slijede
  najnoviji oglasi.” i nastavlja stranama „Novo” (`before=`), preskačući oglase koje je već prikazao.

Prazna stanja:
- „Za tebe” / „Novo” bez oglasa: postojeći tekstovi (+ U-13).
- „Praćeni”, neprijavljen: naslov „Prati butike koji ti se sviđaju”, tekst „Njihovi novi snimci će biti ovdje.”,
  dugme „Napravi nalog” (U-04 sa `{t:'tab',v:'praceni'}`).
- „Praćeni”, ne prati nikoga: naslov „Još ne pratiš nijedan butik”, tekst „Dodirni „Prati” pored imena butika na
  oglasu ili na njegovom profilu.”, dugme „Idi na Za tebe”.
- „Praćeni”, prati, nema oglasa: „Butici koje pratiš još nemaju oglasa.”

#### API

`GET /api/feed` — svi, prijava nije obavezna.

| Parametar | Tip | Ograničenje |
|---|---|---|
| `kartica` | `zatebe` \| `novo` \| `praceni` | zadano `zatebe`; drugo → 400 „Nepoznata kartica.” |
| `category` | string | jedna iz `CATEGORIES`, inače se ignoriše (kao `/api/listings`) |
| `sizes` | csv | ≤ 6 vrijednosti iz skupa F-03, nepoznate se ignorišu |
| `izuzmi` | csv id-jeva | samo `zatebe`; ≤ 200 (višak: zadržati **zadnjih** 200), svaki `isId` |
| `before` | id | samo `novo` i `praceni` |

Izlaz: `{ "oglasi": [ <oglas> ×≤20 ], "kraj": false }`. `<oglas>` = postojeći `publicListing` + polja iz F-03 i
F-07 (`sizes`, `oldPrice`). `kraj` samo za `zatebe`.

- `novo` = ista logika kao `GET /api/listings` (zajednička funkcija), redom `id desc`, bez oglasa u obradi
  (odluka 4; vlasnik svoje vidi).
- `praceni` bez prijave → 401 „Prijavi se da vidiš butike koje pratiš.” Upit: `l.user_id in (select shop_id from
  follows where user_id = $1)`, `order by l.id desc limit 20`, `before`. Ide mimo keša.
- `GET /api/listings` ostaje za pretragu, profil, „Sviđa mi se” i stare klijente; dobija samo `sizes` (F-03).

#### Algoritam „Za tebe”

**1. `base_score` (pozadinski posao, samo proces s `KOMODO_JOBS`, svakih 5 min, i jednom pri startu).**

Jedna naredba nad oglasima zadnjih 30 dana i onima koji još imaju `base_score > 0`:

```
r_avg    = prosjek r_sirovo za oglase iz zadnjih 30 dana s views ≥ 20; ako takvih nema → 0,05
r_sirovo = (likes_count + 3·kontakti) / views
kontakti = broj redova u listing_contacts za oglas (F-06)

r        = (likes_count + 3·kontakti + 20·r_avg) / (views + 20)        -- izglađeno prema prosjeku
kvalitet = clamp(r / r_avg, 0,5, 3)                                    -- nov oglas bez pregleda = 1
svjezina = 0,5 ^ (starost_sati / 72)
pravila  = (sold ? 0,3 : 1) · (butik.created_at > now() − 14 dana ? 1,2 : 1)

base_score = svjezina · kvalitet · pravila
base_score = 0 ako: deleted_at nije null, video_status ≠ 'ready', butik ugašen, starost > 30 dana,
             ili sold i sold_at < now() − 3 dana
```

Odstupanje od analize, namjerno: analiza traži `(sviđanja + 3·razgovori + 1)/(pregledi + 20)` ograničeno na 0,5–3,
ali uz realnih 5–10% sviđanja po pregledu taj broj je skoro uvijek < 0,5, pa bi kvalitet bio isti za sve.
Dijeljenje s prosjekom (`r_avg`) daje isto „ublaženo” ponašanje, a stvarno razlikuje oglase.

Upit ide preko `listings_fresh_idx` (created_at). Procjena: ≤ 10.000 redova, < 200 ms, jednom u 5 min.

**2. Kandidati (keš u procesu, zajednički za sve korisnike).** Ključ = `{category, sizes (sortirano)}`, TTL 60 s,
najviše 100 ključeva (`boundedSet`), istovremeni zahtjevi čekaju isti upit.

- `C` = do 200 oglasa: `LISTING_SELECT` bez `liked/mine` (+ `l.user_id`, `l.base_score`), `base_score > 0`,
  filteri, `order by base_score desc limit 200` (indeksi `listings_score_idx`, `listings_cat_score_idx`).
- `D` (otkrivanje) = do 100 oglasa: `created_at > now() − 72 h`, `views < 50`, `video_status='ready'`,
  filteri, `order by id desc limit 100`.

**3. Lični faktori — jedan upit po zahtjevu** (`$1` korisnik, `$2` gledalac `u<id>` ili `d<did>`, `$3` id-jevi C∪D):

```sql
select
  (select coalesce(json_object_agg(category, n), '{}') from (
     select l.category, count(*) n from likes k join listings l on l.id = k.listing_id
      where k.user_id = $1 and k.created_at > now() - interval '60 days' group by l.category) x) as kat,
  (select coalesce(array_agg(shop_id), '{}') from follows where user_id = $1)                as prati,
  (select coalesce(array_agg(blocked_id), '{}') from blocks where blocker_id = $1)          as blok,
  (select coalesce(array_agg(distinct listing_id), '{}') from listing_views
    where listing_id = any($3) and viewer = $2 and day >= current_date - 7)                 as gledano,
  (select coalesce(array_agg(listing_id), '{}') from likes
    where user_id = $1 and listing_id = any($3))                                             as svidja
```

`gledano` koristi primarni ključ `listing_views(listing_id, viewer, day)` — ≤ 300 sondi. Neprijavljen: `$1 = 0`,
`$2 = 'd'+did` ako kolačić `did` postoji (ruta ga ne pravi), inače se upit preskače (sve prazno).

**4. Ocjena u memoriji** za svaki c ∈ C, osim izuzetih (`izuzmi`), vlastitih (`c.user_id = korisnik`) i blokiranih butika:

```
ukupno = zbir kat
udio   = kat[c.category] / ukupno          (ako ukupno < 3 → lično = 1)
licno  = 0,7 + 0,6 · udio
licno  = licno · 1,3 ako c.user_id ∈ prati
pravilo= 0,2 ako c.id ∈ gledano, inače 1
ocjena = c.base_score · licno · pravilo
```

**5. Slaganje strane od 20** (`n0` = broj id-jeva u `izuzmi`; prozor raznolikosti počinje zadnjim ≤ 3 id-jeva iz
`izuzmi`, ako su u C∪D):

```
za k = 0..19, pozicija p = n0 + k:
  ako p % 5 == 4 → probaj otkrivanje: prvi d ∈ D (redom) koji nije izuzet, nije gledan, nije na strani,
                   nije vlastit/blokiran i prolazi pravila raznolikosti
  inače / ako nema → najbolji preostali c po ocjeni koji prolazi pravila raznolikosti
  ako ništa ne prolazi → najbolji preostali bez pravila raznolikosti
  ako ništa ne preostaje → kraj = true, prekini
pravila raznolikosti: butik kandidata nije među zadnja 3 postavljena (najviše 1 od 4 uzastopna);
                      ne bi bila 3. ista kategorija zaredom
```

**6. Izlaz.** `liked` iz `svidja`, `mine` = vlastit (uvijek false jer su izuzeti). Bez dodatnog upita.

**Straničenje bez ponavljanja.** Klijent šalje `izuzmi` = id-jeve koje je prikazao u ovoj kartici, redom, najviše
zadnjih 200 (URL ≤ ~2 KB, ispod Nginx granice od 8 KB). Starije koje ispadnu iz `izuzmi` do tada su poslane kao
pregledi (svakih 30 s), pa dobijaju ×0,2. Klijent dodatno filtrira duplikate po id-ju. Osvježavanje (ponovni dodir
kartice, povratak u aplikaciju poslije > 30 min) briše `izuzmi`.

**Butik u feedu:** ne vidi svoje oglase u „Za tebe” (vidi ih u „Novo” i na profilu).

#### Baza

`listings.base_score`, `sold_at`, indeksi `listings_score_idx`, `listings_cat_score_idx`, `listings_fresh_idx`,
tabele `follows`, `listing_contacts` (odjeljak 4). `PATCH /api/listings/:id` postavlja `sold_at`:
`case when $sold and not sold then now() when not $sold then null else sold_at end`.

#### Performanse

- Učestalost: strana na ~20 videa ≈ 1 na 160 s po korisniku → 20.000 korisnika ≈ 125 zahtjeva/s (kao sada).
- Po zahtjevu: keš C/D (pogodak ≥ 99%; promašaj ≈ 2 upita po ključu po procesu po minuti) + 1 lični upit
  (~1–3 ms) + slaganje ≤ 300 stavki u memoriji (< 1 ms). `praceni`: 1 upit.
- Memorija: 200 + 100 redova × ~600 B ≈ 180 KB po ključu, ≤ 100 ključeva ≈ ≤ 18 MB po procesu.
- Za QA: isti test opterećenja kao SKALIRANJE (feed preko `/api/feed?kartica=zatebe`), p95 < 300 ms.

#### Kriteriji prihvatanja

1. Butik objavi 10 oglasa zaredom → u prvih 20 „Za tebe” nema 2 oglasa tog butika na udaljenosti < 4.
2. Nema 3 ista kategorija zaredom kad postoje bar 2 kategorije među kandidatima.
3. 5 strana zaredom (`izuzmi` raste) → nijedan id se ne ponavlja; poslije C∪D slijedi `kraj: true`.
4. Pozicije 5, 10, 15… (p%5==4) su iz D kad D ima neizuzet oglas.
5. Kupac s ≥ 3 sviđanja samo „Haljine”: udio haljina u prvih 20 veći nego kod neprijavljenog (ista baza).
6. Oglas pregledan (red u `listing_views` za tog gledaoca, danas) rangira se niže nego isti oglas bez pregleda.
7. Prodat oglas star 4 dana od `sold_at` nije u „Za tebe”, jeste u „Novo” s oznakom „Prodato”.
8. Oglas u obradi nije ni u jednoj kartici za druge; vlasnik ga vidi u „Novo”.
9. `praceni` bez prijave → 401 s tekstom iz specifikacije; s praćenjem vraća samo oglase praćenih, `id desc`.
10. `izuzmi` sa 250 id-jeva → 200 OK (uzeto zadnjih 200); `kartica=x` → 400.
11. Posao `base_score` poslije brisanja oglasa ili gašenja butika postavlja 0 u roku od 5 min.

---

### F-02 Pregled linka pri dijeljenju (P0)

**Zašto:** link na Viberu/WhatsAppu sa slikom, nazivom i cijenom je glavni besplatni kanal rasta; sada je prazan.

**Priča:** Kao kupac koji pošalje oglas drugarici, želim da ona u Viberu vidi sliku, naziv i cijenu prije nego
otvori link. Kao butik, želim podijeliti svoj Komodo profil na Instagramu.

#### Server

Botovi (Viber, WhatsApp, Facebook, Instagram, Telegram) ne izvršavaju JS: oznake moraju biti u HTML-u koji vraća
`GET /` (i `/index.html`) za `?o=<id>` i `?b=<handle>`. Linkovi ostaju isti (već podijeljeni rade).

- `web/index.html`: odmah iza `<meta charset>` oznaka `<!--OG-->`; server je zamjenjuje, a `<title>` mijenja na
  `og:title`. Bez parametara: zadane oznake.
- Vrijednosti se escape-uju (`& < > " '`). Sve URL adrese apsolutne, na osnovu `APP_URL` (u produkciji `https://komodo.ba`).

| | Oglas `/?o=ID` | Butik `/?b=handle` | Zadano |
|---|---|---|---|
| `og:title` | `{naslov} · {cijena} KM` (≤ 70 zn.) | `{Butik} na Komodu` | `Komodo — video oglasi butika iz Banje Luke` |
| `og:description` | `{Butik} · {adresa ili grad}. Pogledaj video na Komodu.` | `{N} {oglas/a} · {adresa ili grad}. Pogledaj snimke proizvoda.` | `Snimi i prodaj. Video oglasi butika iz tvog grada.` |
| `og:image` | `posterUrl` (Bunny `thumbnail.jpg`) | `posterUrl` najnovijeg spremnog oglasa | `{APP_URL}/og-komodo.png` (1200×630, frontend pravi) |
| `og:url` | `{APP_URL}/?o={id}` | `{APP_URL}/?b={handle}` | `{APP_URL}/` |

Uvijek i: `og:type=website`, `og:site_name=Komodo`, `og:locale=bs_BA`, `twitter:card=summary_large_image`.
Oglas s aktivnim sniženjem (F-07): `og:title` = `{naslov} · {nova} KM (bilo {stara} KM)`.
Prodat oglas: `og:title` = `{naslov} · Prodato`.

Bez slike (oglas nije na Bunnyju — razvoj): `{APP_URL}/ikona-1024.png`. Oglas obrisan, u obradi, u grešci, butik
ugašen ili nepostojeći: zadane oznake, kod 200 (aplikacija sama javlja „Taj oglas više ne postoji.”).

Upit: jedan (`LISTING_SELECT ... and l.id = $2` s `$1 = 0`; za butik `/api/shops` upit + 1 red). Keš gotovog HTML-a
po ključu `o:<id>` / `b:<handle>`, 60 s, ≤ 5.000 ključeva. `Cache-Control: no-cache` ostaje.

Napomene za DevOps: Nginx ne smije keširati `/` bez `$args` u ključu. Bunny CDN mora dozvoliti zahtjeve bez
`Referer` (zaštita od hotlinka isključena za `thumbnail.jpg`), inače botovi ne dobiju sliku.

#### Aplikacija

- „Podijeli profil” (novo) na javnom profilu butika (ispod „Pošalji poruku”, sekundarno dugme) i na vlastitom
  profilu butika (F-05 raspored). Link `{origin}/?b={handle}`, tekst `{Butik} na Komodu — pogledaj naše proizvode
  na videu`. Isti tok kao `shareListing` (aplikacija → `toApp share`, web → `navigator.share`, inače kopiranje
  i toast „Link profila je kopiran.”).
- Dijeljenje oglasa ostaje; tekst: `{naslov} · {cijena} · {Butik}`.

#### Performanse

Bot zahtjevi su zanemarljivi; ljudi koji otvaraju link dobijaju index s 1 keširanim upitom. Bez uticaja na budžet.

#### Kriteriji prihvatanja

1. `curl -A "WhatsApp/2.23" '{APP}/?o=1'` → u `<head>` prije 2 KB: `og:title` = „Crna saten haljina, M · 89,90 KM”,
   `og:image` apsolutan `https://…/thumbnail.jpg`, `og:url`.
2. Isto za `?b=moda.bojana`; za `?o=999999` i `?b=nema` zadane oznake i kod 200.
3. Naslov s `"<>&` je ispravno escape-ovan (validator: HTML ispravan).
4. Facebook Sharing Debugger i Viber (stvarni telefon, faza 4) prikazuju sliku, naslov i opis.
5. Sličica s Bunnyja ≤ 300 KB (WhatsApp ograničenje); ako je veća — zapisati za DevOps (Bunny Optimizer).
6. „Podijeli profil” radi u aplikaciji i u pregledniku.

---

### F-03 Veličine (P0)

**Zašto:** prvo pitanje u skoro svakoj poruci je „imate li M?”.

**Priča:** Kao kupac želim odmah vidjeti dostupne veličine i gledati samo ono što mi odgovara. Kao butik želim
jednim dodirom označiti veličine koje imam.

#### Skup vrijednosti

| Kategorija | Ponuđeno |
|---|---|
| Haljine, Jakne i kaputi, Majice i košulje, Pantalone, Ostalo | `XS S M L XL XXL` + `UNI` |
| Obuća | `35 … 46` (12 vrijednosti) |
| Torbe, Nakit | samo `UNI` (birač se ne prikazuje; server upisuje `['UNI']`) |

`UNI` se prikazuje kao „Jedna veličina”. Redoslijed u bazi i prikazu = redoslijed iz tabele.

#### Ekrani

- „Novi oglas” i „Izmijeni oglas”: ispod kategorije „Veličine (izaberi sve koje imaš)” — dugmad-prekidači
  (≥ 44×44, `aria-pressed`), mijenjaju se s kategorijom. Promjena kategorije briše izbor koji ne pripada novom skupu.
  Klijent prije slanja: bez izbora → „Izaberi bar jednu veličinu.”
- Kartica u feedu: ispod cijene red „Vel. S · M · L” (ili „Br. 38 · 39”, ili „Jedna veličina”); više od 6 → prvih 5 i „+N”.
- Profil butika (mreža): bez veličina.
- Filter: u pretrazi novi red „Veličina” sa dva reda prekidača (odjeća; obuća) + „Poništi veličine”. Izbor se pamti
  u `localStorage['komodo.velicine']` (moje veličine) i važi u feedu, kategorijama i pretrazi dok se ne poništi.
  Kad je filter aktivan, na početku reda kategorija tablet „Veličine: M, L ✕” (dodir na ✕ briše filter); na lupi tačka.
- Kad je izabrana kategorija Torbe ili Nakit, filter veličine se ne šalje.
- Prazno stanje s filterom: „Nema oglasa u tvojoj veličini” / „Probaj bez filtera veličine.” / dugme „Poništi veličine”.

#### API

- `POST /api/listings` (multipart): novo polje `sizes` = csv string („S,M,L”). Izostavljeno → `[]` (stari klijent);
  poslano prazno za kategoriju koja traži izbor → 400 „Izaberi bar jednu veličinu.”; vrijednost van skupa
  kategorije → 400 „Veličina nije ispravna za ovu kategoriju.”; > 12 vrijednosti → ista greška.
- `PATCH /api/listings/:id` (JSON): `sizes: string[]`, ista pravila; izostavljeno → ostaje staro.
- `<oglas>` dobija `sizes: ["S","M"]` (uvijek niz).
- `GET /api/listings` i `GET /api/feed`: `sizes=M,L` → `l.sizes && $n::text[]`, ≤ 6 vrijednosti, nepoznate ignorisane.
  Ide u ključ keša feeda (`norm.v`). Oglasi bez veličina ne prolaze filter.

#### Baza

`listings.sizes text[] not null default '{}'`, GIN indeks `listings_sizes_idx` (parcijalni, `deleted_at is null`).

#### Performanse

Bez novih zahtjeva. Filter mijenja samo ključ keša (ključeva više, ali ograničeno na `FEED_CACHE_MAX`).

#### Kriteriji prihvatanja

1. Objava „Haljine” sa S,M → `sizes: ["S","M"]`; „Obuća” s `M` → 400; „Torbe” bez polja → `["UNI"]`.
2. `?sizes=M` vraća samo oglase koji imaju M; `?sizes=M,38` vraća unije; `?sizes=ABC` = bez filtera.
3. Filter preživi zatvaranje i ponovno otvaranje aplikacije; „Poništi veličine” ga briše.
4. Promjena kategorije u formi s Haljine na Obuća briše S/M izbor.
5. Svi prekidači ≥ 44×44 na 390 px širine; red obuće skroluje vodoravno bez preklapanja.

---

### F-04 Praćenje butika (P0; lista „Pratim” P1)

**Zašto:** razlog za povratak (kartica „Praćeni”) i publika koju butik gradi.

**Priča:** Kao kupac želim jednim dodirom pratiti butik i vidjeti njegove nove snimke na jednom mjestu.

#### Ekrani

- Kartica u feedu: pored imena butika tablet „Prati” (ispunjen akcentom) / „Pratiš” (obrub). Ne prikazuje se na
  vlastitim oglasima. Dodir mijenja odmah (optimistično), vraća stanje na grešku + toast.
- Javni profil butika: ispod imena brojke „{N} oglasa · {N} pratilaca”; dugmad redom: „Prati”/„Pratiš” (glavno),
  „Pošalji poruku”, „Podijeli profil”.
- Otpraćivanje: dodir na „Pratiš” odmah otprati (bez potvrde), toast „Više ne pratiš {Butik}.”; praćenje: toast
  „Pratiš {Butik}. Novi snimci su u kartici Praćeni.” (samo prvi put po uređaju; kasnije bez toasta).
- Neprijavljen: U-04.
- P1: profil kupca, druga kartica „Pratim” — spisak butika (ime, grad/adresa, broj oglasa, dugme „Pratiš”).
  Prazno: „Još ne pratiš nijedan butik.”

#### API

`POST /api/shops/:handle/follow` — prijavljen (kupac ili butik).
- Ulaz `{ "following": true|false }`; drugi tip → 400 „Polje following mora biti true ili false.”; bez tijela → 400.
- Izlaz `{ "following": true, "followers": 57 }`.
- Greške: 401 „Prijavi se da pratiš butik.”; 404 „Ovaj butik ne postoji.” (nije butik, ugašen); 400 „Ne možeš
  pratiti svoj butik.”; 400 „Možeš pratiti najviše 500 butika.”; 429 „Previše zahtjeva. Sačekaj minut.”
  (`follow:<userId>` 60/min).
- Jedna naredba po obrascu `LIKE_SQL`: upis/brisanje u `follows`, `users.followers_count` butika i
  `users.following_count` korisnika mijenjaju se samo za stvarno promijenjen red. `forgetUser(user.id)`.

`GET /api/me/follows` — prijavljen. Izlaz `{ "butici": [ { "handle", "shopName", "city", "address", "listings" } ] }`,
≤ 500, `order by f.created_at desc`. Klijent ga zove **jednom** poslije prijave / pri startu kad je prijavljen i
drži skup `handle` u memoriji za stanje „Prati/Pratiš” na karticama (bez polja u svakom odgovoru feeda);
mijenja ga lokalno poslije `follow`.

`GET /api/shops/:handle`: `butik` dobija `followers` (broj), `following` (bool; false za neprijavljenog).
`GET /api/me`: `korisnik.followingCount` (iz reda `users`, bez upita).

Brisanje naloga (`POST /api/me/delete`): u istoj transakciji kao sviđanja umanjiti `followers_count` butika koje je
korisnik pratio (zaključavanje redova po id-ju, kao za `listings`).

#### Baza

Tabela `follows`, `users.followers_count`, `users.following_count`, indeks `follows_shop_idx`.

#### Performanse

Samo na radnju. `GET /api/me/follows` jednom po otvaranju aplikacije (< 0,001/s po korisniku).

#### Kriteriji prihvatanja

1. 1.000 istovremenih `follow {following:true}` različitih kupaca → `followers_count` = broj redova = 1.000.
2. Isti kupac 50× istovremeno `true` → 1 red, svi odgovori `following:true`.
3. Pratim → kartica „Praćeni” prikazuje oglase butika; otpratim → nestaju na sljedećem učitavanju.
4. Brisanje naloga kupca umanjuje `followers_count` svih butika koje je pratio.
5. Neprijavljen dodir na „Prati” → registracija → butik je praćen i korisnik je na istom oglasu (U-04).

---

### F-05 Adresa, radno vrijeme, mapa, „Provjeren butik” (P0)

**Zašto:** mnogi kupci će radije otići u radnju; adresa i radno vrijeme grade povjerenje.

**Priča:** Kao kupac želim vidjeti gdje je butik, radi li sada i otvoriti mapu jednim dodirom.

#### Ekrani

**Javni profil butika** (odozgo):
```
[M]  Moda Bojana   ✓ Provjeren butik
     @moda.bojana · na Komodu od novembra 2026.
     12 oglasa · 57 pratilaca
     Kralja Petra I 12, Banja Luka            [Otvori na mapi]
     Otvoreno do 20:00   (dodir: puno radno vrijeme)
[ Prati ] [ Pošalji poruku ] [ Podijeli profil ]
Pozovi / Viber poruka / linkovi (kao sada)
mreža oglasa
```
- „Provjeren butik” — mala oznaka; dodir: toast „Butike na Komodu otvara naš tim nakon provjere radnje.”
  (zavisi od odgovora Stefana, odjeljak 7; ako je „ne”, oznaka se ne prikazuje).
- „na Komodu od {mjesec godina}.” iz `since` (`users.created_at`), mjeseci u genitivu: januara, februara, marta,
  aprila, maja, juna, jula, augusta, septembra, oktobra, novembra, decembra.
- Bez adrese: red se ne prikazuje. Bez radnog vremena: red se ne prikazuje.
- Status (računa klijent u zoni `Europe/Sarajevo`, `Intl.DateTimeFormat`): otvoreno → „Otvoreno do {do}”
  (zeleno); zatvoreno a danas još otvara → „Zatvoreno · otvara u {od}”; inače → „Zatvoreno · otvara {sutra | u
  ponedjeljak/utorak/srijedu/četvrtak/petak/subotu/nedjelju} u {od}”. Puno radno vrijeme (proširenje na dodir):
  „Pon–pet 09:00–20:00 · Subota 09:00–15:00 · Nedjelja ne radi”.
- „Otvori na mapi”: `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(adresa + ', ' + grad)`,
  `target="_blank" rel="noopener"` (u aplikaciji se otvara vani, postojeći mehanizam).

**„Kontaktiraj butik”** (U-17): ispod „Pošalji poruku” red „Adresa · {adresa}” (link na mapu) i status radnog vremena.

**Vlastiti profil butika** (U-07):
```
[M] Moda Bojana ✓  @moda.bojana · Banja Luka
    12 oglasa · 340 sviđanja · 57 pratilaca
[ Statistika ] [ Uredi profil ] [ Podijeli profil ]
Moji oglasi (mreža, „Učitaj još”)
— Nalog —  Obavještenja (aplikacija) · Promijeni lozinku · Obriši nalog · Odjavi se · Uslovi · Privatnost
```
Profil kupca isto bez „Statistika/Uredi”, brojke „sviđa ti se” i „pratiš” (U-01), naslov mreže „Sviđa mi se”.

**„Uredi profil”** (prozor): Naziv butika · Telefon ili Viber · Adresa („npr. Kralja Petra I 12”, ≤ 120) ·
Radno vrijeme: tri reda „Radnim danima”, „Subota”, „Nedjelja”, svaki: prekidač „Radi” + dva polja `type="time"`
(od, do); isključen prekidač = „ne radi” · Linkovi · dugmad „Odustani” / „Sačuvaj”. Pomoćni tekst ispod adrese:
„Adresa radnje u Banjoj Luci. Kupci je vide na profilu i otvaraju na mapi.” Potvrda: toast „Profil je sačuvan.”

#### API

`PATCH /api/me` (samo butik; kupcu se polja ignorišu):
- `address`: string, `clean(…, 120)`; prazno dozvoljeno (briše).
- `hours`: `null` (briše) ili `{ "rd": ["09:00","20:00"] | null, "sub": […] | null, "ned": […] | null }`.
  Vrijeme `^([01]\d|2[0-3]):[0-5]\d$`, `od < do` (bez rada preko ponoći). Greška 400:
  „Radno vrijeme upiši kao 09:00–20:00, a zatvaranje mora biti poslije otvaranja.”
- `korisnik` (publicUser) dobija `address`, `hours`, `followingCount`.

`GET /api/shops/:handle` → `butik`: postojeća polja + `address`, `hours`, `followers`, `following`,
`since` (ISO), `verified` (true za svaki butik; vidi odjeljak 7), `posterUrl` (najnoviji spremni oglas, za F-02;
klijent ga ne mora koristiti).

#### Baza

`users.address text not null default ''`, `users.hours jsonb` (null = nije upisano).

#### Kriteriji prihvatanja

1. Butik upiše adresu i radno vrijeme → javni profil i „Kontaktiraj butik” ih prikazuju; „Otvori na mapi” otvara
   Google Maps s adresom.
2. U 19:59 po Sarajevu uz „rd 09:00–20:00” → „Otvoreno do 20:00”; u 20:00 → „Zatvoreno · otvara sutra u 09:00”
   (pon–čet); u petak 20:00 uz subotu „ne radi” → „… otvara u ponedjeljak u 09:00”. Test s lažnim satom.
3. `hours.rd = ["20:00","09:00"]` → 400 s tekstom iz specifikacije; `"9:00"` → 400.
4. Profil butika na 390×844: „Moji oglasi” počinju iznad pregiba (prvi red mreže vidljiv bez skrolanja).
5. Kupac na svom profilu ne vidi riječ „oglasa” (U-01).

---

### F-06 Statistika za butik (P0; grafikon po danima P1)

**Zašto:** dokaz da Komodo donosi kupce — preduslov da butik ostane i kasnije plati.

**Priča:** Kao butik želim vidjeti koliko ljudi je gledalo, označilo i pisalo za svaki oglas u zadnjih 7 ili 30 dana.

#### Ekran „Statistika” (iz profila butika ili „Više → Statistika” na oglasu)

```
‹ Profil          Statistika
[ 7 dana | 30 dana ]
Pregledi 1.240   Sviđanja 86   Razgovori 14   Novi pratioci 9
(P1: stupci pregleda po danu)
Oglasi (najviše gledani prvo)
[sličica] Crna saten haljina, M · 89,90 KM
          312 pregleda · 21 sviđanje · 4 razgovora
...
Pregled = jedan kupac pogledao oglas tog dana. Razgovor = kupac ti je pisao iz tog oglasa.
Brojke se osvježavaju svakih 5 minuta.
```
- Otvoreno iz „Više → Statistika” na oglasu: taj oglas je prvi u listi i istaknut.
- Učitavanje: „Učitavam statistiku…”. Greška: tekst greške + „Pokušaj ponovo”.
- Prazno (sve nule): „Još nema podataka za ovaj period. Brojke rastu kad kupci gledaju tvoje snimke.”
- Brojevi s tačkom za hiljade (`1.240`). Bez tajmera; osvježava se samo promjenom perioda ili ponovnim otvaranjem.

#### API

`GET /api/me/stats?period=7|30` (zadano 7; drugo → 400 „Period može biti 7 ili 30 dana.”)
- 401 „Prijavi se.”; 403 „Statistika je dostupna samo butiku.”
- Izlaz:
```json
{ "statistika": {
    "period": 7, "od": "2026-11-13", "do": "2026-11-19",
    "ukupno": { "views": 1240, "likes": 86, "contacts": 14, "newFollowers": 9, "followers": 57 },
    "dani": [ { "day": "2026-11-13", "views": 150 } ],
    "oglasi": [ { "id": 1, "title": "…", "price": 89.9, "posterUrl": "…", "videoUrl": "…", "sold": false,
                  "createdAt": "…", "views": 312, "likes": 21, "contacts": 4, "viewsAll": 900, "likesAll": 40 } ]
} }
```
- Definicije (period = `day > current_date - period`, tj. uključuje danas):
  `views` = redovi u `listing_views` (jedan gledalac, jedan oglas, jedan dan); `likes` = redovi u `likes` s
  `created_at` u periodu (povučena sviđanja se ne broje); `contacts` = redovi u `listing_contacts` u periodu;
  `newFollowers` = `follows` s `created_at` u periodu; `viewsAll`/`likesAll` = `listings.views`/`likes_count`.
- `oglasi`: neobrisani oglasi butika, `order by views desc, id desc`, ≤ 500. `dani`: tačno `period` stavki (nule uključene).
- Upit: CTE `my` (id-jevi butika) + agregati po `listing_id = any(my)` iz `listing_views` (PK), `likes`
  (`likes_listing_idx`), `listing_contacts` (PK) — jedan poziv baze.
- Keš u procesu po `(shopId, period)` 5 min, ≤ 2.000 ključeva.

`listing_contacts` se puni u `POST /api/conversations/:id/messages`: kad pošiljalac je kupac razgovora i
`conv.listing_id` nije null → `insert into listing_contacts(listing_id, customer_id) values ($1,$2) on conflict do nothing`.
(Ne pri otvaranju razgovora — otvaranje bez poruke nije kontakt.)

Napomena za DevOps: vremenska zona baze `Europe/Sarajevo` (`alter database … set timezone`), da `current_date`
u `listing_views.day` i statistici bude lokalni dan.

#### Performanse

Zove se samo otvaranjem ekrana (butika ima 100–200) → zanemarljivo. Najteži dio: `listing_views` za 500 oglasa ×
30 dana — indeks po `listing_id`, keš 5 min.

#### Kriteriji prihvatanja

1. Kupac A pogleda oglas 3 puta danas, kupac B jednom → `views` = 2; sutra A ponovo → 3 za period 7.
2. Kupac otvori razgovor iz oglasa bez poruke → `contacts` 0; pošalje poruku → 1; još 5 poruka → i dalje 1.
3. Kupac kao `listing_views` od prije 8 dana: u periodu 7 nije, u 30 jeste.
4. Kupac → 403; ne-prijavljen → 401; `period=14` → 400.
5. Zbir `oglasi[].views` = `ukupno.views`; `dani` ima 7 odnosno 30 stavki.

---

### F-07 Obavještenje o sniženju (P0)

**Zašto:** sniženje oglasa koji je kupac već označio je najjači okidač za kupovinu.

**Priča:** Kao kupac želim dobiti obavještenje kad butik spusti cijenu nečega što mi se svidjelo. Kao butik želim
da sniženje vide oni koje zanima.

#### Pravila

- Okidač: `PATCH /api/listings/:id` gdje je nova cijena ≤ 95% stare (najmanje 5% niže), oglas nije prodat,
  video je `ready`, butik nije ugašen.
- Pri takvom sniženju: `old_price_cents = stara cijena` (ako već postoji aktivno sniženje mlađe od 7 dana, zadržati
  veću od postojeće i stare), `price_dropped_at = now()`. Povećanje cijene iznad `old_price_cents` ili
  `price_dropped_at` starije od 7 dana → precrtana cijena se ne prikazuje (`oldPrice: null`).
- Primaoci: korisnici s redom u `likes` za oglas, `push_enabled`, nisu ugašeni, nisu u `blocks` s butikom (bilo koji
  smjer), nisu sam butik. **Najviše jedan push po kupcu po oglasu u 24 h** — atomski:
  ```sql
  with t as (update likes set price_notified_at = now()
              where listing_id = $1 and (price_notified_at is null or price_notified_at < now() - interval '1 day')
              returning user_id)
  select p.token from push_tokens p join users u on u.id = p.user_id join t on t.user_id = u.id
   where u.push_enabled and u.suspended_at is null
     and not exists (select 1 from blocks b where (b.blocker_id = u.id and b.blocked_id = $2)
                                             or (b.blocker_id = $2 and b.blocked_id = u.id))
  ```
- Slanje u pozadini (odgovor butiku ne čeka), Expo po 100 poruka po zahtjevu, redom, timeout 10 s, brisanje
  `DeviceNotRegistered` kao u `pushNewMessage`.
- Push: `title` „Sniženje: {naslov}” (naslov skraćen na 50 zn.), `body` „{Butik}: {stara} → {nova}” (npr.
  „Moda Bojana: 89,90 KM → 69,90 KM”), `data: { listingId }`, `channelId: 'snizenja'`.
  Zavisnost od Mobilnog: Android kanal „Sniženja” i dodir na push sa `listingId` → `window.__komodoOpenListing(id)`
  (web: `loadFeed(true, id)` u kartici „Novo”). Dok mobilni dio nije spreman: `channelId: 'poruke'`.
- Prekidač u profilu (aplikacija) mijenja tekst: „Obavještenja o porukama i sniženjima”; potvrde: „Obavještenja su
  uključena.” / „Obavještenja su isključena.” Jedan prekidač (`pushEnabled`) za oba.

#### Ekrani

- Kartica i mreža: kad je `oldPrice` → `<s>89,90 KM</s> 69,90 KM` i oznaka „Sniženo” (akcent), stara cijena `--muted`.
- „Izmijeni oglas”: kad nova cijena ispunjava uslov, ispod polja cijene tekst „Kupci koji su označili ovaj oglas
  ({N}) dobiće obavještenje o sniženju.” (N = `likes` oglasa; za 0 se ne prikazuje). Poslije čuvanja toast
  „Oglas je izmijenjen. Obavijestili smo kupce o sniženju.”

#### API

- `<oglas>` dobija `oldPrice` (KM broj ili `null`).
- `PATCH /api/listings/:id` odgovor ostaje `{ oglas }` + `obavijesteno: true|false` (da li je okinuto slanje).
- Bez nove rute.

#### Baza

`listings.old_price_cents`, `listings.price_dropped_at`, `likes.price_notified_at`.

#### Kriteriji prihvatanja

1. 89,90 → 69,90: kupci sa sviđanjem i tokenom dobiju 1 push (lažni Expo server u testu); `oldPrice` = 89,9.
2. Odmah zatim 69,90 → 59,90: niko ne dobija drugi push (24 h); `oldPrice` ostaje 89,9.
3. 89,90 → 87,90 (2%) → nema pusha ni precrtane cijene.
4. Kupac s `pushEnabled:false`, ugašen ili blokiran/blokirao butik → ne dobija.
5. 2.500 sviđanja → 25 zahtjeva Expo-u, odgovor na PATCH < 300 ms (slanje u pozadini).
6. Povećanje na 99,00 → `oldPrice: null`.

---

### F-08 Brza pitanja u poruci (P0 kupac, P1 butik)

**Zašto:** manje kucanja → više poruka butiku.

**Priča:** Kao kupac želim jednim dodirom pitati ono što svi pitaju.

#### Ekran

- U razgovoru, iznad polja za unos, vodoravni red tableta (visina 36, dodirna površina 44), vidljiv dok je polje
  prazno, razgovor nije blokiran i email je potvrđen.
- Kupac: „Je li još dostupno?” · „Imate li u veličini …?” · „Može li dostava i koliko košta?” · „Mogu li doći da probam?”
  Ako oglas razgovora ima veličine (`oglas.sizes` — dodati u odgovor poruka, vidi API), drugi tablet je po jedan za
  svaku veličinu do 6: „Imate li {M}?” → tekst „Imate li ovo u veličini M?”
- Dodir upisuje tekst u polje i stavlja fokus (ne šalje). „Imate li u veličini …?” upisuje „Imate li ovo u veličini ”
  s kursorom na kraju.
- P1, butik: „Da, dostupno je.” · „Nažalost, prodato je.” · „Dostava je moguća. Pošaljite adresu i broj telefona.” ·
  „Izvolite u radnju, tu smo.”

#### API

Bez nove rute. `GET /api/conversations/:id/messages` → `oglas` dobija `sizes` (iz istog upita oglasa).

#### Kriteriji prihvatanja

1. Dodir na „Je li još dostupno?” upiše tekst, „Pošalji” ga šalje, red tableta nestaje dok polje nije prazno.
2. Razgovor o oglasu s `["S","M"]` prikazuje „Imate li S?” i „Imate li M?”.
3. Blokiran razgovor i nepotvrđen email: red se ne prikazuje.

---

### F-09 Brojke za administratora (P0)

**Zašto:** bez brojki se ne zna raste li Komodo i rade li reklame.

**Priča:** Kao vlasnik želim na jednom ekranu vidjeti aktivne ljude, registracije, oglase i poruke po danu.

#### Ekran (vrh administracije, iznad „Prijave”)

```
Brojke (osvježava se svakih 15 minuta, zadnje u 14:45)
Aktivni danas 1.204 (juče 980)   Registracije 87 (juče 40)
Novi oglasi 31 (juče 25)         Poruke 412 (juče 380)
Tabela, 30 dana: Dan | Aktivni | Registracije | Oglasi | Poruke
Ukupno: 10.400 korisnika · 150 butika · 3.020 aktivnih oglasa
Aktivni = različiti ljudi i uređaji koji su pogledali bar jedan oglas tog dana.
```

#### API

`GET /api/admin/stats` (admin; inače 404 „Ne postoji.”):
```json
{ "brojke": {
    "azurirano": "2026-11-19T13:45:00Z",
    "ukupno": { "users": 10400, "shops": 150, "listings": 3020 },
    "dani": [ { "day": "2026-11-19", "active": 1204, "activeUsers": 700, "activeDevices": 504,
                "registrations": 87, "shops": 1, "listings": 31, "messages": 412, "conversations": 60 } ]
} }
```
`dani`: 30 stavki, najnoviji prvi, dani bez reda = nule. Čita samo `daily_stats` + 3 brojanja za `ukupno`
(keš 60 s).

Pozadinski posao (`KOMODO_JOBS`) svakih 15 min računa `current_date` i `current_date - 1` i radi
`insert … on conflict (day) do update`:
- `active_users` / `active_devices` = `count(distinct viewer)` iz `listing_views where day = $d` s `viewer like 'u%'`
  / `'d%'`; `active` = zbir (isti čovjek prije i poslije prijave se broji dvaput — prihvaćeno, zapisano u tekstu).
- `registrations` = `users` kupci s `created_at` tog dana; `shops` = butici tog dana; `listings` = `listings`
  `created_at` tog dana (i kasnije obrisani); `messages` = `messages`; `conversations` = `conversations`.
- BRIN indeksi na `created_at` (`messages`, `listings`, `conversations`, `users`).

`listing_views` se briše poslije 30 dana; `daily_stats` ostaje zauvijek.

#### Kriteriji prihvatanja

1. Poslije registracije 3 kupca i 2 oglasa i ručnog pokretanja posla → današnji red: `registrations` 3, `listings` 2.
2. Ne-admin → 404. Odgovor < 50 ms.
3. Posao nad 1.000.000 redova `listing_views` za dan traje < 5 s (QA mjeri na `komodo_load`).

## 4. Migracija `api/migrations/009_v1.sql`

Jedan fajl, pravi ga paket P1.

```sql
-- v1: algoritam feeda, veličine, sniženja, praćenje, adresa i radno vrijeme, statistika, brojke.

-- Oglasi
alter table listings add column sizes text[] not null default '{}';
alter table listings add column sold_at timestamptz;
update listings set sold_at = now() where sold;
alter table listings add column old_price_cents integer check (old_price_cents > 0);
alter table listings add column price_dropped_at timestamptz;
alter table listings add column base_score real not null default 0;

create index listings_score_idx on listings(base_score desc)
  where deleted_at is null and base_score > 0;
create index listings_cat_score_idx on listings(category, base_score desc)
  where deleted_at is null and base_score > 0;
create index listings_fresh_idx on listings(created_at desc) where deleted_at is null;
create index listings_sizes_idx on listings using gin (sizes) where deleted_at is null;

-- Sniženje: zadnji push o sniženju za ovo sviđanje
alter table likes add column price_notified_at timestamptz;

-- Butik: adresa, radno vrijeme, brojači praćenja
alter table users add column address text not null default '';
alter table users add column hours jsonb;
alter table users add column followers_count integer not null default 0;
alter table users add column following_count integer not null default 0;

create table follows (
  user_id    integer not null references users(id) on delete cascade,
  shop_id    integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id),
  check (user_id <> shop_id)
);
create index follows_shop_idx on follows(shop_id, created_at);

-- Kupac je pisao butiku iz ovog oglasa (statistika i kvalitet u algoritmu)
create table listing_contacts (
  listing_id  integer not null references listings(id) on delete cascade,
  customer_id integer not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (listing_id, customer_id)
);

-- Brojke po danu za administraciju
create table daily_stats (
  day            date primary key,
  active         integer not null default 0,
  active_users   integer not null default 0,
  active_devices integer not null default 0,
  registrations  integer not null default 0,
  shops          integer not null default 0,
  listings       integer not null default 0,
  messages       integer not null default 0,
  conversations  integer not null default 0,
  updated_at     timestamptz not null default now()
);

create index messages_created_brin on messages using brin (created_at);
create index listings_created_brin on listings using brin (created_at);
create index conversations_created_brin on conversations using brin (created_at);
create index users_created_brin on users using brin (created_at);
```

Paket P1 u istom koraku: `LISTING_SELECT`/`publicListing` dobijaju `sizes`, `oldPrice`; `publicUser` dobija
`address`, `hours`, `followingCount`; `/api/shops/:handle` nova polja (F-04, F-05). Time svi ostali paketi rade na
istom obliku podataka.

## 5. Paketi za fazu 2

Pravilo iz plana: dva paketa u istom talasu ne diraju isti fajl. Nazivi modula zavise od podjele koju radi arhitekt;
ovdje su navedene rute i dijelovi ekrana — arhitekt ih mapira na fajlove prije početka talasa.

| Talas | Paket | Funkcije | Backend (rute, poslovi) | Frontend (ekrani) | Zavisi od |
|---|---|---|---|---|---|
| 1 | **P1 Šema** | temelj | `009_v1.sql`; `LISTING_SELECT`, `publicListing`, `publicUser`, `GET /api/shops/:handle` (nova polja) | — | — |
| 2 | **P2 Feed** | F-01, U-12, U-13, U-18, B-01 | `GET /api/feed`, posao `base_score`, keš kandidata, `sold_at` u `PATCH /api/listings/:id` (samo ta linija) | gornja traka feeda (kartice), učitavanje feeda (`loadFeed`, `izuzmi`, razdjelnik), prazna stanja feeda, uputa za prevlačenje, `refreshLikes` 30 s | P1 |
| 2 | **P3 Butik** | F-04, F-05, U-01, U-02, U-07, U-17 | `POST /api/shops/:handle/follow`, `GET /api/me/follows`, `PATCH /api/me` (adresa, sati), brisanje naloga (brojači) | javni profil butika, vlastiti profil (raspored, „Uredi profil”), prozor „Kontaktiraj butik”, skup praćenih u klijentu | P1 |
| 3 | **P4 Oglas** | F-03, F-07, U-04, U-10, U-11, U-14, U-16 | `POST`/`PATCH /api/listings` (veličine, sniženje, push), filter `sizes` u `/api/listings` i `/api/feed` | kartica oglasa (`cardHTML`: veličine, stara cijena, „Prati”, „Više”), forme objave i izmjene, filter veličine u pretrazi, rukovanje dodirima u feedu (U-04) | P1, P2 (feed ruta), P3 (follow ruta) |
| 3 | **P5 Poruke, statistika, admin** | F-06, F-08, F-09, U-06, U-08, U-09, U-15 | `GET /api/me/stats`, upis `listing_contacts` u slanju poruke, `sizes` u odgovoru poruka, `GET /api/admin/stats` + posao `daily_stats`, `?q=` u admin nalozima | ekran statistike (ulaz iz profila — dugme već postavlja P3), razgovor (brza pitanja, traka potvrde, „Više”), spisak razgovora, administracija | P1, P3 (profil) |
| 4 (ili uz 2/3 ako ima ljudi) | **P6 Dijeljenje i opšte** | F-02, U-03, U-05 | `GET /` s OG oznakama, keš HTML-a | `<!--OG-->` u `index.html`, `og-komodo.png`, „Podijeli profil” (dugme koje je P3 ostavio bez radnje), toast, forma registracije | P1; P3 za dugme |

Mobilni (paralelno s talasom 3): Android kanal „Sniženja”, dodir na push s `listingId` → `__komodoOpenListing(id)`.
QA: za svaki paket testovi iz „Kriteriji prihvatanja”; poslije talasa 3 test opterećenja s `/api/feed`.
DevOps: vremenska zona baze, Nginx keš `/` s `$args`, Bunny bez zaštite od hotlinka za sličice.

## 6. Namjerno van v1

Plaćanje, dostava, recenzije, više gradova, AI, WebSocket (plan, odjeljak 3). Takođe: logo butika (nema otpremanja
slika), push pratiocima za novi oglas (rizik od spama), brojčane veličine odjeće (34–48), pretraga po nazivu
kategorije (nalaz 17), sistemska poruka s karticom oglasa u razgovoru.

## 7. Odluke koje je Stefan potvrdio

1. **Oznaka „Provjeren butik”** (19.11.2026.): ostaje. Stefan lično sa svakim butikom otvara nalog, pa je oznaka
   istinita za sve butike i ne treba poseban prekidač u administraciji.

## 8. Napomena direktora: sličice za pregled linka

Na Bunnyju je uključeno „Block direct url file access” i Stefan je odlučio da se ne isključuje. Zato `og:image` ne
smije pokazivati direktno na Bunny: server služi sličicu sa svoje adrese (`/og/:id.jpg` — preuzme `thumbnail.jpg`
s Bunnyja sa serverske strane, čuva je na disku i kešira), a za lokalni snimak u obradi koristi zajedničku
`og-komodo.png`. Stavka „Bunny bez zaštite od hotlinka” iz odjeljka 5 se ne radi.
