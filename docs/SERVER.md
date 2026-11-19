# Komodo na serveru: postavljanje i svakodnevni rad

Komodo ima svoj server, odvojen od Terminka. Na serveru rade dva Docker kontejnera, `api` (aplikacija i web)
i `db` (PostgreSQL 16), a ispred njih je Nginx s HTTPS-om. Snimci su na Bunny Streamu.

> Ovo uputstvo je napisano prije prvog postavljanja i još nije prođeno na pravom serveru.
> Kad ga prođeš, ispravi ga tamo gdje se stvarnost razlikuje, da sljedeći put bude tačno.
> Komande za instalaciju Dockera i certbota provjeri na njihovim zvaničnim stranicama prije pokretanja.

## 0. Proba na Terminkovom serveru (komodo.terminkoapp.ba)

Do kupovine Komodovog servera i domene, Komodo za probu radi na Terminkovom serveru (`188.245.3.174`),
na adresi `https://komodo.terminkoapp.ba`. Terminko se ne dira: Komodo ima svoj folder (`~/komodo`), svoje
kontejnere, bazu i port (3002; Terminko je 3000, demo 3001), a memorija je ograničena na 256 MB po kontejneru.

**0.1 DNS (UTIC, domena terminkoapp.ba):** novi A zapis `komodo` → `188.245.3.174`.

**0.2 Ključ za GitHub (na serveru, jednom):**

```bash
ssh stefan@188.245.3.174
ssh-keygen -t ed25519 -f ~/.ssh/komodo_deploy -N ""
cat ~/.ssh/komodo_deploy.pub
```

Ispisani ključ: GitHub → `stefansavic7/komodo` → Settings → Deploy keys → Add (bez dozvole za pisanje). Zatim:

```bash
printf 'Host github-komodo\n  HostName github.com\n  IdentityFile ~/.ssh/komodo_deploy\n' >> ~/.ssh/config
git clone git@github-komodo:stefansavic7/komodo.git ~/komodo
```

Poseban `Host github-komodo` je zato što Terminko već koristi svoj ključ za `github.com`.

**0.3 Tajne:**

```bash
cd ~/komodo
cp server/env.server.primjer .env
cp server/env.api.primjer api/.env
nano .env
nano api/.env
chmod 600 .env api/.env
```

U `.env`: `POSTGRES_PASSWORD` i odkomentarisan profil **(a) Terminkov server** (svi njegovi redovi, od
`WORKERS=1` do `DB_SHM_SIZE=64m`). Profili (b) i (c) ostaju zakomentarisani.
U `api/.env`: `APP_URL=https://komodo.terminkoapp.ba`, `ADMIN_EMAILS`, `BUNNY_*` kao na laptopu.
`SMTP_URL` za probu može ostati prazan: emailovi se tada ispisuju u logu (`docker compose logs api`),
a novi nalozi su odmah potvrđeni.

**0.4 Pokretanje:**

```bash
cd ~/komodo
docker compose up -d --build
docker compose ps
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
free -h
```

Health mora vratiti `{"status":"ok"}`. Provjeri i Terminko: `cd ~/terminko && docker compose ps` — oba kontejnera
moraju biti `Up`, a `curl -s http://127.0.0.1:3000/api/health` mora i dalje vraćati `"status":"ok"`.

**0.5 Nginx i HTTPS:**

```bash
sudo cp ~/komodo/server/nginx-komodo.conf /etc/nginx/sites-available/komodo
sudo sed -i 's/DOMENA/komodo.terminkoapp.ba/' /etc/nginx/sites-available/komodo
sudo ln -s /etc/nginx/sites-available/komodo /etc/nginx/sites-enabled/komodo
sudo nginx -t && sudo systemctl reload nginx
nslookup komodo.terminkoapp.ba
sudo certbot --nginx -d komodo.terminkoapp.ba --redirect
```

`nslookup` mora pokazati `188.245.3.174` prije certbota. Provjera: `https://komodo.terminkoapp.ba` otvara
aplikaciju, `https://terminkoapp.ba` i dalje radi.

Na Terminkovom serveru se `/etc/nginx/nginx.conf` ne mijenja (dijeli ga s Terminkom, a za probu nije potrebno);
korak iz 2.7 za `worker_connections` je samo za Komodov server.

