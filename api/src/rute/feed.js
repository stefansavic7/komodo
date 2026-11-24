// Feed (docs/SPEC-V1.md, F-01): GET /api/feed s karticama „Za tebe” (algoritam), „Novo” i „Praćeni”, i
// zajednička strana oglasa koju koristi i GET /api/listings (pretraga, profil butika, „Sviđa mi se”).
// Rute registruje src/rute/oglasi.js (feed(app)), a ocjenu base_score računa posao u src/poslovi.js.
import { bazaNeOdgovara, q } from '../db.js';
import { ocistiKesOgOvdje } from './og.js';
import {
  CATEGORIES, LISTING_SELECT, VISIBLE_SQL, bad, boundedSet, clean, currentUser, isId, javiSvima, knownDeviceId,
  naPoruku, parsePrice, parseSizes, publicListing, rezim,
} from '../app.js';

/* ---------- strana oglasa (redom id desc) — /api/listings i kartica „Novo” ---------- */

// Keš javnog feeda: osnovni redovi oglasa (bez liked/mine) po normalizovanim parametrima, 5 sekundi,
// u memoriji svakog procesa. Istovremeni zahtjevi za isti ključ čekaju isti upit.
const FEED_TTL = 5 * 1000;
const FEED_CACHE_MAX = 2000;
const feedCache = new Map();

// Kandidati za „Za tebe” (zajednički za sve korisnike): ključ = kategorija + veličine, 60 s, ≤ 100 ključeva.
const KAND_TTL = 60 * 1000;
const KAND_MAX = 100;
const kandCache = new Map();

// `ukloni` (R3-04): { oglasi: [id], butici: [id] } — oglasi koji su upravo obrisani ili ugašeni (i svi oglasi
// ugašenih/obrisanih butika). Izbacuju se i iz zadnjeg dobrog keša, da ih neprijavljeni ne vide ponovo kad baza zapne.
function clearHere(ukloni) {
  feedCache.clear();
  kandCache.clear();
  ocistiKesOgOvdje();
  if (ukloni && typeof ukloni === 'object') izbaciIzZadnjegDobrog(ukloni);
}
naPoruku('feed', clearHere);

// Poslije objave, izmjene i brisanja oglasa, gašenja naloga (administrator) i brisanja naloga: ovaj proces
// odmah, ostali preko poruke (src/index.js). Briše i keš pregleda linka (OG, R2-03). Kod brisanja i gašenja
// `ukloni` = { oglasi: [id…] } i/ili { butici: [id…] } (R3-04).
export function ocistiKesFeeda(ukloni) {
  const u = ukloni ? { oglasi: (ukloni.oglasi || []).map(Number), butici: (ukloni.butici || []).map(Number) } : null;
  clearHere(u);
  javiSvima('feed', u || 1);
}

// Zadnji uspješno učitan sadržaj svakog ključa (talas 4): kad baza ne odgovara (istekao rok, nema veze), javni feed
// služi njega umjesto greške, uz zaglavlje X-Komodo-Zastarjelo: 1. Pri ocistiKesFeeda se ne briše cijeli (bolje star
// feed nego greška), ali iz njega ispadaju obrisani i ugašeni oglasi i oglasi ugašenih butika (R3-04). Ne koristi se
// dok baza radi. Ograničen kao i keš.
const zadnjeDobro = new Map();

function izbaciIzZadnjegDobrog({ oglasi = [], butici = [] }) {
  if (!oglasi.length && !butici.length) return;
  const o = new Set(oglasi);
  const b = new Set(butici);
  const ostaje = (r) => !o.has(Number(r.id)) && !b.has(Number(r.user_id));
  for (const [k, v] of zadnjeDobro) {
    if (Array.isArray(v)) zadnjeDobro.set(k, v.filter(ostaje));
    else if (v && Array.isArray(v.C)) zadnjeDobro.set(k, { C: v.C.filter(ostaje), D: v.D.filter(ostaje) });
  }
}

