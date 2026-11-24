// Push obavještenja (Expo): prijava tokena uređaja i slanje prema Expo-u (koristi ga outbox, src/outbox.js).
import { q, qPosao } from '../db.js';
import { bad, clean, currentUser, hashToken } from '../app.js';

export const PO_ZAHTJEVU = 100; // poruka u jednom zahtjevu prema Expo-u

// Jedan zahtjev prema Expo-u (najviše PO_ZAHTJEVU poruka): zaglavlja, EXPO_ACCESS_TOKEN (S-09), EXPO_PUSH_URL
// (testovi, lažni Expo), rok od 10 s. Tokeni koje Expo prijavi kao DeviceNotRegistered brišu se iz baze.
// Baca grešku kad zahtjev ne uspije (mreža, rok, HTTP 429/5xx…), da outbox (src/outbox.js) pokuša ponovo.
export async function posaljiPushSeriju(serija) {
  const url = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(serija),
    signal: AbortSignal.timeout(10000),
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Expo je odgovorio ${resp.status}`);
  const tickets = Array.isArray(out.data) ? out.data : [];
  const mrtvi = [];
  for (let k = 0; k < tickets.length; k += 1) {
    if (tickets[k].status === 'error' && tickets[k].details?.error === 'DeviceNotRegistered') mrtvi.push(serija[k].to);
  }
  if (mrtvi.length) await qPosao('delete from push_tokens where token = any($1::text[])', [mrtvi]);
}

// Opšte slanje bez ponovnog pokušaja: niz Expo poruka u serijama po PO_ZAHTJEVU; greške samo bilježi.
// Obavještenja o poruci i sniženju NE idu ovuda nego kroz outbox (src/outbox.js), koji ponavlja neuspjele serije.
export async function posaljiPush(log, messages) {
  for (let i = 0; i < messages.length; i += PO_ZAHTJEVU) {
    try {
      await posaljiPushSeriju(messages.slice(i, i + PO_ZAHTJEVU));
    } catch (err) {
      log.warn(err, 'Push obavještenje nije poslano');
    }
  }
}

export default function rute(app) {
  // Mobilna aplikacija prijavljuje Expo push token uređaja za trenutnu prijavu.
  app.post('/api/me/push-token', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return bad(reply, 401, 'Prijavi se.');
    const token = clean((req.body || {}).token, 200);
    if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) return bad(reply, 400, 'Token nije ispravan.');
    // S-09: token koji je već prijavljen na drugi nalog se ne preotima. Odjava briše sesiju, a s njom
    // kaskadno i token, pa drugi nalog na istom telefonu poslije odjave prvog prijavljuje token normalno.
    await q(
      `insert into push_tokens(token, user_id, session_token) values ($1, $2, $3)
       on conflict (token) do update set session_token = excluded.session_token, created_at = now()
         where push_tokens.user_id = excluded.user_id`,
      [token, user.id, hashToken(req.cookies.sid)],
    );
    return { ok: true };
  });
}
