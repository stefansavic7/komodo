# Komodo — šta raditi kad (runbook)

Za Stefana i svakoga ko dežura. Sve komande su na serveru, kao `stefan`, u `~/komodo`, osim gdje piše
drugačije. Postavljanje servera je u `docs/SERVER.md`; ovdje su samo postupci kad nešto ne radi.

> Napisano 19.11.2026., prije prvog postavljanja. Skripte i Nginx su isprobani lokalno (vidi kraj), na pravom
> serveru još nisu. Kad postupak prođeš u stvarnosti, ispravi ga ovdje.

## 0. Prvih 5 minuta (uvijek isto)

```bash
ssh stefan@IP-SERVERA
cd ~/komodo
docker compose ps
curl -s http://127.0.0.1:3002/api/health
docker compose logs api --tail 50
df -h /
free -h
docker stats --no-stream
```

Šta se gleda:

| Komanda | U redu | Problem |
|---|---|---|
| `docker compose ps` | `api` i `db`: `Up … (healthy)` | `unhealthy`, `Restarting`, `Exited` |
| health | `{"ok":true,"baza":true,…}` | `{"ok":false,…}` (baza ne radi, kod 503) ili ništa |
| `df -h /` | ispod 80 % | iznad 90 %: odjeljak 2 |
| `free -h` | „available” bar 1–2 GB | blizu 0: odjeljak 4 |
| `docker stats` | API i baza ispod svog `MEM LIMIT` | memorija na limitu ili CPU stalno 100 %·broj jezgara |

Kad je uzrok jasan: poruka butićima/korisnicima ako traje duže od 15 minuta, pa odgovarajući odjeljak.

## 1. Server ne odgovara

Upozorenje stiže od Better Stacka (vanjska provjera `https://komodo.ba/api/health`, `docs/SERVER.md` 2.9).

1. **Radi li SSH?** `ssh stefan@IP-SERVERA`.
   - Ne radi: Hetzner Console → projekat Komodo → server → **Graphs** (CPU, mreža, disk). Zatim **Console**
     (ekran servera u pregledniku) i prijava kao `stefan`. Ako ni to ne reaguje: **Power → Reset** (kao
     dugme za restart; kontejneri se podignu sami, `restart: unless-stopped`). Poslije restarta odjeljak 0.
   - Radi: dalje.
2. **Radi li API iznutra?** `curl -s http://127.0.0.1:3002/api/health`.
   - Ne odgovara, a `docker compose ps` pokazuje da API ne radi ili se stalno restartuje:
     `docker compose logs api --tail 100`, pa `docker compose up -d`. Ako je pao odmah poslije nove verzije:
     odjeljak 10.
   - Memorija: `sudo dmesg -T | grep -i -E 'killed process|out of memory' | tail` — ako je kernel ubijao
     procese, odjeljak 4 (server je premalen za promet).
   - Health vraća `"baza":false`: `docker compose logs db --tail 50`; disk pun → odjeljak 2.
3. **API radi iznutra, a spolja ne:** Nginx.

```bash
sudo systemctl status nginx --no-pager
sudo nginx -t
sudo systemctl restart nginx
sudo tail -n 50 /var/log/nginx/komodo.error.log
sudo certbot certificates
```

   `certbot certificates` pokazuje datum isteka; istekao certifikat se obnavlja s `sudo certbot renew`.
4. Kad proradi: `curl -sI https://komodo.ba` s laptopa mora vratiti `200`.

## 2. Disk pun (ili baza puna)

`server/nadzor.sh` javlja iznad 80 %. Kad je disk pun, baza prestaje upisivati (registracije, poruke, oglasi
padaju s 5xx).

```bash
df -h /
docker system df
sudo du -sh /backup /srv/komodo/uploads /var/log /var/lib/docker /var/cache/nginx/komodo
docker compose exec db psql -U komodo -d komodo -c "select pg_size_pretty(pg_database_size('komodo'))"
```

Šta se smije obrisati, od najsigurnijeg:

```bash
docker image prune -f
docker builder prune -f
sudo journalctl --vacuum-size=200M
```

Svaka objava (`docker compose build`) ostavi staru sliku; `image prune -f` briše samo slike koje ne koristi
nijedan kontejner. **Nikad** `docker system prune --volumes`, `docker volume prune` ni `down -v`
(`docs/SERVER.md`, odjeljak 7).

- `/srv/komodo/uploads` velik: snimci koji su na Bunnyju brišu se sami 30 min poslije obrade. Ako ih je
  mnogo, Bunny ne obrađuje — odjeljak 5.
