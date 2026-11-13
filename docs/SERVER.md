# Komodo na serveru: postavljanje i svakodnevni rad

Komodo ima svoj server, odvojen od Terminka. Na serveru rade dva Docker kontejnera, `api` (aplikacija i web)
i `db` (PostgreSQL 16), a ispred njih je Nginx s HTTPS-om. Snimci su na Bunny Streamu.

> Ovo uputstvo je napisano prije prvog postavljanja i još nije prođeno na pravom serveru.
> Kad ga prođeš, ispravi ga tamo gdje se stvarnost razlikuje, da sljedeći put bude tačno.
> Komande za instalaciju Dockera i certbota provjeri na njihovim zvaničnim stranicama prije pokretanja.

## 1. Gdje je šta

| Šta | Gdje |
|---|---|
| Server | Hetzner, projekat „Komodo”, isti tip i lokacija kao Terminkov, Ubuntu 24.04 |
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
2. Lokacija i tip kao za Terminko, slika **Ubuntu 24.04**, SSH ključ **stefan-laptop**.
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
nano .env       # POSTGRES_PASSWORD: dugačka lozinka, samo slova i brojevi
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
