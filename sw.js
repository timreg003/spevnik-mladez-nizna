// Service Worker – robust offline (app shell + cache-first) + non-blocking external assets
const CACHE_NAME = 'spevnik-v31';

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon.png',
  './icon-192.png'
];

const OPTIONAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    // optional assets – don't fail install if they are slow/offline
    await Promise.allSettled(OPTIONAL_ASSETS.map(u => cache.add(u)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k !== CACHE_NAME && k !== (CACHE_NAME + '-data'))).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first for static assets.
// For navigation, always fall back to cached index.html, so app opens even long time offline.

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // App-shell navigations: serve cached shell immediately, refresh in background when online.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      // Prefer cached index.html for SPA-like navigations
      const cachedIndex = await cache.match('./index.html', { ignoreSearch: true }) || await cache.match('index.html', { ignoreSearch: true });
      if (cachedIndex) {
        // Update in background (best effort)
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req);
            if (fresh && fresh.ok) await cache.put('./index.html', fresh.clone());
          } catch(e) {}
        })());
        return cachedIndex;
      }

      // First-time load (or cache cleared): try network, then cache it
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) await cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Same-origin GET requests: stale-while-revalidate (return cache immediately, refresh in background)
  const url = new URL(req.url);
  if (req.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req);
            if (fresh && fresh.ok) await cache.put(req, fresh.clone());
          } catch(e) {}
        })());
        return cached;
      }
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) await cache.put(req, fresh.clone());
        return fresh;
      } catch(e) {
        return cached || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Cross-origin (fonts/css): cache-first, but don't block if offline
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => cached || fetch(req).catch(() => cached))
  );
});
