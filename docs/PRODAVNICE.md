# Komodo u Google Play i App Store

Sve što prodavnice traže, u redu kojim se popunjava. Tekstovi su spremni za kopiranje, a ograničenja
dužine su provjerena (broj znakova je u zagradi). Izvori za EAS komande su navedeni uz svaku komandu.

Stanje 19.11.2026: omotač je spreman za gradnju (konfiguracija i JS bundle prolaze), **nije isproban na
telefonu**. Odjeljak 11 je obavezna proba na uređaju prije predaje.

## 1. Checklist za predaju

**Prije gradnje**
- [ ] Server radi na `https://komodo.ba` (vidi `docs/SERVER.md`).
- [ ] `https://komodo.ba/uslovi.html`, `/privatnost.html` i `/brisanje-naloga.html` imaju upisane podatke
      firme i kontakt email (sada su na tim mjestima `[upisati …]`).
- [ ] SMTP radi: nova lozinka i potvrda emaila stižu na pravi email.
- [ ] `/.well-known/apple-app-site-association` i `/.well-known/assetlinks.json` se služe (odjeljak 8).
- [ ] Probni nalozi za recenzente i nekoliko pravih oglasa u feedu (odjeljak 7).
- [ ] `eas init` urađen, Firebase i FCM ključ podešeni (odjeljak 2).

**Grafika (sve je u `mobile/assets/`, nastalo iz `web/ikona.svg`)**
- [x] Ikona aplikacije `ikona.png` 1024 × 1024, RGB bez providnosti (Apple odbija ikonu s alfa kanalom).
- [x] Android adaptivna ikona `ikona-android.png` (etiketa u sigurnoj zoni, pozadina `#16121a`).
- [x] Splash `splash.png` (etiketa bez pozadine, pozadina `#16121a`, širina 200).
- [x] Ikona obavještenja `obavjestenje.png` 96 × 96, bijela silueta na providnom (Android je boji u `#ff6a4d`).
- [ ] Google Play: ikona 512 × 512 PNG (umanjena `ikona.png`) i naslovna grafika 1024 × 500 (feature graphic).
- [ ] Slike ekrana (odjeljak 6).

**Prodavnice**
- [ ] Opis, ključne riječi, kategorija (odjeljci 3 i 4).
- [ ] Ocjena sadržaja / starosna ocjena (odjeljak 5).
- [ ] Data safety / App Privacy (odjeljak 5).
- [ ] Brisanje naloga: u aplikaciji (Profil → Obriši nalog) i web link `https://komodo.ba/brisanje-naloga.html`.
- [ ] Napomena za recenzente s probnim nalozima (odjeljak 7).

## 2. Gradnja i predaja (EAS, isti Expo nalog kao za Terminko)

Komande se kucaju u folderu `mobile`. `npx eas-cli <komanda>` je isto što i `eas <komanda>` iz Expo
dokumentacije, samo bez globalne instalacije.

**Jednom, na početku**

```powershell
npx eas-cli login
npx eas-cli init
```

`init` napravi projekat „komodo” i upiše `extra.eas.projectId` u `app.json` — bez toga push ne radi
(token se traži s `projectId`). Commitovati izmijenjeni `app.json`.

**Android push (FCM V1).** U Firebase konzoli (može isti projekat kao Terminko) dodaj Android aplikaciju
`ba.komodo.app`, preuzmi `google-services.json` u folder `mobile` (nikad se ne commituje — u `.gitignore`
je), u `app.json` pod `android` dodaj `"googleServicesFile": "./google-services.json"`, a FCM V1 ključ
(service account JSON) postavi kroz `npx eas-cli credentials` → Android → production → Push Notifications.
Izvor: https://docs.expo.dev/push-notifications/fcm-credentials/

**iOS push.** Prvi `npx eas-cli build -p ios` sam ponudi da napravi APNs ključ. Prihvati.

