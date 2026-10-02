"use client";

import { useEffect } from "react";

// Registers the service worker that makes the app installable — split into
// its own client component so the root layout above it can stay a server
// component. Silently no-ops on browsers without service worker support.
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
