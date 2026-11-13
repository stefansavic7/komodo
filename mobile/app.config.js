// Proširuje app.json. Kad se aplikacija u razvoju veže na laptop preko http:// adrese,
// iOS mora dozvoliti nešifrovanu vezu. Za objavu (https://komodo.ba) to se ne dodaje.
module.exports = ({ config }) => {
  const url = process.env.EXPO_PUBLIC_APP_URL || 'https://komodo.ba';
  if (!url.startsWith('http://')) return config;
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: { ...config.ios.infoPlist, NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
    },
    android: { ...config.android, usesCleartextTraffic: true },
  };
};
