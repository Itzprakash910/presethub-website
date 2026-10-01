const CACHE = 'presethub-static-v6';
const CORE = [
  '/', '/index.html', '/manifest.json', '/style.css', '/app.js',
  '/privacy.html', '/terms.html', '/about.html', '/blog.html',
  '/creator-program.html', '/faq.html', '/contact.html',
  '/download-guide.html', '/lightroom-guide.html', '/download-app.html', '/download-app.js'
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(async c => {
    await Promise.all(CORE.map(url => c.add(url).catch(() => {})));
    return self.skipWaiting();
  })
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/uploads/')) return;
  if (u.pathname.startsWith('/admin')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') {
        const c = r.clone();
        caches.open(CACHE).then(x => x.put(e.request, c));
      }
      return r;
    }).catch(() => caches.match('/')))
  );
});