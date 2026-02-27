/**
 * ScoTech AI — Service Worker
 * Strategy: Cache-first for assets, Network-first for API calls
 */

const CACHE_NAME    = 'scotech-v1.2-lavender';
const OFFLINE_URL   = '/';

const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;500;600;700;800;900&family=Lora:ital,wght@0,400;0,500;1,400&display=swap',
];

// ── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Always go network for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'You are offline. Please check your connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Only cache successful GET requests
        if (request.method !== 'GET' || !response.ok) return response;

        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => {
        // Offline fallback — serve the app shell
        if (request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// ── BACKGROUND SYNC (future: queue failed messages) ───────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    // Placeholder for future offline message queueing
    console.log('[SW] Background sync triggered');
  }
});

// ── PUSH NOTIFICATIONS (future) ───────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'ScoTech AI', {
    body: data.body || 'You have a new message',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
  });
});
