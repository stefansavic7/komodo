# Komodo u Google Play i App Store

Sve što prodavnice traže, u redu kojim se popunjava. Tekstovi su spremni za kopiranje, a ograničenja
dužine su provjerena (broj znakova je u zagradi).

## 1. Prije prijave

- [ ] Server radi na `https://komodo.ba` (vidi `docs/SERVER.md`).
- [ ] `https://komodo.ba/uslovi.html`, `/privatnost.html` i `/brisanje-naloga.html` imaju upisane podatke
      firme i kontakt email (sada su na tim mjestima `[upisati …]`).
- [ ] SMTP radi: nova lozinka i potvrda emaila stižu na pravi email.
- [ ] Dva probna naloga za recenzente (tačka 6), s nekoliko pravih oglasa u feedu.
- [ ] Logo: `mobile/assets/ikona.png` (1024 × 1024), isti kao `web/ikona.svg`.

## 2. Gradnja aplikacije (EAS, isti nalog kao za Terminko)

U folderu `mobile`, jednom:

```powershell
npx eas-cli login
npx eas-cli init
```

`init` napravi projekat „komodo” i upiše `extra.eas.projectId` u `app.json`. Bez toga push obavještenja ne rade.

**Android push:** u Firebase konzoli (može isti Firebase projekat kao Terminko) dodaj Android aplikaciju
`ba.komodo.app`, preuzmi `google-services.json` u folder `mobile`, u `app.json` pod `android` dodaj
`"googleServicesFile": "./google-services.json"`, a FCM V1 ključ (service account) dodaj kroz
`npx eas-cli credentials` → Android → Push Notifications. Postupak je isti kao za Terminko.

**iOS push:** `npx eas-cli build -p ios` sam ponudi da napravi APNs ključ. Prihvati.

Gradnja za prodavnice:

```powershell
npx eas-cli build -p android --profile production
npx eas-cli build -p ios --profile production
```

## 3. Google Play

| Polje | Vrijednost |
|---|---|
| Naziv aplikacije | Komodo: video oglasi butika (27) |
| Paket | ba.komodo.app |
| Kategorija | Kupovina (Shopping) |
| Oznake | Moda, Odjeća |
| Email za kontakt | [upisati] |
| Politika privatnosti | https://komodo.ba/privatnost.html |
| Brisanje naloga (web link) | https://komodo.ba/brisanje-naloga.html |
| Cijena | Besplatno, bez kupovina u aplikaciji, bez reklama |

**Kratki opis** (74):

> Gledaj video oglase butika iz svog grada i piši im direktno iz aplikacije.

**Puni opis:**

> Komodo je izlog svih butika u gradu, u videu.
>
> Umjesto slika i dugih opisa, butici snimaju kratke videe svojih komada: haljina, jakni, patika, torbi i nakita. Ti listaš, vidiš kako komad izgleda uživo i odmah znaš cijenu.
>
> ŠTA MOŽEŠ U KOMODU
> • Listati video oglase butika iz Banje Luke, po kategorijama
> • Tražiti po nazivu, butiku i cijeni
> • Sačuvati ono što ti se sviđa i naći ga kasnije na profilu
> • Pisati butiku direktno iz aplikacije i dobiti obavještenje kad odgovori
> • Pozvati butik, pisati mu na Viber ili otvoriti njegov Instagram, Facebook ili TikTok
> • Podijeliti oglas s prijateljicom jednim dodirom
>
> ZA BUTIKE
> Nalog butika otvaramo mi. Butik snimi video telefonom, upiše naziv i cijenu, i oglas je u feedu. Na profilu vidi koliko je ljudi pogledalo i označilo svaki oglas, a kupci mu pišu na jednom mjestu.
>
> SIGURNOST
> Svaki oglas i poruku možeš prijaviti, a sagovornika blokirati. Prijave pregledamo u roku od 24 sata.
>
> Komodo ne prodaje robu i ne naplaćuje kupovinu. Kupovinu, plaćanje i dostavu dogovaraš direktno s butikom.

**Sigurnost podataka (Data safety):**

