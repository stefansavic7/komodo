// Push obavještenja (Expo): prijava tokena uređaja i slanje obavještenja o novoj poruci.
import { q } from '../db.js';
import { bad, clean, currentUser, hashToken } from '../app.js';

export const PO_ZAHTJEVU = 100; // poruka u jednom zahtjevu prema Expo-u

// Opšte slanje: niz Expo poruka ({to, title, body, channelId, data…}) u serijama po PO_ZAHTJEVU.
// Zaglavlja, EXPO_ACCESS_TOKEN (S-09), EXPO_PUSH_URL (testovi, lažni Expo), rok od 10 s po zahtjevu;
// tokeni koje Expo prijavi kao DeviceNotRegistered brišu se iz baze. Greške samo bilježi.
export async function posaljiPush(log, messages) {
  const url = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
  for (let i = 0; i < messages.length; i += PO_ZAHTJEVU) {
    const serija = messages.slice(i, i + PO_ZAHTJEVU);
    try {
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
      const tickets = Array.isArray(out.data) ? out.data : [];
      const mrtvi = [];
      for (let k = 0; k < tickets.length; k += 1) {
        if (tickets[k].status === 'error' && tickets[k].details?.error === 'DeviceNotRegistered') mrtvi.push(serija[k].to);
      }
      if (mrtvi.length) await q('delete from push_tokens where token = any($1::text[])', [mrtvi]);
    } catch (err) {
      log.warn(err, 'Push obavještenje nije poslano');
    }
  }
}

// Šalje push primaocu nove poruke. Ne zadržava odgovor pošiljaocu; greške samo bilježi.
export async function pushNewMessage(log, recipientId, senderName, text, conversationId) {
  const res = await q(
    `select t.token from push_tokens t join users u on u.id = t.user_id
      where t.user_id = $1 and u.push_enabled and u.suspended_at is null`,
    [recipientId],
  );
  if (res.rowCount === 0) return;
  const body = text.length > 140 ? `${text.slice(0, 137)}…` : text;
  await posaljiPush(log, res.rows.map((r) => ({
    to: r.token, title: senderName, body, sound: 'default', channelId: 'poruke',
    data: { conversationId },
  })));
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
