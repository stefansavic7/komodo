#!/usr/bin/env bash
# Objava nove verzije na serveru (docs/SERVER.md, odjeljak 4). Pokreće se ručno, kao stefan:
#
#   ~/komodo/server/objava.sh
#
# Redom: provjera da nema lokalnih izmjena → git pull → docker compose build → kopija baze (migracije se
# pokreću same pri startu API-ja) → docker compose up -d → čekanje da /api/health vrati 200 (najviše 60 s)
# → brisanje Nginx keša statičkih fajlova. Ako health ne prođe: ispis logova i uputstvo za povratak.
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

cd "$(dirname "$0")/.."

HEALTH_URL="${OBJAVA_HEALTH_URL:-http://127.0.0.1:3002/api/health}"
CEKAJ="${OBJAVA_CEKAJ:-60}"
NGINX_KES="${OBJAVA_NGINX_KES:-/var/cache/nginx/komodo}"
WELL_KNOWN="${OBJAVA_WELL_KNOWN:-/srv/komodo/well-known}"

korak() { echo; echo "== $*"; }
stani() { echo; echo "OBJAVA PREKINUTA: $*" >&2; exit 1; }

korak "Provjera repozitorija ($(pwd))"
grana=$(git symbolic-ref --short -q HEAD) \
  || stani "nisi na grani (vjerovatno poslije povratka na stariju verziju). Vrati se na granu: git checkout - (ili git checkout main)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  stani "na serveru postoje lokalne izmjene u kodu. Kod se mijenja samo preko GitHuba; pogledaj ih (git diff) i odbaci (git checkout -- FAJL) ili ih prvo prenesi na GitHub."
fi
prethodni=$(git rev-parse HEAD)

korak "git pull (grana $grana)"
git pull --ff-only
novi=$(git rev-parse HEAD)
if [ "$novi" = "$prethodni" ]; then
  echo "Nema nove verzije na GitHubu ($(git log -1 --format='%h %s'))."
  if [ "${1:-}" != "--svakako" ]; then
    echo "Ništa nije promijenjeno. Za ponovno pokretanje iste verzije: $0 --svakako"
    exit 0
  fi
else
  echo "Nove izmjene:"
  git log --oneline "$prethodni..$novi"
  if git diff --name-only "$prethodni" "$novi" | grep -E '^api/migrations/' > /dev/null; then
    echo "PAŽNJA: nova verzija ima migraciju baze:"
    git diff --name-only "$prethodni" "$novi" -- api/migrations/
  fi
fi

korak "Gradnja slike (stara verzija i dalje radi)"
docker compose build api

korak "Kopija baze prije objave"
server/kopija-baze.sh objava

korak "Pokretanje nove verzije (migracije se pokreću same)"
docker compose up -d

korak "Čekanje na $HEALTH_URL (najviše $CEKAJ s)"
kraj=$((SECONDS + CEKAJ))
odgovor=""
while [ "$SECONDS" -lt "$kraj" ]; do
  # -f: svaki kod osim 2xx je neuspjeh (health vraća 503 kad baza ne radi).
  if odgovor=$(curl -fsS -m 3 "$HEALTH_URL" 2>&1); then
    echo "Zdravo: $odgovor"
    if [ -d web/.well-known ]; then
      korak "Fajlovi za /.well-known/ (Universal Links, App Links) → $WELL_KNOWN"
      if [ -d "$WELL_KNOWN" ]; then
        rsync -a --delete web/.well-known/ "$WELL_KNOWN/"
        ls -l "$WELL_KNOWN"
      else
        echo "UPOZORENJE: nema $WELL_KNOWN — napravi ga po docs/SERVER.md 2.6, pa pokreni objavu ponovo s --svakako."
      fi
    fi
    korak "Brisanje Nginx keša (stari app.js i style.css)"
    if sudo test -d "$NGINX_KES"; then
      # find umjesto rm …/*: direktorij je vlasništvo www-data, pa bi zvjezdicu shell korisnika stefan
      # ostavio neraširenu i ništa se ne bi obrisalo.
      sudo find "$NGINX_KES" -mindepth 1 -delete
      echo "Obrisan keš $NGINX_KES"
    else
      echo "Nema keša $NGINX_KES (u redu ako Nginx još nije pokrenut)."
    fi
    docker compose ps
    echo
    echo "OBJAVA USPJELA: $(git log -1 --format='%h %s')"
    echo "Prethodna verzija je bila ${prethodni:0:12} (za povratak: docs/RUNBOOK.md, „Vraćanje prethodne verzije”)."
    exit 0
  fi
  sleep 2
done

echo
echo "Zadnji odgovor: ${odgovor:-nema}"
korak "docker compose ps"
docker compose ps || true
korak "Log API-ja (zadnjih 80 redova)"
docker compose logs api --tail 80 || true
korak "Log baze (zadnjih 20 redova)"
docker compose logs db --tail 20 || true

cat >&2 <<PORUKA

OBJAVA NIJE USPJELA: /api/health ne vraća 200 ni poslije $CEKAJ s.

Povratak na prethodnu verziju (${prethodni:0:12}):

  cd $(pwd)
  git checkout $prethodni
  docker compose up -d --build
  curl -s $HEALTH_URL

Migracija baze se NE vraća automatski. Ako je nova verzija imala migraciju (gore piše „PAŽNJA”) i stara
verzija ne radi s novom bazom, vrati bazu iz kopije napravljene prije objave (najnovija u /backup/objava/)
po docs/RUNBOOK.md, „Vraćanje baze iz kopije” — sve upisano poslije te kopije se gubi.

Kad je popravka na GitHubu: git checkout $grana && server/objava.sh
PORUKA
exit 1