- `/backup` velik: kopija se čuva po broju (7 + 4 + 5); ne brisati ručno najnovije.
- Baza velika: najveće tabele

```bash
docker compose exec db psql -U komodo -d komodo -c "select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 10"
```

  i javi backendu (npr. `listing_views` i `rate_limits` treba čistiti posao `cleanup()`).
- Poslije oslobađanja prostora: `docker compose restart db`, pa `docker compose restart api`, pa odjeljak 0.
- Trajno rješenje: veći server (odjeljak 7) ili Hetzner Volume; to je trošak — odobrava Stefan.

## 3. Skok grešaka 5xx

`server/nadzor.sh` javlja kad je više od 20 odgovora 5xx u 5 minuta.

```bash
sudo tail -n 5000 /var/log/nginx/komodo.access.log | awk '$2 ~ /^5/ {print $2, $7}' | sort | uniq -c | sort -rn | head -20
docker compose logs api --tail 300 | grep '"level":50'
```

Prva komanda pokazuje koji kod i koja putanja (polja reda: vrijeme, status, `rt=`, `urt=`, adresa, zahtjev).

| Kod | Najčešći uzrok | Šta raditi |
|---|---|---|
| 502 | API ne radi ili se restartuje | `docker compose ps`, `docker compose logs api --tail 100`, `docker compose up -d` |
| 504 | API odgovara sporije od 60 s (baza zaglavljena) | odjeljak 4 |
| 503 | `/api/health`: baza ne odgovara; ili API: upit duži od 5 s / baza ne prima veze (u logu `Baza ne odgovara na vrijeme (503)`); ili Nginx: API ne odgovara (502/504 se šalju kao 503 s `Retry-After`) | `docker compose logs db --tail 50`, odjeljak 2; spora baza → odjeljak 4 i 4a |
| 500 | greška u kodu (često poslije nove verzije) | logovi iznad; ako je počelo s objavom → odjeljak 10 i poruka backendu s redovima `"level":50` |

`429` nije greška servera: to je ograničenje broja zahtjeva (Nginx ili API). Ako ga dobijaju mnogi pravi
korisnici iza istog operatera, javi devopsu (granice u `server/nginx-komodo.conf`).

## 4. Spor feed (ili sve sporo)

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' http://127.0.0.1:3002/api/listings
sudo tail -n 20000 /var/log/nginx/komodo.access.log | awk '{sub("rt=","",$3); print $3, $7}' | sort -rn | head -20
sudo tail -n 20000 /var/log/nginx/komodo.access.log | awk '{sub("rt=","",$3); print $3}' | sort -n | awk '{a[NR]=$1} END {print "p95:", a[int(NR*0.95)]}'
docker stats --no-stream
docker compose exec db psql -U komodo -d komodo -c "select pid, now() - query_start as trajanje, state, left(query, 80) from pg_stat_activity where state <> 'idle' order by trajanje desc limit 15"
docker compose exec db psql -U komodo -d komodo -c "select count(*) from pg_stat_activity"
```

Cilj je p95 ispod 300 ms (`docs/PLAN-PRODUKCIJA.md`). Kako čitati:

- `rt=` velik, `urt=` mali: spora mreža klijenta (mobilni), nije problem servera.
- `urt=` velik i CPU API-ja na vrhu (`docker stats`: `CPU %` ≈ 100 × WORKERS): premalo procesa ili server
  premalen → odjeljak 7.
- Baza na vrhu ili dugi upiti u `pg_stat_activity`: zaglavljen ili spor upit (fali indeks) → poruka backendu
  s ispisom upita. Jedan zaglavljen upit se prekida s
  `docker compose exec db psql -U komodo -d komodo -c "select pg_cancel_backend(PID)"` (PID iz ispisa).
- Broj konekcija blizu `DB_MAX_CONNECTIONS` iz `.env`: pravila na vrhu `server/env.server.primjer`.

## 4a. Štedni i hitni režim („veliki crveni prekidač”)

Kad server ne stiže (p95 iznad 300 ms, CPU baze ili API-ja stalno na vrhu, mnogo 503), a jači server (odjeljak 7)
nije opcija za sljedećih 15 minuta: smanji koliko često aplikacije pitaju server. Ništa se ne restartuje.

| Režim | Šta radi | Kada |
|---|---|---|
| `normalno` | tajmeri kao inače (~6 zahtjeva/min po korisniku), lični „Za tebe” | uvijek, osim dolje |
| `stedi` | sviđanja na ekranu 90 s, značka poruka 3 min, profil 2 min, pregledi 2 min, otvoren razgovor 8 s (~2–3 zahtjeva/min) | vrh prometa (reklama), CPU > ~70 % duže od 10 min |
| `hitno` | „Za tebe” = keširani „Novo” (bez ličnog algoritma), pregledi se ne šalju i ne broje, sve ostalo najviše svakih 5 min, otvoren razgovor 15 s | baza ne stiže ni u `stedi`; 503 i dalje rastu |

Kako uključiti (bilo koje od dva):

1. **Aplikacija** (najbrže): prijavi se kao administrator → Profil → Administracija → „Režim rada” → Štedni ili
   Hitni. Važi odmah u svim procesima API-ja. „Vrati na podešavanje servera” vraća na `KOMODO_REZIM` iz `api/.env`.
2. **Server** (kad aplikacija ne radi): u `api/.env` upiši `KOMODO_REZIM=stedi` (ili `hitno`), pa
   ```bash
   cd ~/komodo
   nano api/.env
   docker compose up -d
   curl -s http://127.0.0.1:3002/api/config
   ```
   Pazi: izbor iz administracije ima prednost nad `.env`. Ako je neko ranije izabrao režim u aplikaciji, vrati ga
   dugmetom „Vrati na podešavanje servera” ili u bazi:
   `docker compose exec db psql -U komodo -d komodo -c "delete from app_settings where key = 'rezim'"` (API ga
   pročita za najviše 30 s).

Koliko brzo stiže do telefona: svaki odgovor API-ja nosi zaglavlje `X-Komodo-Rezim`, pa aplikacija novi režim
vidi pri prvom sljedećem zahtjevu (najkasnije ~1 min, značka poruka), a `/api/config` je u Nginxu keširan 30 s.
Provjera: `curl -s https://komodo.ba/api/config` → `"rezim":"stedi"`.

