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
// Network-first here always has a time limit (PAGE_TIMEOUT_MS / API_TIMEOUT_MS):
// a connection that is up but not answering — the usual "offline" on a phone
// with one bar of signal — is treated like no connection, so menu taps and
// screens fall back to the saved copy instead of hanging.
//
// Writes (POST/PATCH/DELETE) are never cached or replayed here — the only
// offline write the app supports is clock-in/out, and that has its own
// explicit queue (lib/offlineQueue.js) so it can carry the device time.
const VERSION = "v4";
const STATIC_CACHE = `internova-static-${VERSION}`;
const PAGE_CACHE = `internova-pages-${VERSION}`;
const API_CACHE = `internova-api-${VERSION}`;
const MEDIA_CACHE = `internova-media-${VERSION}`;
const MEDIA_LIMIT = 200;
// How long a request may go unanswered before the saved copy is served. A
// phone with a weak signal, or Wi-Fi with no internet behind it, doesn't fail
// requests — it leaves them hanging, so without a limit a tap in the menu
// (or a screen's data) would wait until the browser gives up minutes later.
const PAGE_TIMEOUT_MS = 3500;
const API_TIMEOUT_MS = 5000;
const TIMED_OUT = Symbol("timed out");
// Once a request has gone unanswered the connection is treated as dead for a
// while: later requests are answered from the saved copy straight away
// instead of each waiting out its own time limit (which made every menu tap
// take several seconds). The network is still tried in the background, and
// the first response that comes back ends this early.
const STALLED_FOR_MS = 30000;
let stalledUntil = 0;
// A request still unanswered after this long is given up on, so hung
// requests can't pile up and hold the browser's connections once the signal
// comes back.
const GIVE_UP_MS = 30000;
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

// Network-first with a time limit: when the network hasn't answered within
// timeoutMs (or the connection is known to be stalled), the cached copy is
// served and the network response, if it ever arrives, still refreshes the
// cache for next time. With nothing cached, onTimeoutMiss decides — return a
// Response to answer now, or nothing to keep waiting on the network.
async function networkFirst(event, cacheName, cacheKey, { store = true, timeoutMs, onTimeoutMiss, fallback }) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const network = fetch(request, { signal: AbortSignal.timeout(GIVE_UP_MS) }).then((response) => {
    stalledUntil = 0;
    if (store && response.ok) cache.put(cacheKey, response.clone()).catch(() => {});
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  const offline = () =>
    cache.match(cacheKey, { ignoreVary: true }).then((cached) => cached || (fallback ? fallback() : Response.error()));

  let first = TIMED_OUT;
  if (Date.now() >= stalledUntil) {
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    first = await Promise.race([network, deadline]).catch(() => null);
    clearTimeout(timer);
    if (first === TIMED_OUT) stalledUntil = Date.now() + STALLED_FOR_MS;
  }
  if (first === null) return offline(); // the network failed outright
  if (first !== TIMED_OUT) return first;

  const cached = await cache.match(cacheKey, { ignoreVary: true });
  if (cached) return cached;
  const answer = onTimeoutMiss ? await onTimeoutMiss() : null;
  return answer || network.catch(offline);
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
    // The printable narrative report loads every photo of an internship at
    // once — caching those would push the photos the app needs offline out
    // of the MEDIA_LIMIT cache, so they're left to the browser.
    const from = request.referrer ? new URL(request.referrer).pathname : "";
    if (from.endsWith("/narrative-report") || from === "/intern/portfolio/report") return;
    event.respondWith(cacheMedia(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    // The health check exists to tell the maintenance page whether the
    // backend is really up — a cached answer would defeat its purpose.
    if (url.pathname === "/api/health") return;
    // Same for the server clock the attendance camera times entries with.
    if (url.pathname === "/api/server-time") return;
    // The Word narrative report is a large one-off download: storing it would
    // fill the API cache, and its generation time could trip the stall timer.
    if (url.pathname.endsWith("/narrative-report/docx")) return;
    event.respondWith(networkFirst(event, API_CACHE, request.url, { timeoutMs: API_TIMEOUT_MS, fallback: offlineJson }));
    return;
  }

  const isRsc = request.headers.get("RSC") === "1";
  if (request.mode === "navigate" || isRsc) {
    // Prefetches return partial payloads — fine to serve from, never to store.
    const isPrefetch = request.headers.get("Next-Router-Prefetch") === "1";
    event.respondWith(
      networkFirst(event, PAGE_CACHE, pageCacheKey(request.url, isRsc), {
        store: !isPrefetch,
        timeoutMs: PAGE_TIMEOUT_MS,
        // An in-app navigation whose data was never saved, on a connection
        // that isn't answering: if the screen's HTML was saved by the warm-up,
        // fail fast so Next.js falls back to a full page load — which is
        // then answered from that saved HTML instead of hanging here.
        onTimeoutMiss: async () =>
          isRsc && !isPrefetch && (await caches.match(pageCacheKey(request.url, false), { ignoreVary: true }))
            ? Response.error()
            : null,
        // A page never visited on this device: fall back to the app's root,
        // which redirects a signed-in user to their dashboard anyway.
        fallback: async () => (request.mode === "navigate" && (await caches.match("/", { ignoreVary: true }))) || Response.error(),
      })
    );
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(networkFirst(event, PAGE_CACHE, request.url, { timeoutMs: PAGE_TIMEOUT_MS }));
  }
});
