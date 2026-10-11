/* LAST SIGNAL — Service Worker: App-Schale offline, Push fuer die Jaeger. */
const CACHE = 'ls-v1';
const SHELL = [
  '/', '/index.html', '/jaeger.html', '/css/app.css',
  '/js/config.js', '/js/store.js', '/js/common.js', '/js/data.js', '/js/bandits.js', '/js/detectives.js',
  '/vendor/supabase.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/fonts/SuperStamped.ttf', '/fonts/ibm-plex-mono-latin-400-normal.woff2', '/icons/pin.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/* Netz zuerst fuer die eigene App, damit neue Deploys sofort greifen; Cache nur ohne Netz.
   Fremde Anfragen (Supabase, Kartenkacheln) laufen ungefiltert durch. */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'LAST SIGNAL', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'LAST SIGNAL', {
    body: data.body || '',
    icon: '/icons/detective-192.png',
    badge: '/icons/detective-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/jaeger.html' },
    vibrate: [200, 80, 200],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/jaeger.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes(target) && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