Šta još radi samo od sebe (bez prekidača):

- Upit duži od 5 s se prekida → 503 „Server je trenutno preopterećen…” s `Retry-After`; aplikacija tada čeka sve
  duže (×2 po grešci, do 5 min, uz nasumičan pomak) i vraća se na normalno poslije prvog uspjeha.
- Kad baza ne odgovara, javni feed i „Za tebe” za neprijavljene služe zadnji keš (zaglavlje `X-Komodo-Zastarjelo: 1`).
- Push o porukama i sniženjima čeka u tabeli `outbox` i šalje se kad Expo/mreža proradi. Pregled:
  `docker compose exec db psql -U komodo -d komodo -c "select vrsta, count(*) filter (where sent_at is null and dead_at is null) as ceka, count(*) filter (where dead_at is not null) as mrtvih from outbox group by vrsta"`.
  Mrtvi redovi (6 neuspjelih pokušaja) imaju razlog u koloni `greska`; ponovo ih pošalji s
  `update outbox set dead_at = null, pokusaja = 0, run_at = now() where dead_at is not null and created_at > now() - interval '1 day'`.

Poslije talasa vrati `normalno` (aplikacija ili `.env`) i zapiši u dnevnik kada i zašto je režim mijenjan.

## 5. Bunny ne radi (oglasi ostaju „Obrađuje se”)

Novi oglas vidi samo vlasnik dok Bunny ne obradi snimak (`docs/PLAN-PRODUKCIJA.md`, odjeljak 4). Ako Bunny ne
radi, novi oglasi ne izlaze u feed, a snimci se gomilaju u `/srv/komodo/uploads`.

```bash
docker compose logs api --tail 300 | grep -i bunny
docker compose exec db psql -U komodo -d komodo -c "select id, created_at, video_status from listings where video_status = 'processing' and deleted_at is null order by id"
sudo du -sh /srv/komodo/uploads
```

1. Status Bunnyja: stranica statusa na bunny.net i Bunny panel → Stream → biblioteka 808418 → Videos (stoje
   li snimci u „Processing” ili „Error”).
2. Greška 401/403 u logu: ključ (`BUNNY_API_KEY`) promijenjen ili istekao → odjeljak 11 (Bunny).
3. Bunny ne radi duže: ništa se ne gubi — snimci čekaju na disku i API ih šalje kad Bunny proradi. Pazi na
   disk (odjeljak 2) i obavijesti butike da novi oglasi kasne.
4. Kad proradi: oglasi iz drugog upita prelaze u `ready` sami (posao provjere u API-ju), za nekoliko minuta.

## 6. Email ne stiže

Simptomi: korisnici ne dobijaju potvrdu emaila ili link za novu lozinku.

```bash
docker compose logs api --tail 500 | grep -i -E 'email|smtp'
```

