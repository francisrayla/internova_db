"use client";

import { useEffect } from "react";

// Registers the service worker that makes the app installable — split into
// its own client component so the root layout above it can stay a server
// component. Silently no-ops on browsers without service worker support.
//
// Production only: `next dev` serves scripts under unhashed names, and the
// worker caches /_next/static cache-first, so in development it would keep
// running old code after every edit. In dev any worker left from an earlier
// session is removed with its caches. To test offline mode locally, use
// `npm run build && npm start`.
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
      if ("caches" in window) {
        caches.keys().then((keys) => keys.filter((k) => k.startsWith("internova-")).forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }
    // "?keep=1" tells sw.js this is a real build (see SELF_DESTRUCT there), so a
    // local `npm run build && npm start` still gets offline mode on localhost.
    navigator.serviceWorker.register("/sw.js?keep=1").catch(() => {});
  }, []);

  return null;
}
