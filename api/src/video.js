// Snimci na Bunny Stream. Dok BUNNY_* vrijednosti u api/.env nisu upisane, snimci ostaju na disku (api/uploads).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';

const LIBRARY = process.env.BUNNY_LIBRARY_ID || '';
const KEY = process.env.BUNNY_API_KEY || '';
const CDN = (process.env.BUNNY_CDN_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
// Samo za probu s lažnim Bunny serverom; inače se ne postavlja.
const API = (process.env.BUNNY_API_BASE || 'https://video.bunnycdn.com').replace(/\/$/, '');

export const bunnyOn = Boolean(LIBRARY && KEY && CDN);

function videoUrl(guid) {
  return `${API}/library/${encodeURIComponent(LIBRARY)}/videos${guid ? `/${encodeURIComponent(guid)}` : ''}`;
}

async function call(method, guid, body) {
  const res = await fetch(videoUrl(guid), {
    method,
    headers: { AccessKey: KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Bunny ${method} ${res.status}: ${data.message || data.Message || 'greška'}`);
  return data;
}

// Šalje fajl s diska na Bunny i vraća guid snimka.
export async function uploadToBunny(filePath, title) {
  const created = await call('POST', null, { title: String(title).slice(0, 100) });
  const guid = created.guid;
  if (!guid) throw new Error('Bunny nije vratio guid snimka');
  const { size } = await stat(filePath);
  const target = new URL(videoUrl(guid));
  const lib = target.protocol === 'http:' ? http : https;
  await new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: 'PUT',
      headers: { AccessKey: KEY, 'Content-Type': 'application/octet-stream', 'Content-Length': size },
      timeout: 10 * 60 * 1000,
    }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error(`Bunny PUT ${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error('Bunny PUT: isteklo vrijeme')));
    req.on('error', reject);
    createReadStream(filePath).on('error', reject).pipe(req);
  });
  return guid;
}

// Stanje obrade: ready (s rezolucijom MP4 snimka), processing ili error.
// Bunny status: 0 napravljen, 1 poslan, 2 obrada, 3 kodiranje, 4 gotov, 5 greška, 6 slanje nije uspjelo.
export async function bunnyState(guid) {
  const v = await call('GET', guid);
  if (v.status === 5 || v.status === 6) return { state: 'error' };
  if (v.status !== 4) return { state: 'processing' };
  // MP4 fallback postoji samo za 240p, 360p, 720p i 1080p. Bira se najveća koju snimak ima.
  const have = String(v.availableResolutions || '').split(',').map((r) => parseInt(r, 10));
  const res = [1080, 720, 360, 240].find((n) => have.includes(n));
  return { state: 'ready', res: `${res || 360}p` };
}

export async function deleteFromBunny(guid) {
  await call('DELETE', guid);
}

// Adrese za pregled: Bunny MP4 i sličica kad je snimak obrađen, inače fajl s našeg servera.
export function mediaUrls(r) {
  if (r.video_provider === 'bunny' && r.video_status === 'ready' && r.bunny_guid && CDN) {
    return {
      videoUrl: `https://${CDN}/${r.bunny_guid}/play_${r.video_res || '360p'}.mp4`,
      posterUrl: `https://${CDN}/${r.bunny_guid}/thumbnail.jpg`,
    };
  }
  return { videoUrl: r.video_path ? `/media/${r.video_path}` : '', posterUrl: '' };
}
