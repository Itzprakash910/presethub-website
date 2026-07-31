// frontend/sw.js
const STATIC_CACHE_NAME = 'presethub-static-v2';
const API_CACHE_NAME = 'presethub-api-v2';

const urlsToCache = [
  '/',
  '/index.html',
  '/admin.html',
  '/terms.html',
  '/privacy.html',
  '/about.html',
  '/blog.html',
  '/creator-program.html',
  '/faq.html',
  '/contact.html',
  '/download-guide.html',
  '/lightroom-guide.html',
  '/terms.css',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/browserconfig.xml',

  // Icons
  '/android-icon-36x36.png',
  '/android-icon-48x48.png',
  '/android-icon-72x72.png',
  '/android-icon-96x96.png',
  '/android-icon-144x144.png',
  '/android-icon-192x192.png',
  '/apple-icon-57x57.png',
  '/apple-icon-60x60.png',
  '/apple-icon-72x72.png',
  '/apple-icon-76x76.png',
  '/apple-icon-114x114.png',
  '/apple-icon-120x120.png',
  '/apple-icon-144x144.png',
  '/apple-icon-152x152.png',
  '/apple-icon-180x180.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/favicon-96x96.png',
  '/ms-icon-144x144.png',

  // Optional old assets
  '/assets/icons/icon-72.png',
  '/assets/icons/icon-96.png',
  '/assets/icons/icon-128.png',
  '/assets/icons/icon-144.png',
  '/assets/icons/icon-152.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-256.png',
  '/assets/icons/icon-384.png',
  '/assets/icons/icon-512.png'
];

// ==================== INSTALL ====================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
      .catch(err => console.error('SW install error:', err))
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE_NAME && key !== API_CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ==================== FETCH ====================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ---------- 1. API CALLS (Stale-While-Revalidate) ----------
  if (url.pathname.startsWith('/api/')) {
    if (event.request.method !== 'GET') {
      event.respondWith(fetch(event.request));
      return;
    }

    event.respondWith(
      caches.open(API_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => null);

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // ---------- 2. STATIC ASSETS (Cache First) ----------
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(response => {
        if (response) return response;

        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => caches.match('/'));
      })
    );
    return;
  }

  // ---------- 3. DEFAULT ----------
  event.respondWith(fetch(event.request));
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', event => {
  if (event.tag === 'presethub-sync') {
    event.waitUntil(processSyncQueue());
  }
});

async function processSyncQueue() {
  try {
    const db = await openDB('PresetHubOffline', 1);
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const items = await getAllItems(store);

    if (items.length === 0) {
      console.log('📭 No queued items to sync.');
      return;
    }

    console.log(`🔄 Processing ${items.length} queued items...`);

    for (const item of items) {
      try {
        const fetchOptions = {
          method: item.method,
          headers: item.headers || {}
        };
        if (item.body) {
          fetchOptions.body = item.body;
        }

        const response = await fetch(item.url, fetchOptions);

        if (response.ok) {
          await store.delete(item.id);
          console.log(`✅ Synced: \( {item.action} ( \){item.url})`);
          const clients = await self.clients.matchAll();
          clients.forEach(client => {
            client.postMessage({
              type: 'SYNC_SUCCESS',
              action: item.action,
              data: item.data
            });
          });
        } else if (response.status === 404 || response.status === 403) {
          await store.delete(item.id);
          console.warn(`⚠️ Removed invalid queue item (${response.status}): ${item.url}`);
        } else {
          console.warn(`⚠️ Sync failed (${response.status}) for ${item.url}, will retry later`);
        }
      } catch (err) {
        console.error(`❌ Sync error for ${item.url}`, err);
      }
    }

    console.log('✅ Sync processing complete.');
  } catch (err) {
    console.error('❌ Sync processing error:', err);
  }
}

function getAllItems(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

console.log('🔧 Service Worker loaded with offline support (v2)');