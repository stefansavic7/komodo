// Otvara nalog butika. Butik se ne može registrovati sam — otvara ga administrator.
//
//   node --env-file=.env src/novi-butik.js --butik "Moda Bojana" --email bojana@primjer.ba --telefon "065 123 456"
//
// Obavezno: --butik i --email. Ispiše privremenu lozinku (samo jednom).
import { migrate, pool, q } from './db.js';
import { createShop } from './nalog.js';

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let k = 0; k < a.length; k += 1) {
    if (a[k].startsWith('--')) { out[a[k].slice(2)] = a[k + 1] && !a[k + 1].startsWith('--') ? a[k += 1] : ''; }
  }
  return out;
}

const opt = args();

let code = 0;
try {
  if (!opt.butik || !opt.email) {
    throw new Error('Upotreba: node --env-file=.env src/novi-butik.js --butik "Naziv butika" --email adresa@primjer.ba [--telefon "065 123 456"] [--grad "Banja Luka"]');
  }
  await migrate({ info: (m) => console.log(m) });
  const shop = await createShop({ name: opt.butik, email: opt.email, phone: opt.telefon, city: opt.grad });
  console.log('\nButik je otvoren.');
  console.log(`  Naziv:               ${shop.name}`);
  console.log(`  Profil:              /?b=${shop.handle}`);
  console.log(`  Email za prijavu:    ${shop.email}`);
  console.log(`  Privremena lozinka:  ${shop.password}`);
  console.log('\nLozinka se više ne može vidjeti. Vlasnik je mijenja u Profil → Promijeni lozinku.\n');
} catch (err) {
  console.error(`\n${err.message}\n`);
  code = 1;
} finally {
  await pool.end();
}
process.exit(code);
