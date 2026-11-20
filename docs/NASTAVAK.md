# Nastavak rada (stanje 20.11.2026.)

Integracija talasa 2 i 3 je završena (Nginx R-05/R-06/R-07, RUNBOOK R-10, CI R-11, dokumentacija, provjere).

Ostalo:
1. Recenzija 2 (Opus) za talase 2 i 3 (od commita 422bb1f).
2. Prenos na laptop (folderi `.claude` i `.github` idu zipom).
3. Nginx izmjene iz ove integracije isprobane su lokalno (privremena kopija, port 3996); na pravom serveru ih
   primijeniti po `docs/SERVER.md` i isprazniti keš (`sudo find /var/cache/nginx/komodo -mindepth 1 -delete`).