**Verzije.** `eas.json` koristi `"appVersionSource": "remote"` i `"autoIncrement": true` za production.
Broj gradnje (`ios.buildNumber`, `android.versionCode`) tada vodi EAS: vrijednosti `1` u `app.json` služe
samo kao početna, poslije se zanemaruju. Ručno se mijenja samo `version` (1.0.0 → 1.0.1 …) pred svaku
novu verziju u prodavnici. Izvor: https://docs.expo.dev/build-reference/app-versions/

**Proba prije prodavnica** (APK koji se instalira direktno na Android telefon; `preview` gađa `https://komodo.ba`):

```powershell
npx eas-cli build -p android --profile preview
```

**Gradnja za prodavnice**

```powershell
npx eas-cli build -p android --profile production
npx eas-cli build -p ios --profile production
```

Production za Android daje `.aab` (Google Play ne prima `.apk`). Izvor:
https://docs.expo.dev/submit/android/ i https://docs.expo.dev/tutorial/eas/ios-production-build/

**Predaja**

Google Play — prije prve predaje: aplikacija napravljena u Play Console („Create app”) i Google Service
Account ključ dodijeljen aplikaciji (`npx eas-cli credentials --platform android` → production → Google
Service Account → „Set up a Google Service Account Key for Play Store Submissions”). Uputstvo za ključ:
https://expo.fyi/creating-google-service-account

```powershell
npx eas-cli submit -p android
```

`eas.json` šalje na **internal** stazu kao **draft**: izdanje se završava ručno u Play Console. Izvor:
https://docs.expo.dev/submit/android/ i https://docs.expo.dev/submit/eas-json/

App Store — aplikacija se pravi u App Store Connect (bundle `ba.komodo.app`), pa:

```powershell
npx eas-cli submit -p ios
```

Komanda traži prijavu na Apple nalog i šalje gradnju u TestFlight. U App Store Connect se zatim popune
podaci, izabere gradnja i klikne „Submit to App Review”. Izvor: https://docs.expo.dev/tutorial/eas/ios-production-build/

Napomena za Google Play: novi **lični** nalozi programera moraju prije produkcije imati zatvoreno testiranje
(12 testera, 14 dana). Ako je Terminko nalog firme ili stariji nalog, to ne važi — provjeriti u Play Console.

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

Jezik liste: bosanski kao glavni ako ga Play Console nudi; inače hrvatski ili srpski (latinica) s istim
tekstom, plus engleski (en-US) prijevod ispod.

**Kratki opis** (74):

> Gledaj video oglase butika iz svog grada i piši im direktno iz aplikacije.

**Kratki opis, engleski** (68):

> Watch video listings from local boutiques and message them directly.

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

**Puni opis, engleski:**

> Komodo is the shop window of every boutique in town, on video.
>
> Instead of photos and long descriptions, boutiques record short videos of their pieces: dresses, jackets, sneakers, bags and jewelry. You scroll, see how a piece really looks and know the price right away.
>
> WHAT YOU CAN DO
> • Browse video listings from boutiques in Banja Luka, by category
> • Search by name, boutique and price
> • Save what you like and find it later on your profile
> • Message a boutique right in the app and get notified when it replies
> • Call a boutique, message it on Viber or open its Instagram, Facebook or TikTok
> • Share a listing with a friend in one tap
>
> FOR BOUTIQUES
> Boutique accounts are opened by us. A boutique records a video with its phone, adds a name and price, and the listing is in the feed. It sees how many people viewed and liked each listing, and all customer messages are in one place.
>
> SAFETY
> Every listing and message can be reported, and any user can be blocked. Reports are reviewed within 24 hours.
>
> Komodo does not sell goods or take payments. You arrange purchase, payment and delivery directly with the boutique.

## 4. App Store

| Polje | Vrijednost |
|---|---|
| Naziv | Komodo (6) |
| Podnaslov | Video oglasi butika (19) · engleski: Boutique video listings (23) |
| Bundle ID | ba.komodo.app |
| Primarna kategorija | Shopping |
| Sekundarna kategorija | Lifestyle |
| URL politike privatnosti | https://komodo.ba/privatnost.html |
| URL podrške | https://komodo.ba |
| Cijena | Besplatno |
| iPad | Ne (`supportsTablet: false`); Apple ipak može probati na iPadu u iPhone načinu — proći jednom na iPadu ili simulatoru |

