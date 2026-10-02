const STATIC_CACHE = 'presethub-static-v7';
const API_CACHE = 'presethub-api-v2';
const IMAGE_CACHE = 'presethub-images-v2';
const CORE = [
  '/', '/index.html', '/manifest.json', '/style.css', '/app.js',
  '/privacy.html', '/terms.html', '/about.html', '/blog.html',
  '/creator-program.html', '/faq.html', '/contact.html',
  '/download-guide.html', '/lightroom-guide.html', '/download-app.html', '/download-app.js'
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(STATIC_CACHE).then(async c => {
    await Promise.all(CORE.map(url => c.add(url).catch(() => {})));
    return self.skipWaiting();
  })
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(
    keys.filter(k => ![STATIC_CACHE, API_CACHE, IMAGE_CACHE].includes(k)).map(k => caches.delete(k))
  )).then(() => self.clients.claim())
));

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _;
  }
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.pathname.startsWith('/admin')) return;

  // Public API responses are cached after the first successful online load.
  if (u.origin === location.origin && u.pathname.startsWith('/api/') &&
      !u.pathname.startsWith('/api/auth/') && !u.pathname.startsWith('/api/admin/') &&
      !u.pathname.startsWith('/api/payments/') && !u.pathname.startsWith('/api/users/me')) {
    e.respondWith(networkFirst(e.request, API_CACHE).catch(() => caches.match('/')));
    return;
  }

  // Preview/poster assets must remain visible during temporary network loss.
  if (u.pathname.startsWith('/uploads/') || /\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(u.pathname)) {
    e.respondWith(networkFirst(e.request, IMAGE_CACHE).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') caches.open(STATIC_CACHE).then(c => c.put(e.request, r.clone())).catch(() => {});
      return r;
    }).catch(() => caches.match('/')))
  );
});

self.addEventListener('message', e => {
  if (e.data?.type !== 'CACHE_IMAGES') return;
  const urls = Array.isArray(e.data.urls) ? e.data.urls.slice(0, 300) : [];
  e.waitUntil((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    await Promise.all(urls.map(async url => {
      try {
        const req = new Request(url, { mode: 'no-cors' });
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
      } catch (_) {}
    }));
  })());
});
