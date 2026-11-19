#!/usr/bin/env bash
# Nadzor servera iznutra (cron svakih 5 minuta, docs/SERVER.md 2.9). Vanjsku provjeru dostupnosti
# (server ne odgovara uopšte) radi besplatni servis za nadzor — ova skripta tada ne može ništa poslati.
#
#   */5 * * * *  /home/stefan/komodo/server/nadzor.sh >> /home/stefan/komodo-nadzor.log 2>&1
#
# Provjere: disk, slobodna memorija, kontejneri (running + healthy), /api/health, broj 5xx odgovora u
# Nginx dnevniku u zadnjih 5 minuta, budžet emailova za potvrdu potrošen (dnevnik API-ja), starost noćne kopije baze (i kopije van servera ako je podešena).
# Isto upozorenje se ne šalje češće od jednom na sat; kad problem nestane, šalje se „riješeno”.
#
# Slanje: email preko curl-a i istog SMTP_URL-a koji koristi API (api/.env), primalac NADZOR_EMAIL;
# i/ili NADZOR_WEBHOOK (POST s tekstom, npr. ntfy.sh tema). Bez ijednog — samo ispis u dnevnik.
#
# Podešavanja (u ~/komodo/.env; sve neobavezno osim primaoca):
#   NADZOR_EMAIL=stefan@primjer.ba   kome ide upozorenje
#   NADZOR_WEBHOOK=                  npr. https://ntfy.sh/tajna-tema
#   NADZOR_PING_URL=                 heartbeat poslije svake provjere (servis javi ako cron/server stane)
#   NADZOR_DISK=80                   % zauzetog diska
#   NADZOR_MEMORIJA=10               najmanje % dostupne memorije
#   NADZOR_5XX=20                    najviše 5xx odgovora u 5 minuta
#   NADZOR_LOG=/var/log/nginx/komodo.access.log
# Proba bez slanja: SUHO=1 server/nadzor.sh (upozorenja se samo ispišu).
# Za lokalnu probu bez Dockera: NADZOR_DOCKER_PS (komanda koja ispisuje „servis stanje zdravlje”),
# NADZOR_HEALTH_URL, NADZOR_API_LOG (komanda koja ispisuje dnevnik API-ja), NADZOR_STANJE (direktorij s vremenom zadnjeg upozorenja), KOPIJE_DIR.
set -uo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

cd "$(dirname "$0")/.."

iz_env() {
  local fajl=${2:-.env}
  [ -f "$fajl" ] || return 0
  grep -E "^$1=" "$fajl" | tail -n 1 | cut -d= -f2- || true
}
podesi() { local v="${!1:-}"; [ -n "$v" ] || v="$(iz_env "$1")"; echo "${v:-$2}"; }