- „Email za … nije poslan” s greškom autentikacije: lozinka/ključ SMTP-a u `api/.env` → odjeljak 11.
- „[email nije podešen]”: `SMTP_URL` u `api/.env` je prazan.
- Nema grešaka u logu, a email ne stiže: panel servisa za email (dnevni limit, odbijeni emailovi, blokada),
  pa spam folder primaoca. Provjera DNS zapisa za slanje (SPF, DKIM, DMARC — vrijednosti daje servis):

```bash
nslookup -type=TXT komodo.ba
nslookup -type=TXT _dmarc.komodo.ba
```

- Proba slanja istim SMTP-om sa servera (stiže na `NADZOR_EMAIL`):
  `NADZOR_DISK=1 ~/komodo/server/nadzor.sh`; sljedeće pokretanje iz crona javi „RIJEŠENO”.
- „Budžet emailova za potvrdu je potrošen” (`nadzor.sh` javi „Email budžet potrošen”): u jednom satu je nastalo
  više naloga od granice `MAIL_POTVRDA_SAT` (zadano 300). Nalozi nastaju, ali bez emaila za potvrdu; korisnik
  ga traži dugmetom „Pošalji ponovo” u profilu. Provjeri je li talas pravi ili napad: broj novih naloga u
  zadnjih sat vremena,
  `docker compose exec db psql -U komodo -d komodo -c "select count(*) from users where created_at > now() - interval '1 hour'"`.
  Pravi talas: povećaj `MAIL_POTVRDA_SAT` u `api/.env` (u granicama dnevnog limita SMTP servisa) i
  `docker compose up -d --force-recreate api`. Napad: granice po adresi/uređaju već rade; pogledaj IP adrese u
  Nginx dnevniku. Budžet se sam obnavlja za sat vremena.
- Talas registracija: Zoho šalje najviše 500 emailova dnevno — zato je za produkciju potreban servis za
  transakcione emailove (`docs/PLAN-PRODUKCIJA.md`, odjeljak 4).

## 7. Talas korisnika: CCX23 → CCX33

Kad: prije reklamne kampanje (planirano), ili kad `docker stats` stalno pokazuje API na vrhu procesora, a p95
raste (odjeljak 4). Cijene: `docs/SERVER.md` 8.2 (CCX33 €138,49 mjesečno bez PDV-a; od promjene važi nova
cijena — odobrava Stefan). Server je ugašen nekoliko minuta: radi u mirno doba (npr. 04–06 h).

1. Better Stack → monitor Komodo → **Pause** (da ne stižu upozorenja tokom gašenja).
2. Kopija baze prije gašenja i uredno gašenje kontejnera:

```bash
cd ~/komodo
~/komodo/server/kopija-baze.sh objava
docker compose stop
```

3. Hetzner Console → projekat Komodo → server → **Power** → **Power off**. Sačekaj da stanje bude „Off”.
4. Kartica **Rescale** → **CCX33** → izaberi promjenu **samo procesora i RAM-a (bez povećanja diska)**, da se
   kasnije može vratiti na manji tip → **Rescale**. Traje nekoliko minuta. (Tačni nazivi dugmadi mogu se
   razlikovati — provjeri u konzoli.)
5. **Power** → **Power on**.
6. Na serveru provjeri da je novi tip vidljiv i promijeni profil:

```bash
nproc
free -h
cd ~/komodo
nano .env
docker compose up -d
docker compose ps
docker compose logs api --tail 30
curl -s http://127.0.0.1:3002/api/health
docker stats --no-stream
```

   `nproc` mora pokazati 8, `free -h` oko 31 GB. U `.env` zakomentariši profil **(b)** (svi njegovi redovi) i
   odkomentariši profil **(c)** (`docs/SERVER.md` 8.4). U `docker stats` `MEM LIMIT` za API mora biti 8 GiB.
7. Better Stack → **Resume**. Provjera s laptopa: `https://komodo.ba` otvara aplikaciju.

Povratak na CCX23 poslije kampanje: isti koraci, tip **CCX23** i profil **(b)**.

## 8. Vraćanje baze iz kopije

Samo kad je baza stvarno izgubljena ili pokvarena, ili kad nova verzija s migracijom mora nazad (odjeljak 10).
Sve upisano poslije kopije se gubi. Kopije (`docs/SERVER.md` 2.8):

