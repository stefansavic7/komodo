# Komodo — plan do produkcije (firma AI inženjera)

Početak: 19.11.2026. Cilj: aplikacija spremna za objavu u prodavnicama i za **20.000 istovremenih
korisnika**, s rezervom za talas poslije reklama. Stefan je posrednik: kupuje naloge i servere, odobrava
troškove i radi ono što traži njegov identitet (prodavnice, pravnik, banka). Sve ostalo radi tim.

## 1. Definicija „spremno za produkciju”

Objavljujemo tek kad je sve ispod zeleno:

| # | Uslov | Kako se dokazuje |
|---|---|---|
| 1 | Funkcije v1 rade (odjeljak 3) | e2e testovi u pregledniku prolaze |
| 2 | 20.000 istovremenih korisnika na pravom serveru, p95 < 300 ms, 0 grešaka 5xx | test opterećenja s druge mašine na kupljeni server |
| 3 | Ispravnost pri istovremenosti (sviđanja, registracije, poruke, pregledi) | `api/test` + test istovremenosti |
| 4 | Nema otvorenog sigurnosnog nalaza visokog ili srednjeg rizika | `docs/SIGURNOST.md` |
| 5 | Automatski testovi na svaki push (GitHub Actions) | zelen CI |
| 6 | Kopija baze van servera, isprobano vraćanje | zapis u `docs/RUNBOOK.md` |
| 7 | Nadzor: znamo za pad ili grešku u roku od 5 minuta | probni pad servera |
| 8 | Email za registracije podnosi talas (10.000 u 7 dana) | servis za transakcione emailove |
| 9 | Pravne stranice pregledao pravnik | Stefan |
| 10 | Android i iPhone aplikacija odobrene | Stefan + EAS |

## 2. Organizacija tima

Uloge su definisane u `.claude/agents/` (može ih pokrenuti i Claude Code na laptopu), a zajednička pravila
u `.claude/skills/komodo-rad/SKILL.md`.

| Uloga | Odgovornost | Fajlovi koje posjeduje |
|---|---|---|
| Direktor tehnike (glavna sesija) | plan, raspodjela, spajanje, odluke, izvještaj Stefanu | `docs/PLAN-PRODUKCIJA.md`, `CLAUDE.md` |
| Arhitekt | struktura koda, ugovori API↔klijent, migracije | `api/src/` (struktura), ugovori u `docs/` |
| Backend | API, baza, pozadinski poslovi | `api/src/`, `api/migrations/` |
| Frontend | web aplikacija | `web/` |
| Mobilni | Expo omotač, prodavnice | `mobile/`, `docs/PRODAVNICE.md` |
| DevOps | server, Nginx, Docker, kopije, nadzor | `server/`, `Dockerfile`, `docker-compose.yml`, `docs/SERVER.md`, `docs/RUNBOOK.md` |
| Kvalitet (QA) | automatski testovi, CI, testovi opterećenja | `api/test/`, `tests/`, `.github/`, `api/package.json` |
| Sigurnost | revizija, nalazi, provjera popravki | `docs/SIGURNOST.md` |
| Proizvod i UX | specifikacija funkcija, tekstovi, tok ekrana | `docs/SPEC-V1.md` |
| Recenzent | nezavisni pregled prije spajanja | samo čita |

Pravilo rada u paraleli: dva agenta nikad ne mijenjaju isti fajl u istoj fazi. Svaka faza se završava
spajanjem, pokretanjem svih testova i lokalnim git commitom (`/home/claude/snimi`), pa prenosom na laptop.

## 3. Obim verzije 1 (odluka tima)

Uzeto iz analize 19.11. (`claude/08-analiza-19-11.md`, odjeljci 4 i 6), bez pretjerivanja:

1. **Algoritam feeda**: kartice „Za tebe” (ocjena: svježina × kvalitet × lično × pravila, raznolikost,
   otkrivanje) i „Novo” (najnovije prvo) i „Praćeni”.