Jezik: App Store Connect ima ograničen spisak jezika; ako bosanski nije ponuđen, glavni jezik je hrvatski
(tekst ostaje bosanski), a engleski (U.K. ili U.S.) dodatni.

**Ključne riječi** (najviše 100 znakova, bez razmaka iza zareza) (91):

> butik,moda,odjeća,haljine,obuća,torbe,nakit,oglasi,video,kupovina,Banja Luka,garderoba,shop

**Ključne riječi, engleski** (96):

> boutique,fashion,clothes,dresses,shoes,bags,jewelry,video,shopping,Banja Luka,local shops,outfit

**Promotivni tekst** (116):

> Svi butici iz grada na jednom mjestu, u videu. Listaj, sačuvaj šta ti se sviđa i piši butiku direktno iz aplikacije.

**Promotivni tekst, engleski** (119):

> All the boutiques in town in one place, on video. Scroll, save what you like and message the boutique right in the app.

**Opis:** isti kao puni opis za Google Play (bosanski i engleski).

## 5. Privatnost i ocjena sadržaja

Popisano prema onome što API stvarno čuva (`api/migrations`, `api/src/server.js`, stanje c2cf623):

| Podatak | Gdje | Ko | Svrha |
|---|---|---|---|
| Email, lozinka (hash) | `users` | svi | nalog, prijava, potvrda emaila, nova lozinka |
| Ime / naziv butika | `users.shop_name` | svi | prikaz u porukama i na profilu |
| Telefon, Viber, linkovi (Instagram, Facebook, TikTok, sajt) | `users.phone`, `users.links` | samo butici, sami upisuju, javno na profilu | kontakt s kupcima |
| Videi, naziv, cijena, kategorija oglasa | `listings`, Bunny Stream | samo butici | funkcionalnost |
| Poruke | `messages`, `conversations` | svi | razgovor kupac–butik |
| Sviđanja, prijave, blokiranja | `likes`, `reports`, `blocks` | svi | funkcionalnost, moderacija |
| Pregledi oglasa | `listing_views` (prijavljeni: korisnik; ostali: kolačić `did`) | svi | broj pregleda za butik |
| ID uređaja `did` (nasumičan kolačić) | kolačić, `rate_limits` | svi | brojanje pregleda, zaštita od masovne registracije |
| Expo push token | `push_tokens`, vezan za sesiju | ko dozvoli obavještenja | obavještenja o porukama |
| IP adresa | `rate_limits` (briše se poslije 2 h), zapisi servera | svi | sigurnost (ograničenje pokušaja) |

Nema reklama, nema analitike trećih strana, nema praćenja među aplikacijama, nema lokacije.
Omotač (`mobile/`) sam ništa ne šalje osim Expo push tokena web aplikaciji.

**Google Play — Data safety**

| Kategorija u formularu | Prikuplja se | Dijeli se | Svrha | Obavezno |
|---|---|---|---|---|
| Personal info → Name | Da | Ne | App functionality, Account management | Da |
| Personal info → Email address | Da | Ne | Account management, Developer communications | Da |
| Personal info → Phone number | Da (samo butici) | Ne | App functionality | Ne |
| Messages → Other in-app messages | Da | Ne | App functionality | Ne |
| Photos and videos → Videos | Da (samo butici) | Ne | App functionality | Ne |
| App activity → App interactions (sviđanja, pregledi) | Da | Ne | App functionality, Analytics | Ne |
| App activity → Other user-generated content (prijave) | Da | Ne | App functionality, Fraud prevention/security | Ne |
| Device or other IDs (push token, `did`) | Da | Ne | App functionality, Fraud prevention/security | Ne |

- Podaci se šifruju u prenosu: **Da** (HTTPS).
- Korisnik može tražiti brisanje: **Da** — u aplikaciji (Profil → Obriši nalog, odmah i trajno) i na
  `https://komodo.ba/brisanje-naloga.html`.
