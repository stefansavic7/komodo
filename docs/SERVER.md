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

U `.env`: `POSTGRES_PASSWORD`, `KOMODO_APP_PASSWORD` (dvije različite, svaka iz `openssl rand -hex 24`) i odkomentarisan profil **(a) Terminkov server** (svi njegovi redovi, od
`WORKERS=1` do `DB_SHM_SIZE=64m`). Profili (b) i (c) ostaju zakomentarisani.
U `api/.env`: `APP_URL=https://komodo.terminkoapp.ba`, `ADMIN_EMAILS`, `BUNNY_*` kao na laptopu.
`SMTP_URL` za probu može ostati prazan: emailovi se tada ispisuju u logu (`docker compose logs api`),
a novi nalozi su odmah potvrđeni.

**0.4 Pokretanje:**

Direktoriji za snimke i za `/.well-known/` (isto kao 2.6):

```bash
sudo mkdir -p /srv/komodo/uploads /srv/komodo/well-known
sudo chown 1000:1000 /srv/komodo/uploads
sudo chown stefan:stefan /srv/komodo/well-known
sudo chmod 755 /srv/komodo /srv/komodo/uploads /srv/komodo/well-known
```

Ako je Komodo na ovom serveru već radio (stara verzija), prvo odjeljci 9 (selidba snimaka) i 10 (korisnik
baze `komodo_app`), pa tek onda dalje.

```bash
cd ~/komodo
docker compose up -d --build
docker compose ps
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
free -h
```

Health mora vratiti `{"ok":true,"baza":true,…}` (starija verzija API-ja: `{"status":"ok"}`). Provjeri i Terminko: `cd ~/terminko && docker compose ps` — oba kontejnera
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

**0.6 Nova verzija** (isto kao odjeljak 4): `~/komodo/server/objava.sh`.

**0.7 Kad Komodo dobije svoj server:** kopija baze (`server/kopija-baze.sh`), postavljanje po odjeljku 2,
vraćanje kopije (`docs/RUNBOOK.md`, „Vraćanje baze iz kopije”), pa na Terminkovom serveru `cd ~/komodo && docker compose down` (bez `-v` dok
nova baza nije provjerena), brisanje Nginx sajta `komodo` i DNS zapisa.

## 1. Gdje je šta

| Šta | Gdje |
|---|---|
| Server | Hetzner, projekat „Komodo”, CCX23 (pred reklame CCX33, odjeljak 8), Ubuntu 24.04 |
| Prijava | `ssh stefan@IP-SERVERA`, ključ „stefan-laptop” kao za Terminko |
| Kod | `~/komodo` (kopija GitHub repozitorija) |
| Tajne | `~/komodo/.env` (lozinka baze) i `~/komodo/api/.env` (sve ostalo) |
| Baza | Docker volumen `komodo_db-data`, baza `komodo`; superuser `komodo` (psql, kopije), API radi kao `komodo_app` (odjeljak 10); vremenska zona `Europe/Sarajevo` |
| Snimci prije Bunnyja | `/srv/komodo/uploads` na hostu (u kontejneru `/data/uploads`), Nginx ih služi kao `/media/` |
| Kopije baze | `/backup/dnevne` (7), `/backup/sedmicne` (4), `/backup/objava` (5), format `pg_dump -Fc`; šifrovane i van servera na Storage Boxu (2.8) |
| Nginx | `/etc/nginx/sites-available/komodo` (izvor: `server/nginx-komodo.conf`) |
| Dnevnik Nginxa | `/var/log/nginx/komodo.access.log` i `komodo.error.log` (logrotate: 14 dana) |
| Skripte | `server/objava.sh` (nova verzija), `server/kopija-baze.sh` (cron 03:20), `server/nadzor.sh` (cron svakih 5 min) |
| Šta raditi kad nešto ne radi | `docs/RUNBOOK.md` |
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

