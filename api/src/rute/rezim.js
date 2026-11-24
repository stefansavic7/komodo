// „Veliki crveni prekidač” (talas 4): GET /api/config javlja klijentima intervale tajmera i zastavice, a
// administrator mijenja režim (POST /api/admin/rezim). Režim važi odmah u svim procesima (javiSvima), klijenti ga
// vide pri sljedećem zahtjevu (zaglavlje X-Komodo-Rezim → klijent ponovo čita /api/config) ili najkasnije kad
// istekne keš /api/config (30 s u Nginxu i pregledniku) i njihov periodični poziv. Uputstvo: docs/RUNBOOK.md.
import { q } from '../db.js';
import {
  REZIMI, app as aplikacija, bad, currentUser, isAdmin, javiSvima, naPoruku, postaviRezimOvdje, rezim, rezimOkoline,
} from '../app.js';

// Intervali u milisekundama. Klijent svakom dodaje nasumičan pomak ±20 % i produžava ih poslije grešaka.
// normalno = dosadašnji tajmeri (docs/SKALIRANJE.md): ~6 zahtjeva/min po korisniku u feedu.
// stedi = ~2,5× rjeđe: za vrh prometa (reklama) kad baza ili procesor pređu ~70 %.
// hitno = samo najnužnije: lični „Za tebe” isključen (server šalje keširani „Novo”), pregledi se ne šalju ni ne
//         broje, sviđanja na ekranu i značka poruka svakih 5 min, otvoren razgovor svakih 15 s.
export const KONFIG = {
  normalno: { intervali: { likes: 30000, me: 60000, profil: 30000, chat: 4000, views: 30000, config: 600000 }, licniFeed: true, pregledi: true },
  stedi: { intervali: { likes: 90000, me: 180000, profil: 120000, chat: 8000, views: 120000, config: 300000 }, licniFeed: true, pregledi: true },
  hitno: { intervali: { likes: 300000, me: 300000, profil: 300000, chat: 15000, views: 300000, config: 300000 }, licniFeed: false, pregledi: false },
};
export function konfig() {
  const r = rezim();
  return { rezim: r, ...KONFIG[r] };
}

async function ucitajRezim() {
  const res = await q("select value from app_settings where key = 'rezim'");
  postaviRezimOvdje(res.rowCount ? res.rows[0].value : null);
}
naPoruku('rezim', (r) => postaviRezimOvdje(r));

export default function rute(app) {
  // Pri startu i svakih 30 s (rezerva ako poruka između procesa zakasni ili se izgubi). Greška baze: ostaje staro.
  const osvjezi = () => ucitajRezim().catch((err) => aplikacija.log.warn({ msg: err.message }, 'Režim rada nije učitan'));
  app.addHook('onReady', async () => { await osvjezi(); });
  const t = setInterval(osvjezi, 30 * 1000);
  t.unref();

  // Javno i keširano (30 s u pregledniku i u Nginxu, server/nginx-komodo.conf); bez kolačića i bez baze.
  app.get('/api/config', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return konfig();
  });

  // R3-09: uz stanje i zadnjih 10 promjena (ko, kada, staro → novo) iz tabele rezim_promjene (014).
  const stanje = async () => {
    const p = await q(
      `select p.created_at, p.staro, p.novo, p.okolina, p.user_id, u.shop_name
         from rezim_promjene p left join users u on u.id = p.user_id
        order by p.id desc limit 10`,
    );
    return {
      ...konfig(), okolina: rezimOkoline(), rezimi: REZIMI,
      promjene: p.rows.map((r) => ({
        at: r.created_at, staro: r.staro, novo: r.novo, okolina: r.okolina,
        admin: r.user_id === null ? null : { id: r.user_id, name: r.shop_name },
      })),
    };
  };

  app.get('/api/admin/rezim', async (req, reply) => {
    if (!isAdmin(await currentUser(req))) return bad(reply, 404, 'Ne postoji.');
    return stanje();
  });

  // {rezim: 'normalno'|'stedi'|'hitno'} postavlja režim; {rezim: null} vraća na KOMODO_REZIM iz okoline.
  app.post('/api/admin/rezim', async (req, reply) => {
    const user = await currentUser(req);
    if (!isAdmin(user)) return bad(reply, 404, 'Ne postoji.');
    const r = (req.body || {}).rezim;
    if (r !== null && !REZIMI.includes(r)) return bad(reply, 400, 'Režim mora biti normalno, stedi ili hitno.');
    const staro = rezim();
    const novo = r === null ? rezimOkoline() : r;
    // Promjena i zapis u dnevnik u istoj naredbi (R3-09): ko (id), kada, staro → novo.
    if (r === null) {
      await q(
        `with d as (delete from app_settings where key = 'rezim')
         insert into rezim_promjene(user_id, staro, novo, okolina) values ($1, $2, $3, true)`,
        [user.id, staro, novo],
      );
    } else {
      await q(
        `with s as (insert into app_settings(key, value) values ('rezim', $1::jsonb)
                    on conflict (key) do update set value = excluded.value, updated_at = now())
         insert into rezim_promjene(user_id, staro, novo, okolina) values ($2, $3, $4, false)`,
        [JSON.stringify(r), user.id, staro, novo],
      );
    }
    postaviRezimOvdje(r);
    javiSvima('rezim', r);
    // U logu id administratora, ne email (lični podatak u logovima, R3-09).
    req.log.warn({ adminId: user.id, staro, novo: rezim() }, `Režim rada: ${staro} → ${rezim()} (administrator id ${user.id})`);
    return stanje();
  });
}