// „Prekidač kola” (R3-04): poslije greške „baza ne odgovara” u feedu, sljedećih FEED_PREKIDAC_MS (zadano 10 s) zahtjevi
// za ključ koji ima zadnji dobar sadržaj dobijaju ga odmah, bez čekanja na bazu (inače bi svaki čekao do roka upita,
// 5 s). Za to vrijeme bazu po ključu „pipka” najviše jedan upit u pozadini (isti kao inače, dijeli se kroz keš):
// čim jedan uspije, prekidač se zatvara i svi opet dobijaju svjež sadržaj; svaka nova greška ga produžava.
const PREKIDAC_MS = Number(process.env.FEED_PREKIDAC_MS) || 10 * 1000;
let prekidacDo = 0;
function otvoriPrekidac() { prekidacDo = Date.now() + PREKIDAC_MS; }
export function prekidacOtvoren() { return prekidacDo > Date.now(); }

function cached(map, key, ttl, limit, load) {
  const hit = map.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = load();
  const unos = { value, exp: Date.now() + ttl, gotov: false };
  boundedSet(map, key, unos, limit);
  value.then(
    (v) => {
      unos.gotov = true;
      prekidacDo = 0; // baza je odgovorila
      boundedSet(zadnjeDobro, `${map === kandCache ? 'k' : 'f'}|${key}`, v, FEED_CACHE_MAX + KAND_MAX);
    },
    (err) => {
      if (bazaNeOdgovara(err)) otvoriPrekidac();
      if (map.get(key)?.value === value) map.delete(key);
    },
  );
  return value;
}

// Kao cached, ali kad baza ne odgovara vraća zadnji dobar sadržaj i javlja to kroz zastarjelo() (zaglavlje).
async function cachedIliStaro(map, key, ttl, limit, load, zastarjelo) {
  const kljucStaro = `${map === kandCache ? 'k' : 'f'}|${key}`;
  if (prekidacOtvoren()) {
    const hit = map.get(key);
    const staro = zadnjeDobro.get(kljucStaro);
    if (staro && !(hit && hit.exp > Date.now() && hit.gotov)) {
      // Upit u pozadini (ako za ovaj ključ već ne radi jedan); greška se ovdje ne čeka.
      if (!hit || hit.exp <= Date.now()) cached(map, key, ttl, limit, load).catch(() => {});
      if (zastarjelo) zastarjelo();
      return staro;
    }
  }
  try {
    return await cached(map, key, ttl, limit, load);
  } catch (err) {
    if (!bazaNeOdgovara(err)) throw err;
    const staro = zadnjeDobro.get(kljucStaro);
    if (!staro) throw err;
    if (zastarjelo) zastarjelo();
    return staro;
  }
}

async function likedSet(user, rows) {
  if (!user || rows.length === 0) return new Set();
  const lk = await q(
    'select listing_id from likes where user_id = $1 and listing_id = any($2::int[])',
    [user.id, rows.map((r) => r.id)],
  );
  return new Set(lk.rows.map((r) => r.listing_id));
}

// Jedna strana (20) oglasa redom od najnovijeg. `p`: category, shop, liked ('1'), q, min, max, sizes, before.
// Vraća { oglasi, ukupno? } (ukupno samo za shop/liked bez before — ugovor iz docs/SKALIRANJE.md).
// `zastarjelo`: poziva se ako je strana iz zadnjeg dobrog keša jer baza ne odgovara (talas 4).
export async function stranaOglasa(user, p, zastarjelo) {
  const { category, before } = p;
  const shop = p.shop ? String(p.shop).toLowerCase() : '';
  const liked = p.liked === '1';
  // Javni keš sadrži samo ono što vide svi (VISIBLE_SQL s $1 = 0: bez oglasa u obradi i u grešci).
  // Mimo keša idu: lista sviđanja, vlastiti profil butika i svaki zahtjev prijavljenog butika — butik
  // mora odmah vidjeti oglas koji je upravo objavio (i svoj oglas u obradi). Butika je ~200, pa to ne
  // opterećuje bazu.
  const direct = liked || (user && ((shop && shop === user.handle) || user.role === 'butik'));
  const params = [direct && user ? user.id : 0];
  const norm = {};
  let where = '';
  const add = (sql, value) => { params.push(value); where += sql.replace('?', `$${params.length}`); };
  if (category && CATEGORIES.includes(category)) { add(' and l.category = ?', category); norm.c = category; }
  if (shop) { add(' and u.handle = ?', shop); norm.s = shop; }
  if (liked) where += ' and l.id in (select k.listing_id from likes k where k.user_id = $1)';
  const sizes = parseSizes(p.sizes);
  if (sizes.length) { add(' and l.sizes && ?::text[]', sizes); norm.v = sizes.join(','); }
  const search = clean(p.q, 60);
  if (search) {
    // Unija dva podupita, da baza koristi trigram indekse na listings.title i users.shop_name
    // (s `or` preko spoja ih ne koristi i za rijetku riječ pregleda cijelu tabelu).
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    where += ` and l.id in (select t.id from listings t where t.title ilike $${n}
                union select t.id from listings t join users s on s.id = t.user_id where s.shop_name ilike $${n})`;
    norm.q = search;
  }
  const min = parsePrice(p.min);
  const max = parsePrice(p.max);
  if (min !== null) { add(' and l.price_cents >= ?', min); norm.min = min; }
  if (max !== null) { add(' and l.price_cents <= ?', max); norm.max = max; }
  const filters = where;
  const filterParams = [...params];
  if (isId(before)) { add(' and l.id < ?', Number(before)); norm.b = Number(before); }
  const sql = `${LISTING_SELECT}${where} order by l.id desc limit 20`;

  let rows;
  if (direct) {
    rows = (await q(sql, params)).rows;
  } else {
    rows = await cachedIliStaro(feedCache, JSON.stringify(norm), FEED_TTL, FEED_CACHE_MAX, () => q(sql, params).then((r) => r.rows), zastarjelo);
    const likedIds = await likedSet(user, rows);
    rows = rows.map((r) => ({ ...r, liked: likedIds.has(r.id), mine: !!user && r.user_id === user.id }));
  }
  const out = { oglasi: rows.map(publicListing) };
  if ((shop || liked) && !isId(before)) {
    const total = await q(
      `select count(*) as n from listings l join users u on u.id = l.user_id
        where l.deleted_at is null and u.suspended_at is null
          and ${VISIBLE_SQL}${filters}`,
      filterParams,
    );
    out.ukupno = Number(total.rows[0].n);
  }
  return out;
}

