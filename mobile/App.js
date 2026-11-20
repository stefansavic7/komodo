import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Image, KeyboardAvoidingView, Linking, Platform, Pressable, Share, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import {
  pathOf, pathWithQuery, isOwnUrl as isOwnUrlIn, isStandalonePage, toAppUrl as toAppUrlIn,
  routeNotification, routeToUrl, shouldShowBanner,
} from './navigacija';

// Sistemski splash ostaje dok se prva stranica ne učita (ili dok ne javimo grešku).
SplashScreen.preventAutoHideAsync().catch(() => {});

// Adresa web aplikacije. U razvoju dolazi iz mobile/.env, a za objavu iz eas.json.
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || 'https://komodo.ba').replace(/\/$/, '');
const PACKAGE = 'ba.komodo.app';
const INK = '#16121a';
const CORAL = '#ff6a4d';
const LOGO = require('./assets/splash.png');

// Najduže koliko čekamo prvu stranicu pod splashom; poslije toga se vidi indikator učitavanja.
const SPLASH_MAX_MS = 8000;

const VERSION = Application.nativeApplicationVersion || Constants.expoConfig?.version || '0.0.0';
const BUILD = Application.nativeBuildVersion || '0';

// Šta omotač kaže web aplikaciji prije nego što se stranica učita (ugovor u docs/PRODAVNICE.md, odjeljak 9).
const APP_INFO = { platform: Platform.OS, version: VERSION, build: String(BUILD) };
const BEFORE_LOAD = `window.KOMODO_APP = ${JSON.stringify(APP_INFO)}; true;`;

/* ---------- adrese ---------- */

const isOwnUrl = (url) => isOwnUrlIn(url, APP_URL);
const toAppUrl = (link) => toAppUrlIn(link, APP_URL);

// Android stranice ponekad daju intent://…; otvaramo rezervnu adresu ako je ima.
function intentFallback(url) {
  const m = /;S\.browser_fallback_url=([^;]+);/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

function openOutside(url) {
  let target = url;
  if (/^intent:/i.test(target)) target = intentFallback(target);
  if (!target) return;
  Linking.openURL(target).catch(() => {
    const what = /^viber:/i.test(target) ? 'Viber nije instaliran na ovom telefonu.' : 'Na telefonu nema aplikacije koja otvara ovaj link.';
    Alert.alert('Link se ne može otvoriti', what);
  });
}

function storeUrl(fromWeb) {
  // Web može poslati tačnu adresu (npr. App Store link s ID-jem); prihvatamo samo adrese prodavnica.
  if (/^https:\/\/(apps\.apple\.com|play\.google\.com)\//i.test(String(fromWeb || ''))) return fromWeb;
  if (Platform.OS === 'android') return `market://details?id=${PACKAGE}`;
  return `https://apps.apple.com/ba/search?term=Komodo`;
}

/* ---------- obavještenja ---------- */

const activeChat = { id: null }; // razgovor otvoren na ekranu (javlja web, poruka 'chat')
let appActive = AppState.currentState === 'active';

// Obavještenje koje stigne dok je aplikacija otvorena prikaže se kao baner,
// osim kad je korisnik upravo u tom razgovoru.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const show = shouldShowBanner(n?.request?.content?.data, activeChat.id, appActive);
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});

// Kanali moraju postojati prije prvog obavještenja; server šalje channelId 'poruke' (poruke)
// i 'snizenja' (PUSH_SNIZENJA_KANAL, sniženja cijena).
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('poruke', {
    name: 'Poruke',
    description: 'Nove poruke od butika i kupaca.',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: CORAL,
  }).catch(() => {});
  Notifications.setNotificationChannelAsync('snizenja', {
    name: 'Sniženja',
    description: 'Obavještenja kad se snizi cijena oglasa koji ti se sviđa.',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: CORAL,
  }).catch(() => {});
}

// Vraća Expo push token, ili null. Dozvolu traži samo kad je ask = true.
async function getPushToken(ask) {
  if (!Device.isDevice) return null;
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return res.data;
  } catch (err) {
    // Bez EAS projekta (eas init) ili bez Firebase podešavanja na Androidu nema tokena.
    console.warn('Push token nije dostupan:', err?.message || err);
    return null;
  }
}

