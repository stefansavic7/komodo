# Komodo

Radni naziv je bio Snimi, pa se folder na laptopu i baza i dalje zovu `snimi`. To su samo interna imena.

Video oglasi butika: snimi proizvod, upiši naziv i cijenu, izaberi kategoriju. Počinjemo s buticima u Banjoj Luci.

- `api/` — API (Node 22, Fastify, PostgreSQL). Služi i web aplikaciju i snimke u razvoju.
- `web/` — web aplikacija (običan HTML, CSS i JavaScript, bez gradnje).

## Pokretanje na laptopu

Treba Node 22 ili noviji (`node -v`) i PostgreSQL koji već radi na laptopu.

1. Napravi praznu bazu `snimi` (jednom). U DBeaveru: desni klik na Databases → Create New Database → `snimi`.
   Ili iz PowerShella, ako je `psql` dostupan:

   ```powershell
   psql -U postgres -c "create database snimi"
   ```

2. Podešavanje (jednom):

   ```powershell
   cd api
   copy env.primjer .env
   notepad .env        # upiši lozinku baze u DATABASE_URL
   npm install
   ```

3. Pokretanje:

   ```powershell
   cd api
   npm run dev
   ```

   Aplikacija je na http://127.0.0.1:3002. Tabele se prave same pri prvom startu (migracije iz `api/migrations`).
   Port 3002 je izabran da se ne sudara s Terminkom (3000).

## Novi butik (jedini način)

Kroz aplikaciju se registruju samo kupci. Butik otvaraš ti, kad se dogovoriš s vlasnikom:

```powershell
cd api
node --env-file=.env src/novi-butik.js --butik "Moda Bojana" --email bojana@primjer.ba --telefon "065 123 456"
```

Obavezno: `--butik` i `--email`. Po želji `--telefon` i `--grad`. Skripta ispiše privremenu lozinku samo jednom.
Vlasnik se prijavi tim emailom i lozinkom, pa je promijeni u *Profil → Promijeni lozinku*.

Butik možeš otvoriti i iz aplikacije: *Profil → Administracija → Novi butik* (vidi ispod).

## Administracija

U `api/.env` upiši svoj email u `ADMIN_EMAILS` i pokreni API ponovo. Kad se prijaviš tim nalogom,
u profilu se pojavi dugme **Administracija**: prijave oglasa i poruka (ukloni sadržaj, odbaci prijavu,
ugasi nalog), otvaranje butika i spisak svih naloga.

## Email

Dok je `SMTP_URL` u `api/.env` prazan, emailovi se ne šalju nego se ispišu u terminalu (link za novu
lozinku tražiš tamo), a novi nalozi su odmah potvrđeni. Kad upišeš `SMTP_URL`, kupac mora potvrditi
email prije nego što može slati poruke, a butik dobija email za poruku koju nije pročitao 15 minuta.

## Snimci (Bunny Stream)

Dok su `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY` i `BUNNY_CDN_HOST` u `api/.env` prazni, snimci se čuvaju u `api/uploads`.
Kad ih upišeš i pokreneš API ponovo (u terminalu piše „Snimci idu na Bunny Stream.”), svaki novi snimak se:

1. sačuva na disk i odmah vidi u profilu butika, s natpisom da se obrađuje;
2. u pozadini pošalje na Bunny;
3. kupci ga odmah gledaju s našeg servera, a kad Bunny završi obradu (provjera svakih 20 sekundi), s Bunnyja;
   lokalni fajl se briše pola sata kasnije.

Stari snimci ostaju lokalni. Brisanje oglasa briše snimak i na Bunnyju.

## Proba na telefonu (isti Wi-Fi)

U `api/.env` stavi `HOST=0.0.0.0`, pokreni ponovo i na telefonu otvori `http://IP-LAPTOPA:3002`
(IP laptopa pokaže `ipconfig`, red „IPv4 Address”). Windows može pitati da dozvoli Node kroz zid.

## Gdje je šta

| Šta | Gdje |
|---|---|
| Snimci u razvoju | `api/uploads/` (ne commituje se) |
| Tajne | `api/.env` (ne commituje se, ne šalje u chat) |
| Šema baze | `api/migrations/*.sql`, primjenjuju se po abecedi pri startu |
| Kategorije | `CATEGORIES` u `api/src/app.js` i `CATS` u `web/js/osnova.js` (moraju biti iste) |
| API | `api/src/server.js` (ulaz), `api/src/app.js` (zajedničko), `api/src/rute/*.js` (rute), `api/src/poslovi.js` (pozadinski poslovi) |
| Web | `web/index.html`, `web/style.css`, `web/js/*.js` (učitavaju se redom iz `index.html`) |

Detaljno (kako dodati rutu ili ekran): `docs/ARHITEKTURA.md`.

## Mobilna aplikacija (Expo)

Folder `mobile/` je Expo aplikacija koja otvara web aplikaciju i dodaje push obavještenja o porukama,
dijeljenje oglasa i Android dugme Nazad. Sav ostali kod je u `web/` i `api/`.

Proba u Expo Go:

1. API mora biti dostupan s telefona: u `api/.env` stavi `HOST=0.0.0.0` i pokreni `npm run dev`.
2. IP laptopa nađeš sa `ipconfig` (red „IPv4 Address”).
3. Podešavanje (jednom):

   ```powershell
   cd mobile
   copy env.primjer .env
   notepad .env        # upiši IP laptopa u EXPO_PUBLIC_APP_URL
   npm install
   ```

4. Pokretanje:

   ```powershell
   cd mobile
   npx expo start
   ```

   QR kod skeniraj aplikacijom Expo Go (Android) ili kamerom (iPhone). Telefon mora biti na istom Wi-Fi-ju.

Push obavještenja traže EAS projekat (`eas init` u folderu `mobile`, jednom). U Expo Go na Androidu push ne radi;
za njega treba development build preko EAS-a.

## Server i prodavnice

- Postavljanje servera: `docs/SERVER.md`
- Google Play i App Store: `docs/PRODAVNICE.md`