- Pružaoci usluga (Hetzner, Bunny, email servis, Expo push, Apple/Google push) obrađuju podatke za nas i ne
  računaju se kao „dijeljenje”.
- Telefon i linkovi butika su javni na profilu butika — to je svrha polja, butik ih upisuje sam.

**App Store — App Privacy**

„Data Used to Track You”: **ništa**. „Data Linked to You” (sve za App Functionality, bez praćenja):

- Contact Info: Name, Email Address, Phone Number (samo butici)
- User Content: Photos or Videos (videi butika), Emails or Text Messages (poruke u aplikaciji), Other User Content (prijave)
- Identifiers: User ID (nalog), Device ID (push token, kolačić `did`)
- Usage Data: Product Interaction (sviđanja, pregledi)

**Ocjena sadržaja (Google Play, IARC upitnik):** korisnici razmjenjuju poruke i objavljuju sadržaj; postoji
prijava i blokiranje; nema nasilja, kockanja ni sadržaja za odrasle; nema kupovine u aplikaciji.
Očekivano: 12+ / PEGI 12 zbog komunikacije među korisnicima.

**Starosna ocjena (App Store):** isti odgovori; „User-Generated Content” i „Messaging” = Da, uz prijavu,
blokiranje i moderaciju. Uslovi korištenja traže najmanje 16 godina — ako upitnik ponudi 16+, uzeti to.

**Ciljna publika (Google Play):** 16 godina i više. Aplikacija nije namijenjena djeci.

**Apple, sadržaj korisnika (1.2):** ispunjeno — prihvatanje uslova pri registraciji (`index.html`: „Pravljenjem
naloga prihvataš Uslove…”), prijava oglasa i poruke, blokiranje, pregled prijava u 24 h, kontakt u uslovima.
**Brisanje naloga (5.1.1(v)):** ispunjeno u aplikaciji.

## 6. Slike ekrana

| Prodavnica | Šta | Veličina |
|---|---|---|
| App Store | iPhone 6,9" (obavezno) | 1320 × 2868 (ili 1290 × 2796), uspravno, 3–10 slika |
| App Store | iPhone 6,5" (samo ako 6,9" nije dato) | 1284 × 2778 |
| Google Play | telefon | najmanje 2, 9:16, npr. 1080 × 1920; strana između 320 i 3840 px |
| Google Play | naslovna grafika | 1024 × 500 |

Tačne zahtjeve provjeriti u konzoli pri učitavanju (mijenjaju se). Snimati na pravom telefonu iz
production/preview gradnje, s pravim oglasima. Predlog pet slika, svaka s kratkim natpisom na vrhu:

1. Feed s videom haljine: „Svi butici iz grada, u videu” / „Every boutique in town, on video”
2. Kategorije i pretraga: „Nađi komad po kategoriji i cijeni” / „Find a piece by category and price”
3. Profil butika s kontaktima: „Pozovi, piši na Viber ili Instagram” / „Call, Viber or Instagram”
4. Razgovor s butikom: „Piši butiku direktno iz aplikacije” / „Message the boutique in the app”
5. Lista „Sviđa mi se”: „Sačuvaj šta ti se sviđa” / „Save what you like”

Snimci u feedu moraju biti pravi oglasi butika s kojima imamo dogovor, ne tuđi sadržaj.

## 7. Napomena za recenzente (oba) i probni nalozi

Prije predaje napraviti dva naloga na produkcionom serveru (lozinke ne u repozitorij, samo u formularu prodavnice):

- kupac: `recenzija.kupac@komodo.ba` (napravi se kroz aplikaciju, potvrditi email);
- butik: `recenzija.butik@komodo.ba` (`api/src/novi-butik.js`, uputstvo u `docs/SERVER.md`), s 3–5 oglasa i
  jednim razgovorom s kupcem, da recenzent odmah vidi poruke.

Nalozi moraju raditi cijelo vrijeme recenzije (ne gasiti, ne mijenjati lozinke).

