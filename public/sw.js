// دلني Service Worker
const CACHE = 'dellini-v2';
const STATIC = [
  '/',
  '/css/style.css',
  '/images/logo.png',
  '/images/pwa-192.png',
  '/images/pwa-512.png',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Skip non-GET and Socket.IO
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('socket.io')) return;
  
  // For HTML pages — ALWAYS network first (no cached redirects)
  if (e.request.headers.get('Accept') && e.request.headers.get('Accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request).catch(() => {
        // Only fall back to cache for exact '/' homepage
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (url.pathname === '/') return caches.match('/');
          return Response.error();
        });
      })
    );
    return;
  }
  
  // Static assets — cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => caches.match(e.request))
  );
});
