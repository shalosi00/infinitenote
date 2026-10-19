/*
 * InfiniteNote service worker.
 *
 * Installability + offline shell for the PWA (Linux desktop / Android).
 * Strategy:
 *  - static, never-hot-reloaded assets (icons, excalidraw fonts, pdf worker):
 *    cache-first with runtime fill
 *  - everything else (app code, navigation): network-first, falling back to a
 *    cached navigation response when offline. App data lives in IndexedDB, so
 *    the app is fully usable offline once visited.
 */
const CACHE = "infinitenote-v1";
const PRECACHE = ["/manifest.webmanifest"];

const STATIC_PREFIXES = ["/icons/", "/excalidraw/", "/pdf.worker.min.mjs", "/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (CDN fonts etc.)

  const isStatic = STATIC_PREFIXES.some((p) => url.pathname.startsWith(p) || url.pathname === p);
  if (isStatic) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/")))
    );
    return;
  }

  // other same-origin assets: network-first, cache fallback (keeps dev HMR sane)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