> Komodo is a video marketplace for local fashion boutiques in Banja Luka, Bosnia and Herzegovina. The app is in Bosnian.
>
> Customer account: [email] / [password]
> Boutique account: [email] / [password]
>
> Customers browse boutique videos, like listings and message boutiques. Boutique accounts are created by us; with the boutique account you can post a video (Objavi) recorded with the camera or picked from the library, edit it or delete it.
>
> Native features: push notifications for new messages (tapping one opens the conversation), the system share sheet for listings (Podijeli), camera and photo library for posting videos, deep links (komodo:// and https://komodo.ba links open the right listing, boutique or chat), phone/Viber/Instagram links open the corresponding apps, a native offline screen, and the Android back button.
>
> Every listing and conversation has a Report button (Prijavi) and conversations can be blocked (Blokiraj). Reports are reviewed within 24 hours in our admin panel. Accounts can be deleted in Profil → Obriši nalog.

Napomena je na engleskom jer je recenzenti čitaju na engleskom.

## 8. Linkovi u aplikaciju (deep link, universal links, app links)

Šta omotač prihvata (`mobile/App.js`, `toAppUrl`):

| Link | Otvara |
|---|---|
| `komodo://o/123` | `https://komodo.ba/?o=123` (oglas) |
| `komodo://b/ime-butika` | `/?b=ime-butika` (profil butika) |
| `komodo://poruke/45` | `/?poruke=45` (razgovor) |
| `komodo:///?…` ili `komodo://putanja?…` | ista putanja i upit na `https://komodo.ba` |
| `https://komodo.ba/?…` (universal/app link) | ta adresa unutar aplikacije |
| `https://komodo.ba/api/auth/…` (potvrda emaila) | unutar aplikacije |

U aplikaciju vode samo putanja `/` (sa svim upitima: `?o=`, `?b=`, `?poruke=`, `?lozinka=`) i
`/api/auth/…`. Stranice `*.html` (uslovi, privatnost, brisanje naloga) i `/media/` ostaju u pregledniku —
omotač ih i sam otvara u pregledniku, pa ne smiju biti universal link (inače bi se vrtile u krug).

`app.json`: `ios.associatedDomains = ["applinks:komodo.ba"]`, `android.intentFilters` s `autoVerify` za
`https://komodo.ba` putanju `/` i prefiks `/api/auth/`. Dok fajlovi ispod ne postoje, linkovi se otvaraju u
pregledniku — gradnja i recenzija ne zavise od njih. Ako sajt bude i na `www.komodo.ba`, dodati i taj host
(i u `app.json` i fajlove na tom hostu).

**Fajlovi za server (frontend ih stavlja u `web/.well-known/`, devops ih služi):**

`https://komodo.ba/.well-known/apple-app-site-association` (bez ekstenzije):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<APPLE_TEAM_ID>.ba.komodo.app"],
        "components": [
          { "/": "/", "comment": "feed, oglas ?o=, butik ?b=, razgovor ?poruke=, nova lozinka ?lozinka=" },
          { "/": "/api/auth/*", "comment": "potvrda emaila" }
        ]
      }
    ]
  }
}
```

`https://komodo.ba/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "ba.komodo.app",
      "sha256_cert_fingerprints": ["<SHA256 EAS ključa>", "<SHA256 ključa iz Play Console → App signing>"]
    }
  }
]
```

- `<APPLE_TEAM_ID>`: developer.apple.com → Membership (Stefan).
- SHA256: `npx eas-cli credentials -p android` → production → „SHA256 Fingerprint”, i drugi iz Play Console →
  Release → Setup → App signing (Google ponovo potpisuje aplikaciju, pa trebaju oba).
- Oba fajla: HTTPS, **bez preusmjerenja**, `Content-Type: application/json`, javno (bez kolačića i prijave).
  U Nginxu poseban `location ^~ /.well-known/` s `default_type application/json` (AASA nema ekstenziju).
- Apple fajl čita pri instalaciji i nadogradnji; izmjena putanja kasnije traži novu verziju aplikacije.

Izvor: https://docs.expo.dev/linking/ios-universal-links/ i https://docs.expo.dev/linking/android-app-links/

## 9. Ugovor omotač ↔ web

Postojeći kanal: omotač → web kroz `injectJavaScript`, web → omotač kroz `toApp(msg)`
(`window.ReactNativeWebView.postMessage(JSON.stringify(msg))`).

**Omotač postavlja prije učitavanja svake stranice:**

```js
window.KOMODO_APP = { platform: 'ios' | 'android', version: '1.0.0', build: '7' }
```

U pregledniku `window.KOMODO_APP` ne postoji. User-Agent u aplikaciji završava s `Komodo/<verzija> (<platforma>)`
(korisno u zapisima servera).

**Omotač poziva (ako postoje):**

| Funkcija | Kada |
|---|---|
| `window.__komodoPush(token)` | dobijen Expo push token (postoji) |
| `window.__komodoOpenChat(id)` | dodir na obavještenje dok aplikacija radi (postoji) |
| `window.__komodoBack()` | Android dugme Nazad (postoji) |
| `window.__komodoOpenUrl(path)` | **novo, nije obavezno**: link `komodo://` ili `https://komodo.ba/…` dok aplikacija radi; `path` je npr. `/?o=123`. Ako funkcije nema, omotač radi `location.href = …` (puno učitavanje). |

