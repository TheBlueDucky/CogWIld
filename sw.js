// Cogwild service worker: lets the website be installed as an app (phones, Chromebooks, iPhone "Add to Home Screen")
// and start without internet. Network first, so a new version reaches players on their next load;
// the cache is only used when the network fails. Online play, downloads and /health are never cached.
const CACHE = 'cogwild-v1';
const CORE = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest', '/fonts/lilita-one-latin.woff2', '/fonts/nunito-latin.woff2', '/js/vendor/three.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || /^\/(ws|downloads\/|health)/.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html')))
  );
});
