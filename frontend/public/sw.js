// Offline support for the installed app. Three caches, three strategies:
//
// - STATIC: Next.js build output under /_next/static is content-hashed and
//   never changes in place, so cache-first is safe and makes the app shell
//   boot instantly offline.
// - PAGES: page HTML and the RSC payloads Next.js fetches on client-side
//   navigation. Network-first, falling back to the last copy seen — so the
//   app still opens with no connection instead of the browser's offline page.
// - API: GET responses from our own /api/* routes. Network-first, falling
//   back to the last successful response, so screens show the last data that
//   was loaded on this device rather than an error. Cleared on login/logout
//   (see clearOfflineCaches in lib/offlineCache.js) so one person's cached
//   data is never shown to the next person who signs in on the same device.
//
// - MEDIA: uploaded photos under /storage/ (selfies, avatars, activity
//   photos), proxied through this origin so they can be cached. Cache-first —
//   a stored file never changes in place — so photos already seen still show
//   offline. Cleared on login/logout together with API.
//
// Warm-up: on every online app load the page asks this worker (WARM_PAGES
// message) to fetch every screen in the user's menu and the scripts each one
// needs, so going offline works on screens never opened on this device —
// and right after an app update, which starts with fresh caches.
//
// Writes (POST/PATCH/DELETE) are never cached or replayed here — the only
// offline write the app supports is clock-in/out, and that has its own
// explicit queue (lib/offlineQueue.js) so it can carry the device time.
const VERSION = "v3";
const STATIC_CACHE = `internova-static-${VERSION}`;
const PAGE_CACHE = `internova-pages-${VERSION}`;
const API_CACHE = `internova-api-${VERSION}`;
const MEDIA_CACHE = `internova-media-${VERSION}`;
const MEDIA_LIMIT = 200;
const SHELL_ASSETS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = [STATIC_CACHE, PAGE_CACHE, API_CACHE, MEDIA_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function offlineJson() {
  return new Response(
    JSON.stringify({ success: false, offline: true, message: "You're offline and this hasn't been loaded on this device yet." }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

// RSC requests carry a `_rsc` cache-buster that changes between visits, so
// they're stored under a stable synthetic key instead — otherwise every
// offline lookup would miss.
function pageCacheKey(url, isRsc) {
  const key = new URL(url);
  key.searchParams.delete("_rsc");
  if (isRsc) key.searchParams.set("__sw_rsc", "1");
  return key.toString();
}

async function networkFirst(request, cacheName, cacheKey, { store = true, fallback } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (store && response.ok) cache.put(cacheKey, response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = await cache.match(cacheKey, { ignoreVary: true });
    if (cached) return cached;
    return fallback ? fallback() : Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

// Like cacheFirst, but keeps only the most recent MEDIA_LIMIT photos so the
// cache can't grow without bound on a device used all internship long.
async function cacheMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone()).catch(() => {});
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MEDIA_LIMIT)).map((key) => cache.delete(key)));
  }
  return response;
}

async function warmPages(urls) {
  const pages = await caches.open(PAGE_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const assets = new Set();
  for (const raw of urls) {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    try {
      const response = await fetch(url.href, { credentials: "same-origin" });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) continue;
      const html = await response.clone().text();
      await pages.put(pageCacheKey(url.href, false), response);
      for (const match of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(match[0]);
    } catch {
      // offline or a transient error — the next online load tries again
    }
  }
  for (const asset of assets) {
    try {
      if (await statics.match(asset)) continue;
      const response = await fetch(asset);
      if (response.ok) await statics.put(asset, response);
    } catch {
      // ignore
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "WARM_PAGES" && Array.isArray(event.data.urls)) {
    event.waitUntil(warmPages(event.data.urls.slice(0, 40)));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/storage/")) {
    event.respondWith(cacheMedia(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    // The health check exists to tell the maintenance page whether the
    // backend is really up — a cached answer would defeat its purpose.
    if (url.pathname === "/api/health") return;
    // Same for the server clock the attendance camera times entries with.
    if (url.pathname === "/api/server-time") return;
    event.respondWith(networkFirst(request, API_CACHE, request.url, { fallback: offlineJson }));
    return;
  }

  const isRsc = request.headers.get("RSC") === "1";
  if (request.mode === "navigate" || isRsc) {
    // Prefetches return partial payloads — fine to serve from, never to store.
    const isPrefetch = request.headers.get("Next-Router-Prefetch") === "1";
    event.respondWith(
      networkFirst(request, PAGE_CACHE, pageCacheKey(request.url, isRsc), {
        store: !isPrefetch,
        // A page never visited on this device: fall back to the app's root,
        // which redirects a signed-in user to their dashboard anyway.
        fallback: async () => (request.mode === "navigate" && (await caches.match("/", { ignoreVary: true }))) || Response.error(),
      })
    );
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, PAGE_CACHE, request.url));
  }
});