/* ---------- „Za tebe” ---------- */

const PAGE = 20;
// R2-01: izuzmi mora pokriti sve kandidate koje server može vratiti (C 200 + D 100 = 300), inače prikazani
// oglasi ispadnu iz izuzmi i vraćaju se ponovo (klijent ih odbaci kao duplikate, a kraj nikad ne dođe). 400 =
// 300 + rezerva za smjenu kandidata dok keš (60 s) i ocjene (5 min) mijenjaju C. Zapis ostaje običan csv u GET
// upitu: 400 id-jeva po 7 cifara ≈ 3,2 KB, ispod Nginx granice reda zahtjeva (8 KB); kompaktan zapis ili POST
// bi uštedio samo bajtove, a GET ostaje idempotentan, lak za praćenje u dnevniku i bez nove provjere Origina.
export const MAX_IZUZMI = 400;

// C = do 200 oglasa po base_score, D (otkrivanje) = do 100 novih (72 h) s malo pregleda. Oba bez oglasa u
// obradi ($1 = 0 u VISIBLE_SQL; D još i eksplicitno video_status = 'ready'), pa keš nikad ne sadrži oglas
// koji drugi ne smiju vidjeti. D ide po created_at (indeks listings_fresh_idx; isti redoslijed kao id).
// Ocjena je u listing_scores (migracija 012, R2-02); oglas bez reda ima ocjenu 0 (D: novi oglasi).
const KAND_SELECT = LISTING_SELECT
  .replace('select l.id,', 'select coalesce(sc.base_score, 0) as base_score, l.id,')
  .replace('join users u on u.id = l.user_id', 'join users u on u.id = l.user_id\n    left join listing_scores sc on sc.listing_id = l.id');
if (!/sc\.base_score, 0\) as base_score, l\.id,/.test(KAND_SELECT) || !KAND_SELECT.includes('left join listing_scores sc')) {
  throw new Error('LISTING_SELECT: nema „select l.id,” ili spoja s users (feed.js, KAND_SELECT)');
}
function kandidati(category, sizes, zastarjelo) {
  const key = JSON.stringify([category || '', sizes.join(',')]);
  return cachedIliStaro(kandCache, key, KAND_TTL, KAND_MAX, async () => {
    const params = [0];
    let where = '';
    if (category) { params.push(category); where += ` and l.category = $${params.length}`; }
    if (sizes.length) { params.push(sizes); where += ` and l.sizes && $${params.length}::text[]`; }
    const [c, d] = await Promise.all([
      q(`${KAND_SELECT} and sc.base_score > 0${where} order by sc.base_score desc limit 200`, params),
      q(`${KAND_SELECT} and l.created_at > now() - interval '72 hours' and l.views < 50
           and l.video_status = 'ready'${where} order by l.created_at desc, l.id desc limit 100`, params),
    ]);
    return { C: c.rows, D: d.rows };
  }, zastarjelo);
}