**SSH samo ključem, bez prijave kao root.** Tek kad prijava `ssh stefan@IP-SERVERA` radi ključem i `sudo`
radi (inače se zaključaš). Fajl počinje s `00-` jer sshd uzima PRVU vrijednost, a Hetznerova slika može
imati `50-cloud-init.conf` s `PasswordAuthentication yes`:

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/00-komodo.conf
sudo sshd -t
sudo systemctl restart ssh
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) '
```

Zadnja komanda mora ispisati `no` za sve tri. Prije zatvaranja trenutne veze otvori NOVI terminal i provjeri
da `ssh stefan@IP-SERVERA` i dalje radi.

**fail2ban** (blokira adrese koje pogađaju SSH lozinke). Ubuntuov paket sam uključuje zaštitu za `sshd`
(`/etc/fail2ban/jail.d/defaults-debian.conf`):

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

**Automatske sigurnosne nadogradnje:**

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
cat /etc/apt/apt.conf.d/20auto-upgrades
```

Na pitanje odgovori „Yes”; fajl mora imati `APT::Periodic::Unattended-Upgrade "1";`. Server se ne restartuje
sam: kad postoji `/var/run/reboot-required`, restart zakaži u mirno doba (`docs/RUNBOOK.md`, „Mjesečno”).

**Šta je otvoreno prema internetu:** samo 22, 80 i 443 (Hetzner firewall i `ufw`). Docker zaobilazi `ufw`
za portove koje objavi, zato `docker-compose.yml` objavljuje samo `127.0.0.1:3002` (API), a baza nema
`ports` uopšte. Provjera poslije pokretanja (2.6):

```bash
sudo ufw status
sudo ss -ltnp | grep -E ':(3002|5432) '
```