| Gdje | Šta |
|---|---|
| `/backup/dnevne/komodo-DATUM.dump` | noćne (03:20), zadnjih 7 |
| `/backup/sedmicne/komodo-DATUM.dump` | nedjeljne, zadnje 4 |
| `/backup/objava/komodo-DATUM-VRIJEME.dump` | prije svake objave, zadnjih 5 |
| Storage Box `komodo/dnevne`, `komodo/sedmicne` | iste, šifrovane (`.dump.gpg`) |

**8.1 Kopija sa servera:**

```bash
cd ~/komodo
ls -l /backup/dnevne /backup/objava
docker compose stop api
~/komodo/server/kopija-baze.sh objava
docker compose exec -T db psql -U komodo -d postgres -c "drop database komodo with (force)"
docker compose exec -T db psql -U komodo -d postgres -c "create database komodo owner komodo_app"
docker compose exec -T db pg_restore -U komodo -d komodo --no-owner --role=komodo_app --exit-on-error < /backup/dnevne/komodo-DATUM.dump
docker compose start api
curl -s http://127.0.0.1:3002/api/health
```

- `kopija-baze.sh objava` sačuva trenutno (pokvareno) stanje, za svaki slučaj. Ako ne uspije jer baza ne
  radi, nastavi bez nje.
- `--role=komodo_app`: tabele dobijaju vlasnika `komodo_app` (korisnik s kojim radi API). Bez toga bi bile
  vlasništvo superusera i API ne bi mogao raditi.
- `DATUM` zamijeni imenom fajla iz `ls` (npr. `komodo-2026-11-19.dump`).

**8.2 Kopija sa Storage Boxa** (server je izgubljen, ili lokalnih kopija nema). Na novom serveru prvo
`docs/SERVER.md` 2.1–2.6, pa:

```bash
mkdir -p ~/vracanje
nano ~/.komodo-kopija-sifra
chmod 600 ~/.komodo-kopija-sifra
ssh -p23 -i ~/.ssh/komodo_kopija uXXXXX@uXXXXX.your-storagebox.de ls -l komodo/dnevne
rsync -av -e "ssh -p 23 -i $HOME/.ssh/komodo_kopija" uXXXXX@uXXXXX.your-storagebox.de:komodo/dnevne/komodo-DATUM.dump.gpg ~/vracanje/
gpg --batch --pinentry-mode loopback --passphrase-file ~/.komodo-kopija-sifra -o ~/vracanje/komodo-DATUM.dump -d ~/vracanje/komodo-DATUM.dump.gpg
```

- U `~/.komodo-kopija-sifra` upiši lozinku za kopije iz menadžera lozinki (jedan red).
- Na novom serveru nema ključa `~/.ssh/komodo_kopija`: napravi ga i pošalji na Storage Box po
  `docs/SERVER.md` 2.8, korak 4 (traži lozinku Storage Boxa; ako je nema, Hetzner Console → Storage Box →
  reset lozinke).
- Zatim 8.1 s `~/vracanje/komodo-DATUM.dump` umjesto `/backup/dnevne/komodo-DATUM.dump`, pa `rm -rf ~/vracanje`.

## 9. Probno vraćanje kopije (jednom mjesečno i poslije svake izmjene kopija)

Dokazuje da se kopija sa Storage Boxa stvarno može vratiti. Ne dira pravu bazu: vraća se u privremenu bazu
`komodo_proba` u istom kontejneru. Radi u mirno doba (troši procesor i disk nekoliko minuta).

```bash
cd ~/komodo
mkdir -p ~/vracanje
ssh -p23 -i ~/.ssh/komodo_kopija uXXXXX@uXXXXX.your-storagebox.de ls -l komodo/dnevne
rsync -av -e "ssh -p 23 -i $HOME/.ssh/komodo_kopija" uXXXXX@uXXXXX.your-storagebox.de:komodo/dnevne/komodo-DATUM.dump.gpg ~/vracanje/
gpg --batch --pinentry-mode loopback --passphrase-file ~/.komodo-kopija-sifra -o ~/vracanje/komodo-DATUM.dump -d ~/vracanje/komodo-DATUM.dump.gpg
docker compose exec -T db psql -U komodo -d postgres -c "drop database if exists komodo_proba"
docker compose exec -T db psql -U komodo -d postgres -c "create database komodo_proba owner komodo_app"
docker compose exec -T db pg_restore -U komodo -d komodo_proba --no-owner --role=komodo_app --exit-on-error < ~/vracanje/komodo-DATUM.dump
docker compose exec -T db psql -U komodo -d komodo_proba -c "select (select count(*) from users) as korisnika, (select count(*) from listings) as oglasa, (select max(created_at) from listings) as zadnji_oglas"
docker compose exec -T db psql -U komodo -d komodo -c "select (select count(*) from users) as korisnika, (select count(*) from listings) as oglasa, (select max(created_at) from listings) as zadnji_oglas"
docker compose exec -T db psql -U komodo -d postgres -c "drop database komodo_proba"
rm -rf ~/vracanje
```

