#!/usr/bin/env bash
# Kopija baze: lokalno na serveru, pa (ako je podešeno) šifrovana kopija van servera (Hetzner Storage Box,
# rsync preko SSH-a). Uputstvo: docs/SERVER.md (2.8) i docs/RUNBOOK.md (vraćanje i probno vraćanje).
#
#   kopija-baze.sh           noćna kopija (cron, 03:20): /backup/dnevne, nedjeljom i /backup/sedmicne,
#                            pa slanje van servera
#   kopija-baze.sh objava    kopija prije objave nove verzije (server/objava.sh): /backup/objava, bez slanja
#
# Čuva se: 7 dnevnih, 4 sedmične (nedjeljne), 5 prije objave. Briše se po broju, ne po starosti: ako kopije
# danima ne uspijevaju, stare ostaju.
#
# Podešavanja (u ~/komodo/.env ili kao varijable okruženja; sve je neobavezno):
#   KOPIJE_DIR=/backup                                  gdje su lokalne kopije
#   KOPIJA_VAN=uXXXXX@uXXXXX.your-storagebox.de:komodo  kuda ide kopija van servera (prazno = ne šalje se)
#   KOPIJA_VAN_PORT=23                                  SSH port Storage Boxa za rsync
#   KOPIJA_VAN_KLJUC=/home/stefan/.ssh/komodo_kopija    SSH ključ za Storage Box
#   KOPIJA_SIFRA_FAJL=/home/stefan/.komodo-kopija-sifra lozinka za gpg; ako postoji, van ide samo šifrovano
#   KOPIJA_PING_URL=https://…                           adresa koja se pozove poslije uspjele noćne kopije
#                                                       (heartbeat u servisu za nadzor; prazno = ništa)
# Samo za lokalnu probu (bez Dockera): KOPIJA_DUMP i KOPIJA_LISTA zamjenjuju komande ispod.
#
# Format: pg_dump -Fc (sažet, vraća se s pg_restore). Provjera: sadržaj kopije mora imati tabelu listings,
# da prazna ili prekinuta kopija ne bi izgledala kao ispravna.
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
umask 077

cd "$(dirname "$0")/.."

# Vrijednost iz .env (bez izvršavanja fajla: .env je za docker compose, ne za bash).
iz_env() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true
}

OZNAKA="${1:-dnevna}"
case "$OZNAKA" in dnevna|objava) ;; *) echo "Upotreba: $0 [objava]" >&2; exit 2 ;; esac

DIR="${KOPIJE_DIR:-$(iz_env KOPIJE_DIR)}"; DIR="${DIR:-/backup}"
VAN="${KOPIJA_VAN:-$(iz_env KOPIJA_VAN)}"
VAN_PORT="${KOPIJA_VAN_PORT:-$(iz_env KOPIJA_VAN_PORT)}"; VAN_PORT="${VAN_PORT:-23}"
VAN_KLJUC="${KOPIJA_VAN_KLJUC:-$(iz_env KOPIJA_VAN_KLJUC)}"; VAN_KLJUC="${VAN_KLJUC:-$HOME/.ssh/komodo_kopija}"
SIFRA="${KOPIJA_SIFRA_FAJL:-$(iz_env KOPIJA_SIFRA_FAJL)}"
PING="${KOPIJA_PING_URL:-$(iz_env KOPIJA_PING_URL)}"
DUMP="${KOPIJA_DUMP:-docker compose exec -T db sh -c 'pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Fc --no-owner'}"
LISTA="${KOPIJA_LISTA:-docker compose exec -T db pg_restore -l}"

log() { echo "$(date -Is) $*"; }
greska() { echo "$(date -Is) GREŠKA: $*" >&2; exit 1; }

mkdir -p "$DIR/dnevne" "$DIR/sedmicne" "$DIR/objava"

# Noćna kopija i kopija prije objave ne smiju raditi istovremeno.
exec 9> "$DIR/.zakljucano"
flock -w 900 9 || greska "druga kopija radi duže od 15 minuta"

