#!/usr/bin/env bash
# Dnevna kopija baze. Pokreće se iz crona na serveru (vidi docs/SERVER.md, korak 8):
#
#   20 3 * * *  /home/stefan/komodo/server/kopija-baze.sh >> /var/log/komodo-kopija.log 2>&1
#
# Po uzoru na Terminko: pg_dump UNUTAR kontejnera, pipefail i provjera sadržaja,
# da prazna kopija ne bi izgledala kao ispravna.
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")/.."
DIR="${KOPIJE_DIR:-/backup}"
CILJ="$DIR/komodo-$(date +%F).sql.gz"
mkdir -p "$DIR"
trap 'rm -f "$CILJ.tmp"' EXIT

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$CILJ.tmp"

# Bez `grep -q`: zatvorena cijev bi gzipu dala SIGPIPE, a pipefail to proglasi greškom.
if ! gzip -t "$CILJ.tmp" || ! gzip -dc "$CILJ.tmp" | grep 'CREATE TABLE public.listings' > /dev/null; then
  echo "$(date -Is) KOPIJA NEISPRAVNA — nije sačuvana" >&2
  exit 1
fi
mv "$CILJ.tmp" "$CILJ"
echo "$(date -Is) kopija $CILJ ($(du -h "$CILJ" | cut -f1))"
find "$DIR" -name 'komodo-*.sql.gz' -mtime +14 -delete