Mora pisati samo `127.0.0.1:3002`; port 5432 se ne smije pojaviti. Kontejneri ne rade kao root: API kao
`node` (Dockerfile, `USER node`), a službena Postgres slika pokreće bazu kao korisnik `postgres`. Oba
kontejnera imaju `restart: unless-stopped` (podižu se sami poslije restarta servera).

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
openssl rand -hex 24   # pokreni dvaput: jedna lozinka za POSTGRES_PASSWORD, druga za KOMODO_APP_PASSWORD
nano .env       # POSTGRES_PASSWORD, KOMODO_APP_PASSWORD i profil (b) CCX23 ili (c) CCX33
nano api/.env   # APP_URL, COOKIE_SECRET (openssl rand -hex 32), SMTP_URL, ADMIN_EMAILS, BUNNY_*
chmod 600 .env api/.env
```

Tajne se ne commituju i ne šalju u chat.

U produkciji (`NODE_ENV=production`, kako radi kontejner) API **ne starta bez `SMTP_URL` i `COOKIE_SECRET`**
(S-01, S-07); poruka u `docker compose logs api` kaže šta nedostaje. `APP_URL` je također obavezan (linkovi u
emailovima i provjera Origin zaglavlja). `COOKIE_SECRET` napravi sa `openssl rand -hex 32` i poslije ga ne mijenjaj
bez potrebe: promjena poništava potpise kolačića uređaja (korisnici ostaju prijavljeni, ali se neprijavljeni
pregledi i poznati uređaji počinju brojati ispočetka).

### 2.6 Pokretanje

Direktorij za snimke dok se obrađuju. Dijele ga API (u kontejneru `/data/uploads`, korisnik `node`, uid 1000)
i Nginx (`www-data`, samo čita). `docker-compose.yml` ga ne pravi sam (`create_host_path: false`): da ga
napravi Docker, vlasnik bi bio root i objava videa bi padala s „permission denied”. Uz njega
`/srv/komodo/well-known` za `/.well-known/` (Universal Links i App Links, `docs/PRODAVNICE.md` odjeljak 8):
puni ga `server/objava.sh` iz `web/.well-known/`, Nginx ga služi kao `application/json`.

```bash
sudo mkdir -p /srv/komodo/uploads /srv/komodo/well-known
sudo chown 1000:1000 /srv/komodo/uploads
sudo chown stefan:stefan /srv/komodo/well-known
sudo chmod 755 /srv/komodo /srv/komodo/uploads /srv/komodo/well-known
```

Fajlove API piše s dozvolom 644, pa ih Nginx može čitati. Ako objava videa javi grešku pri upisu:
`ls -ln /srv/komodo/uploads` mora pokazati vlasnika `1000 1000`; ako ne, ponovi `chown` iznad.

```bash
cd ~/komodo
docker compose up -d --build
docker compose ps
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
```

Zadnja komanda treba vratiti `{"ok":true,"baza":true,…}`. Pri prvom pokretanju baza sama napravi korisnika
`komodo_app` s kojim radi API (`server/db-init/10-komodo-app.sh`; bez superusera, nalaz S-17 u
`docs/SIGURNOST.md`). U logu treba pisati „Snimci idu na Bunny Stream.”

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

Certbot sam dopiše HTTPS u Nginx i obnavlja certifikat. HSTS (`Strict-Transport-Security`, godinu dana) je već
u `server/nginx-komodo.conf`; preglednici ga poštuju tek preko HTTPS-a. Kad sedmicu dana sve radi preko HTTPS-a,
može se dodati `; preload` i prijaviti domena na hstspreload.org — to se teško poništava, pa tek kad je
sigurno da `komodo.ba` i sve poddomene ostaju na HTTPS-u.

Provjera poslije certbota:

```bash
curl -sI https://komodo.ba | grep -i -E 'strict-transport|^server'
curl -sI https://komodo.ba/.well-known/assetlinks.json | grep -i -E '^HTTP|content-type'
```

Prva mora pokazati HSTS i `Server: nginx` bez broja verzije; druga `200` i `application/json` (kad frontend
doda fajl u `web/.well-known/` i prođe objava).

Za veliki broj istovremenih veza (odjeljak 8) u glavnoj Nginx konfiguraciji podigni broj veza i otvorenih fajlova:

```bash
sudo nano /etc/nginx/nginx.conf
```

Na vrhu fajla (van svih blokova) dodaj `worker_rlimit_nofile 16384;`, a u bloku `events { }` postavi
`worker_connections 4096;` (zamijeni postojeću vrijednost, obično 768). Zatim:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Keš statičkih fajlova je u `/var/cache/nginx/komodo` (najviše 5 GB); Nginx ga pravi sam. Snimke (`/media/`)
Nginx čita direktno iz `/srv/komodo/uploads`, bez API-ja i bez keša.

Dnevnik je `/var/log/nginx/komodo.access.log`: vrijeme, status, `rt=` (trajanje zahtjeva), `urt=` (koliko
je čekan API), adresa, zahtjev. Adrese s tokenom (link za potvrdu emaila i za novu lozinku) upisuju se kao
`?[skriveno]`. Brisanje starih dnevnika radi Ubuntuov logrotate (`/etc/logrotate.d/nginx`: svaki dan, čuva
14 dana) — ništa ne treba podešavati. Da bi `server/nadzor.sh` mogao čitati dnevnik:

```bash
sudo usermod -aG adm stefan
```

(važi od sljedeće prijave).

### 2.8 Kopije baze (na serveru i van servera)

`server/kopija-baze.sh` svaku noć napravi kopiju (`pg_dump -Fc`, provjerava da u njoj postoji tabela
`listings`), čuva 7 dnevnih i 4 sedmične (nedjeljne), a ako je podešeno šalje šifrovanu kopiju na Hetzner
Storage Box. Kopija samo na istom serveru ne štiti od gubitka servera — zato je kopija van servera uslov
za objavu (`docs/PLAN-PRODUKCIJA.md`, uslov 6).

**Lokalno:**

```bash
sudo mkdir -p /backup && sudo chown stefan:stefan /backup
crontab -e
```

Dodaj red:

```
20 3 * * *  /home/stefan/komodo/server/kopija-baze.sh >> /home/stefan/komodo-kopija.log 2>&1
```

Provjeri odmah ručno: `~/komodo/server/kopija-baze.sh` mora ispisati „kopija /backup/dnevne/komodo-….dump”.

**Van servera — Hetzner Storage Box.** Najmanji je BX11 (1 TB, €3,20 mjesečno bez PDV-a, uz jednokratnu
naknadu za postavljanje; izvor: hetzner.com/storage/storage-box/bx11, provjereno 19.11.2026. — provjeri
prije narudžbe). Pristup rsyncom ide preko SSH-a na portu 23 (izvor: docs.hetzner.com → Storage Box →
Access with SSH/rsync/BorgBackup).

1. Hetzner Console → Storage Box → naruči **BX11**, lokacija druga od servera ako može (npr. server u
   Nürnbergu, kopija u Falkensteinu ili Helsinkiju). Zapiši korisnika `uXXXXX`.
2. U podešavanjima Storage Boxa uključi **SSH support** i **External reachability** (server je izvana).
3. Uključi **automatske snapshotove** (npr. svaki dan, BX11 ima do 10). Skripta šalje s `--delete` (na
   Storage Boxu ostaje isto što i lokalno), pa su snapshotovi zaštita ako neko obriše kopije sa servera.
4. Na serveru ključ samo za kopije i njegovo slanje na Storage Box (traži lozinku Storage Boxa jednom):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/komodo_kopija -N ""
cat ~/.ssh/komodo_kopija.pub | ssh -p23 uXXXXX@uXXXXX.your-storagebox.de install-ssh-key
ssh -p23 -i ~/.ssh/komodo_kopija uXXXXX@uXXXXX.your-storagebox.de mkdir -p komodo
```