// Šta dodir na obavještenje otvara: { kind: 'listing'|'chat', id } ili null.
function routeOf(response) {
  return routeNotification(response?.notification?.request?.content?.data);
}

/* ---------- početna adresa ---------- */

// Hladan start: dodir na obavještenje ima prednost, pa link kojim je aplikacija otvorena.
async function initialUrl(handled) {
  try {
    const last = Notifications.getLastNotificationResponse?.();
    const target = routeToUrl(routeOf(last), APP_URL);
    if (target) {
      handled.add(last.notification.request.identifier);
      Notifications.clearLastNotificationResponse?.();
      return target;
    }
  } catch { /* nastavljamo bez obavještenja */ }
  try {
    const link = await Promise.race([Linking.getInitialURL(), new Promise((r) => { setTimeout(() => r(null), 1500); })]);
    const url = toAppUrl(link);
    if (url) return url;
  } catch { /* nastavljamo na početnu */ }
  return `${APP_URL}/`;
}

/* ---------- aplikacija ---------- */

export default function App() {
  const web = useRef(null);
  const pushToken = useRef(null);
  const pushAsked = useRef(false);
  const handled = useRef(new Set());
  const loaded = useRef(false);       // prva stranica je učitana bar jednom
  const failedNow = useRef(false);    // tekuće učitavanje je palo
  const canGoBack = useRef(false);
  const [uri, setUri] = useState(null);
  const [mount, setMount] = useState(0);        // novi broj = WebView se pravi iznova (Pokušaj ponovo)
  const [screen, setScreen] = useState('loading'); // loading | ok | offline | down
  const [splashGone, setSplashGone] = useState(false);

  const hideSplash = useCallback(() => {
    setSplashGone(true);
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => { initialUrl(handled.current).then(setUri); }, []);

  // Splash se ne drži unedogled: poslije SPLASH_MAX_MS vidi se naš indikator učitavanja.
  useEffect(() => {
    const t = setTimeout(hideSplash, SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [hideSplash]);

  const sendToWeb = useCallback((code) => {
    web.current?.injectJavaScript(`try { ${code} } catch (e) {} true;`);
  }, []);

  const markLoaded = useCallback(() => {
    if (failedNow.current) return;
    loaded.current = true;
    setScreen('ok');
    hideSplash();
  }, [hideSplash]);

  const fail = useCallback((kind) => {
    failedNow.current = true;
    setScreen(kind);
    hideSplash();
  }, [hideSplash]);

  const retry = useCallback(() => {
    failedNow.current = false;
    setScreen('loading');
    setMount((n) => n + 1);
  }, []);

  // Otvaranje adrese naše aplikacije dok WebView već radi (link ili obavještenje iz pozadine).
  const navigate = useCallback((url) => {
    if (!url) return;
    if (!loaded.current || failedNow.current) { setUri(url); retry(); return; }
    const path = pathWithQuery(url);
    sendToWeb(`if (window.__komodoOpenUrl) { window.__komodoOpenUrl(${JSON.stringify(path)}); } else { location.href = ${JSON.stringify(url)}; }`);
  }, [retry, sendToWeb]);

  const deliverToken = useCallback(() => {
    if (pushToken.current) sendToWeb(`window.__komodoPush && window.__komodoPush(${JSON.stringify(pushToken.current)});`);
  }, [sendToWeb]);

  const ensurePush = useCallback((ask) => {
    if (ask) {
      if (pushAsked.current) { deliverToken(); return; }
      pushAsked.current = true;
    }
    getPushToken(ask).then((token) => {
      if (token) pushToken.current = token;
      deliverToken();
    });
  }, [deliverToken]);

  // Ako je dozvola već data, token uzimamo odmah, bez pitanja.
  useEffect(() => { ensurePush(false); }, [ensurePush]);

  // Sistem može promijeniti token uređaja; tada tražimo novi Expo token i javljamo ga webu.
  useEffect(() => {
    const sub = Notifications.addPushTokenListener(() => { ensurePush(false); });
    return () => sub.remove();
  }, [ensurePush]);

  // Dodir na obavještenje dok aplikacija radi ili je u pozadini (hladan start rješava initialUrl).
  const openRoute = useCallback((route) => {
    if (!route) return;
    if (route.kind === 'chat') { navigate(routeToUrl(route, APP_URL)); return; }
    const url = routeToUrl(route, APP_URL);
    if (!loaded.current || failedNow.current) { navigate(url); return; }
    sendToWeb(`if (window.__komodoOpenListing) { window.__komodoOpenListing(${JSON.stringify(route.id)}); } else { location.href = ${JSON.stringify(url)}; }`);
  }, [navigate, sendToWeb]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const key = response?.notification?.request?.identifier;
      if (key && handled.current.has(key)) return;
      if (key) handled.current.add(key);
      openRoute(routeOf(response));
    });
    return () => sub.remove();
  }, [openRoute]);

  // Linkovi komodo://… i https://komodo.ba/… dok aplikacija radi.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => navigate(toAppUrl(url)));
    return () => sub.remove();
  }, [navigate]);

  // Povratak u aplikaciju poslije greške: jedan novi pokušaj (bez tajmera dok je u pozadini).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActive = state === 'active';
      if (appActive && failedNow.current) retry();
    });
    return () => sub.remove();
  }, [retry]);

  // Android dugme Nazad: web zatvara prozor ili se vraća na prethodni ekran; s početnog ekrana
  // javlja 'exit'. Stranica bez __komodoBack ide nazad u istoriji WebViewa, ili se aplikacija zatvara.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen !== 'ok') { BackHandler.exitApp(); return true; }
      sendToWeb("if (window.__komodoBack) { window.__komodoBack(); } else { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nazad' })); }");
      return true;
    });
    return () => sub.remove();
  }, [screen, sendToWeb]);

  const onMessage = useCallback((event) => {
    let msg;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ready':
        markLoaded();
        // Dozvolu za obavještenja tražimo kad je korisnik prijavljen. Stari web ne šalje loggedIn → pitamo odmah.
        ensurePush(msg.loggedIn !== false);
        break;
      case 'push':
        ensurePush(true);
        break;
      case 'exit':
        BackHandler.exitApp();
        break;
      case 'nazad':
        if (canGoBack.current) web.current?.goBack(); else BackHandler.exitApp();
        break;
      case 'chat':
        activeChat.id = /^\d+$/.test(String(msg.id ?? '')) ? String(msg.id) : null;
        break;
      case 'update':
        openOutside(storeUrl(msg.url));
        break;
      case 'share':
        Share.share(Platform.OS === 'ios'
          ? { message: String(msg.text || ''), url: String(msg.url || '') }
          : { message: `${msg.text || ''}\n${msg.url || ''}` }).catch(() => {});
        break;
      default:
    }
  }, [ensurePush, markLoaded]);

  // Unutra ostaje samo naša domena; sve ostalo (Instagram, Facebook, TikTok, sajt, tel:, viber:,
  // mailto:, mape) otvara se u svojoj aplikaciji ili pregledniku.
  const onShouldStart = useCallback((req) => {
    const url = String(req.url || '');
    if (/^(about:|blob:|data:)/i.test(url)) return true;
    if (isOwnUrl(url)) {
      if (req.isTopFrame !== false && loaded.current && isStandalonePage(url)) { openOutside(url); return false; }
      return true;
    }
    // Ugrađeni okviri (iframe) tuđih stranica smiju se učitati; ne otvaramo ih van aplikacije.
    if (req.isTopFrame === false && /^https?:/i.test(url)) return true;
    openOutside(url);
    return false;
  }, []);

  // target="_blank" i window.open
  const onOpenWindow = useCallback((event) => {
    const url = event.nativeEvent.targetUrl;
    if (!url) return;
    if (isOwnUrl(url) && !isStandalonePage(url)) navigate(url); else openOutside(url);
  }, [navigate]);

  const onError = useCallback((event) => {
    const e = event.nativeEvent || {};
    const code = Number(e.code);
    const desc = String(e.description || '');
    // iOS: prekinuto učitavanje (naše onShouldStart, brzo preusmjerenje, video) nije greška.
    if (Platform.OS === 'ios' && (code === -999 || code === 102 || code === 204)) return;
    if (e.url && !isOwnUrl(e.url) && loaded.current) return;
    const offline = Platform.OS === 'ios'
      ? (code === -1009 || code === -1020 || code === -1018)
      : /INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/i.test(desc) || code === -2;
    fail(offline ? 'offline' : 'down');
  }, [fail]);

  // 5xx na glavnoj stranici (npr. 502 dok se server mijenja ili 503 pod opterećenjem).
  const onHttpError = useCallback((event) => {
    const e = event.nativeEvent || {};
    if (Number(e.statusCode) >= 500 && isOwnUrl(e.url) && !/\/api\//.test(pathOf(e.url))) fail('down');
  }, [fail]);

  const onLoadStart = useCallback(() => { failedNow.current = false; }, []);

  // Android prvo javi završetak pa grešku istog učitavanja; zato kratko sačekamo prije „uspjelo”.
  const onLoad = useCallback(() => { setTimeout(markLoaded, 300); }, [markLoaded]);

  // Proces WebViewa je ugašen (premalo memorije, dugo u pozadini): pravimo ga iznova umjesto bijelog ekrana.
  const onProcessGone = useCallback(() => { retry(); }, [retry]);

  const errorView = screen === 'offline' || screen === 'down';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        {/* Android je edge-to-edge: prozor se više ne skuplja za tastaturu, pa polje za poruku
            podižemo sami. iOS WebView to radi sam. */}
        <KeyboardAvoidingView style={styles.web} behavior="padding" enabled={Platform.OS === 'android'}>
        {uri ? (
          <WebView
            key={mount}
            ref={web}
            source={{ uri }}
            style={styles.web}
            containerStyle={styles.web}
            originWhitelist={['*']}
            applicationNameForUserAgent={`Komodo/${VERSION} (${Platform.OS})`}
            injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStart}
            onOpenWindow={onOpenWindow}
            onLoadStart={onLoadStart}
            onLoad={onLoad}
            onError={onError}
            onHttpError={onHttpError}
            renderError={() => <View style={styles.blank} />}
            onNavigationStateChange={(s) => { canGoBack.current = !!s.canGoBack; }}
            onRenderProcessGone={onProcessGone}
            onContentProcessDidTerminate={onProcessGone}
            // video: feed se pušta sam (web ga pokreće bez zvuka), preko cijelog ekrana na zahtjev
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            allowsPictureInPictureMediaPlayback={false}
            // kamera i galerija idu kroz <input type="file">; getUserMedia samo za našu domenu
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            // izgled nativne aplikacije: bez pregleda linka, odskakanja i zumiranja teksta
            allowsBackForwardNavigationGestures={false}
            allowsLinkPreview={false}
            bounces={false}
            overScrollMode="never"
            textZoom={100}
            setBuiltInZoomControls={false}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            dataDetectorTypes="none"
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            domStorageEnabled
            javaScriptEnabled
            setSupportMultipleWindows
            webviewDebuggingEnabled={__DEV__}
          />
        ) : null}
        </KeyboardAvoidingView>

        {!errorView && screen === 'loading' && splashGone ? (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            <ActivityIndicator color={CORAL} size="large" />
          </View>
        ) : null}

        {errorView ? (
          <View style={[StyleSheet.absoluteFill, styles.error]}>
            <Image source={LOGO} style={styles.logoSmall} resizeMode="contain" />
            <Text style={styles.errorTitle} accessibilityRole="header">
              {screen === 'offline' ? 'Nema interneta' : 'Komodo trenutno nije dostupan'}
            </Text>
            <Text style={styles.errorText}>
              {screen === 'offline'
                ? 'Provjeri Wi-Fi ili mobilne podatke i pokušaj ponovo.'
                : 'Radimo na tome. Pokušaj ponovo za koji minut.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              accessibilityRole="button"
              onPress={retry}
            >
              <Text style={styles.buttonText}>Pokušaj ponovo</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  web: { flex: 1, backgroundColor: INK },
  blank: { flex: 1, backgroundColor: INK },
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: INK, gap: 24 },
  logo: { width: 200, height: 200 },
  logoSmall: { width: 96, height: 96, marginBottom: 8 },
  error: { justifyContent: 'center', paddingHorizontal: 28, gap: 12, backgroundColor: INK },
  errorTitle: { color: '#f7f1ea', fontSize: 26, fontWeight: '700' },
  errorText: { color: '#b9adbd', fontSize: 16, lineHeight: 22 },
  button: { alignSelf: 'flex-start', backgroundColor: CORAL, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 999, marginTop: 8 },
  pressed: { opacity: 0.8 },
  buttonText: { color: INK, fontSize: 16, fontWeight: '700' },
});