Uspjelo je ako `pg_restore` završi bez greške i brojevi u probnoj bazi odgovaraju pravoj bazi (prava ima
nešto više — sve upisano od noćne kopije). Upiši rezultat:

| Datum | Kopija | Gdje | Rezultat | Ko |
|---|---|---|---|---|
| 19.11.2026. | probna baza `komodo_devops` (5 korisnika, 50 oglasa) | lokalno, razvojni računar, Postgres 16, bez Dockera | šifrovana kopija (gpg) dešifrovana, `pg_restore --exit-on-error` u novu bazu: isti broj redova i zbir cijena, 13 tabela, 8 migracija; pogrešna lozinka odbijena | DevOps (Claude) |
| 19.11.2026. | isto, s korisnikom `komodo_app` | lokalno | `create database … owner komodo_app` + `pg_restore --role=komodo_app`: sve tabele vlasništvo `komodo_app`, API radi (health, registracija) | DevOps (Claude) |
| | prva prava kopija sa Storage Boxa | server | | Stefan |

## 10. Vraćanje prethodne verzije

Kad nova verzija ne radi (`server/objava.sh` sam ispiše tačne komande s brojem prethodne verzije):

```bash
cd ~/komodo
git log --oneline -5
git checkout PRETHODNI-COMMIT
docker compose up -d --build
curl -s http://127.0.0.1:3002/api/health
sudo find /var/cache/nginx/komodo -mindepth 1 -delete
```

- `PRETHODNI-COMMIT` je oznaka iz `git log` (npr. `7a75447`) — verzija prije zadnje objave.
- **Migracija baze se ne vraća sama.** Ako je nova verzija imala migraciju (`objava.sh` ispiše „PAŽNJA: nova
  verzija ima migraciju baze”), stara verzija obično radi i s novom bazom (migracije samo dodaju). Ako ne radi
  (greške o kolonama/tabelama u `docker compose logs api`), vrati bazu iz kopije napravljene prije objave
  (`/backup/objava/`, najnovija) po odjeljku 8.1 — sve upisano od objave se gubi, pa to odlučuje Stefan.
- **Povratak na verziju prije migracije 012 (R2-02, R2-07).** Stara verzija radi s novom bazom: ponovo piše
  `listings.base_score` (kolona je ostala; prvi prolaz posla pri startu je popuni), a kandidate „Za tebe” čita bez
  indeksa (pregled ~10.000 redova jednom u minuti po procesu — prihvatljivo). `listing_scores` i `price_set_at` ostaju
  i ne smetaju; ponovna objava nove verzije ne traži ništa (posao za 5 min osvježi `listing_scores`).
- **Povratak na verziju prije migracije 013 (talas 4, otpornost).** Stara verzija ne zna za `listing_likes_delta`:
  sviđanja koja posao još nije sabrao (najviše ~1 s prometa) ne bi ušla u `likes_count`. Odmah poslije povratka
  ih saberi jednom:
  `docker compose exec db psql -U komodo -d komodo -c "with d as (delete from listing_likes_delta returning listing_id, delta) update listings l set likes_count = l.likes_count + s.n from (select listing_id, sum(delta)::int as n from d group by 1) s where l.id = s.listing_id"`.
  Push koji je čekao u `outbox` stara verzija ne šalje (ostaje u tabeli; nova verzija ga pošalje kad se vrati, a
  sniženja starija od dana su tada bespredmetna — po želji `delete from outbox where sent_at is null`). Ostale
  tabele (`idempotency_keys`, `app_settings`) stara verzija ne koristi.
- **Povratak na verziju prije migracije 010 (sigurnost, S-18).** Migracija 010 pretvara tokene sesija u
  sha256 (`api/migrations/010_sigurnost.sql`). Stara verzija traži sirovi token, pa poslije povratka **niko nije
  prijavljen** (prijava ponovo radi, ništa ne pada; feed, profili i `/api/me` rade). Sesije koje stara verzija
  napravi čuvaju sirovi token u bazi do isteka (30 dana), a nova verzija ih ne prepoznaje. Ponovna objava nove
  verzije ne traži ništa posebno: 010 je već primijenjena i ne ponavlja se; ti korisnici se samo prijave ponovo.
  Ne pretvarati ove sesije SQL-om: sirovi token i sha256 su oba 64 znaka hex, pa se ne mogu razlikovati i
  pretvaranje bi dvaput heširalo već pretvorene. Ako sirovi tokeni ne smiju ostati u bazi:
  `delete from sessions where created_at >= 'VRIJEME-POVRATKA'` (vrijeme prvog starta stare verzije).
  Linkovi `#potvrda=` iz emailova poslanih dok je radila stara verzija ne rade u starom webu.
