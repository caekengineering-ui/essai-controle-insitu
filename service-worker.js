const CACHE = 'caek-controle-v11';
const SHELL = [
  './', './index.html', './css/styles.css',
  './js/config.js', './js/i18n.js', './js/server.js', './js/db.js', './js/auth.js',
  './assets/fonts/cairo-arabic-400.woff2', './assets/fonts/cairo-arabic-600.woff2', './assets/fonts/cairo-arabic-700.woff2',
  './js/calc.js', './js/calc_compacite.js', './js/sync.js', './js/referentiel.js',
  './js/fiche.js', './js/profil.js', './js/admin.js', './js/share.js',
  './js/detail.js', './js/repertoire.js', './js/campagne.js', './js/campagne_compacite.js', './js/app.js',
  './vendor/xlsx.full.min.js',
  './assets/logo-caek.png', './assets/graphe_essai_plaque.png',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/icons/menu/essai-plaque.png', './assets/icons/menu/compacite.png',
  './assets/icons/menu/profil.png', './assets/icons/menu/mise-a-jour.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(SHELL.map(url => fetch(new Request(url, { cache: 'reload' })).then(r => cache.put(url, r)).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // Ne jamais mettre en cache les appels API Supabase (toujours réseau)
  if (url.includes('supabase.co') || url.includes('/rest/v1/')) return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
