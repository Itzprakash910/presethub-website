const STATIC_CACHE = 'presethub-static-v4';
const PUBLIC_CACHE = 'presethub-public-v4';
const STATIC_ASSETS = [
  '/', '/index.html', '/style.css', '/app.js', '/manifest.json',
  '/assets/icons/icon-192.png', '/assets/icons/icon-512.png',
  '/assets/icons/favicon-32x32.png', '/assets/images/presethub-logo-1.jpg',
  '/assets/images/og-image.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(async cache => {
    await Promise.all(STATIC_ASSETS.map(async url => { try { await cache.add(url); } catch (_) {} }));
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![STATIC_CACHE,PUBLIC_CACHE].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function isPublicGet(url) {
  if (url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/payments')) return false;
  if (url.pathname === '/api/presets' || url.pathname.startsWith('/api/presets/search') || url.pathname.startsWith('/api/presets/')) return true;
  if (url.pathname === '/api/users/top' || /^\/api\/users\/[^/]+$/.test(url.pathname)) return true;
  if (url.pathname.startsWith('/api/reviews/')) return true;
  if (url.pathname.startsWith('/uploads/previews/') || url.pathname.startsWith('/uploads/avatars/')) return true;
  return false;
}

self.addEventListener('fetch', event => {
  const req = event.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (isPublicGet(url)) {
    event.respondWith(caches.open(PUBLIC_CACHE).then(async cache => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => { if (res.ok) cache.put(req,res.clone()); return res; }).catch(() => cached);
      return cached || network;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => { if(res.ok) caches.open(STATIC_CACHE).then(c=>c.put(req,res.clone())); return res; })));
});

self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