EMAIL=$(podesi NADZOR_EMAIL "")
WEBHOOK=$(podesi NADZOR_WEBHOOK "")
PING=$(podesi NADZOR_PING_URL "")
PRAG_DISK=$(podesi NADZOR_DISK 80)
PRAG_MEM=$(podesi NADZOR_MEMORIJA 10)
PRAG_5XX=$(podesi NADZOR_5XX 20)
LOG=$(podesi NADZOR_LOG /var/log/nginx/komodo.access.log)
KOPIJE=$(podesi KOPIJE_DIR /backup)
VAN=$(podesi KOPIJA_VAN "")
HEALTH_URL=${NADZOR_HEALTH_URL:-http://127.0.0.1:3002/api/health}
API_LOG=${NADZOR_API_LOG:-docker compose logs api --since 5m --no-log-prefix}
DOCKER_PS=${NADZOR_DOCKER_PS:-docker compose ps -a --format '{{.Service}} {{.State}} {{.Health}}'}
STANJE=${NADZOR_STANJE:-$HOME/.komodo-nadzor}
SAT=3600
mkdir -p "$STANJE"

NOVO=()       # upozorenja za slanje
RIJESENO=()   # problemi koji su nestali

# alarm KLJUČ PORUKA — problem postoji. Šalje se ako nije poslan u zadnjih sat vremena.
alarm() {
  local f="$STANJE/$1" sada; sada=$(date +%s)
  if [ -f "$f" ] && [ $((sada - $(stat -c %Y "$f"))) -lt $SAT ]; then return; fi
  touch "$f"
  NOVO+=("$2")
}
# u_redu KLJUČ OPIS — provjera prošla; ako je ranije bilo upozorenje, javi da je riješeno.
u_redu() {
  if [ -f "$STANJE/$1" ]; then rm -f "$STANJE/$1"; RIJESENO+=("$2"); fi
}
starost_h() { echo $(( ($(date +%s) - $(stat -c %Y "$1")) / 3600 )); }

# 1. Disk (sistem i kopije baze)
for mjesto in / "$KOPIJE"; do
  [ -d "$mjesto" ] || continue
  posto=$(df -P "$mjesto" | awk 'NR==2 {gsub("%","",$5); print $5}')
  kljuc="disk$(echo "$mjesto" | tr '/' '_')"
  if [ "${posto:-0}" -ge "$PRAG_DISK" ]; then
    alarm "$kljuc" "Disk $mjesto je pun ${posto} % (prag $PRAG_DISK %). RUNBOOK: „Disk pun”."
  else
    u_redu "$kljuc" "Disk $mjesto: ${posto} %"
  fi
done

# 2. Memorija (MemAvailable uključuje keš koji se može osloboditi)
mem=$(awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if (t) print int(a*100/t); else print 100}' /proc/meminfo)
if [ "$mem" -lt "$PRAG_MEM" ]; then
  alarm memorija "Dostupno samo $mem % memorije (prag $PRAG_MEM %). Provjeri: docker stats --no-stream"
else
  u_redu memorija "Memorija: dostupno $mem %"
fi

# 3. Kontejneri: oba moraju biti running i healthy
ps_izlaz=$(bash -c "$DOCKER_PS" 2>&1) || ps_izlaz="GREŠKA $ps_izlaz"
for servis in db api; do
  red=$(echo "$ps_izlaz" | awk -v s="$servis" '$1 == s')
  if [ -z "$red" ]; then
    alarm "kontejner_$servis" "Kontejner $servis ne postoji ili docker ne odgovara: $(echo "$ps_izlaz" | head -n 3)"
  elif ! echo "$red" | grep -E "^$servis running healthy\$" > /dev/null; then
    alarm "kontejner_$servis" "Kontejner $servis nije zdrav: $red. Provjeri: docker compose logs $servis --tail 50"
  else
    u_redu "kontejner_$servis" "Kontejner $servis: running, healthy"
  fi
done

# 4. /api/health (od arhitektove izmjene vraća 503 kad baza ne radi; svaki kod osim 200 je problem)
if odg=$(curl -fsS -m 5 "$HEALTH_URL" 2>&1); then
  u_redu health "/api/health: $odg"
else
  alarm health "/api/health ne prolazi: $odg"
fi

# 5. Greške 5xx u Nginx dnevniku u zadnjih 5 minuta. Prvo polje je $time_iso8601 (isti format i vremenska
# zona kao `date -Iseconds`), pa se vrijeme poredi kao tekst. Samo zadnjih 200.000 redova (brzina).
if [ -r "$LOG" ]; then
  od=$(date -Iseconds -d '-5 min')
  broj=$(tail -n 200000 "$LOG" | awk -v od="$od" '$1 >= od && $2 ~ /^5/ {n++} END {print n+0}')
  if [ "$broj" -gt "$PRAG_5XX" ]; then
    alarm 5xx "$broj odgovora 5xx u zadnjih 5 minuta (prag $PRAG_5XX). RUNBOOK: „Skok grešaka 5xx”."
  else
    u_redu 5xx "5xx u zadnjih 5 minuta: $broj"
  fi
else
  alarm 5xx_log "Ne mogu čitati $LOG (stefan mora biti u grupi adm: sudo usermod -aG adm stefan)."
fi

# 5b. Budžet emailova za potvrdu (MAIL_POTVRDA_SAT, S-03): API to upiše u dnevnik kad pređe granicu, a novi
# nalozi tada ne dobijaju email odmah. Gleda se dnevnik API-ja u zadnjih 5 minuta. RUNBOOK: „Email budžet potrošen”.
if api_dnevnik=$(bash -c "$API_LOG" 2>&1); then
  budzet=$(printf '%s\n' "$api_dnevnik" | grep -c 'Budžet emailova za potvrdu je potrošen' || true)
  if [ "${budzet:-0}" -gt 0 ]; then
    alarm mail_budzet "Budžet emailova za potvrdu je potrošen (${budzet}× u zadnjih 5 minuta): novi nalozi ne dobijaju email. RUNBOOK: „Email budžet potrošen”."
  else
    u_redu mail_budzet "Budžet emailova za potvrdu: u granici"
  fi
fi

# 6. Kopija baze: najnovija noćna mlađa od 26 h; ako je podešena, i kopija van servera
zadnja=$(find "$KOPIJE/dnevne" -maxdepth 1 -name 'komodo-*.dump' 2>/dev/null | sort | tail -n 1)
if [ -z "$zadnja" ]; then
  alarm kopija "Nema nijedne noćne kopije baze u $KOPIJE/dnevne. Provjeri ~/komodo-kopija.log."
elif [ "$(starost_h "$zadnja")" -ge 26 ]; then
  alarm kopija "Zadnja kopija baze je stara $(starost_h "$zadnja") h ($zadnja). Provjeri ~/komodo-kopija.log."
else
  u_redu kopija "Kopija baze: $zadnja"
fi
if [ -n "$VAN" ]; then
  if [ ! -f "$KOPIJE/.zadnja-van" ] || [ "$(starost_h "$KOPIJE/.zadnja-van")" -ge 26 ]; then
    alarm kopija_van "Kopija van servera ($VAN) nije poslana u zadnjih 26 h. Provjeri ~/komodo-kopija.log."
  else
    u_redu kopija_van "Kopija van servera: $(cat "$KOPIJE/.zadnja-van")"
  fi
fi

# --- slanje ---
[ -n "$PING" ] && { curl -fsS -m 10 -o /dev/null "$PING" || echo "$(date -Is) heartbeat nije javljen"; }

[ ${#NOVO[@]} -eq 0 ] && [ ${#RIJESENO[@]} -eq 0 ] && exit 0

server=$(hostname)
tekst=""
for p in "${NOVO[@]}"; do tekst+="PROBLEM: $p"$'\n'; done
for p in "${RIJESENO[@]}"; do tekst+="RIJEŠENO: $p"$'\n'; done
naslov="Komodo nadzor ($server): ${#NOVO[@]} upozorenja, ${#RIJESENO[@]} rijeseno"

echo "$(date -Is) $naslov"
printf '%s' "$tekst"

if [ "${SUHO:-0}" = 1 ]; then
  echo "(SUHO=1: ništa nije poslano)"
  exit 0
fi

poslano=0
if [ -n "$WEBHOOK" ]; then
  curl -fsS -m 10 -o /dev/null -H "Title: $naslov" --data-binary "$tekst" "$WEBHOOK" && poslano=1 \
    || echo "$(date -Is) webhook nije uspio"
fi

if [ -n "$EMAIL" ]; then
  SMTP_URL=$(iz_env SMTP_URL api/.env)
  OD=$(iz_env MAIL_FROM api/.env | sed -E 's/.*<([^>]+)>.*/\1/')
  if [ -z "$SMTP_URL" ] || [ -z "$OD" ]; then
    echo "$(date -Is) email nije poslan: SMTP_URL ili MAIL_FROM nisu u api/.env"
  else
    # nodemailer adresa: smtps://korisnik:lozinka@host:465 (TLS odmah) ili smtp://…:587 (STARTTLS).
    # Upit iza „?” (opcije nodemailera) curl ne razumije, pa se odbacuje. Adresa s lozinkom ide kroz
    # konfiguraciju na ulazu (-K -), ne kao argument, da se ne vidi u `ps`.
    url=${SMTP_URL%%\?*}
    poruka=$(printf 'From: Komodo nadzor <%s>\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n' \
      "$OD" "$EMAIL" "$naslov" "$tekst")
    if printf 'url = "%s"\n' "$url" | curl -sS -m 30 -K - --ssl-reqd \
         --mail-from "$OD" --mail-rcpt "$EMAIL" --upload-file <(printf '%s' "$poruka"); then
      poslano=1
    else
      echo "$(date -Is) email nije poslan (curl)"
    fi
  fi
fi

if [ "$poslano" = 0 ] && { [ -n "$EMAIL" ] || [ -n "$WEBHOOK" ]; }; then
  # Ništa nije otišlo: poništi „poslano”, da sljedeća provjera pokuša ponovo umjesto da čeka sat.
  for f in "$STANJE"/*; do [ -f "$f" ] && [ $(( $(date +%s) - $(stat -c %Y "$f") )) -lt 60 ] && rm -f "$f"; done
  exit 1
fi
exit 0
