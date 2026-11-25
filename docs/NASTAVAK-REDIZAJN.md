# Nastavak redizajna (stanje 25.11.2026., poslije popravki iz pregleda)

Grana `redizajn`. Gotovi koraci 1–12 iz `docs/DIZAJN.md` 4.1 (9 poruke + API polja, 10 prijava/registracija, 11 statistika/admin/nadogradnja,
12 čišćenje) i odluke od 25.11.: glavna boja koral + „Sjaj” (gradijent samo na glavnoj radnji, `docs/DIZAJN.md` odj. 6, `docs/SPEC-V1.md` odj. 7)
i tekst dugmeta na kartici „Kontaktiraj” (naslov prozora kontakta je ime butika; statički zadani tekst „Kontaktiraj butik”).

Popravljeni su nalazi D-01…D-12 i D-14 iz `docs/DIZAJN-PREGLED.md` (stanje popravki na kraju tog dokumenta); slike
`design/poslije/` su ponovo snimljene (`python3 design/snimi-slike.py`, upute u zaglavlju skripte).

Ostaje (malo):
- D-13: sličica proizvoda u razgovoru je ikona kamere dok nema pravog Bunnyja; u fazi 4 provjeriti da `thumbnail.jpg` stiže.
- Nativni ekran „Bez interneta” (`mobile/App.js`, odj. 2.19) nije dirnut — posao mobilnog developera.
- „Oglasi” u statistici nema podnaslov „najviše gledani prvo” (API ne garantuje taj redoslijed).
- Poslovi koji slijede su izvan redizajna: Stefanova recenzija slika `design/poslije/`, pa spajanje grane `redizajn` (glavna grana nije diran).
- Glavna grana (`master`) ima `GET /api/config` koji grana `redizajn` još nema (različita baza grana, ne posljedica redizajna).

Napomena za testove na probnoj bazi: prije prijava `delete from rate_limits`.
