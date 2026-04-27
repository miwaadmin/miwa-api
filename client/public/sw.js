const CACHE = 'miwa-v3';

// Keep the install cache small. Clinical app freshness matters more than
// offline behavior, especially immediately after deploys.
const PRECACHE = [
  '/manifest.json',
  '/favicon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept API calls or the service worker itself.
  if (url.pathname.startsWith('/api') || url.pathname === '/sw.js') return;

  // Navigation requests: network first, fall back only if offline.
  // This prevents stale route shells after Azure deploys.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put('/index.html', clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Built assets are hashed, but cache-first can still leave a tab running an
  // old app bundle after a deployment. Prefer network, cache as fallback.
  e.respondWith(
    fetch(request, { cache: 'no-store' })
      .then(res => {
        if (res.ok && (url.pathname.match(/\.(js|css|png|svg|woff2?)$/))) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
