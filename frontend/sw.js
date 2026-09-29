const VERSION = 'v2';
const STATIC_CACHE = `presethub-static-${VERSION}`;
const PRECACHE = ['/', '/style.css', '/app.js', '/manifest.json', '/assets/icons/icon-192.png', '/assets/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      // allSettled: one missing file must NOT break the whole install (old code used addAll)
      .then(cache => Promise.allSettled(PRECACHE.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch: non-GET, other origins, API calls, downloads/uploads, admin (fresh + private data)
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/admin')) return;

  // Pages: network first, fall back to cached shell when offline
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.open(STATIC_CACHE).then(async cache => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});
