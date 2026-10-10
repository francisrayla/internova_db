"use client";

import { useEffect, useState } from "react";
import NavIcon from "@/components/NavIcon";
import { getPendingAttendance, syncPendingAttendance, QUEUE_CHANGED_EVENT } from "@/lib/offlineQueue";

export const ATTENDANCE_SYNCED_EVENT = "internova-attendance-synced";

/** Banner shown across every role's workspace while the device is offline
 * (screens are showing the last data loaded on this device, served by the
 * service worker), plus the driver that flushes queued offline clock-ins/outs
 * as soon as a connection comes back. */
export default function OfflineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);
  const [syncNotice, setSyncNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshCount() {
      const pending = await getPendingAttendance();
      if (!cancelled) setPendingCount(pending.length);
    }

    async function trySync() {
      if (!navigator.onLine) return;
      const { synced, rejected } = await syncPendingAttendance();
      if (cancelled) return;
      if (rejected.length > 0) {
        setSyncNotice({ tone: "error", text: `Couldn't save an offline attendance entry: ${rejected[0]}` });
      } else if (synced > 0) {
        setSyncNotice({ tone: "success", text: `${synced} offline attendance ${synced === 1 ? "entry" : "entries"} synced.` });
      }
      if (synced > 0 || rejected.length > 0) window.dispatchEvent(new Event(ATTENDANCE_SYNCED_EVENT));
    }

    function handleOnline() {
      setOnline(true);
      trySync();
    }
    function handleOffline() {
      setOnline(false);
    }
    function handleVisible() {
      if (document.visibilityState === "visible") trySync();
    }

    refreshCount();
    trySync();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener(QUEUE_CHANGED_EVENT, refreshCount);
    document.addEventListener("visibilitychange", handleVisible);
    // navigator.onLine can claim "online" on a network with no real internet
    // (captive wifi, dead data) — so retry on a timer too while anything's queued.
    const interval = setInterval(trySync, 60000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(QUEUE_CHANGED_EVENT, refreshCount);
      document.removeEventListener("visibilitychange", handleVisible);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!syncNotice) return;
    const id = setTimeout(() => setSyncNotice(null), syncNotice.tone === "error" ? 12000 : 6000);
    return () => clearTimeout(id);
  }, [syncNotice]);

  if (online && pendingCount === 0 && !syncNotice) return null;

  return (
    <div className="space-y-2 print:hidden">
      {!online && (
        <div className="k-note is-warn flex-nowrap justify-start gap-2">
          <NavIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          <p>
            <span className="font-semibold">You&apos;re offline.</span> Showing the last data loaded on this device — some of it may be out of date.
          </p>
        </div>
      )}
      {pendingCount > 0 && (
        <div className="k-note">
          {pendingCount} attendance {pendingCount === 1 ? "entry is" : "entries are"} saved on this device and will sync automatically once you&apos;re back online.
        </div>
      )}
      {syncNotice && (
        <div className={`k-note ${syncNotice.tone === "error" ? "is-risk" : "is-ok"}`}>
          {syncNotice.text}
        </div>
      )}
    </div>
  );
}