// Lični faktori: jedan upit (docs/SPEC-V1.md, F-01, korak 3). Isto značenje kao upit iz specifikacije, ali
// čita samo redove gledaoca (uzastopno: likes_pkey (user_id, listing_id) i listing_views_viewer_idx (viewer,
// day), migracija 011) umjesto ~300 sondi po kandidatu, a presjek s kandidatima radi u memoriji. Izmjereno:
// ~4× manje rada baze po zahtjevu. Gornje granice (2.000 sviđanja, 5.000 pregleda) štite od ekstremnih naloga.
const LICNO_SQL = `
select
  (select coalesce(json_agg(json_build_array(k.listing_id, l.category, k.created_at > now() - interval '60 days')), '[]')
     from (select listing_id, created_at from likes where user_id = $1 order by listing_id desc limit 2000) k
     join listings l on l.id = k.listing_id)                                                as lajk,
  (select coalesce(array_agg(shop_id), '{}') from follows where user_id = $1)                as prati,
  (select coalesce(array_agg(blocked_id), '{}') from blocks where blocker_id = $1)          as blok,
  (select coalesce(array_agg(listing_id), '{}') from (
     select listing_id from listing_views where viewer = $2 and day >= current_date - 7 limit 5000) v) as gledano`;

const PRAZNO = { kat: {}, prati: [], blok: [], gledano: [], svidja: [] };

async function licniFaktori(userId, viewer) {
  if (!viewer) return PRAZNO;
  const r = (await q(LICNO_SQL, [userId, viewer])).rows[0];
  if (!r) return PRAZNO;
  const kat = {};
  const svidja = [];
  for (const [id, category, nedavno] of r.lajk) {
    svidja.push(id);
    if (nedavno) kat[category] = (kat[category] || 0) + 1;
  }
  return { kat, prati: r.prati, blok: r.blok, gledano: r.gledano, svidja };
}

// Slaganje strane (koraci 4 i 5). Čista funkcija: ulaz su kandidati i lični faktori, izlaz { rows, kraj }.
export function slozi({ C, D, izuzmi, userId, licno }) {
  const excl = new Set(izuzmi);
  const gledano = new Set(licno.gledano);
  const prati = new Set(licno.prati);
  const blok = new Set(licno.blok);
  const kat = licno.kat || {};
  let ukupno = 0;
  for (const k of Object.keys(kat)) ukupno += Number(kat[k]);
  const ok = (r) => !excl.has(r.id) && r.user_id !== userId && !blok.has(r.user_id);
  const ocjena = (r) => {
    let licnoF = ukupno < 3 ? 1 : 0.7 + 0.6 * (Number(kat[r.category] || 0) / ukupno);
    if (prati.has(r.user_id)) licnoF *= 1.3;
    return Number(r.base_score) * licnoF * (gledano.has(r.id) ? 0.2 : 1);
  };
  const cs = C.filter(ok).map((r) => ({ r, s: ocjena(r) })).sort((a, b) => b.s - a.s || b.r.id - a.r.id).map((x) => x.r);
  const ds = D.filter(ok);

  // Prozor raznolikosti: zadnja ≤ 3 id-ja iz izuzmi (ako su među kandidatima), pa sve što se postavi.
  const svi = new Map();
  for (const r of C) svi.set(r.id, r);
  for (const r of D) svi.set(r.id, r);
  const prozor = izuzmi.slice(-3).map((id) => svi.get(id)).filter(Boolean);
  const butikOk = (r) => {
    const n = prozor.length;
    for (let k = Math.max(0, n - 3); k < n; k += 1) if (prozor[k].user_id === r.user_id) return false;
    return true;
  };
  const prolazi = (r) => {
    const n = prozor.length;
    return butikOk(r) && !(n >= 2 && prozor[n - 1].category === r.category && prozor[n - 2].category === r.category);
  };

  const used = new Set();
  const slobodan = (r) => !used.has(r.id);
  const rows = [];
  let kraj = false;
  const n0 = izuzmi.length;
  for (let k = 0; k < PAGE; k += 1) {
    let pick = null;
    if ((n0 + k) % 5 === 4) pick = ds.find((r) => slobodan(r) && !gledano.has(r.id) && prolazi(r));
    // Redom: najbolji iz C uz oba pravila raznolikosti, pa novi iz D uz oba (kad C nema drugog butika), pa
    // samo uz pravilo butika (važnije: „najviše 1 od 4 uzastopna”), pa bez pravila. Kad ne ostane ništa
    // ni u C ni u D → kraj.
    if (!pick) pick = cs.find((r) => slobodan(r) && prolazi(r));
    if (!pick) pick = ds.find((r) => slobodan(r) && prolazi(r));
    if (!pick) pick = cs.find((r) => slobodan(r) && butikOk(r)) || ds.find((r) => slobodan(r) && butikOk(r));
    if (!pick) pick = cs.find(slobodan) || ds.find(slobodan);
    if (!pick) { kraj = true; break; }
    used.add(pick.id);
    rows.push(pick);
    prozor.push(pick);
  }
  if (!kraj && !cs.some(slobodan) && !ds.some(slobodan)) kraj = true;
  return { rows, kraj };
}

