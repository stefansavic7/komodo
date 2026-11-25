// Popravke iz recenzije 3 (docs/RECENZIJA-3.md, „Stanje popravki”): R3-01 … R3-09.
// Svaki test pada na kodu prije popravke (256f6cb / 9c6d976) — vidi komentar uz test.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { ADMIN_URL, noviButik, novaBaza, okolina, pokreniApi, sleep } from './pomoc/okolina.mjs';

async function cekajDa(fn, ms = 5000, opis = 'uslov') {
  const kraj = Date.now() + ms;
  while (Date.now() < kraj) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error(`Nije ispunjeno za ${ms} ms: ${opis}`);
}

/* ---------- R3-03: bazaNeOdgovara ---------- */

describe('R3-03: samo greške dostupnosti/isteka su „baza ne odgovara” (503)', () => {
  test('57014, 57P0x, 08xxx, 53300, 25P03, mrežne greške i istek bazena → da; 55000, ENOTFOUND, 23505, 42P01 → ne', async () => {
    process.env.DATABASE_URL ||= `${ADMIN_URL}`;
    const { bazaNeOdgovara, zatvoriBazu } = await import('../src/db.js');
    try {
      for (const code of ['57014', '57P01', '57P02', '57P03', '08006', '08001', '08P01', '53300', '25P03', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']) {
        assert.equal(bazaNeOdgovara({ code, message: 'x' }), true, code);
      }
      assert.equal(bazaNeOdgovara(new Error('timeout exceeded when trying to connect')), true);
      assert.equal(bazaNeOdgovara(new Error('Connection terminated unexpectedly')), true);
      // 55000 samo kad baza ne prima veze (allow_connections false), ne za grešku u kodu (currval prije nextval).
      assert.equal(bazaNeOdgovara({ code: '55000', message: 'database "x" is not currently accepting connections' }), true);
      assert.equal(bazaNeOdgovara({ code: '55000', message: 'currval of sequence "s" is not yet defined in this session' }), false);
      // Prije popravke: 55000 i ENOTFOUND su bili 503 (maskirana greška u kodu/podešavanju).
      for (const code of ['55000', 'ENOTFOUND', 'EAI_AGAIN', '23505', '42P01', '22P02', '40P01']) {
        assert.equal(bazaNeOdgovara({ code, message: 'nešto nije u redu' }), false, code);
      }
      assert.equal(bazaNeOdgovara(new Error('nešto drugo')), false);
    } finally {
      await zatvoriBazu();
    }
  });
});

/* ---------- R3-01: zaglavljen Idempotency-Key ---------- */

describe('R3-01: Idempotency-Key ne ostaje zaglavljen', () => {
  let o; let kupac; let razgovor;
  before(async () => {
    o = await okolina({ PG_STATEMENT_TIMEOUT_MS: '400' });
    const b = await noviButik(o.baza, { butik: 'Zaglavljen Butik', email: 'zaglavljen@test.ba' });
    kupac = o.klijent(); await kupac.registruj('zaglavljen-kupac@test.ba', 'Zaglavljen Kupac');
    razgovor = (await kupac.post('/api/conversations', { shop: b.handle })).body.razgovor;
  });
  after(async () => { await o?.stop(); });
  const poruka = (body, kljuc) => kupac.post(`/api/conversations/${razgovor}/messages`, { body }, { headers: { 'idempotency-key': kljuc } });
  const broj = async () => (await o.baza.q('select count(*)::int as n from messages where conversation_id = $1', [razgovor])).rows[0].n;

  test('dokaz iz recenzije (brava na messages, pa na idempotency_keys): 503, a drugi pokušaj poslije oporavka upiše tačno jednu poruku', async () => {
    await kupac.get('/api/me'); // sesija u kešu
    const a = await o.baza.pool.connect();
    const b = await o.baza.pool.connect();
    try {
      await a.query('begin');
      await a.query('lock table messages in access exclusive mode');
      const prvi = poruka('Ima li u M?', 'kljuc-zaglavljen-01');
      await cekajDa(async () => (await o.baza.q("select count(*)::int as n from idempotency_keys where kljuc = 'kljuc-zaglavljen-01'")).rows[0].n === 1, 3000, 'ključ upisan');
      await b.query('begin');
      await b.query('lock table idempotency_keys in access exclusive mode');
      const r1 = await prvi;
      assert.equal(r1.status, 503, JSON.stringify(r1.body));
      await sleep(1200); // brave drže još ~1 s poslije odgovora; ponovno brisanje ključa čeka na bravu
      await a.query('rollback');
      await b.query('rollback');
    } finally {
      a.release();
      b.release();
    }
    // Prije popravke: ključ ostaje status null 35 min → 409, 409, a poruka nikad nije upisana.
    await cekajDa(async () => (await o.baza.q("select count(*)::int as n from idempotency_keys where kljuc = 'kljuc-zaglavljen-01'")).rows[0].n === 0, 5000, 'ključ obrisan u pozadini');
    const r2 = await poruka('Ima li u M?', 'kljuc-zaglavljen-01');
    assert.equal(r2.status, 201, JSON.stringify(r2.body));
    const r3 = await poruka('Ima li u M?', 'kljuc-zaglavljen-01');
    assert.equal(r3.status, 201);
    assert.equal(r3.headers.get('idempotent-replay'), 'true');
    assert.equal(await broj(), 1);
  });

  test('ključ „u toku” stariji od roka rute se preuzima (poruka 60 s); objava ima duži rok; stari vlasnik ne može upisati ni obrisati', async () => {
    const uid = (await o.baza.q("select id from users where email = 'zaglavljen-kupac@test.ba'")).rows[0].id;
    await o.baza.q(`insert into idempotency_keys(user_id, ruta, kljuc, vlasnik, created_at) values
      ($1, 'poruka', 'kljuc-mrtav-0001', 'stari', now() - interval '61 seconds'),
      ($1, 'poruka', 'kljuc-svjez-0001', 'stari', now() - interval '20 seconds'),
      ($1, 'objava', 'kljuc-objava-001', 'stari', now() - interval '61 seconds')`, [uid]);
    const prije = await broj();
    // Prije popravke: 409 (rok je bio 35 min za sve rute).
    const r = await poruka('Poslije pada procesa', 'kljuc-mrtav-0001');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await broj(), prije + 1);
    const red = (await o.baza.q("select status, vlasnik from idempotency_keys where kljuc = 'kljuc-mrtav-0001'")).rows[0];
    assert.equal(red.status, 201);
    assert.notEqual(red.vlasnik, 'stari');
    // Stari zahtjev koji bi ipak završio: njegov upis/brisanje (where vlasnik = 'stari') ne dira preuzet ključ.
    assert.equal((await o.baza.q("delete from idempotency_keys where kljuc = 'kljuc-mrtav-0001' and vlasnik = 'stari'")).rowCount, 0);
    // Svjež ključ „u toku” (20 s) i dalje 409; objava (rok = rok zahtjeva + 2 min) poslije 61 s i dalje 409.
    assert.equal((await poruka('Svjež', 'kljuc-svjez-0001')).status, 409);
    const f = new FormData();
    f.append('title', 'x');
    const ob = await kupac.zahtjev('POST', '/api/listings', { body: f, headers: { 'idempotency-key': 'kljuc-objava-001' } });
    assert.equal(ob.status, 409);
  });
});