- Server je sada na „odvojenoj” verziji: `objava.sh` odbija rad dok se ne vrati na granu. Kad je popravka na
  GitHubu: `git checkout main` (ili ime grane iz `git branch`), pa `~/komodo/server/objava.sh`.

## 11. Rotacija tajni

Kad: tajna je procurila (poslana u chat, laptop izgubljen, neko napustio posao) ili jednom godišnje. Nove
vrijednosti se ne šalju u chat; čuvaju se u menadžeru lozinki.

| Tajna | Gdje | Postupak |
|---|---|---|
| Lozinka API korisnika baze (`KOMODO_APP_PASSWORD`) | `.env` | 11.1 |
| Lozinka superusera baze (`POSTGRES_PASSWORD`) | `.env` | 11.2 |
| `BUNNY_API_KEY` | `api/.env` | Bunny panel → Stream → biblioteka → API → novi ključ; upiši u `api/.env`; 11.3 |
| `SMTP_URL` (lozinka ili API ključ) | `api/.env` | panel servisa za email → novi ključ; upiši u `api/.env`; 11.3 |
| Sesije korisnika (procurila baza ili kolačići) | baza | 11.4 |
| SSH ključ laptopa (`stefan-laptop`) | `~/.ssh/authorized_keys` na serveru | novi ključ na laptopu, dodaj ga u `~/.ssh/authorized_keys`, obriši stari red |
| Deploy ključ za GitHub | `~/.ssh/komodo_deploy` | `docs/SERVER.md` 2.5 (novi ključ), na GitHubu obriši stari |
| Ključ za Storage Box | `~/.ssh/komodo_kopija` | `docs/SERVER.md` 2.8 korak 4; stari red obriši iz `.ssh/authorized_keys` na Storage Boxu |
| Lozinka kopija (`~/.komodo-kopija-sifra`) | server + menadžer lozinki | `docs/SERVER.md` 2.8 korak 5. Stare kopije ostaju šifrovane starom lozinkom: staru čuvaj još 4 sedmice (dok najstarija sedmična kopija ne nestane) |

**11.1 `KOMODO_APP_PASSWORD`:**

```bash
cd ~/komodo
openssl rand -hex 24
nano .env
docker compose up -d db
docker compose exec -T db sh /docker-entrypoint-initdb.d/10-komodo-app.sh
docker compose up -d
curl -s http://127.0.0.1:3002/api/health
```

U `.env` upiši novu vrijednost `KOMODO_APP_PASSWORD`. Skripta postavi tu lozinku u bazi, `up -d` ponovo pravi
API s novom adresom baze. API je bez baze nekoliko sekundi.

**11.2 `POSTGRES_PASSWORD`** (lozinka se u bazi mijenja ručno; promjena u `.env` sama ne mijenja ništa u
postojećoj bazi):

```bash
cd ~/komodo
openssl rand -hex 24
docker compose exec db psql -U komodo -d komodo -c "\password komodo"
nano .env
docker compose up -d
```

`\password` traži novu lozinku dvaput (zalijepi ispisanu); zatim je upiši i u `.env`.

**11.3 Tajne u `api/.env`** (`docs/SERVER.md`, odjeljak 5):

```bash
cd ~/komodo
nano api/.env
docker compose up -d --force-recreate api
docker compose logs api --tail 30
```

Stari ključ u panelu Bunnyja/servisa za email obriši tek kad novi radi (Bunny: novi oglas prelazi u „ready”;
email: `NADZOR_DISK=1 ~/komodo/server/nadzor.sh` stigne).

**11.4 Odjava svih korisnika:**

```bash
docker compose exec db psql -U komodo -d komodo -c "delete from sessions"
docker compose restart api
```

`restart api` briše keš prijava u memoriji (15 s). Svi se moraju ponovo prijaviti.

## 12. Redovno

**Svake sedmice** (5 minuta): `docker compose ps`, `df -h /`, `tail -n 20 ~/komodo-kopija.log`,
`tail -n 20 ~/komodo-nadzor.log`.

**Jednom mjesečno:**

```bash
ls /var/run/reboot-required
sudo certbot renew --dry-run
docker image prune -f
```

