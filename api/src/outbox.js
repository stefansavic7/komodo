// Odgođeni poslovi koji se ne gube (talas 4, outbox; tabela outbox iz migracija 013 i 014).
// Push o novoj poruci (src/rute/poruke.js) i o sniženju (src/snizenje.js) se prvo upisuju u bazu, u istoj
// naredbi/transakciji kao poruka, odnosno izmjena cijene. Ovaj posao (src/poslovi.js, svake sekunde, samo u
// radniku s poslovima — ali bezbjedno i u više procesa) ih šalje:
//   1. „zakupi” redove: `update … set run_at = now() + zakup, pokusaja + 1, zakup = <oznaka prolaza> … for update skip
//      locked` — red koji je jedan proces uzeo drugi ne vidi dok zakup (OUTBOX_ZAKUP_S, zadano 120 s) ne istekne;
//   2. prije svake serije produži zakup redova serije — samo onih koji još nose oznaku ovog prolaza (R3-08: ako je
//      zakup istekao usred dugog prolaza i red je preuzeo drugi prolaz, ovaj ga ne šalje);
//   3. pošalje ih (serije do 100 poruka po zahtjevu prema Expo-u) i označi sent_at;
//   4. greška → run_at = sada + čekanje koje raste (5 s, 10 s, 20 s … najviše 10 min, uz nasumičan pomak); poslije
//      OUTBOX_POKUSAJA (zadano 6) pokušaja red je „mrtav” (dead_at, greska) i više se ne pokušava.
// Proces koji padne usred slanja ne gubi ništa: zakup istekne i red se pošalje ponovo (najviše jednom više, ako je
// pao baš između prihvatanja kod Expo-a i upisa sent_at).
//
// Recenzija 3:
// - R3-02: Expo odbije cijeli zahtjev (4xx, npr. PUSH_TOO_MANY_EXPERIENCE_IDS kad je u seriji token drugog Expo
//   projekta) → serija se dijeli (po projektima iz `details`, inače na polovine) do pojedinačnih poruka; pojedinačno
//   odbijena poruka se odbacuje i njen token briše (samo ako je u istom prolazu Expo prihvatio bar jednu drugu poruku
//   — dokaz da nije greška u našem formatu ili ključu, pa jedna greška u kodu ne briše sve tokene). Ostali primaoci
//   dobiju push. 429/5xx/mreža i dalje: ponovni pokušaj cijele serije.
// - R3-08: greška u tiketu MessageRateExceeded → ponovni pokušaj (samo za te tokene, `preostali` u payloadu);
//   push stariji od 24 h se ne šalje (odbačen, greska „isteklo”); push o sniženju se šalje samo dok sniženje važi
//   (oglas nije obrisan ni prodat, cijena je i dalje nova, butik nije ugašen); tokeni se provjeravaju pri slanju
//   (obrisan nalog, odjava, isključena obavještenja → ne šalje se).
// - R3-07: poslanom redu poruke se briše tekst iz payloada; poslani redovi se brišu poslije 24 h, mrtvi poslije 7
//   dana (poslovi.js, cleanup), a redovi razgovora korisnika pri brisanju naloga (rute/profil.js).
import { randomBytes } from 'node:crypto';
import { qPosao } from './db.js';
import { posaljiPushSeriju } from './rute/push.js';
import { rasporediSnizenje, snizenjeVazi } from './snizenje.js';

export const OUTBOX_POKUSAJA = () => Math.max(1, Number(process.env.OUTBOX_POKUSAJA) || 6);
const ZAKUP_S = () => Math.max(5, Number(process.env.OUTBOX_ZAKUP_S) || 120);
const PO_ZAHTJEVU = 100;
const REDOVA_PO_PROLAZU = 500;
const ROK_VAZENJA_H = 24;

const ZAKUPI_SQL = `
  update outbox o set run_at = now() + make_interval(secs => $2), pokusaja = o.pokusaja + 1, zakup = $4
   where o.id in (
     select id from outbox
      where sent_at is null and dead_at is null and run_at <= now() and vrsta = any($3::text[])
      order by run_at, id
      limit $1
      for update skip locked)
  returning o.id, o.vrsta, o.payload, o.pokusaja, o.created_at < now() - make_interval(hours => ${ROK_VAZENJA_H}) as isteklo`;

// Čekanje prije sljedećeg pokušaja: 5 s · 2^(pokušaj − 1), najviše 10 min, +0–20 % nasumično.
export function cekanjeSek(pokusaja) {
  const osnova = Math.min(600, 5 * 2 ** Math.max(0, pokusaja - 1));
  return Math.round(osnova * (1 + Math.random() * 0.2));
}

