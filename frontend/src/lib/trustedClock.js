"use client";

// A clock the user can't move by changing their phone's date/time.
//
// While online the app reads the server's time once and then counts forward
// with performance.now() — a timer that keeps running at its own pace no
// matter what the device clock is set to. trustedNow() is "server time at
// the last sync + time elapsed since". Without a sync this page session
// (e.g. the app was opened with no signal) it falls back to the device clock,
// and the server corrects those entries when they sync (see
// InternMonitoringController::resolveClockTime).

let anchor = null; // { server: epoch ms, perf: performance.now() at that moment }
let syncing = null;

export async function syncTrustedClock() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const started = performance.now();
      const res = await fetch("/api/server-time", { cache: "no-store" });
      const finished = performance.now();
      const { now } = await res.json();
      const server = Date.parse(now);
      if (!res.ok || Number.isNaN(server)) return false;
      // Assume the answer was produced halfway through the round trip.
      anchor = { server: server + (finished - started) / 2, perf: finished };
      return true;
    } catch {
      return false;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** { date, source }: source "server" when anchored to the server's clock this
 *  session (tamper-proof), "device" when it had to fall back to the phone. */
export function trustedNow() {
  if (anchor) return { date: new Date(anchor.server + (performance.now() - anchor.perf)), source: "server" };
  return { date: new Date(), source: "device" };
}

/** Philippine time for display, regardless of the phone's time zone setting. */
export const DISPLAY_TIME_ZONE = "Asia/Manila";