- Ako `reboot-required` postoji, u mirno doba `sudo reboot` (kontejneri se podignu sami), pa odjeljak 0.
- Probno vraćanje kopije (odjeljak 9) i upis u tabelu.

### Hitno uklanjanje sličice iz keša (zahtjev za uklanjanje sadržaja)

Kad butik ili administrator obriše oglas (ili ugasi butik), API odmah briše sličicu s diska i iz svojih keševa, a
`/og/<id>.jpg` vraća 404. Nginx (`location ^~ /og/`) drži već poslanu sličicu još najviše **1 h** (R2-03), a
preglednici i botovi isto toliko (`max-age=3600`). Kad sadržaj mora nestati odmah (zahtjev osobe, prijava), obriši
zapis iz Nginx keša. Ključ je `$scheme$host$request_uri` (`server/nginx-komodo.conf`), npr. za oglas 123:

```bash
sudo grep -rlZ "KEY: httpskomodo.ba/og/123.jpg" /var/cache/nginx/komodo | sudo xargs -0 -r rm -f
curl -sI https://komodo.ba/og/123.jpg | head -1
```

Drugi red mora pokazati `404`. Sve sličice odjednom: `sudo find /var/cache/nginx/komodo -mindepth 1 -delete`
(odjeljak 10; briše i keš statičkih fajlova, koji se sam ponovo puni). Kopije koje su botovi (Facebook, Viber)
već preuzeli ne kontrolišemo.

## 13. Čuvanje podataka (za politiku privatnosti)

| Šta | Koliko dugo | Gdje se podešava |
|---|---|---|
| Kopije baze (lokalno i na Storage Boxu, šifrovane van servera) | do 7 dana dnevne, do 4 sedmice sedmične, 5 zadnjih prije objave | `server/kopija-baze.sh` |
| Snapshotovi Storage Boxa | po podešavanju u Hetzner Consoli (prijedlog: do 10 dana) | Hetzner Console |
| Nginx dnevnik (IP adresa, putanja bez upita, vrijeme) | 14 dana | `/etc/logrotate.d/nginx` (Ubuntu) |
| Docker dnevnici API-ja i baze | 3 × 10 MB po kontejneru | `docker-compose.yml` |
| Snimci na našem serveru | dok Bunny ne obradi + 30 min | API |

Obrisan nalog ostaje u kopijama baze najviše 4 sedmice (najstarija sedmična kopija i snapshotovi Storage Boxa).

## Šta je isprobano lokalno (19.11.2026.)

- Nginx 1.24 s `server/nginx-komodo.conf` (privremena kopija, port 8095, bez IPv6): `nginx -t`; `/media/`
  služi `.mp4` kao `video/mp4` i `.jpg` kao `image/jpeg`, Range daje `206` i `Content-Range`, sigurnosna
  zaglavlja i HSTS su na odgovoru, listing direktorija `403`, skriveni fajl i nepostojeći `404`;
  `/.well-known/` daje `application/json` (i za AASA bez ekstenzije); `/app-verzija.json` `max-age=300`;
  `Server: nginx` bez verzije; u dnevniku nema upita ni tokena (`/?lozinka=…`, `/api/auth/verify?token=…`,
  Referer).
- `server/kopija-baze.sh` protiv Postgresa 16 (bez Dockera, preko `KOPIJA_DUMP`/`KOPIJA_LISTA`): kopija,
  provjera sadržaja, odbijena neispravna kopija, gpg šifrovanje, rsync na lokalni direktorij umjesto Storage
  Boxa (SSH dio nije isproban), čuvanje 7/4/5 po broju.
- Probno vraćanje: tabela u odjeljku 9.
- `server/nadzor.sh` sa `SUHO=1` i lažnim `docker compose ps`: disk, health, kontejneri, 5xx iz Nginx
  dnevnika, starost kopije, „jednom na sat”, „RIJEŠENO”, webhook (lokalni HTTP server). Email preko curl-a
  nije isproban (nema SMTP servera ovdje).
- `server/objava.sh` u privremenoj kopiji repozitorija s lažnim `docker`: uspjeh, „nema nove verzije”,
  odbijanje lokalnih izmjena, neuspio health (ispis i uputstvo za povratak), odbijanje na odvojenom HEAD-u,
  kopiranje `.well-known`.
- `server/db-init/10-komodo-app.sh` protiv Postgresa 16 (postojeća i prazna baza), API kao `komodo_app`.
- Nije isprobano: Docker slika (Docker Hub je ovdje blokiran), `docker compose up`, certbot, ufw, fail2ban,
  sshd, Hetzner konzola.
