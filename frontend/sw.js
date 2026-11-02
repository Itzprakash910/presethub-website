const STATIC_CACHE = 'presethub-static-v15';
const API_CACHE = 'presethub-api-v8';
const IMAGE_CACHE = 'presethub-images-v6';
const CORE = [
  '/', '/index.html', '/manifest.json', '/icons.css?v=3.25.1', '/style.css?v=3.25.1', '/app.js?v=3.25.1', '/texts.js?v=3.2.0', '/shayari/',
  '/privacy.html', '/terms.html', '/about.html', '/blog.html',
  '/creator-program.html', '/faq.html', '/contact.html',
  '/download-guide.html', '/lightroom-guide.html', '/download-app.html', '/cookies.html', '/cookie-consent.css?v=3.2.0', '/cookie-consent.js?v=3.2.0', '/download-app.js?v=2.9.6'
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

const PUBLIC_API_PREFIXES = ['/api/presets', '/api/texts', '/api/ads/', '/api/features/daily', '/api/features/leaderboard', '/api/users/top', '/api/collections/public/', '/api/comments/', '/api/reviews/'];
const PUBLIC_PROFILE = /^\/api\/users\/[a-f0-9]{24}(\/presets)?\/?$/i;
const PRIVATE_SUFFIX = /\/(file|download|bulk-download|share-stats)(\/|$)/;
function isPublicApi(p) {
  if (PRIVATE_SUFFIX.test(p)) return false;
  return PUBLIC_API_PREFIXES.some(x => p.startsWith(x)) || PUBLIC_PROFILE.test(p);
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.pathname.startsWith('/admin')) return;

  // Only PUBLIC API responses are cached (allowlist). Private data (creator earnings, payout details, notifications,
  // feed, paid preset files) must never be stored on the device, where another user of the same browser could read it offline.
  if (u.origin === self.location.origin && isPublicApi(u.pathname)) {
    e.respondWith(networkFirst(e.request, API_CACHE).catch(() => new Response(JSON.stringify({ error: 'Offline. Try again when you are connected.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Preview/poster assets must remain visible during temporary network loss.
  if (u.pathname.startsWith('/media/') || u.pathname.startsWith('/uploads/') || /\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(u.pathname)) {
    e.respondWith(networkFirst(e.request, IMAGE_CACHE).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') caches.open(STATIC_CACHE).then(c => c.put(e.request, r.clone())).catch(() => {});
      return r;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('/') : Response.error()))
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


self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text?.() || 'You have a new PresetHub notification.' }; }
  const title = data.title || 'PresetHub';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: data.icon || '/assets/icons/icon-192.png',
    badge: data.badge || '/assets/icons/icon-192.png',
    data: data.data || { url: '/' },
    vibrate: [120, 60, 120],
    tag: data.tag || 'presethub-notification',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of clients) {
      if ('focus' in client) { await client.focus(); if ('navigate' in client) await client.navigate(target); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
