"use client";

/** The service worker (public/sw.js) keeps the last response of every /api/*
 * GET so screens still show data offline. That cache isn't scoped per user,
 * so it's wiped whenever the signed-in account changes — otherwise the next
 * person to log in on a shared device could see the previous person's data. */
export async function clearOfflineCaches() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    // API responses and uploaded photos (selfies, avatars) are per-account.
    await Promise.all(
      keys.filter((key) => key.startsWith("internova-api-") || key.startsWith("internova-media-")).map((key) => caches.delete(key))
    );
  } catch {
    // ignore
  }
}
