// Push obavještenja (Expo): prijava tokena uređaja i slanje prema Expo-u (koristi ga outbox, src/outbox.js).
import { q, qPosao } from '../db.js';
import { bad, clean, currentUser, hashToken } from '../app.js';

export const PO_ZAHTJEVU = 100; // poruka u jednom zahtjevu prema Expo-u

// Jedan zahtjev prema Expo-u (najviše PO_ZAHTJEVU poruka): zaglavlja, EXPO_ACCESS_TOKEN (S-09), EXPO_PUSH_URL
// (testovi, lažni Expo), rok od 10 s. Tokeni koje Expo prijavi kao DeviceNotRegistered brišu se iz baze.
// Vraća niz ishoda, po jedan za svaku poruku: { ok: true } | { greska, privremena } (greška u tiketu).
// Baca ExpoGreska kad Expo odbije cijeli zahtjev ili zahtjev ne uspije: `privremena` = mreža, rok, HTTP 429 ili 5xx
// (ponovo kasnije; i 401/403); inače (4xx) zahtjev neće proći ni ponovljen — outbox ga tada dijeli (src/outbox.js, R3-02).
//
// Ugovor Expo-a (docs.expo.dev/push-notifications/sending-notifications, provjereno 24.11.2026.): neuspio zahtjev ima
// HTTP 4xx/5xx i tijelo { errors: [{ code, message, details? }] }; 429 i 5xx su privremeni (ponoviti s rastućim
// čekanjem), 400 se ne popravlja sam; PUSH_TOO_MANY_EXPERIENCE_IDS = tokeni iz više Expo projekata u istom
// zahtjevu, `details` = { "<projekat>": [tokeni] }. Greške po poruci u tiketu: DeviceNotRegistered (token ne važi),
// MessageRateExceeded (ponoviti s rastućim čekanjem), MessageTooBig, InvalidCredentials, MismatchSenderId.
export class ExpoGreska extends Error {
  constructor(message, { status = 0, privremena = true, kod = null, details = null } = {}) {
    super(message);
    this.status = status;
    this.privremena = privremena;
    this.kod = kod;
    this.details = details;
  }
}

const PRIVREMENE_U_TIKETU = new Set(['MessageRateExceeded']);

export async function posaljiPushSeriju(serija) {
  const url = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(serija),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new ExpoGreska(`Expo nije dostupan: ${err.message}`);
  }
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = Array.isArray(out.errors) && out.errors[0] ? out.errors[0] : {};
    throw new ExpoGreska(`Expo je odgovorio ${resp.status}${e.code ? ` (${e.code})` : ''}`, {
      status: resp.status,
      // 401/403: ključ (EXPO_ACCESS_TOKEN) ili podešavanje — ne krivica pojedinog tokena, pa ponovo kao privremena.
      privremena: resp.status === 429 || resp.status >= 500 || resp.status === 401 || resp.status === 403,
      kod: e.code || null,
      details: e.details || null,
    });
  }
  const tickets = Array.isArray(out.data) ? out.data : [];
  const mrtvi = [];
  const ishodi = serija.map((m, k) => {
    const t = tickets[k];
    if (!t) return { greska: 'Expo nije vratio tiket', privremena: true };
    if (t.status !== 'error') return { ok: true };
    const greska = (t.details && t.details.error) || t.message || 'greška';
    if (greska === 'DeviceNotRegistered') mrtvi.push(m.to);
    return { greska, privremena: PRIVREMENE_U_TIKETU.has(greska) };
  });
  if (mrtvi.length) await qPosao('delete from push_tokens where token = any($1::text[])', [mrtvi]);
  return ishodi;
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