| Podatak | Prikuplja se | Dijeli se | Svrha | Obavezno |
|---|---|---|---|---|
| Ime | Da | Ne | Funkcionalnost, upravljanje nalogom | Da |
| Email | Da | Ne | Upravljanje nalogom, komunikacija | Da |
| Telefon | Da, samo butici | Ne (javan na profilu butika, butik ga sam upiše) | Funkcionalnost | Ne |
| Poruke u aplikaciji | Da | Ne | Funkcionalnost | Ne |
| Videi | Da, samo butici | Ne | Funkcionalnost | Ne |
| Interakcije (sviđanja, pregledi) | Da | Ne | Funkcionalnost, analitika aplikacije | Ne |
| ID uređaja (push token) | Da | Ne | Funkcionalnost (obavještenja) | Ne |

- Podaci se šifruju u prenosu: **Da** (HTTPS).
- Korisnik može tražiti brisanje podataka: **Da** (u aplikaciji i na web linku).
- Pružaoci usluga (server, Bunny, email, Expo push) ne računaju se kao „dijeljenje” jer obrađuju podatke za nas.

**Ocjena sadržaja (upitnik):** korisnici razmjenjuju poruke i objavljuju sadržaj; postoji prijava i
blokiranje; nema nasilja, kockanja ni sadržaja za odrasle. Očekivana ocjena: 12+ / PEGI 12, zbog
komunikacije među korisnicima.

**Ciljna publika:** 16 godina i više (isto kao u uslovima korištenja). Aplikacija nije namijenjena djeci.

## 4. App Store

| Polje | Vrijednost |
|---|---|
| Naziv | Komodo (6) |
| Podnaslov | Video oglasi butika (19) |
| Bundle ID | ba.komodo.app |
| Primarna kategorija | Shopping |
| Sekundarna kategorija | Lifestyle |
| URL politike privatnosti | https://komodo.ba/privatnost.html |
| URL podrške | https://komodo.ba |
| Cijena | Besplatno |

**Ključne riječi** (najviše 100 znakova, bez razmaka iza zareza):

> butik,moda,odjeća,haljine,obuća,torbe,nakit,oglasi,video,kupovina,Banja Luka,garderoba,shop

**Promotivni tekst** (116):

> Svi butici iz grada na jednom mjestu, u videu. Listaj, sačuvaj šta ti se sviđa i piši butiku direktno iz aplikacije.

**Opis:** isti kao puni opis za Google Play.

**Privatnost aplikacije (App Privacy):** podaci se koriste za funkcionalnost aplikacije, povezani su s
korisnikom i ne koriste se za praćenje (tracking). Kategorije: Contact Info (ime, email, telefon butika),
User Content (poruke, videi), Identifiers (push token), Usage Data (sviđanja, pregledi).

**Starosna ocjena:** odgovori kao za Google Play. Kod pitanja o korisničkom sadržaju označi da postoji
prijava sadržaja, blokiranje i moderacija. Apple to provjerava kod aplikacija u kojima korisnici objavljuju
sadržaj ili si pišu.

## 5. Slike ekrana

Potrebno: Android telefon (najmanje 2), iPhone 6,9" (1320 × 2868) i 6,5" (1284 × 2778). Predlog pet slika,
svaka s kratkim natpisom na vrhu:

1. Feed s videom haljine: „Svi butici iz grada, u videu”
2. Kategorije i pretraga: „Nađi komad po kategoriji i cijeni”
3. Profil butika s kontaktima: „Pozovi, piši na Viber ili Instagram”
4. Razgovor s butikom: „Piši butiku direktno iz aplikacije”
5. Lista „Sviđa mi se”: „Sačuvaj šta ti se sviđa”

Snimci u feedu moraju biti pravi oglasi butika s kojima imamo dogovor, ne tuđi sadržaj.

## 6. Napomena za recenzente (oba)

> Komodo is a video marketplace for local fashion boutiques in Banja Luka, Bosnia and Herzegovina. The app is in Bosnian.
>
> Customer account: [email] / [lozinka]
> Boutique account: [email] / [lozinka]
>
> Customers can browse videos, like listings and message boutiques. Boutique accounts are created by us; with the boutique account you can post a video (Objavi), edit or delete it.
>
> Every listing and conversation has a Report button (Prijavi) and conversations can be blocked (Blokiraj). Reports are reviewed within 24 hours in our admin panel. Accounts can be deleted in Profil → Obriši nalog.

Napomena je na engleskom jer je recenzenti čitaju na engleskom.