5. Lozinka za šifrovanje (gpg, AES256). **Bez nje su kopije van servera neupotrebljive** — prepiši je
   odmah u menadžer lozinki (ne u chat):

```bash
openssl rand -base64 32 > ~/.komodo-kopija-sifra
chmod 600 ~/.komodo-kopija-sifra
cat ~/.komodo-kopija-sifra
```

6. U `~/komodo/.env` dodaj (sa svojim `uXXXXX`):

```
KOPIJA_VAN=uXXXXX@uXXXXX.your-storagebox.de:komodo
KOPIJA_SIFRA_FAJL=/home/stefan/.komodo-kopija-sifra
```

7. Proba: `~/komodo/server/kopija-baze.sh` mora ispisati i „poslano van servera”. Provjera na Storage Boxu:
   `ssh -p23 -i ~/.ssh/komodo_kopija uXXXXX@uXXXXX.your-storagebox.de ls -l komodo/dnevne`.
8. Odmah uradi **probno vraćanje** iz kopije sa Storage Boxa (`docs/RUNBOOK.md`, „Probno vraćanje kopije”)
   i upiši datum u tabelu tamo.

Zašto gpg, a ne age: gpg je već instaliran na Ubuntuu (bez novog paketa), a lozinka iz fajla radi iz crona.
Lokalne kopije ostaju nešifrovane (`chmod 600`, samo stefan) radi brzog vraćanja.

Kopije sadrže lične podatke (emailovi, poruke). Obrisan nalog ostaje u kopijama najviše 4 sedmice (najstarija
sedmična kopija), pa se onda sam briše — to treba pisati u politici privatnosti.

### 2.9 Nadzor i upozorenja

**Izvana (server ne odgovara uopšte):** besplatni servis koji svakih nekoliko minuta otvara
`https://komodo.ba/api/health` i šalje email kad ne vrati 200. Prijedlog:

