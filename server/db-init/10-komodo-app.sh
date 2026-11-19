#!/bin/sh
# Korisnik baze za API: komodo_app, BEZ superusera (nalaz S-17 u docs/SIGURNOST.md).
#
# - Nova baza: službena Postgres slika ovo pokrene sama, jednom, pri prvom pokretanju (prazan volumen),
#   jer je server/db-init montiran u /docker-entrypoint-initdb.d (docker-compose.yml).
# - Postojeća baza (npr. proba na Terminkovom serveru): pokreće se ručno, docs/SERVER.md odjeljak 10:
#     docker compose exec -T db sh /docker-entrypoint-initdb.d/10-komodo-app.sh
#   Može se pokretati više puta (postavi lozinku iz KOMODO_APP_PASSWORD i preuzme vlasništvo nad tabelama).
#
# komodo_app je vlasnik baze i tabela: API i dalje sam pokreće migracije (pravi tabele i indekse), a
# `create extension pg_trgm` (migracija 008) radi jer je pg_trgm „trusted” ekstenzija (dovoljno je biti
# vlasnik baze). Superuser `komodo` (POSTGRES_USER) ostaje samo za psql, kopije i ovakve izmjene.
# Ne može: COPY … PROGRAM, čitanje fajlova servera, pravljenje drugih korisnika i baza.
set -eu

: "${KOMODO_APP_PASSWORD:?KOMODO_APP_PASSWORD nije postavljen (u .env)}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v lozinka="$KOMODO_APP_PASSWORD" -v baza="$POSTGRES_DB" <<'SQL'
select 'create role komodo_app login'
 where not exists (select 1 from pg_roles where rolname = 'komodo_app') \gexec
alter role komodo_app with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'lozinka';
alter database :"baza" owner to komodo_app;
-- Postojeće tabele, pogledi i samostalne sekvence u šemi public (sekvence kolona idu same s tabelom),
-- i funkcije koje nisu dio ekstenzije.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as ime, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and pg_get_userbyid(c.relowner) <> 'komodo_app'
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i', 'e'))
  loop
    execute format('alter %s %s owner to komodo_app',
      case r.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view'
                     when 'f' then 'foreign table' else 'table' end, r.ime);
  end loop;
  for r in
    select p.oid::regprocedure as ime
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and pg_get_userbyid(p.proowner) <> 'komodo_app'
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter routine %s owner to komodo_app', r.ime);
  end loop;
end $$;
select 'komodo_app: vlasnik baze ' || current_database() || ', superuser: ' || rolsuper::text
  from pg_roles where rolname = 'komodo_app';
SQL