if [ "$OZNAKA" = objava ]; then
  CILJ="$DIR/objava/komodo-$(date +%F-%H%M%S).dump"
else
  CILJ="$DIR/dnevne/komodo-$(date +%F).dump"
fi
trap 'rm -f "$CILJ.tmp" "$CILJ.gpg.tmp"' EXIT

bash -c "$DUMP" > "$CILJ.tmp"

# Bez `grep -q`: zatvorena cijev bi dala SIGPIPE, a pipefail to proglasi greškom.
if [ ! -s "$CILJ.tmp" ] || ! bash -c "$LISTA" < "$CILJ.tmp" | grep -E 'TABLE public listings ' > /dev/null; then
  greska "KOPIJA NEISPRAVNA — nije sačuvana ($CILJ)"
fi
mv "$CILJ.tmp" "$CILJ"
log "kopija $CILJ ($(du -h "$CILJ" | cut -f1))"

# Šifrovana verzija (za slanje van servera). Lokalna kopija ostaje nešifrovana radi brzog vraćanja.
if [ -n "$SIFRA" ]; then
  [ -r "$SIFRA" ] || greska "KOPIJA_SIFRA_FAJL=$SIFRA ne postoji ili se ne može čitati"
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$SIFRA" \
      --symmetric --cipher-algo AES256 -o "$CILJ.gpg.tmp" "$CILJ"
  mv "$CILJ.gpg.tmp" "$CILJ.gpg"
fi

if [ "$OZNAKA" = dnevna ] && [ "$(date +%u)" = 7 ]; then
  cp -p "$CILJ" "$DIR/sedmicne/"
  [ -f "$CILJ.gpg" ] && cp -p "$CILJ.gpg" "$DIR/sedmicne/"
  log "sedmična kopija $DIR/sedmicne/$(basename "$CILJ")"
fi

# Čuvanje po broju: imena sadrže datum, pa abecedni red = hronološki.
zadrzi() {
  local dir=$1 broj=$2 f
  find "$dir" -maxdepth 1 -name 'komodo-*.dump' | sort -r | tail -n +"$((broj + 1))" | while read -r f; do
    rm -f "$f" "$f.gpg"
    log "obrisana stara kopija $f"
  done
  # Šifrovane kopije bez para (npr. šifrovanje uključeno pa isključeno).
  find "$dir" -maxdepth 1 -name 'komodo-*.dump.gpg' | while read -r f; do
    [ -f "${f%.gpg}" ] || rm -f "$f"
  done
}
zadrzi "$DIR/dnevne" 7
zadrzi "$DIR/sedmicne" 4
zadrzi "$DIR/objava" 5

[ "$OZNAKA" = dnevna ] || exit 0

if [ -n "$VAN" ]; then
  if [ -n "$SIFRA" ]; then UZORAK='*.dump.gpg'; else UZORAK='*.dump'; log "UPOZORENJE: kopija van servera nije šifrovana (KOPIJA_SIFRA_FAJL)"; fi
  # --delete: na Storage Boxu ostaje isto što i lokalno (7 dnevnih, 4 sedmične). Od slučajnog ili
  # zlonamjernog brisanja štite automatski snapshotovi Storage Boxa (docs/SERVER.md, 2.8).
  rsync -a --delete --include='*/' --include="$UZORAK" --exclude='*' \
    -e "ssh -p $VAN_PORT -i $VAN_KLJUC -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
    "$DIR/dnevne" "$DIR/sedmicne" "$VAN/" \
    || greska "KOPIJA VAN SERVERA NIJE USPJELA (lokalna kopija $CILJ je sačuvana)"
  date -Is > "$DIR/.zadnja-van"
  log "poslano van servera: $VAN"
fi

if [ -n "$PING" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$PING" || log "UPOZORENJE: heartbeat nije javljen ($PING)"
fi
