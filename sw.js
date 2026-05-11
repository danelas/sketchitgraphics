/* ===================================================================
   Sketch It Graphics — Service Worker
   Strategy:
     - Pre-cache app shell on install
     - Static assets (css/js/svg/img/font): cache-first, fall back to net
     - HTML: network-first with cache fallback (so updates show fast)
     - Google Fonts: stale-while-revalidate
     - All non-GET requests bypass cache
   =================================================================== */

const VERSION = 'sketchit-v1.0.0';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const FONT_CACHE = `${VERSION}-fonts`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/favicon.svg',
  '/site.webmanifest',
  '/og-image.svg',
];

/* ---------- Install: pre-cache shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activate: cleanup old caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- Fetch routing ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Bypass non-GET and Range requests (video, partials)
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);

  // Same-origin assets: pick strategy by destination
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate' || request.destination === 'document') {
      event.respondWith(networkFirst(request));
      return;
    }
    if (['style','script','image','font'].includes(request.destination) || /\.(css|js|svg|png|jpg|jpeg|webp|woff2?|ttf)$/.test(url.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }
    // default: network-first
    event.respondWith(networkFirst(request));
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // 3rd-party: just pass through
});

/* ---------- Strategies ---------- */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request) || await caches.match('/index.html');
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/* ---------- Messages (allow page to nudge updates) ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
