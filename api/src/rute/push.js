// Push obavještenja (Expo): prijava tokena uređaja i slanje obavještenja o novoj poruci.
import { q } from '../db.js';
import { bad, clean, currentUser, hashToken } from '../app.js';

// Šalje push primaocu nove poruke. Ne zadržava odgovor pošiljaocu; greške samo bilježi.
export async function pushNewMessage(log, recipientId, senderName, text, conversationId) {
  const res = await q(
    `select t.token from push_tokens t join users u on u.id = t.user_id
      where t.user_id = $1 and u.push_enabled and u.suspended_at is null`,
    [recipientId],
  );
  if (res.rowCount === 0) return;
  const body = text.length > 140 ? `${text.slice(0, 137)}…` : text;
  const messages = res.rows.map((r) => ({
    to: r.token, title: senderName, body, sound: 'default', channelId: 'poruke',
    data: { conversationId },
  }));
  try {
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      // S-09: s „Enhanced Security for Push Notifications” u Expo projektu slanje traži pristupni token.
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10000),
    });
    const out = await resp.json().catch(() => ({}));
    const tickets = Array.isArray(out.data) ? out.data : [];
    for (let k = 0; k < tickets.length; k += 1) {
      if (tickets[k].status === 'error' && tickets[k].details?.error === 'DeviceNotRegistered') {
        await q('delete from push_tokens where token = $1', [messages[k].to]);
      }
    }
  } catch (err) {
    log.warn(err, 'Push obavještenje nije poslano');
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
