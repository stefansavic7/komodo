import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function checkPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function slug(text) {
  const map = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj' };
  return String(text).toLowerCase()
    .replace(/[čćšžđ]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30) || 'korisnik';
}

// Slobodno korisničko ime (handle) izvedeno iz naziva: butik.sik, butik.sik2, …
export async function freeHandle(name) {
  const base = slug(name);
  for (let n = 0; n < 50; n += 1) {
    const handle = n === 0 ? base : `${base}${n + 1}`;
    const taken = await q('select 1 from users where handle = $1', [handle]);
    if (taken.rowCount === 0) return handle;
  }
  return `${base}.${randomBytes(3).toString('hex')}`;
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Unique violation (23505) na datoj koloni users: 'email' ili 'handle'.
export function uniqueOn(err, column) {
  return err && err.code === '23505' && String(err.constraint || '').includes(column);
}

// Upisuje novog korisnika. Ako je handle u međuvremenu zauzeo neko drugi (istovremena registracija),
// pokušava ponovo s nasumičnim sufiksom, najviše 5 puta. Zauzet email baca grešku s kodom 'EMAIL_ZAUZET'.
export async function insertUser(name, insert) {
  let handle = await freeHandle(name);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await insert(handle);
    } catch (err) {
      if (uniqueOn(err, 'email')) {
        const e = new Error('Nalog s ovom email adresom već postoji. Prijavi se.');
        e.code = 'EMAIL_ZAUZET';
        throw e;
      }
      if (!uniqueOn(err, 'handle') || attempt >= 4) throw err;
      handle = `${slug(name).slice(0, 24)}.${randomBytes(3).toString('hex')}`;
    }
  }
}

// Otvara nalog butika i vraća privremenu lozinku. Baca grešku s porukom ako ne može.
export async function createShop({ name, email, phone = '', city = 'Banja Luka' }) {
  name = String(name || '').trim().slice(0, 40);
  email = String(email || '').trim().toLowerCase();
  phone = String(phone || '').trim().slice(0, 30);
  city = String(city || 'Banja Luka').trim().slice(0, 40) || 'Banja Luka';
  if (name.length < 2) throw new Error('Upiši naziv butika.');
  if (!validEmail(email)) throw new Error('Upiši ispravnu email adresu butika.');
  const exists = await q('select role from users where email = $1', [email]);
  if (exists.rowCount > 0) throw new Error(`Nalog s adresom ${email} već postoji (uloga: ${exists.rows[0].role}). Ništa nije promijenjeno.`);
  const password = randomBytes(6).toString('base64url');
  const passwordHash = await hashPassword(password);
  let handle;
  try {
    handle = await insertUser(name, async (h) => {
      await q(
        `insert into users(email, password_hash, shop_name, handle, phone, city, role, email_verified_at)
         values ($1, $2, $3, $4, $5, $6, 'butik', now())`,
        [email, passwordHash, name, h, phone, city],
      );
      return h;
    });
  } catch (err) {
    if (err.code === 'EMAIL_ZAUZET') throw new Error(`Nalog s adresom ${email} već postoji. Ništa nije promijenjeno.`);
    throw err;
  }
  return { name, email, handle, password };
}