**0.6 Nova verzija** (isto kao odjeljak 4): `cd ~/komodo && git pull && docker compose up -d --build`,
pa `sudo rm -rf /var/cache/nginx/komodo/*` (brisanje keša starih `app.js` i `style.css`).

**0.7 Kad Komodo dobije svoj server:** kopija baze (`server/kopija-baze.sh`), postavljanje po odjeljku 2,
vraćanje kopije (odjeljak 6), pa na Terminkovom serveru `cd ~/komodo && docker compose down` (bez `-v` dok
nova baza nije provjerena), brisanje Nginx sajta `komodo` i DNS zapisa.

## 1. Gdje je šta

| Šta | Gdje |
|---|---|
| Server | Hetzner, projekat „Komodo”, CCX23 (pred reklame CCX33, odjeljak 8), Ubuntu 24.04 |
| Prijava | `ssh stefan@IP-SERVERA`, ključ „stefan-laptop” kao za Terminko |
| Kod | `~/komodo` (kopija GitHub repozitorija) |
| Tajne | `~/komodo/.env` (lozinka baze) i `~/komodo/api/.env` (sve ostalo) |
| Baza | Docker volumen `komodo_db-data`, korisnik i baza `komodo` |
| Snimci prije Bunnyja | Docker volumen `komodo_uploads` |
| Kopije baze | `/backup/komodo-DATUM.sql.gz`, čuva se 14 dana |
| Nginx | `/etc/nginx/sites-available/komodo` (izvor: `server/nginx-komodo.conf`) |
| Zid | Hetzner firewall (TCP 22, 80, 443) i `ufw` na serveru |

## 2. Prvo postavljanje (jednom)

### 2.1 Server u Hetzneru

1. Hetzner Cloud → novi projekat **Komodo** → **Add Server**.
2. Lokacija kao za Terminko (Njemačka ili Finska), tip **CCX23** (odjeljak 8), slika **Ubuntu 24.04**,
   SSH ključ **stefan-laptop**.
3. Firewall: dozvoli dolazni TCP 22, 80 i 443 te ICMP.
4. Zapiši IP adresu servera.

### 2.2 Domena

Kod registrara domene `komodo.ba` dodaj dva DNS zapisa:

| Tip | Ime | Vrijednost |
|---|---|---|
| A | `komodo.ba` (ili `@`) | IP servera |
| A | `www` | IP servera |

Promjena se proširi za nekoliko minuta do nekoliko sati.

### 2.3 Korisnik i zaštita

Prva prijava je kao `root`:

```bash
ssh root@IP-SERVERA
adduser stefan
usermod -aG sudo stefan
rsync --archive --chown=stefan:stefan ~/.ssh /home/stefan
ufw allow OpenSSH
ufw enable
exit
```

Od sada se prijavljuješ kao `stefan`:

```bash
ssh stefan@IP-SERVERA
sudo apt update && sudo apt upgrade -y
```

### 2.4 Docker

Instaliraj Docker Engine i Compose plugin po zvaničnom uputstvu za Ubuntu (docs.docker.com → Install Docker
Engine on Ubuntu). Zatim:

```bash
sudo usermod -aG docker stefan
exit
```

Prijavi se ponovo i provjeri: `docker compose version`.

### 2.5 Kod i tajne

Kod ide s GitHuba, iz privatnog repozitorija `komodo`. Na serveru napravi ključ samo za čitanje:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/komodo_deploy -N ""
cat ~/.ssh/komodo_deploy.pub
```

Ispisani ključ dodaj na GitHubu: repozitorij → Settings → Deploy keys → Add (bez dozvole za pisanje). Zatim:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/komodo_deploy\n' >> ~/.ssh/config
git clone git@github.com:KORISNIK/komodo.git ~/komodo
cd ~/komodo
cp server/env.server.primjer .env
cp server/env.api.primjer api/.env
nano .env       # POSTGRES_PASSWORD (dugačka, samo slova i brojevi) i profil (b) CCX23 ili (c) CCX33
nano api/.env   # ADMIN_EMAILS, SMTP_URL, BUNNY_*
chmod 600 .env api/.env
```

Tajne se ne commituju i ne šalju u chat.

### 2.6 Pokretanje

```bash
cd ~/komodo
docker compose up -d --build
docker compose ps
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
```

Zadnja komanda treba vratiti `{"status":"ok"}`. U logu treba pisati „Snimci idu na Bunny Stream.”

