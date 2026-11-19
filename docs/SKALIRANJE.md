# Skaliranje Komoda: cilj, mjerenja i ugovor između dijelova

Cilj: **40.000 istovremenih korisnika** i talas od **10.000 registracija u 7 dana** bez grešaka i bez
usporavanja. Polazna mjerenja (19.11.2026., `claude/08-analiza-19-11.md` u projektu): jedan Node proces
izdrži oko 2.000 zahtjeva/s; sadašnji klijent pravi ~0,36 zahtjeva/s po korisniku.

## Proračun

| Stavka | Sada | Cilj poslije izmjena |
|---|---|---|
| Zahtjeva/s po korisniku u feedu | 0,36 | ≤ 0,13 |
| 40.000 korisnika | ~14.400 zahtjeva/s | ≤ 5.200 zahtjeva/s |
| Registracije | 10.000 / 7 dana ≈ 0,02/s prosječno; vrh poslije reklame ~5/s | scrypt ~54/s po 4 niti → dovoljno |

Za 5.200 zahtjeva/s treba više Node procesa (po jedan na jezgro) i manje rada baze po zahtjevu.

## Ugovor API ↔ klijent (obavezno za oba tima)

1. `POST /api/listings/:id/like` prima JSON `{ "liked": true|false }` i postavlja to stanje (idempotentno).
   Bez tijela radi kao do sada (prekidač). Odgovor: `{ liked, likes }`.
2. `POST /api/views` prima `{ "ids": [1,2,3] }` (najviše 50 id-jeva). Broji jedan pregled po oglasu, po
   gledaocu, po danu. Gledalac je prijavljeni korisnik, a za neprijavljene uređaj (kolačić `did`, koji server
   postavlja sam). Odgovor `{ ok: true }`. Vlasnikovi pregledi se ne broje. Stara ruta
   `POST /api/listings/:id/view` ostaje i radi isto za jedan id.
3. `GET /api/listings` kad ima `shop=` ili `liked=1`, a nema `before=`, vraća i `ukupno` (ukupan broj
   oglasa butika, odnosno sviđanja kupca). Stranice i dalje po 20, s `before=<id zadnjeg>`.
4. `GET /api/likes?ids=…` ostaje; klijent ga zove samo za oglas na ekranu.
5. Sve ostale rute i oblici odgovora ostaju isti.

## Ponašanje klijenta (tajmeri)

| Šta | Sada | Novo |
|---|---|---|
| Osvježavanje sviđanja | svih ~100 učitanih oglasa, svakih 5 s | samo oglas na ekranu, svakih 15 s, samo dok je stranica vidljiva |
| Pregledi | zahtjev po videu | skupljeno, `POST /api/views` svakih 30 s i kad se stranica sakrije |
| `/api/me` (značka poruka) | 30 s | 60 s, samo dok je stranica vidljiva |
| Profil (vlastiti) | svakih 5 s | svakih 30 s, samo dok je vidljiv |
| Otvoren razgovor | 4 s | 4 s, pauza dok stranica nije vidljiva |

## Server (API)

- Više procesa: `api/src/index.js` pokreće migracije jednom, pa `WORKERS` procesa (zadano: broj jezgara).
  Pozadinski poslovi (Bunny, email butiku, čišćenje) samo u prvom procesu.
- Keš prijava (15 s) i keš javnog feeda (5 s) u svakom procesu.
- `listings.likes_count` umjesto brojanja pri svakom čitanju.
- Ograničenja (prijava, registracija, poruke, prijave, zaboravljena lozinka) u bazi, zajednička za sve procese,
  i prilagođena dijeljenim IP adresama mobilnih operatera.
- Registracija bez grešaka 500 pri istovremenim zahtjevima.
- Indeksi za pretragu (`pg_trgm`), kategoriju i butik.
- Bez zapisivanja svakog uspješnog zahtjeva (`LOG_REQUESTS=1` ga uključuje).
