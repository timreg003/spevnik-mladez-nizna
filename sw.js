// Service Worker – robust offline (app shell + cache-first) + non-blocking external assets
const CACHE_NAME = "spevnik-v119";

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './keepawake.mp4',
  './fonts/icons.css',
  './fonts/fa-solid-subset.woff'
];

const OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
];
// Písmo Inter z Google Fonts sa môže uložiť do cache (aby bolo aj offline)
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache core assets one-by-one (so one missing file never breaks install)
    // cache:'reload' = obíď HTTP cache prehliadača, nech sa do novej verzie nedostanú staré súbory
    await Promise.allSettled(CORE_ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    // Optional assets – don't fail install if they are slow/offline
    await Promise.allSettled(OPTIONAL_ASSETS.map(u => cache.add(u)));
  })());
  // ŽIADNE automatické skipWaiting – nová verzia počká a aktivuje sa
  // pri ďalšom otvorení aplikácie (alebo keď používateľ ťukne „Aktualizovať“).
});

// Stránka pošle {type:'SKIP_WAITING'}, keď chce novú verziu aktivovať hneď.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  // Rýchle hlášky (ntfy.sh) – živé spojenie, nikdy necachovať ani neprechádzať cez SW
  try { if (new URL(req.url).hostname === 'ntfy.sh') return; } catch (e) {}


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
        const okOrigin = (url.origin === self.location.origin) || CACHEABLE_HOSTS.includes(url.hostname);
        if (req.method === 'GET' && okOrigin && resp && resp.ok && resp.status !== 206 && !req.headers.has('range')) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => { try { cache.put(req, copy); } catch(e) {} });
        }
      } catch(e) {}
      return resp;
    }).catch(() => cached))
  );
});
