// Service Worker – robust offline (app shell + cache-first) + non-blocking external assets
// Goal: ALWAYS show the last successfully loaded online version when offline.
// NOTE: Keep CACHE_NAME aligned with APP_CACHE_NAME in script.js.
const CACHE_NAME = 'spevnik-v31';

// Data cache is used by script.js to store export XML as a fallback when localStorage is cleared.
// IMPORTANT: Do NOT delete it during SW activation.
const DATA_CACHE_NAME = CACHE_NAME + '-data';

const CORE_ASSETS = [
  './',
  './index.html',
  // cache-busted URLs used in index.html (GitHub Pages / iOS can request these exact URLs)
  './index.html?v=31',
  './style.css',
  './style.css?v=29',
  './script.js',
  './script.js?v=31',
  './manifest.json',
  './manifest.json?v=29',
  './icon.png',
  './icon.png?v=29'
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

    // Clean up only our older app-shell caches, but keep:
    // - current shell cache (CACHE_NAME)
    // - current data cache (DATA_CACHE_NAME)
    // - any unrelated caches (belonging to the browser/other scopes)
    await Promise.all(keys.map((k) => {
      const isOurCache = k === CACHE_NAME || k === DATA_CACHE_NAME;
      const isOldShell = k.startsWith('spevnik-') && !isOurCache;
      return isOldShell ? caches.delete(k) : Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

// Cache-first for static assets.
// For navigation, always fall back to cached index.html, so app opens even long time offline.

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // App-shell navigations: cache-first (instant), update in background when online.
  // This is what prevents the "blank page" when opening the app offline later.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true })
        || await cache.match('./index.html', { ignoreSearch: true });

      const fetchAndUpdate = (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            // Keep both the concrete URL and the canonical index.html cached.
            cache.put(req, fresh.clone());
            cache.put('./index.html', fresh.clone());
          }
          return fresh;
        } catch (e) {
          return null;
        }
      })();

      // If we have something cached, return it immediately and refresh in background.
      if (cached) {
        event.waitUntil(fetchAndUpdate);
        return cached;
      }

      // First run (no cache yet): try network.
      const fresh = await fetchAndUpdate;
      if (fresh) return fresh;

      return new Response('Offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })());
    return;
  }

  // Static assets: cache-first, update same-origin GETs in background.
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      // Update in background (best-effort) for same-origin.
      event.waitUntil((async () => {
        try {
          const url = new URL(req.url);
          if (req.method === 'GET' && url.origin === self.location.origin) {
            const fresh = await fetch(req);
            if (fresh && fresh.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(req, fresh.clone());
            }
          }
        } catch (e) {}
      })());
      return cached;
    }

    // Not cached: try network, and cache same-origin GETs.
    try {
      const fresh = await fetch(req);
      try {
        const url = new URL(req.url);
        if (req.method === 'GET' && url.origin === self.location.origin && fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, fresh.clone());
        }
      } catch (e) {}
      return fresh;
    } catch (e) {
      // If even network fails, return whatever we had (likely null).
      return cached || new Response('', { status: 504 });
    }
  })());
});