**Web šalje (`toApp`):**

| Poruka | Značenje | Stanje |
|---|---|---|
| `{type:'ready', loggedIn: bool}` | stranica spremna; s `loggedIn:true` omotač traži dozvolu za obavještenja | `ready` postoji; **dodati `loggedIn`** (bez polja omotač pita odmah, kao do sada) |
| `{type:'push'}` | traži dozvolu za obavještenja sada (npr. odmah poslije prijave ili prve poslane poruke) | novo |
| `{type:'chat', id: '45' \| null}` | korisnik je otvorio / napustio razgovor; dok je razgovor otvoren, obavještenje za njega se ne prikazuje | novo |
| `{type:'update', url?}` | otvori prodavnicu (obavezna nadogradnja); `url` samo `https://apps.apple.com/…` ili `https://play.google.com/…` | novo |
| `{type:'share', text, url}` | sistemski meni za dijeljenje | postoji |
| `{type:'exit'}` | zatvori aplikaciju (Android) | postoji |

**Obavezna nadogradnja (predlog):** web pri pokretanju pročita `GET /app-verzija.json` (statičan fajl, keš
5 min):

```json
{ "ios": { "min": "1.0.0", "url": "https://apps.apple.com/app/id<APP_STORE_ID>" },
  "android": { "min": "1.0.0", "url": "https://play.google.com/store/apps/details?id=ba.komodo.app" } }
```

Ako je `window.KOMODO_APP.version` manja od `min` za tu platformu (poređenje po brojevima, 1.10.0 > 1.9.0),
web prikaže ekran preko svega: „Nova verzija Komoda — Ova verzija više ne radi. Nadogradi aplikaciju da
nastaviš.” s dugmetom „Nadogradi”, koje šalje `toApp({type:'update', url})`. Pošto je skoro sve na webu,
`min` se diže samo kad se promijeni nešto u omotaču (nova poruka u ugovoru, novi ključ za push itd.).

**EAS Update (`expo-updates`): ne uključujemo.** Cijeli proizvod je web aplikacija koja se mijenja odmah na
serveru; JS omotača je ~490 redova i mijenja se rijetko, a većina izmjena omotača (dozvole, `Info.plist`,
universal links, ikone) ionako traži novu gradnju. `expo-updates` bi dodao zavisnost, `runtimeVersion`,
kanale i još jedno mjesto gdje se objava može pokvariti, a koristi skoro da nema. Uključiti tek ako omotač
počne dobijati nativne ekrane.

## 10. Apple 4.2 (minimalna funkcionalnost) — procjena

Rizik: **srednji do nizak**. Apple odbija aplikacije koje su „upakovan sajt” bez vrijednosti iznad
preglednika. Komodo je oglasnik s vlastitim sadržajem korisnika, nalozima, porukama i objavom videa — to je
aplikacija, ne marketinški sajt, i to ide u korist. Rizik ostaje jer recenzent vidi WebView.

