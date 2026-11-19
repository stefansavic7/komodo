// Registracija, prijava, odjava, potvrda emaila i zaboravljena lozinka (/api/auth/*).
import { q } from '../db.js';
import { mailOn, sendMail } from '../mail.js';
import { checkPassword, hashPassword, insertUser, needsRehash, validEmail } from '../nalog.js';
import {
  APP_URL, MIN, bad, clean, cleanLine, currentUser, deviceId, emailToken, forgetToken, forgetUser, hashToken,
  knownDeviceId, limited, publicUser, sendVerification, startSession,
} from '../app.js';

export default function rute(app) {
  app.post('/api/auth/register', async (req, reply) => {
    // Mobilni operateri dijele jednu IP adresu na mnogo ljudi (CGNAT), pa je ograničenje po IP široko,
    // a uže je po uređaju (kolačić `did`).
    if (await limited(`reg:ip:${req.ip}`, 60, 60 * MIN)) return bad(reply, 429, 'Previše novih naloga s ove adrese. Pokušaj za sat vremena.');
    // Dnevna granica po adresi (S-03): jedna adresa ne može potrošiti dnevnu kvotu emailova.
    if (await limited(`reg:ip:dan:${req.ip}`, 200, 24 * 60 * MIN)) return bad(reply, 429, 'Previše novih naloga s ove adrese danas. Pokušaj sutra.');
    if (await limited(`reg:did:${deviceId(req, reply)}`, 5, 60 * MIN)) return bad(reply, 429, 'Previše novih naloga s ovog uređaja. Pokušaj za sat vremena.');
    const body = req.body || {};
    const email = clean(body.email, 200).toLowerCase();
    const password = String(body.password ?? '');
    const name = cleanLine(body.name, 40);
    if (!validEmail(email)) return bad(reply, 400, 'Upiši ispravnu email adresu.');
    if (password.length < 8) return bad(reply, 400, 'Lozinka mora imati najmanje 8 znakova.');
    if (name.length < 2) return bad(reply, 400, 'Upiši svoje ime.');
    const exists = await q('select 1 from users where email = $1', [email]);
    if (exists.rowCount > 0) return bad(reply, 409, 'Nalog s ovom email adresom već postoji. Prijavi se.');
    const passwordHash = await hashPassword(password);
    // Istovremene registracije: zauzet email → 409, zauzet handle → novi pokušaj (insertUser).
    let user;
    try {
      // Bez podešenog emaila (razvoj) nalog je odmah potvrđen.
      user = await insertUser(name, async (handle) => (await q(
        `insert into users(email, password_hash, shop_name, handle, role, email_verified_at)
         values ($1, $2, $3, $4, 'kupac', $5) returning *`,
        [email, passwordHash, name, handle, mailOn ? null : new Date()],
      )).rows[0]);
    } catch (err) {
      if (err.code === 'EMAIL_ZAUZET') return bad(reply, 409, 'Nalog s ovom email adresom već postoji. Prijavi se.');
      throw err;
    }
    if (mailOn) await sendVerification(req.log, user);
    await startSession(reply, user.id);
    return reply.code(201).send({ korisnik: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body || {};
    const email = clean(body.email, 200).toLowerCase();
    const password = String(body.password ?? '');
    const tooMany = 'Previše pokušaja prijave. Pokušaj ponovo za 15 minuta.';
    if (await limited(`login:ip:${req.ip}:${email}`, 10, 15 * MIN)) return bad(reply, 429, tooMany);
    const res = await q('select * from users where email = $1', [email]);
    const user = res.rows[0];
    // S-04: ograničenje po emailu (protiv pogađanja lozinke s mnogo adresa) ne važi za uređaj s kog je
    // prijava na ovaj nalog već uspjela, pa napadač ne može zaključati vlasnika pogrešnim lozinkama.
    const did = knownDeviceId(req);
    const known = user && did
      && (await q('select 1 from known_devices where user_id = $1 and did = $2', [user.id, did])).rowCount > 0;
    if (!known && await limited(`login:email:${email}`, 30, 15 * MIN)) return bad(reply, 429, tooMany);
    if (!user || !(await checkPassword(password, user.password_hash))) {
      return bad(reply, 401, 'Email ili lozinka nisu tačni.');
    }
    if (user.suspended_at) return bad(reply, 403, 'Ovaj nalog je ugašen. Javi nam se ako misliš da je greška.');
    await q(
      `insert into known_devices(user_id, did) values ($1, $2)
       on conflict (user_id, did) do update set seen_at = now()`,
      [user.id, deviceId(req, reply)],
    );
    // Stari scrypt zapis (N=2^14) se prepisuje u novi; ne zadržava odgovor.
    if (needsRehash(user.password_hash)) {
      hashPassword(password)
        .then((h) => q('update users set password_hash = $1 where id = $2 and password_hash = $3', [h, user.id, user.password_hash]))
        .catch((err) => req.log.warn(err, 'Lozinka nije prepisana u novi zapis'));
    }
    await startSession(reply, user.id);
    return { korisnik: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies.sid) {
      await q('delete from sessions where token = $1', [hashToken(req.cookies.sid)]);
      forgetToken(req.cookies.sid);
    }
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  // Novi linkovi (S-06): ${APP_URL}/#potvrda=TOKEN; web čita fragment i šalje token ovdje.
  // 200 {ok:true} | 400 {greska}. Potvrđuje nalog iz tokena, bez obzira ko je prijavljen.
  app.post('/api/auth/verify', async (req, reply) => {
    if (await limited(`verify:ip:${req.ip}`, 30, 15 * MIN)) return bad(reply, 429, 'Previše pokušaja. Pokušaj ponovo za 15 minuta.');
    const token = clean((req.body || {}).token, 100);
    const res = token ? await q(
      `delete from email_tokens where token = $1 and kind = 'potvrda' and expires_at > now() returning user_id`,
      [token],
    ) : { rowCount: 0 };
    if (res.rowCount === 0) return bad(reply, 400, 'Link za potvrdu je istekao ili je već iskorišten. Zatraži novi u profilu.');
    await q('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [res.rows[0].user_id]);
    forgetUser(res.rows[0].user_id);
    return { ok: true };
  });

  // Stari linkovi iz emailova poslanih prije S-06 (/api/auth/verify?token=…) i dalje rade.
  app.get('/api/auth/verify', async (req, reply) => {
    const res = await q(
      `delete from email_tokens where token = $1 and kind = 'potvrda' and expires_at > now() returning user_id`,
      [clean(req.query.token, 100)],
    );
    if (res.rowCount === 0) return reply.redirect('/?potvrda=istekla');
    await q('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [res.rows[0].user_id]);
    forgetUser(res.rows[0].user_id);
    return reply.redirect('/?potvrda=ok');
  });

  app.post('/api/auth/resend', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se.');
    if (user.email_verified_at) return { ok: true };
    if (await limited(`resend:${user.id}`, 3, 60 * MIN)) return bad(reply, 429, 'Link je već poslan. Provjeri poštu, pa pokušaj ponovo za sat vremena.');
    if (!(await sendVerification(req.log, user))) return bad(reply, 429, 'Trenutno ne možemo poslati email. Pokušaj ponovo za sat vremena.');
    return { ok: true };
  });

  // Uvijek odgovara isto, da se ne može provjeriti postoji li nalog s tom adresom.
  app.post('/api/auth/forgot', async (req, reply) => {
    const email = clean((req.body || {}).email, 200).toLowerCase();
    const tooMany = await limited(`forgot:ip:${req.ip}`, 20, 60 * MIN);
    if (await limited(`forgot:email:${email}`, 3, 60 * MIN) || tooMany) {
      return bad(reply, 429, 'Previše zahtjeva. Pokušaj ponovo za sat vremena.');
    }
    const res = await q('select * from users where email = $1 and suspended_at is null', [email]);
    if (res.rowCount > 0) {
      const token = await emailToken(res.rows[0].id, 'lozinka', 1);
      await sendMail(req.log, {
        to: email,
        subject: 'Nova lozinka za Komodo',
        text: `Zdravo ${cleanLine(res.rows[0].shop_name, 40)},\n\nnovu lozinku postavljaš na linku:\n${APP_URL}/#lozinka=${token}\n\nLink vrijedi 1 sat. Ako nisi ti tražio novu lozinku, zanemari ovu poruku.\n\nKomodo`,
      });
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const body = req.body || {};
    const password = String(body.password ?? '');
    if (password.length < 8) return bad(reply, 400, 'Lozinka mora imati najmanje 8 znakova.');
    const res = await q(
      `delete from email_tokens where token = $1 and kind = 'lozinka' and expires_at > now() returning user_id`,
      [clean(body.token, 100)],
    );
    if (res.rowCount === 0) return bad(reply, 400, 'Link je istekao ili je već iskorišten. Zatraži novi.');
    const userId = res.rows[0].user_id;
    await q(
      'update users set password_hash = $1, email_verified_at = coalesce(email_verified_at, now()) where id = $2',
      [await hashPassword(password), userId],
    );
    await q('delete from sessions where user_id = $1', [userId]);
    forgetUser(userId);
    await startSession(reply, userId);
    const user = await q('select * from users where id = $1', [userId]);
    return { korisnik: publicUser(user.rows[0]) };
  });
}