2. **Pregled linka pri dijeljenju** (Open Graph: sličica, naziv, cijena) — glavni besplatni kanal rasta.
3. **Veličine** na oglasu i filter po veličini.
4. **Praćenje butika**.
5. **Adresa i radno vrijeme butika** s linkom na mapu.
6. **Statistika za butik** (pregledi, sviđanja, poruke po oglasu).
7. **Obavještenje o sniženju** za označene oglase (push).
8. **Brza pitanja** u poruci.
9. **Brojke za administratora** (aktivni korisnici, novi oglasi, poruke po danu).

Namjerno van v1: plaćanje u aplikaciji, dostava, recenzije, više gradova, AI, chat preko WebSocketa.

## 4. Odluke tima koje mijenjaju dosadašnje ponašanje

- **Snimak u obradi:** na velikom prometu jedan novi snimak s našeg servera mogu istovremeno tražiti hiljade
  ljudi. Zato oglas u obradi vidi samo vlasnik (s oznakom „Obrađuje se”), a svi ostali tek kad je snimak na
  Bunnyju (obično 1–3 minute). Ako Bunny nije podešen (razvoj), ponašanje ostaje kao sada.
  Nginx služi `/media/` direktno s diska, bez Node procesa.
- **Email:** Zoho šalje najviše 500 emailova dnevno po korisniku. Talas od 10.000 registracija za 7 dana
  je ~1.400 emailova dnevno samo za potvrde. Treba servis za transakcione emailove (SMTP ostaje isti u kodu,
  mijenja se samo `SMTP_URL`). Stefan otvara nalog kad tim predloži servis.
- **Server od početka dovoljno jak za 20.000:** izbor se potvrđuje testom na pravom serveru (faza 4).

## 5. Faze

**Faza 0 — osnivanje (urađeno 19.11.)**: ovaj plan, uloge i pravila, lokalni git.

**Faza 1 — temelji (paralelno, fajlovi se ne preklapaju)**
- Arhitekt: `server.js` i `app.js` dijeli na module bez promjene ponašanja (da faza 2 može raditi u paraleli);
  detaljnija `/api/health`.
- QA: automatski testovi API-ja (preko HTTP-a), test istovremenosti i opterećenja u repozitoriju, e2e u
  pregledniku, GitHub Actions.
- Sigurnost: revizija cijelog koda → `docs/SIGURNOST.md`.
- Proizvod i UX: `docs/SPEC-V1.md` — tačan ugovor, baza, ekrani i tekstovi za obim iz odjeljka 3.
- DevOps: skripta za objavu nove verzije, kopija baze van servera, nadzor i upozorenja, Nginx za `/media/`,
  `docs/RUNBOOK.md`.
- Mobilni: spremnost omotača za prodavnice (bez mreže, greške, vanjski linkovi, verzija).

**Faza 2 — izgradnja**: sigurnosne popravke, pa funkcije v1 po specifikaciji (backend i frontend po paketima),
svaki paket s testovima.

**Faza 3 — dokaz**: nezavisni pregled koda, svi testovi, test opterećenja lokalno, ažurirana dokumentacija.

**Faza 4 — sa Stefanom**: server, domena, email servis, kopije van servera, nadzor; test opterećenja na pravom
serveru; EAS build i prodavnice; pravnik; lansiranje.

## 6. Šta treba od Stefana (samo ovo)

| Kada | Šta |
|---|---|
| Faza 2 | Push na GitHub poslije svake faze (Claude nema pravo pisanja u repozitorij) |
| Faza 4 | Kupovina servera i domene, nalog za email servis i za kopije van servera |
| Faza 4 | Expo/EAS, Firebase, App Store i Google Play (postojeći nalozi od Terminka) |
| Faza 4 | Pravnik i knjigovođa |
| Uvijek | Odobrenje svakog troška |