**Šta omotač radi nativno (stanje 19.11.):**

- Push obavještenja o porukama; dodir otvara razgovor (i iz ugašene aplikacije); Android kanal „Poruke”, vlastita ikona.
- Sistemski meni za dijeljenje oglasa.
- Kamera i galerija za snimanje/biranje videa (sistemski izbornik).
- Deep link `komodo://` i universal/app links za `komodo.ba`.
- Telefon, Viber, mail, mape, Instagram/Facebook/TikTok otvaraju svoje aplikacije; uslovi i privatnost preglednik.
- Nativni ekran bez interneta / nedostupnog servera s „Pokušaj ponovo”, nativni splash i indikator učitavanja,
  oporavak kad sistem ugasi WebView proces (nema bijelog ekrana).
- Android dugme Nazad zatvara prozore i vraća kroz ekrane web aplikacije.
- Izgled aplikacije: bez pregleda linka na dugi dodir, bez odskakanja, bez zumiranja teksta, tamna tema od
  prvog piksela, tastatura ne prekriva polje za poruku (Android).

**Šta bi pomoglo, po isplativosti:**

1. Dozvolu za obavještenja tražiti u pravom trenutku (poslije prijave ili prve poruke) — poruka `push`, sitna
   izmjena na webu. Apple to i preporučuje.
2. Dobra napomena za recenzente (odjeljak 7) s nalogom butika koji već ima razgovor — recenzent mora vidjeti
   push i objavu videa, ne prazan feed. Najčešći stvarni razlog odbijanja je 2.1 (nešto ne radi pri recenziji).
3. Haptika na „Sviđa mi se” i slanje poruke (`expo-haptics`, nova poruka `{type:'haptic'}`) — mala izmjena,
   osjeća se nativno. Uraditi ako stigne odbijanje ili u verziji 1.1.
4. Nativni donji meni (tab bar) — najjači signal „prava aplikacija”, ali traži da web sakrije svoj meni i da
   omotač vodi stanje kartica. **Ne raditi unaprijed**; samo ako Apple odbije po 4.2, kao drugi korak.

## 11. Obavezna proba na telefonu (prije predaje)

Ništa od ovoga nije provjereno na uređaju. Na Android (preview APK) i iPhone (TestFlight):

- [ ] Prvo pokretanje: splash, pa feed bez bijelog bljeska; videi se sami puštaju bez zvuka, zvuk na dodir.
- [ ] Avionski način → „Nema interneta”; uključi mrežu → „Pokušaj ponovo” učita feed. Ugašen server (502) → „Komodo trenutno nije dostupan”.
- [ ] Objava videa (butik): „Snimi video” i „Galerija” se nude; video od ~90 MB prolazi do kraja (Wi-Fi i mobilni podaci).
      Android: u izborniku mora biti i kamera — omotač **namjerno nema** dozvolu `CAMERA` (sistemska kamera je ne traži;
      kad bi je imao, react-native-webview bi kameru sakrio dok dozvola nije data).
- [ ] Poruka: tastatura ne prekriva polje za unos (Android edge-to-edge). Ako polje „skače” duplo, ukloniti
      `KeyboardAvoidingView` u `App.js` (znači da WebView sam pomjera sadržaj).
- [ ] Push: prijava → dozvola → poruka s drugog naloga stiže; dodir otvara razgovor (aplikacija u pozadini i ugašena).
      Odjava → nova poruka **ne** stiže na taj telefon.
- [ ] Profil butika: telefon otvara poziv, Viber link Viber (ili poruku da nije instaliran), Instagram svoju aplikaciju.
- [ ] Dijeljenje oglasa otvara sistemski meni; poslani link otvara aplikaciju (kad postoje fajlovi iz odjeljka 8).
- [ ] Uslovi i privatnost otvaraju preglednik, povratak u aplikaciju radi.
- [ ] Android Nazad: zatvara prozor → vraća na feed → izlazi iz aplikacije.
- [ ] Brisanje naloga iz aplikacije.
