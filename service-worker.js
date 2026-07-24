// LocalTube service worker — caches only the app shell (HTML/CSS/JS/icons).
// Videos always come straight from the device's file system / picker and
// are never touched by this cache.
//
// IMPORTANT: bump CACHE_NAME any time the app shell changes. The version
// string is what makes the browser notice this file is "different" and
// install a fresh service worker — without that, fetch handlers below would
// keep serving whatever got cached on the very first visit, forever.
const CACHE_NAME = 'localtube-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/scanner.js',
  './js/player.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App-shell files (markup/scripts/styles) use network-first: always try to
// fetch the latest version, and only fall back to the cached copy if the
// network is unavailable (offline). Icons/manifest rarely change, so those
// stay cache-first for speed.
const CACHE_FIRST_RE = /\/icons\//;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith('blob:')) return; // never touch local video streams

  if (CACHE_FIRST_RE.test(req.url)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.status === 200) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, clone)); }
        return res;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
