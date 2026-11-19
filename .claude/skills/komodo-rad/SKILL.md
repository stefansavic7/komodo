---
name: komodo-rad
description: Pravila rada za svakog člana tima na Komodu (API, web, mobilna, server, testovi). Učitaj prije bilo kakve izmjene u repozitoriju.
---

# Kako se radi na Komodu

1. Pročitaj `CLAUDE.md`, `docs/PLAN-PRODUKCIJA.md` i dokument svoje oblasti (`docs/SKALIRANJE.md`,
   `docs/SPEC-V1.md`, `docs/SIGURNOST.md`, `docs/SERVER.md`).
2. Mijenjaj samo fajlove koje tvoja uloga posjeduje (tabela u `docs/PLAN-PRODUKCIJA.md`, odjeljak 2).
   Treba ti izmjena u tuđem fajlu → napiši je u izvještaju, ne radi je sam.
3. Tehnika: Node 22, ESM, Fastify, `pg`, običan JavaScript bez gradnje i bez TypeScripta. Web je običan
   HTML/CSS/JS u ES5 stilu (`var`, `function`). Nove zavisnosti samo ako nema razumne alternative — obrazloži.
4. Bosanski jezik, ijekavica: tekstovi u aplikaciji, poruke grešaka, komentari, dokumentacija.
5. Baza: samo nova migracija `api/migrations/NNN_ime.sql`; postojeće se ne mijenjaju.
6. Svaka izmjena mora biti provjerena pokretanjem: `node --check`, testovi iz `api/test`, a za ekrane
   prolazak u pregledniku (Playwright, `/usr/bin/google-chrome`, 390×844).
7. Performanse: cilj je 20.000 istovremenih korisnika (`docs/SKALIRANJE.md`). Nova ruta koja se zove često
   mora imati indeks, ograničenu veličinu odgovora i po mogućnosti keš. Klijent ne smije dodavati tajmere
   koji rade dok je stranica sakrivena.
8. Tajne: `api/.env`, `mobile/.env`, ključevi, `google-services.json`, keystore — nikad se ne čitaju, ne
   kopiraju, ne ispisuju i ne commituju.
9. Komande za server, laptop, EAS i bazu se ne izmišljaju: prepisuju se iz `docs/SERVER.md`, `README.md`
   ili `CLAUDE.md`, uz navod odakle su.
10. Izvještaj na kraju: šta je urađeno, izmijenjeni fajlovi, šta je izmjereno (samo stvarno izmjereno),
    šta nije urađeno, rizici, i šta treba od drugih uloga.

## Lokalno okruženje u cloud sesiji

- PostgreSQL 16: `127.0.0.1:55432`, korisnik `postgres` bez lozinke. Pokretanje ako ne radi:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgsnimi -o '-p 55432 -k /tmp' -l /tmp/pg.log start"`.
- Svaki agent pravi svoju bazu (`komodo_<uloga>`) i koristi svoj port (dodijeljen u zadatku).
  Ne gasi tuđe procese (`pkill node` je zabranjen; gasi samo svoj PID).
- Baza `komodo_load` (10.100 korisnika, 10.000 oglasa, sesije `'tok'||id`) je zajednička za test opterećenja —
  ne brisati.
