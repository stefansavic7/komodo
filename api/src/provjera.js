// Provjera okoline pri startu. U produkciji (NODE_ENV=production) API ne starta bez varijabli od kojih
// zavisi sigurnost (docs/SIGURNOST.md, S-01 i S-07). Poziva je src/index.js (primarni proces, prije
// migracija) i src/app.js (svaki proces), pa greška ima jasnu poruku i radnici ne padaju u krug.

export function provjeriOkolinu(log = (text) => console.warn(text)) {
  const prod = process.env.NODE_ENV === 'production';
  const nema = [];
  if (prod && !process.env.SMTP_URL) {
    nema.push('SMTP_URL (bez emaila nalozi ne mogu potvrditi adresu ni postaviti novu lozinku, a administrator mora imati potvrđen email)');
  }
  if (prod && !process.env.COOKIE_SECRET) {
    nema.push('COOKIE_SECRET (potpis kolačića uređaja; npr. `openssl rand -hex 32`)');
  }
  if (nema.length) {
    throw new Error(`API ne može startati u produkciji. Nedostaje u api/.env:\n  - ${nema.join('\n  - ')}`);
  }
  if (prod && !process.env.APP_URL) log('Upozorenje: APP_URL nije upisan; linkovi u emailovima i provjera Origin koriste 127.0.0.1.');
  if (prod && process.env.COOKIE_SECRET.length < 32) log('Upozorenje: COOKIE_SECRET je kraći od 32 znaka.');
  if (!prod && !process.env.COOKIE_SECRET) log('Upozorenje: COOKIE_SECRET nije upisan; koristi se razvojni ključ (nije za produkciju).');
}