### 2.7 Nginx i HTTPS

```bash
sudo apt install -y nginx
sudo ufw allow 'Nginx Full'
sudo cp ~/komodo/server/nginx-komodo.conf /etc/nginx/sites-available/komodo
sudo sed -i 's/DOMENA/komodo.ba www.komodo.ba/' /etc/nginx/sites-available/komodo
sudo ln -s /etc/nginx/sites-available/komodo /etc/nginx/sites-enabled/komodo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Kad DNS iz koraka 2.2 proradi (`http://komodo.ba` otvara aplikaciju), dodaj HTTPS. Certbot instaliraj po
zvaničnom uputstvu (certbot.eff.org → Nginx na Ubuntuu), pa:

```bash
sudo certbot --nginx -d komodo.ba -d www.komodo.ba
```

Certbot sam dopiše HTTPS u Nginx i obnavlja certifikat.

Za veliki broj istovremenih veza (odjeljak 8) u glavnoj Nginx konfiguraciji podigni broj veza i otvorenih fajlova:

```bash
sudo nano /etc/nginx/nginx.conf
```

Na vrhu fajla (van svih blokova) dodaj `worker_rlimit_nofile 16384;`, a u bloku `events { }` postavi
`worker_connections 4096;` (zamijeni postojeću vrijednost, obično 768). Zatim:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Keš statičkih fajlova i snimaka je u `/var/cache/nginx/komodo` (najviše 5 GB); Nginx ga pravi sam.

### 2.8 Noćna kopija baze

```bash
sudo mkdir -p /backup && sudo chown stefan:stefan /backup
crontab -e
```

Dodaj red:

```
20 3 * * *  /home/stefan/komodo/server/kopija-baze.sh >> /home/stefan/komodo-kopija.log 2>&1
```

Provjeri odmah ručno: `~/komodo/server/kopija-baze.sh` mora ispisati „kopija /backup/komodo-….sql.gz”.

Kopija koja je samo na istom serveru ne štiti od gubitka servera. Prije objave dogovoriti kopiju van servera
(npr. Backblaze, kao što je planirano za Terminko).

### 2.9 Prvi nalozi

1. Na `https://komodo.ba` napravi svoj nalog (Profil → Nemaš nalog?).
2. Njegov email upiši u `ADMIN_EMAILS` u `api/.env`, pa `docker compose up -d --force-recreate api`.
3. U aplikaciji: Profil → Administracija → Novi butik.

## 3. Svakodnevne komande (na serveru, u `~/komodo`)

| Šta | Komanda |
|---|---|
| Stanje kontejnera | `docker compose ps` |
| Log API-ja (zadnjih 50) | `docker compose logs api --tail 50` |
| Log uživo (Ctrl+C za izlaz) | `docker compose logs -f api` |
| Samo greške | `docker compose logs api --tail 300 \| grep '"level":50'` |
| Restart API-ja | `docker compose restart api` |
| Zdravlje | `curl -s http://127.0.0.1:3002/api/health` |
| Disk | `df -h /` i `docker system df` |
| Memorija | `free -h` |
| Opterećenje po kontejneru (procesor, memorija) | `docker stats --no-stream` |
| Baza (psql) | `docker compose exec db psql -U komodo -d komodo` |
| Novi butik iz komandne linije | `docker compose exec api node api/src/novi-butik.js --butik "Naziv" --email adresa@primjer.ba` |

## 4. Nova verzija

Kad je nova verzija na GitHubu:

```bash
cd ~/komodo
git pull
docker compose up -d --build
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
```

Poslije svake nove verzije obriši Nginx keš, inače korisnici do sat vremena dobijaju stari `app.js` uz novi
`index.html`:

```bash
sudo rm -rf /var/cache/nginx/komodo/*
```

Migracije baze se pokreću same pri startu API-ja. Prije veće izmjene baze napravi ručnu kopiju:
`~/komodo/server/kopija-baze.sh`.

## 5. Izmjena tajni

```bash
cd ~/komodo
nano api/.env
docker compose up -d --force-recreate api
```

`restart` ne čita `.env` ponovo, zato `--force-recreate`.

## 6. Vraćanje baze iz kopije

Samo kad je baza stvarno izgubljena ili pokvarena:

