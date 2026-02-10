// Service Worker – robust offline (app shell + cache-first) + non-blocking external assets
const CACHE_NAME = "spevnik-v96";

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './keepawake.mp4'
];

const OPTIONAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache core assets one-by-one (so one missing file never breaks install)
    await Promise.allSettled(CORE_ASSETS.map(u => cache.add(u)));
    // Optional assets – don't fail install if they are slow/offline
    await Promise.allSettled(OPTIONAL_ASSETS.map(u => cache.add(u)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first for static assets.
// For navigation, always fall back to cached index.html, so app opens even long time offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;


// Do not cache range/partial responses (e.g. media streaming). Cache API rejects 206.
try {
  if (req.headers && req.headers.has('range')) {
    event.respondWith(fetch(req));
    return;
  }
} catch (e) {}

  // App-shell navigations: always fall back to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      const indexCached = await cache.match('index.html', { ignoreSearch: true });
      if (indexCached) return indexCached;

      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.status !== 206 && !req.headers.has('range')) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => cached || fetch(req).then(resp => {
      try {
        const url = new URL(req.url);
        if (req.method === 'GET' && url.origin === self.location.origin && resp && resp.ok && resp.status !== 206 && !req.headers.has('range')) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => { try { cache.put(req, copy); } catch(e) {} });
        }
      } catch(e) {}
      return resp;
    }).catch(() => cached))
  );
});