// Gotovo (poslano, ili namjerno odbačeno uz `napomena`). Tekst poruke se iz payloada briše (R3-07).
async function poslano(ids, zakup, napomena = null) {
  if (!ids.length) return;
  await qPosao(
    `update outbox set sent_at = now(), greska = $3, payload = payload - 'tekst' - 'preostali'
      where id = any($1::bigint[]) and zakup = $2`,
    [ids, zakup, napomena],
  );
}

// Produži zakup redova prije slanja; vraća skup id-jeva koji su i dalje zakupljeni ovim prolazom.
async function produziZakup(ids, zakup) {
  const res = await qPosao(
    `update outbox set run_at = now() + make_interval(secs => $3)
      where id = any($1::bigint[]) and zakup = $2 and sent_at is null and dead_at is null returning id`,
    [ids, zakup, ZAKUP_S()],
  );
  return new Set(res.rows.map((r) => String(r.id)));
}

async function neuspjeh(log, redovi, err, zakup, preostali = null) {
  const poruka = String(err && err.message ? err.message : err).slice(0, 500);
  for (const r of redovi) {
    const ostaje = preostali ? preostali.get(String(r.id)) : null;
    if (r.pokusaja >= OUTBOX_POKUSAJA()) {
      await qPosao('update outbox set dead_at = now(), greska = $2 where id = $1 and zakup = $3', [r.id, poruka, zakup]);
      log.error(`Outbox: red ${r.id} (${r.vrsta}) nije poslan ni poslije ${r.pokusaja} pokušaja, označen kao mrtav: ${poruka}`);
    } else {
      await qPosao(
        `update outbox set run_at = now() + make_interval(secs => $2), greska = $3,
                payload = case when $5::jsonb is null then payload else payload || jsonb_build_object('preostali', $5::jsonb) end
          where id = $1 and zakup = $4`,
        [r.id, cekanjeSek(r.pokusaja), poruka, zakup, ostaje ? JSON.stringify(ostaje) : null],
      );
      log.warn(`Outbox: red ${r.id} (${r.vrsta}), pokušaj ${r.pokusaja} nije uspio, ponovo kasnije: ${poruka}`);
    }
  }
}

// Tokeni koji i dalje smiju dobiti push (postoje, nalog nije ugašen, obavještenja uključena).
async function vazeciTokeni(tokeni) {
  if (!tokeni.length) return new Set();
  const res = await qPosao(
    `select t.token from push_tokens t join users u on u.id = t.user_id
      where t.token = any($1::text[]) and u.push_enabled and u.suspended_at is null`,
    [tokeni],
  );
  return new Set(res.rows.map((r) => r.token));
}

// Push o novoj poruci: tokeni se čitaju sada (ne pri upisu), uz ista pravila kao ranije (push_enabled, ugašen nalog).
async function porukeZaRedove(redovi) {
  const primaoci = [...new Set(redovi.map((r) => Number(r.payload.primalac)))];
  const res = await qPosao(
    `select t.user_id, t.token from push_tokens t join users u on u.id = t.user_id
      where t.user_id = any($1::int[]) and u.push_enabled and u.suspended_at is null`,
    [primaoci],
  );
  const tokeni = new Map();
  for (const r of res.rows) {
    if (!tokeni.has(r.user_id)) tokeni.set(r.user_id, []);
    tokeni.get(r.user_id).push(r.token);
  }
  return redovi.map((r) => {
    const preostali = Array.isArray(r.payload.preostali) ? new Set(r.payload.preostali) : null;
    return (tokeni.get(Number(r.payload.primalac)) || []).filter((to) => !preostali || preostali.has(to)).map((to) => ({
      to, title: r.payload.naslov, body: r.payload.tekst, sound: 'default', channelId: 'poruke',
      data: { conversationId: r.payload.razgovor },
    }));
  });
}

// Redovi 'push' (serije sniženja): samo tokeni koji i dalje važe i samo dok sniženje važi.
async function porukeZaPush(redovi) {
  const sviTokeni = [];
  for (const r of redovi) for (const m of (Array.isArray(r.payload.poruke) ? r.payload.poruke : [])) sviTokeni.push(m.to);
  const vaze = await vazeciTokeni([...new Set(sviTokeni)]);
  const snizenja = redovi.map((r) => r.payload.snizenje).filter(Boolean);
  const vaziSnizenje = await snizenjeVazi(snizenja);
  return redovi.map((r) => {
    if (r.payload.snizenje && !vaziSnizenje.has(`${r.payload.snizenje.listingId}:${r.payload.snizenje.newCents}`)) {
      return { odbaci: 'sniženje više ne važi (oglas obrisan/prodat ili cijena promijenjena)', poruke: [] };
    }
    const preostali = Array.isArray(r.payload.preostali) ? new Set(r.payload.preostali) : null;
    const poruke = (Array.isArray(r.payload.poruke) ? r.payload.poruke : [])
      .filter((m) => vaze.has(m.to) && (!preostali || preostali.has(m.to)));
    return { poruke };
  });
}