```bash
cd ~/komodo
docker compose stop api
gunzip -c /backup/komodo-DATUM.sql.gz | docker compose exec -T db psql -U komodo -d komodo
docker compose start api
```

Ako baza nije prazna, prvo je treba isprazniti, pa ovaj korak raditi pažljivo i s novom kopijom u ruci.

## 7. Šta se na serveru NIKAD ne radi

- `docker compose down -v`: `-v` briše bazu i snimke.
- `docker volume rm` ili `docker system prune --volumes`: isto.
- Otvaranje porta 3002 ili 5432 prema internetu: API i baza se vide samo sa servera.
- Commit `.env` fajlova ili slanje njihovog sadržaja u chat.

## 8. Veliki promet i izbor servera

### 8.1 Proračun

Cilj je **40.000 istovremenih korisnika** i talas od **10.000 registracija za 7 dana** (`docs/SKALIRANJE.md`).

| Stavka | Vrijednost |
|---|---|
| Zahtjeva po korisniku u feedu (lakši klijent) | ≤ 0,13/s |
| 40.000 istovremenih | ≈ 5.200 zahtjeva/s |
| Jedan Node proces (mjerenje 19.11.2026.) | ≈ 2.000 zahtjeva/s |
| Potrebno API procesa | najmanje 3, uz rezervu 4–6 |
| Registracije | 10.000 / 7 dana ≈ 0,02/s prosječno, vrh poslije reklame ~5/s — nije problem |

Snimci se gledaju s Bunny CDN-a, pa server nosi samo API, web i snimke dok se obrađuju (prvih ~30 minuta).
Najveći trošak je procesor (API procesi i baza na istom serveru), a ne mreža.

> Brojke za broj korisnika su procjene iz mjerenja na razvojnom računaru. Na pravom serveru test opterećenja
> treba ponoviti prije reklamne kampanje i po njemu podesiti `WORKERS` i veličinu servera.

### 8.2 Cijene Hetznera

Cijene poslije promjene od 15.06.2026. (važe za nove narudžbe i promjene veličine), Njemačka/Finska, mjesečno,
bez PDV-a i bez IPv4 adrese. Izvor: docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/

| Server | Procesor i RAM | Cijena |
|---|---|---|
| CCX13 (cloud) | 2 dedicated vCPU, 8 GB | €42,99 |
| CCX23 (cloud) | 4 dedicated vCPU, 16 GB | €85,99 |
| CCX33 (cloud) | 8 dedicated vCPU, 32 GB | €138,49 |
| CCX43 (cloud) | 16 dedicated vCPU, 64 GB | €275,99 |
| AX42-1 (fizički, Falkenstein ili Helsinki) | 8 jezgara (AMD Ryzen 7 PRO 8700GE), 64 GB, 2 × 512 GB NVMe — provjeri na Hetzneru | €97,30 + €49 jednokratno |

Prije narudžbe provjeri cijenu na Hetzneru; ovdje je prepisana 19.11.2026.

### 8.3 Preporuka

1. **Proba:** Terminkov server (odjeljak 0), profil **(a)** u `.env`. Samo za probu, ne za lansiranje.
2. **Lansiranje:** Komodov server **CCX23**, profil **(b)**.
3. **Pred reklamnu kampanju:** promjena veličine na **CCX33**, profil **(c)**. Promjena veličine cloud servera
   je brza, ali server se gasi na nekoliko minuta (zakaži je u mirno doba), a od tada važi nova cijena.
   U Hetzner konzoli biraj promjenu samo procesora i RAM-a (bez diska), da se kasnije može vratiti na manji tip.
4. **Jeftinija jača opcija:** fizički server **AX42-1** ako se prihvati da je postavljanje sporije (narudžba i
   priprema traju duže, jednokratna naknada) i da nema brze promjene veličine — za veći server treba novi
   server i selidba baze (odjeljci 2 i 6).

### 8.4 Promjena profila (poslije promjene veličine servera)

```bash
cd ~/komodo
nano .env                     # zakomentariši stari profil, odkomentariši novi
docker compose up -d          # pravi kontejnere ponovo s novim ograničenjima
docker compose ps
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
docker stats --no-stream
```

Pravila za vlastite vrijednosti su na vrhu `server/env.server.primjer` (procesi × heap mora stati u `API_MEM`,
`DB_MAX_CONNECTIONS` veći od (`WORKERS` + 1) × `PG_POOL` + rezerva).