| Servis | Besplatno | Izvor (provjereno 19.11.2026.) |
|---|---|---|
| **Better Stack** (preporuka) | 10 monitora i heartbeatova, 1 statusna stranica, email i Slack upozorenja; provjera svake 3 minute | betterstack.com/pricing, betterstack.com/uptime-robot-alternative |
| UptimeRobot | 50 monitora, provjera svakih 5 minuta, dozvoljeno i za komercijalnu upotrebu | uptimerobot.com/pricing, help.uptimerobot.com („Who is UptimeRobot's free plan for”) |

Nijedan besplatni plan nema provjeru svake minute (to je plaćeno). Better Stack svake 3 minute zadovoljava
„znamo za pad u roku od 5 minuta”. Postavljanje (Stefan, jednom):

1. Better Stack → Uptime → **Create monitor**: URL `https://komodo.ba/api/health`, „URL becomes unavailable”,
   upozorenje na Stefanov email.
2. **Create heartbeat** „Komodo nadzor”, period 5 minuta: dobijenu adresu upiši kao `NADZOR_PING_URL` u
   `~/komodo/.env`. Ako cron ili server stane, Better Stack javi.
3. **Create heartbeat** „Komodo kopija”, period 1 dan: adresu upiši kao `KOPIJA_PING_URL`.

**Iznutra — `server/nadzor.sh`** (cron svakih 5 minuta): disk iznad 80 %, dostupna memorija ispod 10 %,
kontejner `db` ili `api` nije `running healthy`, `/api/health` ne vraća 200, više od 20 odgovora 5xx u
zadnjih 5 minuta, noćna kopija baze (ili kopija van servera) starija od 26 h. Isto upozorenje najviše
jednom na sat; kad prođe, stiže „RIJEŠENO”.

Upozorenje ide emailom preko curl-a (već je na Ubuntuu, bez novog paketa) i istog `SMTP_URL`-a koji koristi
API (`api/.env`), na adresu `NADZOR_EMAIL`. Ako je `SMTP_URL` oblika `smtps://…:465`, curl koristi TLS odmah;
`smtp://…:587` koristi STARTTLS (bez šifrovanja curl odbija slanje). Posebni znakovi u korisniku ili lozinki
moraju biti URL-kodirani (`@` → `%40`), kao i za nodemailer. Umjesto ili uz email može `NADZOR_WEBHOOK`
(POST s tekstom, npr. tema na ntfy.sh za obavještenje na telefon).

U `~/komodo/.env`:

```
NADZOR_EMAIL=stefan@primjer.ba
NADZOR_PING_URL=https://…   (iz Better Stacka, korak 2 iznad)
KOPIJA_PING_URL=https://…   (korak 3)
```

Proba bez slanja, pa cron:

```bash
SUHO=1 ~/komodo/server/nadzor.sh
crontab -e
```

Dodaj red:

```
*/5 * * * *  /home/stefan/komodo/server/nadzor.sh >> /home/stefan/komodo-nadzor.log 2>&1
```

Proba stvarnog slanja: `NADZOR_DISK=1 ~/komodo/server/nadzor.sh` (disk je sigurno „pun” iznad 1 %) mora
poslati email; sljedeće normalno pokretanje iz crona pošalje „RIJEŠENO”. Proba vanjskog nadzora (uslov 7 iz
plana): u mirno doba `docker compose stop api`, sačekaj email od Better Stacka (do ~3–5 min), pa
`docker compose start api`.

Pragovi se mijenjaju u `.env`: `NADZOR_DISK`, `NADZOR_MEMORIJA`, `NADZOR_5XX`.

### 2.10 Prvi nalozi

1. Na `https://komodo.ba` napravi svoj nalog (Profil → Nemaš nalog?) i **potvrdi email** dodirom na link iz
   poruke (S-01: administratorska prava postoje tek uz potvrđen email; ko se registruje s adresom iz
   `ADMIN_EMAILS`, a ne potvrdi je, ostaje običan kupac).
2. Njegov email upiši u `ADMIN_EMAILS` u `api/.env`, pa `docker compose up -d --force-recreate api`.
3. U aplikaciji: Profil → Administracija → Novi butik.

Redoslijed nije bitan (adresa u `ADMIN_EMAILS` i potvrda emaila mogu doći bilo kojim redom), ali oba moraju
postojati. Bez `SMTP_URL` nalog se ne može potvrditi, pa API u produkciji ni ne starta.

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
~/komodo/server/objava.sh
```

Skripta redom: odbije ako na serveru ima lokalnih izmjena u kodu → `git pull --ff-only` → `docker compose
build api` (stara verzija i dalje radi) → kopija baze u `/backup/objava/` → `docker compose up -d` (migracije
se pokreću same) → čeka da `/api/health` vrati 200 (najviše 60 s) → briše Nginx keš (`sudo` traži lozinku),
inače bi korisnici do sat vremena dobijali stari `app.js` uz novi `index.html`.

Poslije objave verzije s migracijom 010 (sigurnost, sesije se čuvaju kao sha256 tokena) jednom osvježi
statistiku tabele sesija, jer je migracija prepisala sve redove. Komanda je sastavljena iz oblika za psql u
tabeli iz odjeljka 3 (`docker compose exec db psql -U komodo -d komodo`); ovaj tačan poziv nije ranije bio u
dokumentaciji:

```bash
docker compose exec db psql -U komodo -d komodo -c "vacuum analyze sessions"
```

Ako health ne prođe, skripta ispiše logove i tačne komande za povratak na prethodnu verziju (i u
`docs/RUNBOOK.md`, „Vraćanje prethodne verzije”). Migracija baze se ne vraća automatski.

## 5. Izmjena tajni

```bash
cd ~/komodo
nano api/.env
docker compose up -d --force-recreate api
```

`restart` ne čita `.env` ponovo, zato `--force-recreate`.

## 6. Vraćanje baze iz kopije

Uputstvo i probno vraćanje su u `docs/RUNBOOK.md` („Vraćanje baze iz kopije”, „Probno vraćanje kopije”).

## 7. Šta se na serveru NIKAD ne radi

- `docker compose down -v`: `-v` briše bazu.
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

## 9. Selidba snimaka iz Docker volumena u `/srv/komodo/uploads` (jednom)

Do 19.11.2026. snimci su bili u Docker volumenu `komodo_uploads`, koji Nginx na hostu ne vidi. Sada su u
direktoriju `/srv/komodo/uploads` (bind mount). Na serveru gdje je Komodo već radio sa starom verzijom
(npr. Terminkov server, odjeljak 0), prije prve objave s novim `docker-compose.yml`:

```bash
cd ~/komodo
docker volume ls | grep komodo_uploads
sudo mkdir -p /srv/komodo/uploads
sudo chown 1000:1000 /srv/komodo/uploads
sudo chmod 755 /srv/komodo /srv/komodo/uploads
docker compose stop api
sudo cp -a "$(docker volume inspect komodo_uploads --format '{{ .Mountpoint }}')/." /srv/komodo/uploads/
sudo chown -R 1000:1000 /srv/komodo/uploads
sudo ls -ln /srv/komodo/uploads | head
```

Ako `docker volume ls` ne ispiše ništa, volumena nema i kopiranje se preskače. Zatim nova verzija (odjeljak
4: `~/komodo/server/objava.sh`) i nova Nginx konfiguracija:

```bash
sudo cp ~/komodo/server/nginx-komodo.conf /etc/nginx/sites-available/komodo
sudo sed -i 's/DOMENA/komodo.terminkoapp.ba/' /etc/nginx/sites-available/komodo
sudo nginx -t && sudo systemctl reload nginx
```

(Na Komodovom serveru `komodo.ba www.komodo.ba` umjesto `komodo.terminkoapp.ba`, kao u 2.7.) Pažnja:
kopiranje preko starog fajla briše HTTPS dio koji je certbot dopisao; poslije njega pokreni ponovo
`sudo certbot --nginx -d komodo.terminkoapp.ba --redirect` (certbot iskoristi postojeći certifikat).

Provjera: otvori oglas čiji je snimak još u obradi, ili
`curl -sI https://komodo.terminkoapp.ba/media/IME-FAJLA.mp4` (ime iz `sudo ls /srv/komodo/uploads`) mora
vratiti `200` i `Content-Type: video/mp4`.

Stari volumen ostaje dok se ne provjeri da sve radi; poslije toga se smije obrisati samo on:
`docker volume rm komodo_uploads` (nikad `docker volume prune` ni `down -v`, odjeljak 7).

## 10. Korisnik baze `komodo_app` na postojećoj bazi (jednom)

Od 19.11.2026. API se na bazu ne spaja kao superuser `komodo`, nego kao `komodo_app` (nalaz S-17 u
`docs/SIGURNOST.md`): vlasnik je baze i tabela (pa i dalje sam pokreće migracije, uključujući
`create extension pg_trgm`, jer je pg_trgm „trusted” ekstenzija), ali ne može `COPY … PROGRAM`, čitati
fajlove servera ni praviti korisnike. Nova baza ga dobije sama (2.6). Na bazi koja je napravljena ranije
(proba na Terminkovom serveru), prije prve objave s novim `docker-compose.yml`:

```bash
cd ~/komodo
openssl rand -hex 24
nano .env
```

U `.env` dodaj red `KOMODO_APP_PASSWORD=` s ispisanom lozinkom. Zatim (stari API i dalje radi kao `komodo`):

```bash
cd ~/komodo
git pull
docker compose up -d db
docker compose exec -T db sh /docker-entrypoint-initdb.d/10-komodo-app.sh
~/komodo/server/objava.sh --svakako
```

Skripta mora ispisati `komodo_app: vlasnik baze komodo, superuser: false`. `up -d db` ponovo pravi samo
kontejner baze (podaci ostaju u volumenu `komodo_db-data`), pa je API nekoliko sekundi bez baze. Ako
`objava.sh` ne prođe, `docker compose logs api --tail 50`: „password authentication failed for user
komodo_app” znači da lozinka u `.env` nije ista kao pri pokretanju skripte — pokreni skriptu ponovo
(postavlja lozinku iz `.env`), pa `docker compose up -d`.

Isprobano lokalno (Postgres 16, 19.11.2026.): skripta na postojećoj bazi s podacima i na praznoj bazi;
API kao `komodo_app` na praznoj bazi primijeni svih 8 migracija (s `pg_trgm`), registracija radi,
`COPY … TO PROGRAM` je odbijen. Na pravom serveru (Docker) nije isprobano.