function parseIzuzmi(raw) {
  const out = [];
  const seen = new Set();
  for (const v of String(raw ?? '').split(',')) {
    if (!isId(v)) continue;
    const id = Number(v);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-MAX_IZUZMI);
}

const KARTICE = ['zatebe', 'novo', 'praceni'];

export default function rute(app) {
  app.get('/api/feed', async (req, reply) => {
    const kartica = req.query.kartica === undefined || req.query.kartica === '' ? 'zatebe' : String(req.query.kartica);
    if (!KARTICE.includes(kartica)) return bad(reply, 400, 'Nepoznata kartica.');
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
    const sizes = parseSizes(req.query.sizes);
    const user = await currentUser(req);
    const zastarjelo = () => { reply.header('X-Komodo-Zastarjelo', '1'); };

    // Hitni režim (talas 4): „Za tebe” bez ličnog algoritma — prva strana keširanog „Novo” i kraj:true, pa klijent
    // nastavlja stranama „Novo” (isti put kao poslije kraja „Za tebe”).
    if (kartica === 'novo' || (kartica === 'zatebe' && rezim() === 'hitno')) {
      const out = await stranaOglasa(user, { category, sizes: sizes.join(','), before: kartica === 'novo' ? req.query.before : undefined }, zastarjelo);
      return kartica === 'novo' ? { oglasi: out.oglasi } : { oglasi: out.oglasi, kraj: true, rezim: 'hitno' };
    }

    if (kartica === 'praceni') {
      if (!user) return bad(reply, 401, 'Prijavi se da vidiš butike koje pratiš.');
      const params = [user.id];
      let where = '';
      if (category) { params.push(category); where += ` and l.category = $${params.length}`; }
      if (sizes.length) { params.push(sizes); where += ` and l.sizes && $${params.length}::text[]`; }
      if (isId(req.query.before)) { params.push(Number(req.query.before)); where += ` and l.id < $${params.length}`; }
      const res = await q(
        `${LISTING_SELECT} and l.user_id in (select shop_id from follows where user_id = $1)${where}
          order by l.id desc limit 20`,
        params,
      );
      return { oglasi: res.rows.map(publicListing) };
    }

    // „Za tebe”
    const izuzmi = parseIzuzmi(req.query.izuzmi);
    const { C, D } = await kandidati(category, sizes, zastarjelo);
    const did = user ? null : knownDeviceId(req);
    const viewer = user ? `u${user.id}` : (did ? `d${did}` : null);
    let licno = PRAZNO;
    if ((C.length || D.length) && !user && prekidacOtvoren()) {
      zastarjelo(); // baza nije odgovarala prije manje od 10 s: neprijavljeni bez ličnih faktora, bez čekanja
    } else if (C.length || D.length) {
      try {
        licno = await licniFaktori(user ? user.id : 0, viewer);
      } catch (err) {
        // Neprijavljen gledalac kad baza ne odgovara: strana bez ličnih faktora umjesto greške.
        if (user || !bazaNeOdgovara(err)) throw err;
        otvoriPrekidac();
        zastarjelo();
      }
    }
    const { rows, kraj } = slozi({ C, D, izuzmi, userId: user ? user.id : 0, licno });
    const svidja = new Set(licno.svidja);
    return {
      oglasi: rows.map((r) => publicListing({ ...r, liked: svidja.has(r.id), mine: false })),
      kraj,
    };
  });
}
