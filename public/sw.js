/* WeighGuard service worker — Cache-First for 100% offline airplane mode.
 * Caches the app shell, CSS, fonts, and bundled static JSON (public key + revocation list).
 */

const CACHE_NAME = 'weighguard-shell-v4';

const APP_SHELL = [
  '/',
  '/verify/',
  '/dashboard/',
  '/inspect/',
  '/demo-qr-sheet/',
  '/manifest.json',
  '/favicon.svg',
  '/favicon.ico',
  '/data/public-key.json',
  '/data/revocation-list.json',
  '/data/seed-instruments.json',
  '/data/seed-certificates.json',
  '/data/seed-mandis.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass service worker completely in dev environments and LAN IPs
  if (
    url.port === '4322' ||
    url.port === '3000' ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url.hostname) ||
    /^10\./.test(url.hostname) ||
    url.pathname.includes('@vite') ||
    url.pathname.includes('@fs') ||
    url.search.includes('token=') ||
    request.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache valid same-origin GET responses + font CSS for offline use.
          const shouldCache =
            response.ok &&
            (new URL(request.url).origin === self.location.origin ||
              request.url.includes('fonts.googleapis.com') ||
              request.url.includes('fonts.gstatic.com'));

          if (shouldCache) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }

          return response;
        })
        .catch(() => {
          // Offline fallback: serve cached app shell for navigations.
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return Response.error();
        });
    }),
  );
});
