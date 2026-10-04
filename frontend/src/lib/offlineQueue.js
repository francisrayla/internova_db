"use client";

import { apiFetch } from "@/lib/apiFetch";

// Clock-ins/outs captured with no connection wait here (IndexedDB, since the
// selfie is a Blob — localStorage can't hold it) until the device is back
// online, then get submitted with the device's capture time and an
// `is_offline` flag. See InternMonitoringController::resolveClockTime() for
// how the backend bounds and flags those.
const DB_NAME = "internova-offline";
const STORE = "pending-attendance";
export const QUEUE_CHANGED_EVENT = "internova-offline-queue-changed";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result ?? result);
        tx.onerror = () => reject(tx.error);
      })
  );
}

function notifyChanged() {
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

function currentUserId() {
  try {
    return JSON.parse(localStorage.getItem("internova_user") || "null")?.id ?? null;
  } catch {
    return null;
  }
}

/** How long a clock-in/out upload may go unanswered before it's treated as
 * no connection. A weak signal (or Wi-Fi with no internet) leaves requests
 * hanging instead of failing them, which would otherwise keep the button on
 * "Saving…" — or the sync stuck — indefinitely. */
export const SUBMIT_TIMEOUT_MS = 20000;

/** True when a fetch failed because there's no connection at all (or it
 * timed out waiting for one), as opposed to the server answering with an
 * error. */
export function isNetworkError(err) {
  return (
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    err instanceof TypeError ||
    err?.name === "TimeoutError" ||
    err?.name === "AbortError"
  );
}

/** deviceTime: the phone's own clock at capture. anchoredTime: the
 *  server-anchored clock (lib/trustedClock) when available, else null. */
export async function enqueueAttendance({ mode, selfie, lat, lng, deviceTime, anchoredTime = null }) {
  await run("readwrite", (store) =>
    store.add({ userId: currentUserId(), mode, selfie, lat, lng, deviceTime, anchoredTime, createdAt: Date.now() })
  );
  notifyChanged();
}

/** Pending entries for whoever is signed in right now. Entries belong to the
 * account that captured them — they're never submitted under someone else's
 * session if a different person signs in on the same device. */
export async function getPendingAttendance() {
  if (typeof indexedDB === "undefined") return [];
  const userId = currentUserId();
  const all = await run("readonly", (store) => store.getAll()).catch(() => []);
  return (all || []).filter((entry) => entry.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
}

let syncing = false;

/** Submits every pending entry for the signed-in user, oldest first (a
 * clock-in has to land before its clock-out). Stops at the first network
 * failure and leaves the rest for the next attempt. Returns the messages of
 * any entries the server rejected outright — those are dropped, since
 * retrying won't change the answer. */
export async function syncPendingAttendance() {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) return { synced: 0, rejected: [] };
  syncing = true;
  let synced = 0;
  const rejected = [];
  try {
    const pending = await getPendingAttendance();
    for (const entry of pending) {
      const formData = new FormData();
      formData.append("selfie", entry.selfie, "selfie.jpg");
      formData.append("latitude", String(entry.lat));
      formData.append("longitude", String(entry.lng));
      formData.append("is_offline", "1");
      formData.append("device_time", entry.deviceTime);
      if (entry.anchoredTime) formData.append("anchored_time", entry.anchoredTime);
      // The phone's clock right now: lets the server measure how far off it
      // is and correct device_time even if the date was changed on purpose.
      formData.append("device_now", new Date().toISOString());

      let res;
      try {
        res = await apiFetch(`/api/intern/attendance/${entry.mode === "clock_in" ? "clock-in" : "clock-out"}`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        });
      } catch {
        break;
      }

      if (res.status === 401 || res.status === 403) {
        // Session expired — keep the entry; it'll go through once they sign
        // back in (apiFetch is already sending them to /login).
        break;
      }
      if (res.ok) {
        synced += 1;
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => ({}));
        rejected.push(data.message || "An offline attendance entry couldn't be saved.");
      } else {
        // 5xx — the server's having trouble, not the entry. Try again later.
        break;
      }
      await run("readwrite", (store) => store.delete(entry.id));
    }
  } finally {
    syncing = false;
    notifyChanged();
  }
  return { synced, rejected };
}
