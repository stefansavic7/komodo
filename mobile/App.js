import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Adresa web aplikacije. U razvoju dolazi iz mobile/.env, a za objavu iz eas.json.
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || 'https://komodo.ba').replace(/\/$/, '');
const APP_ORIGIN = APP_URL.match(/^https?:\/\/[^/]+/i)[0].toLowerCase();
const INK = '#16121a';

// Obavještenje koje stigne dok je aplikacija otvorena prikaže se kao baner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Traži dozvolu i vraća Expo push token, ili null ako obavještenja nisu moguća.
async function getPushToken() {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('poruke', {
      name: 'Poruke',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#ff6a4d',
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return res.data;
  } catch (err) {
    // U Expo Go na Androidu push nije podržan, a bez EAS projekta nema tokena.
    console.warn('Push token nije dostupan:', err?.message || err);
    return null;
  }
}

function isOwnUrl(url) {
  return String(url).toLowerCase().startsWith(APP_ORIGIN);
}

// Kažemo web aplikaciji da radi unutar mobilne aplikacije, prije nego što se učita.
const BEFORE_LOAD = `window.KOMODO_APP = { platform: ${JSON.stringify(Platform.OS)} }; true;`;

export default function App() {
  const web = useRef(null);
  const pushToken = useRef(null);
  const [failed, setFailed] = useState(false);
  const [uri, setUri] = useState(APP_URL + '/');

  const sendToWeb = useCallback((code) => {
    web.current?.injectJavaScript(`try { ${code} } catch (e) {} true;`);
  }, []);

  const deliverToken = useCallback(() => {
    if (pushToken.current) sendToWeb(`window.__komodoPush && window.__komodoPush(${JSON.stringify(pushToken.current)});`);
  }, [sendToWeb]);

  const openConversation = useCallback((conversationId) => {
    if (!/^\d+$/.test(String(conversationId ?? ''))) return;
    sendToWeb(`if (window.__komodoOpenChat) { window.__komodoOpenChat(${JSON.stringify(String(conversationId))}); } else { location.href = ${JSON.stringify(APP_URL + '/?poruke=')} + ${JSON.stringify(String(conversationId))}; }`);
  }, [sendToWeb]);

  // Push token: traži se jednom, a web aplikacija ga prijavi serveru kad je korisnik prijavljen.
  useEffect(() => {
    getPushToken().then((token) => {
      pushToken.current = token;
      deliverToken();
    });
  }, [deliverToken]);

  // Dodir na obavještenje otvara taj razgovor, i kad je aplikacija bila ugašena.
  useEffect(() => {
    const open = (response) => openConversation(response?.notification?.request?.content?.data?.conversationId);
    const last = Notifications.getLastNotificationResponse?.();
    if (last) {
      const id = last.notification?.request?.content?.data?.conversationId;
      if (/^\d+$/.test(String(id ?? ''))) setUri(`${APP_URL}/?poruke=${id}`);
    }
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [openConversation]);

  // Android dugme Nazad: web aplikacija zatvara prozor ili se vraća na prethodni ekran,
  // a s početnog ekrana javlja da se aplikacija može zatvoriti.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sendToWeb("if (window.__komodoBack) { window.__komodoBack(); } else { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'exit' })); }");
      return true;
    });
    return () => sub.remove();
  }, [sendToWeb]);

  const onMessage = useCallback((event) => {
    let msg;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') deliverToken();
    if (msg.type === 'exit') BackHandler.exitApp();
    if (msg.type === 'share') {
      Share.share(Platform.OS === 'ios'
        ? { message: msg.text, url: msg.url }
        : { message: `${msg.text}\n${msg.url}` }).catch(() => {});
    }
  }, [deliverToken]);

  // Linkovi van aplikacije (telefon, Viber, Instagram, Facebook…) otvaraju se u svojoj aplikaciji.
  const onShouldStart = useCallback((req) => {
    if (isOwnUrl(req.url) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const onOpenWindow = useCallback((event) => {
    const url = event.nativeEvent.targetUrl;
    if (url) Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        {failed ? (
          <View style={styles.error}>
            <Text style={styles.errorTitle}>Nema veze sa Komodom</Text>
            <Text style={styles.errorText}>Provjeri internet i pokušaj ponovo.</Text>
            <Pressable
              style={styles.button}
              accessibilityRole="button"
              onPress={() => { setFailed(false); web.current?.reload(); }}
            >
              <Text style={styles.buttonText}>Pokušaj ponovo</Text>
            </Pressable>
          </View>
        ) : null}
        <WebView
          ref={web}
          source={{ uri }}
          style={[styles.web, failed && styles.hidden]}
          containerStyle={styles.web}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStart}
          onOpenWindow={onOpenWindow}
          onError={() => setFailed(true)}
          onLoadEnd={deliverToken}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsBackForwardNavigationGestures={false}
          sharedCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          allowFileAccess
          setSupportMultipleWindows
          overScrollMode="never"
          bounces={false}
          textZoom={100}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  web: { flex: 1, backgroundColor: INK },
  hidden: { opacity: 0, height: 0, flex: 0 },
  error: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  errorTitle: { color: '#f7f1ea', fontSize: 24, fontWeight: '700' },
  errorText: { color: '#b9adbd', fontSize: 16 },
  button: { alignSelf: 'flex-start', backgroundColor: '#ff6a4d', paddingVertical: 13, paddingHorizontal: 20, borderRadius: 999 },
  buttonText: { color: INK, fontSize: 15, fontWeight: '700' },
});
