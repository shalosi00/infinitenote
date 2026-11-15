/*
 * InfiniteNote service worker.
 *
 * Installability + offline shell for the PWA (Linux desktop / Android),
 * plus the Web Share Target receiver (issue #247): the OS share sheet can
 * POST shared text/links/files to /share-target; the POST is intercepted
 * here before the network, stashed in a raw-IndexedDB mailbox and the user
 * is redirected into the app, which drains the mailbox on boot.
 * Strategy:
 *  - share-target POSTs (non-GET, intercepted before the GET fast-path)
 *  - static, never-hot-reloaded assets (icons, excalidraw fonts, pdf worker):
 *    cache-first with runtime fill
 *  - everything else (app code, navigation): network-first, falling back to a
 *    cached navigation response when offline. App data lives in IndexedDB, so
 *    the app is fully usable offline once visited.
 */
const CACHE = "infinitenote-v1";
const PRECACHE = ["/manifest.webmanifest"];

const STATIC_PREFIXES = ["/icons/", "/excalidraw/", "/pdf.worker.min.mjs", "/logo.svg", "/ocr/", "/hwr/"];

/* --------------------- share-target mailbox (issue #247) ---------------------
 * Standalone script: these constants and the entry shape MIRROR
 * src/lib/share-inbox.ts (SHARE_INBOX_DB / SHARE_INBOX_STORE / field names /
 * SharedEntry). src/lib/__tests__/share-inbox.test.ts pins the two copies in
 * sync — update them together.
 */
const SHARE_TARGET_PATH = "/share-target";
const SHARE_TEXT_FIELDS = ["title", "text", "url"];
const SHARE_FILE_FIELD = "files";
const SHARE_INBOX_DB = "infinitenote-share-inbox";
const SHARE_INBOX_STORE = "shares";

/** Open the mailbox (same schema the app drains). */
function openShareInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_INBOX_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_INBOX_STORE)) {
        req.result.createObjectStore(SHARE_INBOX_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("share inbox open failed"));
  });
}

/** Stash one entry; rejects on failure (the caller redirects regardless). */
async function stashShareEntry(entry) {
  const db = await openShareInbox();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE, "readwrite");
      tx.objectStore(SHARE_INBOX_STORE).add(entry);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error ?? new Error("share stash failed"));
      tx.onabort = () => reject(tx.error ?? new Error("share stash aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Parse the share POST and stash it. Throws when the body cannot be parsed
 * or the stash fails — the fetch handler still redirects, it just loses the
 * payload (an installed PWA always has the SW, so this is defensive only).
 */
async function receiveShare(request) {
  const form = await request.formData();
  const entry = {
    title: "",
    text: "",
    url: "",
    files: form
      .getAll(SHARE_FILE_FIELD)
      .filter((v) => v instanceof File)
      .map((file) => ({ name: file.name, type: file.type, blob: file })),
    receivedAt: Date.now(),
  };
  for (const field of SHARE_TEXT_FIELDS) {
    const value = form.get(field);
    entry[field] = typeof value === "string" ? value : "";
  }
  await stashShareEntry(entry);
}

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
  const url = new URL(req.url);

  // Web Share Target (issue #247): intercept the OS share-sheet POST before
  // the GET fast-path. Stash the payload, then redirect into the app — the
  // drain happens on the app's next boot. A parse/stash failure must never
  // strand the user on a dead POST, so the redirect fires regardless.
  if (req.method === "POST" && url.pathname === SHARE_TARGET_PATH && url.origin === self.location.origin) {
    event.respondWith(
      receiveShare(req)
        .catch(() => undefined)
        .then(() => Response.redirect("/", 303))
    );
    return;
  }

  if (req.method !== "GET") return;
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
