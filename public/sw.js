// دلني Service Worker
const CACHE = 'dellini-v1';
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
  // Skip non-GET and Socket.IO
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('socket.io')) return;
  
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        if (res.ok && e.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => {
        // If HTML page requested and not in cache, serve index
        if (e.request.headers.get('Accept')?.includes('text/html')) {
          return caches.match('/');
        }
        return cached;
      }))
  );
});