/* ---------- R3-02, R3-07, R3-08: outbox ---------- */

// Lažni Expo. `projekat(token)` vraća ime Expo projekta tokena; zahtjev s tokenima više projekata ili s tokenom koji
// nije iz '@komodo/komodo' se odbija cijeli (HTTP 400, PUSH_TOO_MANY_EXPERIENCE_IDS s details, kao pravi Expo), a
// `bezDetalja` daje 400 bez details (opšta greška validacije). `tiket(token)` daje tiket po poruci.
function laziExpo() {
  const zahtjevi = [];
  const primljeno = [];
  const st = {
    projekat: (t) => (/tudji/.test(t) ? '@drugi/aplikacija' : '@komodo/komodo'),
    bezDetalja: false,
    sveOdbij: false,
    tiket: () => ({ status: 'ok', id: 'x' }),
    prijeOdgovora: null,
  };
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      const poruke = JSON.parse(b);
      zahtjevi.push(poruke.map((p) => p.to));
      res.setHeader('content-type', 'application/json');
      if (st.prijeOdgovora) await st.prijeOdgovora(poruke);
      const projekti = {};
      for (const p of poruke) (projekti[st.projekat(p.to)] ||= []).push(p.to);
      const tudji = Object.keys(projekti).some((k) => k !== '@komodo/komodo');
      if (st.sveOdbij || tudji) {
        res.statusCode = 400;
        res.end(JSON.stringify({ errors: [st.bezDetalja || st.sveOdbij
          ? { code: 'VALIDATION_ERROR', message: 'neispravan zahtjev' }
          : { code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'više projekata', details: projekti }] }));
        return;
      }
      const data = poruke.map((p) => st.tiket(p.to));
      poruke.forEach((p, k) => { if (data[k].status === 'ok') primljeno.push(p); });
      res.end(JSON.stringify({ data }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/push`, st, zahtjevi, primljeno,
    close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); },
  })));
}

describe('outbox: R3-02 (loš token ne obara seriju), R3-08, R3-07', () => {
  let baza; let expo; let api; const procesi = [];
  before(async () => {
    expo = await laziExpo();
    baza = await novaBaza();
    // Prvi start bez poslova (samo migracije), korisnici i tokeni direktno u bazi.
    api = await pokreniApi(baza, { EXPO_PUSH_URL: expo.url });
    procesi.push(api);
    await baza.q(`insert into users(email, password_hash, shop_name, handle, role, email_verified_at)
                  select 'p' || g || '@t.ba', 'x', 'P ' || g, 'p' || g, 'kupac', now() from generate_series(1, 120) g`);
    await baza.q(`insert into sessions(token, user_id, expires_at) select 's' || id, id, now() + interval '1 day' from users where email like 'p%@t.ba'`);
  });
  after(async () => {
    for (const p of procesi) await p.stop().catch(() => {});
    await expo?.close();
    await baza?.drop();
  });
  const korisnik = async (n) => (await baza.q('select id from users where email = $1', [`p${n}@t.ba`])).rows[0].id;
  const token = async (n, t) => { const id = await korisnik(n); await baza.q('insert into push_tokens(token, user_id, session_token) values ($1, $2, $3)', [t, id, `s${id}`]); return id; };
  const ima = async (t) => (await baza.q('select 1 from push_tokens where token = $1', [t])).rowCount === 1;
  const naCekanju = async () => (await baza.q('select count(*)::int as n from outbox where sent_at is null and dead_at is null')).rows[0].n;
  const posao = async (env = {}) => {
    for (const p of procesi.splice(0)) await p.stop().catch(() => {});
    api = await pokreniApi(baza, { EXPO_PUSH_URL: expo.url, KOMODO_JOBS: '1', OUTBOX_MS: '150', ...env });
    procesi.push(api);
  };

  test('R3-02: token drugog Expo projekta u seriji od 30 poruka → 29 primalaca dobije push, loš token obrisan', async () => {
    for (let n = 1; n <= 30; n += 1) {
      const id = await token(n, n === 17 ? 'ExponentPushToken[tudji17]' : `ExponentPushToken[nas${n}]`);
      await baza.q("insert into outbox(vrsta, payload) values ('poruka', jsonb_build_object('primalac', $1::int, 'naslov', 'Kupac', 'tekst', 'Zdravo ' || $1, 'razgovor', 0))", [id]);
    }
    await posao();
    // Prije popravke: 400 za cijelu seriju → svih 30 redova ponovo, pa poslije 6 pokušaja mrtvi; niko ne dobije push.
    await cekajDa(async () => (await naCekanju()) === 0, 8000, 'svi redovi obrađeni');
    const dobili = new Set(expo.primljeno.map((p) => p.to));
    assert.equal(dobili.size, 29);
    assert.ok(!dobili.has('ExponentPushToken[tudji17]'));
    // Token se briše na kraju prolaza, poslije oznake „poslano” (outbox.js) — sačekati ga, ne čitati odmah.
    await cekajDa(async () => !(await ima('ExponentPushToken[tudji17]')), 3000, 'loš token obrisan');
    assert.equal(await ima('ExponentPushToken[nas1]'), true);
    // Podjela po projektima iz details: prvi zahtjev (30), pa dvije grupe (29 i 1) — ne 30 pojedinačnih.
    assert.ok(expo.zahtjevi.length <= 4, `zahtjeva: ${expo.zahtjevi.length}`);
    // R3-07: poslanim redovima je tekst poruke izbrisan iz payloada.
    assert.equal((await baza.q("select count(*)::int as n from outbox where payload ? 'tekst'")).rows[0].n, 0);
  });

  test('R3-02: 400 bez details (dva loša tokena u seriji od 90) → podjela na polovine, 88 poslano, loši obrisani', async () => {
    expo.st.bezDetalja = true;
    expo.st.projekat = (t) => (/los/.test(t) ? '@drugi/x' : '@komodo/komodo');
    const poruke = [];
    for (let n = 31; n <= 120; n += 1) {
      const t = n === 40 || n === 99 ? `ExponentPushToken[los${n}]` : `ExponentPushToken[nas${n}]`;
      await token(n, t);
      poruke.push({ to: t, title: 'Sniženje', body: 'b' });
    }
    const prije = expo.primljeno.length;
    await baza.q("insert into outbox(vrsta, payload) values ('push', $1::jsonb)", [JSON.stringify({ poruke })]);
    await cekajDa(async () => (await naCekanju()) === 0, 8000, 'red obrađen');
    assert.equal(expo.primljeno.length - prije, poruke.length - 2);
    await cekajDa(async () => !(await ima('ExponentPushToken[los40]')) && !(await ima('ExponentPushToken[los99]')), 3000, 'loši tokeni obrisani');
    expo.st.bezDetalja = false;
  });

  test('R3-02: Expo odbija sve (greška u našem formatu) → tokeni se NE brišu, red ide u ponovni pokušaj', async () => {
    expo.st.sveOdbij = true;
    const id = await korisnik(1);
    await baza.q("insert into outbox(vrsta, payload) values ('poruka', jsonb_build_object('primalac', $1::int, 'naslov', 'K', 'tekst', 'x', 'razgovor', 0))", [id]);
    const rid = (await baza.q("select max(id) as id from outbox")).rows[0].id;
    await cekajDa(async () => (await baza.q('select greska from outbox where id = $1', [rid])).rows[0].greska !== null, 5000, 'pokušaj');
    const red = (await baza.q('select sent_at, dead_at from outbox where id = $1', [rid])).rows[0];
    assert.equal(red.sent_at, null);
    assert.equal(red.dead_at, null);
    assert.equal(await ima('ExponentPushToken[nas1]'), true);
    expo.st.sveOdbij = false;
    await baza.q('delete from outbox where id = $1', [rid]);
  });

  test('R3-08: MessageRateExceeded u tiketu → ponovo samo za taj token (bez duplikata ostalima)', async () => {
    const id = await token(2, 'ExponentPushToken[nas2b]'); // korisnik 2 ima dva uređaja
    let prvi = true;
    expo.st.tiket = (t) => {
      if (t === 'ExponentPushToken[nas2b]' && prvi) { prvi = false; return { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } }; }
      return { status: 'ok', id: 'x' };
    };
    const prije = expo.primljeno.length;
    const r = await baza.q("insert into outbox(vrsta, payload) values ('poruka', jsonb_build_object('primalac', $1::int, 'naslov', 'K', 'tekst', 'Dva uređaja', 'razgovor', 0)) returning id", [id]);
    const rid = r.rows[0].id;
    // Prije popravke: tiket s greškom osim DeviceNotRegistered = poslano, push na drugi uređaj izgubljen.
    await cekajDa(async () => (await baza.q('select greska from outbox where id = $1', [rid])).rows[0].greska !== null, 5000, 'prvi pokušaj');
    const red = (await baza.q('select sent_at, payload from outbox where id = $1', [rid])).rows[0];
    assert.equal(red.sent_at, null);
    assert.deepEqual(red.payload.preostali, ['ExponentPushToken[nas2b]']);
    await baza.q('update outbox set run_at = now() where id = $1', [rid]);
    await cekajDa(async () => (await baza.q('select sent_at from outbox where id = $1', [rid])).rows[0].sent_at !== null, 5000, 'poslano');
    const nova = expo.primljeno.slice(prije).filter((p) => p.body === 'Dva uređaja').map((p) => p.to).sort();
    assert.deepEqual(nova, ['ExponentPushToken[nas2]', 'ExponentPushToken[nas2b]']);
    expo.st.tiket = () => ({ status: 'ok', id: 'x' });
  });

  test('R3-08: red čiji je zakup preuzeo drugi prolaz (istekao usred prolaza) se ne šalje; stariji od 24 h se odbacuje', async () => {
    const id3 = await korisnik(3);
    // Tačno 100 poruka na postojeće tokene (nas1–nas12 i nas31–nas120 bez obrisanih 40 i 99), pa red b ide u drugi zahtjev.
    const brojevi = [...Array.from({ length: 12 }, (_, k) => k + 1), ...Array.from({ length: 90 }, (_, k) => k + 31).filter((n) => n !== 40 && n !== 99)];
    const sto = brojevi.map((n) => ({ to: `ExponentPushToken[nas${n}]`, title: 't', body: 'serija' }));
    assert.equal(sto.length, 100);
    // Zaustavi posao, upiši dva reda (serija ~98 poruka + 1 poruka = dva zahtjeva), pa pokreni posao ponovo.
    for (const p of procesi.splice(0)) await p.stop().catch(() => {});
    const a = (await baza.q("insert into outbox(vrsta, payload) values ('push', $1::jsonb) returning id", [JSON.stringify({ poruke: sto })])).rows[0].id;
    const b = (await baza.q("insert into outbox(vrsta, payload) values ('poruka', jsonb_build_object('primalac', $1::int, 'naslov', 'K', 'tekst', 'Drugi zahtjev', 'razgovor', 0)) returning id", [id3])).rows[0].id;
    const c = (await baza.q(`insert into outbox(vrsta, payload, created_at) values ('poruka', jsonb_build_object('primalac', $1::int, 'naslov', 'K', 'tekst', 'Prestaro', 'razgovor', 0), now() - interval '25 hours') returning id`, [id3])).rows[0].id;
    // Dok Expo prima prvi zahtjev, „drugi proces” preuzima red b (njegov zakup je istekao).
    expo.st.prijeOdgovora = async (poruke) => {
      if (poruke.some((p) => p.body === 'serija')) await baza.q("update outbox set zakup = 'drugi-proces' where id = $1", [b]);
    };
    const prije = expo.primljeno.length;
    await posao();
    await cekajDa(async () => (await baza.q('select sent_at from outbox where id = $1', [a])).rows[0].sent_at !== null, 5000, 'serija poslana');
    await sleep(500);
    expo.st.prijeOdgovora = null;
    const nova = expo.primljeno.slice(prije);
    // Prije popravke: prolaz bi poslao i red b (drugi proces bi ga poslao još jednom).
    assert.equal(nova.filter((p) => p.body === 'Drugi zahtjev').length, 0);
    assert.equal((await baza.q('select sent_at from outbox where id = $1', [b])).rows[0].sent_at, null);
    // Stariji od 24 h: ne šalje se, označen kao gotov s razlogom.
    assert.equal(nova.filter((p) => p.body === 'Prestaro').length, 0);
    const rc = (await baza.q('select sent_at, greska from outbox where id = $1', [c])).rows[0];
    assert.notEqual(rc.sent_at, null);
    assert.match(rc.greska, /isteklo/);
    await baza.q('delete from outbox where id = $1', [b]);
  });

  test('R3-07: čišćenje — poslani se brišu poslije 24 h, mrtvi poslije 7 dana', async () => {
    for (const p of procesi.splice(0)) await p.stop().catch(() => {});
    await baza.q('delete from outbox');
    await baza.q(`insert into outbox(vrsta, payload, created_at, sent_at, dead_at) values
      ('poruka', '{"tekst":"a"}', now() - interval '26 hours', now() - interval '25 hours', null),
      ('poruka', '{"tekst":"b"}', now() - interval '2 hours', now() - interval '1 hour', null),
      ('poruka', '{"tekst":"c"}', now() - interval '8 days', null, now() - interval '8 days'),
      ('poruka', '{"tekst":"d"}', now() - interval '2 days', null, now() - interval '2 days')`);
    await posao(); // cleanup se pokreće pri startu poslova
    // Prije popravke: poslani 7 dana, mrtvi 30 dana → ostala bi sva četiri.
    await cekajDa(async () => (await baza.q('select count(*)::int as n from outbox')).rows[0].n === 2, 5000, 'čišćenje');
    const ost = (await baza.q("select payload->>'tekst' as t from outbox order by t")).rows.map((r) => r.t);
    assert.deepEqual(ost, ['b', 'd']);
  });
});

describe('R3-08: sniženje važi samo dok je cijena ista i oglas postoji; R3-07: brisanje naloga briše redove outboxa', () => {
  let o; let expo; let bk; let oglas; let kupac; let b;
  before(async () => {
    expo = await laziExpo();
    o = await okolina({ EXPO_PUSH_URL: expo.url });
    b = await noviButik(o.baza, { butik: 'Snizenje Rok', email: 'snizenje.rok@test.ba' });
    bk = o.klijent(); await bk.prijavi(b.email, b.password);
    oglas = (await bk.objavi({ title: 'Kaput', price: '200' })).body.oglas.id;
    kupac = o.klijent(); await kupac.registruj('snizenje-kupac@test.ba', 'Snizenje Kupac');
    await kupac.post('/api/me/push-token', { token: 'ExponentPushToken[kupacSn]' });
    await kupac.post(`/api/listings/${oglas}/like`, { liked: true });
  });
  after(async () => { await o?.stop(); await expo?.close(); });

  test('red sniženja za cijenu koja se u međuvremenu vratila se ne šalje; serija za prodat oglas se odbacuje', async () => {
    const [shopId] = (await o.baza.q('select id from users where email = $1', [b.email])).rows.map((r) => r.id);
    // API bez poslova (KOMODO_JOBS=0): redovi čekaju, pa ih obrađuje proces s poslovima ispod.
    await o.baza.q('update listings set price_cents = 20000 where id = $1', [oglas]);
    const s = { listingId: oglas, shopId, shopName: 'Snizenje Rok', title: 'Kaput', oldCents: 20000, newCents: 15000 };
    await o.baza.q("insert into outbox(vrsta, payload) values ('snizenje', $1::jsonb)", [JSON.stringify(s)]);
    await o.baza.q("insert into outbox(vrsta, payload) values ('push', $1::jsonb)", [JSON.stringify({ poruke: [{ to: 'ExponentPushToken[kupacSn]', title: 'Sniženje', body: 'stara serija' }], snizenje: { listingId: oglas, newCents: 15000 } })]);
    const a = await pokreniApi(o.baza, { EXPO_PUSH_URL: expo.url, KOMODO_JOBS: '1', OUTBOX_MS: '150' });
    try {
      await cekajDa(async () => (await o.baza.q('select count(*)::int as n from outbox where sent_at is null and dead_at is null')).rows[0].n === 0, 5000, 'obrađeno');
      // Prije popravke: kupac dobije „sniženje 200 → 150 KM” iako je cijena i dalje 200 KM.
      assert.equal(expo.primljeno.length, 0);
      assert.equal((await o.baza.q("select count(*)::int as n from outbox where vrsta = 'push'")).rows[0].n, 1);
      const g = (await o.baza.q('select greska from outbox order by id')).rows.map((r) => r.greska);
      assert.ok(g.every((x) => /ne važi/.test(x)), JSON.stringify(g));
    } finally {
      await a.stop();
    }
  });

  test('brisanje naloga butika briše redove poruka iz njegovih razgovora (s tekstom) i njegova sniženja', async () => {
    const [shopId] = (await o.baza.q('select id from users where email = $1', [b.email])).rows.map((r) => r.id);
    const razgovor = (await kupac.post('/api/conversations', { shop: b.handle })).body.razgovor;
    await bk.post('/api/me/push-token', { token: 'ExponentPushToken[butikSn]' });
    expo.st.sveOdbij = true; // Expo ne prima ništa: red poruke čeka ponovni pokušaj s tekstom u payloadu
    assert.equal((await kupac.post(`/api/conversations/${razgovor}/messages`, { body: 'Privatna poruka' })).status, 201);
    await sleep(300);
    await o.baza.q("insert into outbox(vrsta, payload) values ('snizenje', $1::jsonb)", [JSON.stringify({ listingId: oglas, shopId, newCents: 1 })]);
    assert.ok((await o.baza.q("select count(*)::int as n from outbox where payload::text like '%Privatna poruka%'")).rows[0].n >= 1);
    assert.equal((await bk.post('/api/me/delete', { password: b.password })).status, 200);
    // Prije popravke: tekst poruke ostaje u outbox.payload 7–30 dana poslije brisanja naloga.
    assert.equal((await o.baza.q("select count(*)::int as n from outbox where payload::text like '%Privatna poruka%'")).rows[0].n, 0);
    assert.equal((await o.baza.q("select count(*)::int as n from outbox where vrsta = 'snizenje' and (payload->>'shopId')::int = $1", [shopId])).rows[0].n, 0);
    expo.st.sveOdbij = false;
  });
});

/* ---------- R3-05: statistika ---------- */

describe('R3-05: statistika butika čita likes_count + nesabrane razlike', () => {
  let o;
  before(async () => { o = await okolina({ KOMODO_JOBS: '0' }); });
  after(async () => { await o?.stop(); });

  test('sviđanje koje posao još nije sabrao se vidi u likesAll', async () => {
    const b = await noviButik(o.baza, { butik: 'Stat Delta', email: 'stat.delta@test.ba' });
    const bk = o.klijent(); await bk.prijavi(b.email, b.password);
    const id = (await bk.objavi({ title: 'Delta' })).body.oglas.id;
    const k = o.klijent(); await k.registruj('stat-delta@test.ba', 'Stat Delta K');
    assert.equal((await k.post(`/api/listings/${id}/like`, { liked: true })).body.likes, 1);
    assert.equal((await o.baza.q('select likes_count from listings where id = $1', [id])).rows[0].likes_count, 0); // posao ne radi
    const s = await bk.get('/api/me/stats?period=7');
    assert.equal(s.status, 200, JSON.stringify(s.body));
    // Prije popravke: 0.
    assert.equal(s.body.statistika.oglasi.find((x) => x.id === id).likesAll, 1);
  });
});

/* ---------- R3-06: brisanje naloga i istovremeno sviđanje ---------- */

describe('R3-06: brisanje naloga istovremeno sa sviđanjem istog korisnika ne ostavlja +1', () => {
  let o;
  before(async () => { o = await okolina({ KOMODO_JOBS: '0' }); });
  after(async () => { await o?.stop(); });

  test('sviđanje poslato dok `delete from likes` brisanja naloga čeka ne ostaje u brojaču', async () => {
    const b = await noviButik(o.baza, { butik: 'Brisanje Lajk', email: 'brisanje.lajk@test.ba' });
    const bk = o.klijent(); await bk.prijavi(b.email, b.password);
    const prvi = (await bk.objavi({ title: 'Lajk jedan' })).body.oglas.id;
    const id = (await bk.objavi({ title: 'Lajk dva' })).body.oglas.id;
    const k = o.klijent(); await k.registruj('brise-lajk@test.ba', 'Brise Lajk');
    assert.equal((await k.post(`/api/listings/${prvi}/like`, { liked: true })).status, 200);
    const uid = (await o.baza.q("select id from users where email = 'brise-lajk@test.ba'")).rows[0].id;
    // Brava na postojeće sviđanje korisnika: `delete from likes` brisanja naloga (snimak uzet na početku naredbe)
    // čeka na nju. Za to vrijeme isti korisnik označi drugi oglas. Bez brave na red korisnika (R3-06) to sviđanje se
    // potvrdi odmah, naredba ga ne vidi, a `delete from users` ga obriše kaskadno bez −1 → brojač ostane +1.
    const c = await o.baza.pool.connect();
    try {
      await c.query('begin');
      await c.query('select 1 from likes where user_id = $1 and listing_id = $2 for update', [uid, prvi]);
      const brisanje = k.post('/api/me/delete', { password: 'lozinka123' });
      await cekajDa(async () => (await o.baza.q(
        "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like 'with d as (delete from likes%'",
      )).rows[0].n === 1, 5000, 'delete from likes čeka na bravu');
      const lajk = k.post(`/api/listings/${id}/like`, { liked: true });
      await sleep(400);
      await c.query('commit');
      const [rb, rl] = await Promise.all([brisanje, lajk]);
      assert.equal(rb.status, 200);
      assert.ok([401, 404].includes(rl.status), `sviđanje za vrijeme brisanja: ${rl.status} ${JSON.stringify(rl.body)}`);
    } finally {
      c.release();
    }
    for (const oglas of [prvi, id]) {
      const r = (await o.baza.q(
        `select l.likes_count + coalesce((select sum(delta) from listing_likes_delta where listing_id = l.id), 0) as broj,
                (select count(*) from likes where listing_id = l.id) as redova
           from listings l where l.id = $1`, [oglas])).rows[0];
      assert.deepEqual([Number(r.broj), Number(r.redova)], [0, 0], `oglas ${oglas}`);
    }
  });
});

/* ---------- R3-04: stari keš feeda ---------- */

describe('R3-04: „prekidač kola” i stari keš bez obrisanih/ugašenih oglasa', () => {
  let o; let admin; let anon; let bk1; let bk2;
  let a1; let a2; let a3;
  before(async () => {
    o = await okolina({ PG_STATEMENT_TIMEOUT_MS: '1500', FEED_PREKIDAC_MS: '4000' });
    admin = o.klijent(); await admin.registruj('admin@test.ba', 'Administrator');
    const b1 = await noviButik(o.baza, { butik: 'Kes Jedan', email: 'kes1@test.ba' });
    const b2 = await noviButik(o.baza, { butik: 'Kes Dva', email: 'kes2@test.ba' });
    bk1 = o.klijent(); await bk1.prijavi(b1.email, b1.password);
    bk2 = o.klijent(); await bk2.prijavi(b2.email, b2.password);
    a1 = (await bk1.objavi({ title: 'Ostaje' })).body.oglas.id;
    a2 = (await bk1.objavi({ title: 'Obrisan' })).body.oglas.id;
    a3 = (await bk2.objavi({ title: 'Ugasen butik' })).body.oglas.id;
    anon = o.klijent();
  });
  after(async () => { await o?.stop(); });

  test('obrisan oglas i oglasi ugašenog butika ne vraćaju se iz starog keša; drugi zahtjev dok baza ne odgovara ne čeka', async () => {
    const prije = await anon.get('/api/listings');
    assert.deepEqual(prije.body.oglasi.map((x) => x.id).sort(), [a1, a2, a3].sort());
    const zt = await anon.get('/api/feed?kartica=zatebe');
    assert.equal(zt.body.oglasi.length, 3);
    assert.equal((await bk1.del(`/api/listings/${a2}`)).status, 200);
    const b2id = (await o.baza.q("select id from users where email = 'kes2@test.ba'")).rows[0].id;
    assert.equal((await admin.post(`/api/admin/users/${b2id}/suspend`, { suspended: true })).status, 200);
    const c = await o.baza.pool.connect();
    try {
      await c.query('begin');
      await c.query('lock table listings in access exclusive mode');
      let t = Date.now();
      const r1 = await anon.get('/api/listings');
      const prviMs = Date.now() - t;
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.equal(r1.headers.get('x-komodo-zastarjelo'), '1');
      // Prije popravke: [a1, a2, a3] (obrisan i ugašen se vraćaju).
      assert.deepEqual(r1.body.oglasi.map((x) => x.id), [a1]);
      assert.ok(prviMs >= 1300, `prvi zahtjev čeka rok upita (${prviMs} ms)`);
      // Prekidač otvoren: odmah, bez čekanja 1,5 s (prije popravke: svaki ~1,5 s).
      t = Date.now();
      const r2 = await anon.get('/api/listings');
      const z2 = await anon.get('/api/feed?kartica=zatebe');
      const drugiMs = Date.now() - t;
      assert.equal(r2.headers.get('x-komodo-zastarjelo'), '1');
      assert.equal(z2.status, 200);
      assert.equal(z2.headers.get('x-komodo-zastarjelo'), '1');
      assert.deepEqual(z2.body.oglasi.map((x) => x.id), [a1]);
      assert.ok(drugiMs < 600, `dva zahtjeva dok je prekidač otvoren: ${drugiMs} ms`);
    } finally {
      await c.query('rollback');
      c.release();
    }
    // Poslije FEED_PREKIDAC_MS (4 s) opet svježe iz baze.
    await sleep(4200);
    const r3 = await anon.get('/api/listings');
    assert.equal(r3.headers.get('x-komodo-zastarjelo'), null);
    assert.deepEqual(r3.body.oglasi.map((x) => x.id), [a1]);
  });
});

/* ---------- R3-09: dnevnik promjena režima ---------- */

describe('R3-09: promjene režima u bazi (ko, kada, staro → novo), bez emaila u logu', () => {
  let o;
  before(async () => { o = await okolina(); });
  after(async () => { await o?.stop(); });

  test('dvije promjene → GET /api/admin/rezim vraća ih (najnovija prva); log ima id, ne email', async () => {
    const admin = o.klijent(); await admin.registruj('admin@test.ba', 'Glavni Admin');
    assert.equal((await admin.post('/api/admin/rezim', { rezim: 'stedi' })).status, 200);
    assert.equal((await admin.post('/api/admin/rezim', { rezim: null })).status, 200);
    const r = await admin.get('/api/admin/rezim');
    assert.equal(r.status, 200);
    // Prije popravke: polja promjene nema.
    assert.equal(r.body.promjene.length, 2);
    assert.deepEqual(r.body.promjene.map((p) => [p.staro, p.novo, p.okolina, p.admin.name]),
      [['stedi', 'normalno', true, 'Glavni Admin'], ['normalno', 'stedi', false, 'Glavni Admin']]);
    assert.ok(r.body.promjene[0].at);
    const log = o.api.log();
    assert.match(log, /Režim rada: normalno → stedi \(administrator id \d+\)/);
    assert.doesNotMatch(log, /Režim rada[^\n]*admin@test\.ba/);
    assert.equal((await o.klijent().get('/api/admin/rezim')).status, 404);
  });
});