// Grupe za dijeljenje serije koju je Expo odbio: po projektima iz `details` (PUSH_TOO_MANY_EXPERIENCE_IDS), inače
// na dvije polovine. Grupa = niz indeksa u `poruke`.
function podijeli(poruke, err) {
  const sve = poruke.map((_, k) => k);
  if (err.details && typeof err.details === 'object' && !Array.isArray(err.details)) {
    const projekatTokena = new Map();
    for (const [projekat, tokeni] of Object.entries(err.details)) {
      if (Array.isArray(tokeni)) for (const t of tokeni) projekatTokena.set(t, projekat);
    }
    const grupe = new Map();
    for (const k of sve) {
      const p = projekatTokena.get(poruke[k].to) ?? '';
      if (!grupe.has(p)) grupe.set(p, []);
      grupe.get(p).push(k);
    }
    if (grupe.size > 1) return [...grupe.values()];
  }
  const pola = Math.ceil(sve.length / 2);
  return [sve.slice(0, pola), sve.slice(pola)];
}

// Šalje niz poruka (≤ 100); kad Expo odbije cijeli zahtjev (4xx), dijeli ga dok ne ostanu pojedinačne poruke.
// Vraća ishod po poruci: { ok } | { odbijeno, greska, token? } (trajno) | { privremena, greska } (ponovo kasnije).
async function posaljiSPodjelom(poruke) {
  const ishodi = new Array(poruke.length);
  const dio = async (indeksi) => {
    let r;
    try {
      r = await posaljiPushSeriju(indeksi.map((k) => poruke[k]));
    } catch (err) {
      if (err.privremena !== false) {
        for (const k of indeksi) ishodi[k] = { privremena: true, greska: err.message };
        return;
      }
      if (indeksi.length === 1) {
        ishodi[indeksi[0]] = { odbijeno: true, greska: err.message, token: poruke[indeksi[0]].to };
        return;
      }
      for (const g of podijeli(indeksi.map((k) => poruke[k]), err)) await dio(g.map((x) => indeksi[x]));
      return;
    }
    indeksi.forEach((k, j) => {
      const t = r[j];
      if (t.ok) ishodi[k] = { ok: true };
      else if (t.privremena) ishodi[k] = { privremena: true, greska: t.greska };
      else ishodi[k] = { odbijeno: true, greska: t.greska };
    });
  };
  await dio(poruke.map((_, k) => k));
  return ishodi;
}

