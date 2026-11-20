// Čista logika rutiranja linkova i obavještenja (bez React Native zavisnosti, da se može testirati s `node --test`).
// CommonJS namjerno: Metro i Node isto čitaju bez podešavanja.

function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

function pathOf(url) {
  const m = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(String(url || ''));
  return (m && m[1]) || '/';
}

// Putanja s upitom i hashom, npr. '/?o=123'; za web funkciju window.__komodoOpenUrl(path).
function pathWithQuery(url) {
  const m = /^https?:\/\/[^/?#]+(.*)$/i.exec(String(url || ''));
  return (m && m[1] ? m[1] : '/').replace(/^(?=[?#])/, '/');
}

// Naša domena (i www. varijanta), tačno po imenu hosta, ne po početku teksta.
function isOwnUrl(url, appUrl) {
  if (!/^https?:\/\//i.test(String(url))) return false;
  const appHost = hostOf(appUrl);
  const host = hostOf(url);
  return host === appHost || host === `www.${appHost}`;
}

// Zasebne stranice (uslovi, privatnost, brisanje naloga) otvaramo u pregledniku.
function isStandalonePage(url) {
  const path = pathOf(url).toLowerCase();
  return path.endsWith('.html') && path !== '/index.html';
}

// komodo://… i https://komodo.ba/… pretvara u adresu web aplikacije, ili null ako nije naša.
// Kratki oblici: komodo://o/123 (oglas), komodo://b/ime-butika, komodo://poruke/45.
function toAppUrl(link, appUrl) {
  const base = String(appUrl).replace(/\/$/, '');
  const url = String(link || '');
  if (isOwnUrl(url, base)) return url;
  const m = /^komodo:\/\/\/?([^?#]*)(\?[^#]*)?/i.exec(url);
  if (!m) return null;
  const path = m[1].replace(/\/+$/, '');
  const query = m[2] || '';
  const short = /^(o|b|poruke)\/([A-Za-z0-9_-]+)$/.exec(path);
  if (short) return `${base}/?${short[1]}=${encodeURIComponent(short[2])}`;
  if (!/^[A-Za-z0-9/_.-]*$/.test(path)) return `${base}/`;
  return `${base}/${path}${query}`;
}

const isId = (v) => /^\d+$/.test(String(v ?? ''));

// Šta obavještenje otvara, po njegovim podacima (`data`):
// { kind: 'listing', id } za sniženje, { kind: 'chat', id } za poruku, ili null.
function routeNotification(data) {
  if (!data || typeof data !== 'object') return null;
  if (isId(data.listingId)) return { kind: 'listing', id: String(data.listingId) };
  if (isId(data.conversationId)) return { kind: 'chat', id: String(data.conversationId) };
  return null;
}

// Adresa web aplikacije za hladan start (WebView se tek pravi).
function routeToUrl(route, appUrl) {
  if (!route) return null;
  const base = String(appUrl).replace(/\/$/, '');
  return route.kind === 'listing' ? `${base}/?o=${route.id}` : `${base}/?poruke=${route.id}`;
}

// Baner u prvom planu: poruka iz razgovora koji je upravo otvoren se ne prikazuje; sve ostalo (i sniženje) da.
function shouldShowBanner(data, activeChatId, appActive) {
  const route = routeNotification(data);
  if (!route || route.kind !== 'chat') return true;
  return !(appActive && activeChatId != null && route.id === String(activeChatId));
}

module.exports = { hostOf, pathOf, pathWithQuery, isOwnUrl, isStandalonePage, toAppUrl, routeNotification, routeToUrl, shouldShowBanner };
