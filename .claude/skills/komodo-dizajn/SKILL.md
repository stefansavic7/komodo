---
name: komodo-dizajn
description: Kako se radi redizajn Komoda — vanjske smjernice za mobilni UI i web interfejs, ograničenja projekta, tok rada na grani redizajn i šta se predaje. Učitaj prije svakog posla na izgledu ili toku ekrana.
---

# Redizajn Komoda

## 1. Vanjske smjernice (čitaj na početku svakog posla, ne kopiraj u repozitorij)

1. **Mobilni UI — `ceorkm/mobile-app-ui-design` (MIT):**
   `https://raw.githubusercontent.com/ceorkm/mobile-app-ui-design/main/SKILL.md` i
   `https://raw.githubusercontent.com/ceorkm/mobile-app-ui-design/main/references/industry-conventions.md`.
   Iz nje uzimaš proces u 5 koraka (kontekst → struktura → vizuelna pravila → emocija → dorada), 60/30/10 za boje,
   mrežu od 8 px, najviše 4 veličine i 2 debljine slova, zonu palca (glavne radnje u donjoj trećini), Peak-End
   (vrhunac i kraj toka) i spisak anti-obrazaca.
2. **Web interfejs — Vercel `web-interface-guidelines`:**
   `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`.
   To je kontrolna lista za reviziju (pristupačnost, fokus, forme, animacija, tipografija, sadržaj, slike,
   performanse, dodir, sigurne zone, tamna tema, lokalizacija) i format nalaza `fajl:red – problem`.

Ako preuzimanje ne uspije, reci to u izvještaju i radi po pravilima iz odjeljka 2 — ne izmišljaj sadržaj smjernica.

## 2. Ograničenja Komoda (imaju prednost nad vanjskim smjernicama)

- **Tehnika:** običan HTML/CSS/JS bez gradnje, ES5 stil u `web/js/*.js`, bez React-a, Tailwinda i biblioteka ikona.
  Preporuke iz smjernica za React/Tailwind/Lucide prevedi u CSS varijable i ručno pisane SVG ikone.
- **Jezik:** bosanski, ijekavica. Pravilo „Title Case” iz Vercel smjernica ne važi — kod nas samo prvo slovo
  rečenice ili naziva. Tekstovi iz `docs/SPEC-V1.md` ostaju dok proizvod ne odobri izmjenu.
- **Brend danas** (`web/style.css`): tamna tema (`--ink #16121a`, `--surface`, `--line`), naglasak `--accent #ff6a4d`,
  etiketa s cijenom `--tag #ffd95a` (logo je etiketa s cijenom — ostaje), fontovi Bricolage Grotesque (naslovi) i
  Figtree (tekst) sa svog servera. Promjena brenda je odluka za Stefana — predloži, ne mijenjaj sam.
- **Video je glavni sadržaj:** feed preko cijelog ekrana; ništa ne smije pokrivati proizvod, cijenu i dugme za
  kontakt. Cijena i veličine moraju se pročitati za sekundu.
- **Performanse:** bez novih zahtjeva po korisniku (budžet ≤ ~7 API zahtjeva u minuti), bez velikih slika i
  fontova (novi font ili debljina samo uz obrazloženje i mjerenje), animacije samo `transform`/`opacity`, poštuj
  `prefers-reduced-motion`.
- **Pristupačnost:** dodirne površine najmanje 44×44, kontrast teksta najmanje 4,5:1 (velikog 3:1), vidljiv fokus,
  oznake za ikone, sigurne zone (`env(safe-area-inset-*)`).
- **Ekrani:** provjera na 360×780, 390×844 i 430×932; WebView (iOS i Android) i mobilni Chrome/Safari.
- **Omotač:** `window.__komodo*` funkcije i `toApp` poruke se ne smiju pokvariti (`docs/PRODAVNICE.md`, odjeljak 9).

## 3. Tok rada

1. **Grana:** sve na grani `redizajn` (`git switch -c redizajn` ili `git switch redizajn`). Glavna grana se ne dira.
2. **Revizija:** prođi aplikaciju kao kupac, butik i administrator u pregledniku (Playwright, 3 veličine ekrana),
   napravi slike ekrana u `design/prije/`, i zapiši nalaze u `docs/DIZAJN-REVIZIJA.md` — po ekranu, s ozbiljnošću
   i formatom `fajl:red – problem` za nalaze iz Vercel liste.
3. **Pravac:** 2–3 različita vizuelna pravca (npr. „topli butik”, „čisti katalog”, „noćni izlog”) kao statički
   HTML nacrti u `design/pravci/` za iste 3 ključne slike: feed, profil butika, objava oglasa. Svaki s kratkim
   obrazloženjem: kome odgovara, šta se gubi. Stefan bira.
4. **Dizajn sistem** za izabrani pravac u `docs/DIZAJN.md`: boje (uloge, ne samo kodovi; 60/30/10), tipografija
   (najviše 4 veličine, 2 debljine), razmaci (mreža 8 px), radijusi, sjene, ikone, stanja (prazno, učitavanje,
   greška, uspjeh), pokret; zatim komponente (kartica oglasa, dugmad, tableti, prozori, polja, trake).
5. **Ekrani:** nacrti svih ekrana u `design/ekrani/`, pa specifikacija za frontend (šta se mijenja u kojem fajlu).
   Implementaciju radi frontend na grani `redizajn`; dizajner pregleda svaku izmjenu slikom ekrana.
6. **Dokaz:** slike prije/poslije u `design/poslije/`, ista Vercel kontrolna lista bez otvorenih ozbiljnih nalaza,
   svi e2e testovi (`tests/`) zeleni, broj API zahtjeva u minuti nije porastao.

## 4. Predaja

- `docs/DIZAJN-REVIZIJA.md`, `docs/DIZAJN.md`, `design/` (nacrti i slike).
- Kratak izvještaj: pravci i preporuka, šta treba od Stefana (izbor pravca, eventualna promjena brenda), rizici.
- Ništa se ne spaja u glavnu granu bez Stefanovog odobrenja i recenzije.