// Jedan prolaz. Vraća { snizenja, poslano, neuspjelo, odbaceno }.
export async function obradiOutbox(log) {
  const out = { snizenja: 0, poslano: 0, neuspjelo: 0, odbaceno: 0 };
  const zakup = randomBytes(9).toString('base64url');
  // 1. Sniženja → redovi 'push' (po 100 poruka).
  const sn = await qPosao(ZAKUPI_SQL, [5, ZAKUP_S(), ['snizenje'], zakup]);
  for (const r of sn.rows) {
    try {
      if (r.isteklo) {
        await poslano([r.id], zakup, `isteklo: starije od ${ROK_VAZENJA_H} h, nije poslano`);
        out.odbaceno += 1;
        continue;
      }
      const n = await rasporediSnizenje(r.payload);
      await poslano([r.id], zakup, n < 0 ? 'sniženje više ne važi, nije poslano' : null);
      if (n < 0) out.odbaceno += 1; else out.snizenja += 1;
    } catch (err) {
      await neuspjeh(log, [r], err, zakup);
    }
  }
  // 2. Poruke i gotove serije: pakuju se u zahtjeve do 100 poruka; red se ne dijeli između dva zahtjeva.
  const res = await qPosao(ZAKUPI_SQL, [REDOVA_PO_PROLAZU, ZAKUP_S(), ['poruka', 'push'], zakup]);
  if (res.rowCount === 0) return out;
  res.rows.sort((a, b) => Number(a.id) - Number(b.id)); // update … returning ne čuva redoslijed podupita

  const istekli = res.rows.filter((r) => r.isteklo).map((r) => r.id);
  await poslano(istekli, zakup, `isteklo: starije od ${ROK_VAZENJA_H} h, nije poslano`);
  out.odbaceno += istekli.length;
  const zive = res.rows.filter((r) => !r.isteklo);

  const porukeReda = new Map();
  const odbaciReda = [];
  const zaPoruke = zive.filter((r) => r.vrsta === 'poruka');
  if (zaPoruke.length) {
    const liste = await porukeZaRedove(zaPoruke);
    zaPoruke.forEach((r, k) => porukeReda.set(r.id, liste[k]));
  }
  const zaPush = zive.filter((r) => r.vrsta === 'push');
  if (zaPush.length) {
    const liste = await porukeZaPush(zaPush);
    zaPush.forEach((r, k) => {
      porukeReda.set(r.id, liste[k].poruke);
      if (liste[k].odbaci) odbaciReda.push(r.id);
    });
  }
  if (odbaciReda.length) {
    await poslano(odbaciReda, zakup, 'sniženje više ne važi, nije poslano');
    out.odbaceno += odbaciReda.length;
  }
  const odbaceni = new Set(odbaciReda.map(String));
  const prazni = zive.filter((r) => !odbaceni.has(String(r.id)) && porukeReda.get(r.id).length === 0).map((r) => r.id);
  await poslano(prazni, zakup); // nema kome (nema tokena, isključena obavještenja): gotovo

  let prihvacenoUProlazu = 0;
  const odbijeniTokeni = [];
  let serija = [];
  let redovi = [];
  const posalji = async () => {
    if (!redovi.length) return;
    const nasi = await produziZakup(redovi.map((r) => r.id), zakup);
    if (nasi.size < redovi.length) {
      log.warn(`Outbox: ${redovi.length - nasi.size} redova više nije zakupljeno ovim prolazom (zakup istekao), preskačem ih`);
      redovi = redovi.filter((r) => nasi.has(String(r.id)));
      serija = redovi.flatMap((r) => porukeReda.get(r.id));
    }
    if (redovi.length) {
      const ishodi = await posaljiSPodjelom(serija);
      prihvacenoUProlazu += ishodi.filter((x) => x.ok).length;
      // Expo u ovom prolazu nije prihvatio nijednu poruku: pojedinačna odbijanja (4xx) su vjerovatno naša greška
      // (format, ključ), ne krivica tokena → ponovo kasnije, token ostaje.
      if (prihvacenoUProlazu === 0) {
        for (const x of ishodi) if (x.odbijeno && x.token) { x.odbijeno = false; x.privremena = true; }
      }
      // Ishod po redu: sve poslano/odbijeno → gotovo; neka privremena greška → ponovo samo za te tokene.
      let k = 0;
      const gotovi = [];
      const ponovo = [];
      const preostali = new Map();
      let zadnjaGreska = null;
      for (const r of redovi) {
        const m = porukeReda.get(r.id);
        const ostali = [];
        for (let j = 0; j < m.length; j += 1, k += 1) {
          const ish = ishodi[k];
          if (ish.ok) { out.poslano += 1; continue; }
          if (ish.privremena) { ostali.push(m[j].to); zadnjaGreska = ish.greska; continue; }
          out.odbaceno += 1;
          if (ish.token) odbijeniTokeni.push(ish.token);
          log.warn(`Outbox: Expo je odbio poruku reda ${r.id} (${ish.greska}); poruka odbačena`);
        }
        if (ostali.length) { ponovo.push(r); preostali.set(String(r.id), ostali); out.neuspjelo += ostali.length; } else gotovi.push(r.id);
      }
      await poslano(gotovi, zakup);
      if (ponovo.length) await neuspjeh(log, ponovo, zadnjaGreska, zakup, preostali);
    }
    serija = [];
    redovi = [];
  };
  for (const r of zive) {
    const m = porukeReda.get(r.id);
    if (!m.length || odbaceni.has(String(r.id))) continue;
    if (serija.length + m.length > PO_ZAHTJEVU) await posalji();
    serija = serija.concat(m);
    redovi.push(r);
  }
  await posalji();
  // Token koji je Expo sam odbio (npr. iz drugog Expo projekta) se briše — samo kad je u ovom prolazu prihvaćena bar
  // jedna druga poruka (inače su odbijanja gore pretvorena u ponovni pokušaj), da greška u našem formatu ili ključu
  // ne obriše sve tokene.
  if (odbijeniTokeni.length) {
    await qPosao('delete from push_tokens where token = any($1::text[])', [odbijeniTokeni]);
    log.warn(`Outbox: obrisano ${odbijeniTokeni.length} push tokena koje je Expo odbio`);
  }
  return out;
}

// Odmah poslije upisa (poruka, sniženje) proces koji je upisao red pokreće jedan prolaz sam, da push ne čeka
// sljedeći krug posla (do 1 s), i da radi i u procesima bez poslova (KOMODO_JOBS=0). Bezbjedno uz posao u drugom
// procesu (skip locked, oznaka zakupa). Dok prolaz traje, novi pozivi samo traže još jedan prolaz poslije njega.
let radiOvdje = false;
let josJedan = false;
export function obradiUskoro(log) {
  if (radiOvdje) { josJedan = true; return; }
  radiOvdje = true;
  setImmediate(async () => {
    try {
      do {
        josJedan = false;
        await obradiOutbox(log);
      } while (josJedan);
    } catch (err) {
      log.warn(err, 'Outbox: prolaz nije uspio (posao pokušava ponovo)');
    } finally {
      radiOvdje = false;
    }
  });
}
