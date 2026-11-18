// Narrivell service worker: keeps the app shell available offline.
// It only caches the app's own files. Your writing is stored separately
// (IndexedDB / your own sync), never in this cache.

const CACHE = 'narrivell-shell-v1';
const scope = self.registration.scope; // e.g. https://…/narrivell/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([scope, scope + 'manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page sends the list of files it loaded, so the first visit is
// enough to work offline. Old build files no longer in use are removed.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS') return;
  const urls = (event.data.urls || []).filter((u) => u.startsWith(scope));
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.allSettled(urls.map((u) => cache.add(u)));
      const keep = new Set(urls);
      for (const req of await cache.keys()) {
        if (req.url.startsWith(scope + 'assets/') && !keep.has(req.url)) {
          await cache.delete(req);
        }
      }
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;

  // Pages: try the network first so updates arrive; fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(scope, copy));
          }
          return response;
        })
        .catch(() => caches.match(scope)),
    );
    return;
  }

  // Files: serve from cache straight away, refresh in the background.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
