"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import Icon from "@/components/Icon";
import { ATTENDANCE_SYNCED_EVENT } from "@/components/OfflineStatus";
import { enqueueAttendance, getPendingAttendance, isNetworkError, QUEUE_CHANGED_EVENT } from "@/lib/offlineQueue";
import { DISPLAY_TIME_ZONE, syncTrustedClock, trustedNow } from "@/lib/trustedClock";
import AttendanceCard, { STATUS_STYLES } from "./AttendanceCard";

const LIVE_TYPES = ["attendance_reviewed"];

function formatStampDate(d) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}
function formatStampTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}
function formatStampLocation(location) {
  if (!location) return "Locating…";
  return location.address || `Lat ${location.lat.toFixed(5)}, Lng ${location.lng.toFixed(5)}`;
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Turns raw coordinates into a short, readable address (street/barangay,
 * city, province) via OpenStreetMap's free Nominatim reverse-geocoder — no
 * API key needed. Coordinates alone aren't what a supervisor can glance at
 * and recognize; a real address is. Falls back to the coordinates
 * themselves if the lookup is unavailable, so the stamp never blocks on it. */
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`, {
      headers: { Accept: "application/json", "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address;
    const parts = a ? [a.road || a.neighbourhood || a.suburb, a.city || a.town || a.municipality || a.village, a.state || a.province].filter(Boolean) : [];
    const address = parts.length ? parts.join(", ") : data.display_name;
    return address ? truncate(address, 60) : null;
  } catch {
    return null;
  }
}

/** Live overlay + the identical stamp baked into the captured image itself,
 * mimicking a timestamp/GPS camera — so the date, time, and coordinates are
 * part of the photo's pixels, not just separate form fields. */
function StampOverlay({ now, location }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-6 text-white">
      <p className="text-sm font-semibold leading-tight">
        {formatStampDate(now)} · {formatStampTime(now)}
      </p>
      <p className="mt-0.5 text-xs leading-tight text-white/90">📍 {formatStampLocation(location)}</p>
    </div>
  );
}

/** getUserMedia rejects for several distinct reasons that need different
 * advice — lumping them all into "denied" (as an earlier version of this did)
 * hides the real cause from the person trying to fix it. */
function cameraErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera access was denied. Allow the camera for this site in your browser's settings, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera is already being used by another app. Close it, then try again.";
    case "SecurityError":
      return "Camera access needs a secure connection (https or localhost) to work here.";
    default:
      return "Couldn't access your camera. Try again.";
  }
}

/** Full-screen, like a device's built-in camera app, rather than a small
 * boxed-in preview — the live feed fills the screen and the shutter/controls
 * dock at the bottom. */
function ClockCamera({ mode, onClose, onDone }) {
  const isIn = mode === "clock_in";
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  // Bumped on every start/stop so a getUserMedia request that resolves after
  // the modal closed (or after a newer request began) can tell it's stale and
  // release its stream instead of leaking it — a leaked stream keeps the
  // camera locked and every later attempt fails with "already being used".
  const requestIdRef = useRef(0);

  const [camSupported] = useState(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState(camSupported ? "" : "This browser doesn't support camera access.");
  const [preview, setPreview] = useState(null);
  const [selfie, setSelfie] = useState(null);
  // The moment the photo was taken — what an offline entry reports as its
  // time, since that's when the intern actually clocked in/out.
  // Server-anchored, so the live stamp can't be moved by changing the phone's date/time.
  const [now, setNow] = useState(() => trustedNow().date);
  const [captureMeta, setCaptureMeta] = useState(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  const [locSupported] = useState(() => typeof navigator !== "undefined" && !!navigator.geolocation);
  const [location, setLocation] = useState(null);
  const [locError, setLocError] = useState(locSupported ? "" : "This browser doesn't support location access.");

  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function stopStream() {
    requestIdRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function startCamera() {
    if (!camSupported) return;
    stopStream();
    const requestId = requestIdRef.current;
    setCamError("");
    // A soft "ideal" front-camera preference, with a plain-video fallback for
    // webcams that don't report a facingMode at all (common on laptops) —
    // requiring facingMode outright made the very first version of this
    // fail on exactly that kind of camera.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }))
      .then((stream) => {
        if (requestId !== requestIdRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setReady(true);
      })
      .catch((err) => {
        if (requestId === requestIdRef.current) setCamError(cameraErrorMessage(err));
      });
  }

  // The <video> element only exists in the DOM once `ready` is true (it's
  // conditionally rendered below), so assigning srcObject inside
  // startCamera()'s promise callback above was racing against React's own
  // commit — the ref was still null at that point on every single call,
  // first load and retake alike. Attaching the stream here instead, in an
  // effect that runs after the video element has actually mounted,
  // guarantees the ref exists before we touch it.
  useEffect(() => {
    if (ready && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [ready]);

  function requestLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, address: null };
        setLocation(loc);
        // Resolved separately so the shutter isn't blocked waiting on it —
        // the stamp shows raw coordinates for the moment it takes, then
        // swaps to the address once the lookup lands.
        reverseGeocode(loc.lat, loc.lng).then((address) => {
          if (address) setLocation((prev) => (prev ? { ...prev, address } : prev));
        });
      },
      (err) => setLocError(err.code === err.PERMISSION_DENIED ? "Location access was denied — allow it to continue." : "Couldn't get your location. Try again."),
      // GPS still works offline, but without network-assisted positioning a
      // first fix can take noticeably longer — give it room before giving up.
      { enableHighAccuracy: true, timeout: 20000 }
    );
  }

  useEffect(() => {
    startCamera();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (locSupported) requestLocation();
  }, [locSupported]);

  useEffect(() => {
    syncTrustedClock().then(() => setNow(trustedNow().date));
    const id = setInterval(() => setNow(trustedNow().date), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  function retryLocation() {
    setLocError("");
    requestLocation();
  }

  // verified=false: no server sync this session, so the time is the phone's
  // own clock — labelled, since the server corrects it when the entry syncs.
  function drawStamp(ctx, canvas, stampAt, verified = true) {
    const padding = Math.round(canvas.width * 0.035);
    const barHeight = Math.round(canvas.height * (verified ? 0.2 : 0.3));
    const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    const bigFont = Math.max(14, Math.round(canvas.width * 0.04));
    const smallFont = Math.max(11, Math.round(canvas.width * 0.032));
    ctx.font = `700 ${bigFont}px sans-serif`;
    ctx.fillText(`${formatStampDate(stampAt)} · ${formatStampTime(stampAt)}`, padding, canvas.height - padding - smallFont - 6);
    ctx.font = `${smallFont}px sans-serif`;
    ctx.fillText(`📍 ${formatStampLocation(location)}`, padding, canvas.height - padding);
    if (!verified) {
      ctx.fillStyle = "#fde68a";
      ctx.fillText("Phone time — checked by the server when synced", padding, canvas.height - padding - smallFont - bigFont - 14);
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    const clock = trustedNow();
    const stampAt = clock.date;
    const meta = { deviceTime: new Date().toISOString(), anchoredTime: clock.source === "server" ? stampAt.toISOString() : null };
    drawStamp(ctx, canvas, stampAt, clock.source === "server");
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        setReady(false);
        setPreview(URL.createObjectURL(blob));
        setSelfie(blob);
        setCaptureMeta(meta);
      },
      "image/jpeg",
      0.92
    );
  }

  function retake() {
    setPreview(null);
    setSelfie(null);
    setCaptureMeta(null);
    startCamera();
  }

  /** No connection: keep the entry on the device and let OfflineStatus
   * submit it (with this capture time) once the connection is back. */
  async function saveOffline() {
    await enqueueAttendance({
      mode,
      selfie,
      lat: location.lat,
      lng: location.lng,
      deviceTime: captureMeta?.deviceTime ?? new Date().toISOString(),
      anchoredTime: captureMeta?.anchoredTime ?? null,
    });
    onDone({ offline: true });
  }

  async function handleSubmit() {
    if (!selfie || !location) return;
    setSaving(true);
    setSubmitError("");
    try {
      if (!navigator.onLine) {
        await saveOffline();
        return;
      }
      const formData = new FormData();
      formData.append("selfie", selfie, "selfie.jpg");
      formData.append("latitude", String(location.lat));
      formData.append("longitude", String(location.lng));
      const res = await apiFetch(`/api/intern/attendance/${isIn ? "clock-in" : "clock-out"}`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save this.");
      onDone();
    } catch (err) {
      if (isNetworkError(err)) {
        try {
          await saveOffline();
          return;
        } catch {
          setSubmitError("Couldn't reach the server or save this on your device. Try again.");
          return;
        }
      }
      setSubmitError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const canCapture = ready && !!location;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-white/10">
          <Icon name="x" size={22} />
        </button>
        <p className="text-sm font-semibold">{isIn ? "Clock In" : "Clock Out"}</p>
        <div className="w-9" />
      </div>

      <div className="relative flex-1 overflow-hidden bg-slate-900">
        {preview ? (
          <img src={preview} alt="Captured selfie" className="h-full w-full object-contain" />
        ) : ready ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            <StampOverlay now={now} location={location} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm text-slate-300">{camError || "Starting camera…"}</p>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="space-y-3 bg-black px-6 py-6">
        {camError && !ready && !preview && (
          <div className="text-center">
            <button type="button" onClick={startCamera} className="text-sm font-semibold text-blue-400 hover:underline">
              Try again
            </button>
          </div>
        )}
        {ready && !location && !preview && (
          <p className="text-center text-xs text-slate-400">
            {locError ? (
              <>
                <span className="text-red-400">{locError}</span>{" "}
                <button type="button" onClick={retryLocation} className="font-semibold text-blue-400 hover:underline">
                  Try again
                </button>
              </>
            ) : (
              "Waiting for your location to stamp the photo…"
            )}
          </p>
        )}
        {!online && (
          <p className="text-center text-xs text-amber-300">
            You&apos;re offline — this will be saved on your device and sent automatically once you&apos;re back online.
          </p>
        )}
        {submitError && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-center text-sm text-red-400">{submitError}</p>}

        {preview ? (
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={retake} disabled={saving} className="rounded-xl border border-white/30 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50">
              Retake
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : isIn ? "Clock In" : "Clock Out"}
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={capture}
              disabled={!canCapture}
              aria-label="Capture"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
            >
              <span className="h-12 w-12 rounded-full bg-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatPendingTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}

/** What the today-card should show, combining the server's answer (possibly
 * a cached copy from an earlier day, if offline) with anything still sitting
 * in the offline queue — an offline clock-in has to flip the card to
 * "Clock Out" right away, not after it eventually syncs. */
function resolveTodayView(today, pending, online) {
  const lastPending = pending[pending.length - 1];
  if (lastPending?.mode === "clock_in") {
    return { action: "clock_out", clockIn: formatPendingTime(lastPending.anchoredTime ?? lastPending.deviceTime), waitingToSync: true };
  }
  if (lastPending?.mode === "clock_out") {
    return { action: "done", clockOut: formatPendingTime(lastPending.anchoredTime ?? lastPending.deviceTime), waitingToSync: true };
  }

  // A cached response whose day is already over says nothing about today.
  const stale = today?.day_ends_at && trustedNow().date.getTime() > Date.parse(today.day_ends_at);
  if (!today || stale) {
    // Nothing usable loaded (offline, never cached here) — still let them
    // clock in; the server sorts out duplicates when the entry syncs.
    return today || !online ? { action: "clock_in" } : null;
  }

  if (today.next_action === "clock_in") return { action: "clock_in" };
  if (today.next_action === "clock_out") return { action: "clock_out", clockIn: today.record.clock_in };
  if (today.record) return { action: "done", record: today.record };
  return null;
}

export default function Attendance() {
  const [today, setToday] = useState(null);
  const [records, setRecords] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalMode, setModalMode] = useState(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  function load() {
    Promise.all([fetchInternData("attendance/today"), fetchInternData("attendance")])
      .then(([t, r]) => {
        setToday(t);
        setRecords(r.records ?? []);
        setError("");
      })
      .catch((e) =>
        setError(navigator.onLine ? e.message : "You're offline, and your attendance hasn't been loaded on this device yet.")
      )
      .finally(() => setLoading(false));
  }

  function loadPending() {
    getPendingAttendance().then(setPending).catch(() => {});
  }

  useEffect(load, []);
  useLiveRefresh(LIVE_TYPES, load);

  useEffect(() => {
    loadPending();
    const updateOnline = () => setOnline(navigator.onLine);
    const handleSynced = () => {
      setNotice("");
      load();
    };
    window.addEventListener(QUEUE_CHANGED_EVENT, loadPending);
    window.addEventListener(ATTENDANCE_SYNCED_EVENT, handleSynced);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener(QUEUE_CHANGED_EVENT, loadPending);
      window.removeEventListener(ATTENDANCE_SYNCED_EVENT, handleSynced);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const view = loading ? null : resolveTodayView(today, pending, online);
  const syncNote = <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Waiting to sync</span>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Attendance</h2>
        <p className="mt-1 text-sm text-slate-600">Clock in and out with a selfie and your location — your supervisor reviews each entry.</p>
      </div>

      {notice && <p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</p>}
      {error && !view && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {view && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {view.action === "clock_in" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">You haven&apos;t clocked in today.</p>
                <p className="mt-0.5 text-sm text-slate-500">Log your arrival to start today&apos;s attendance.</p>
              </div>
              <button onClick={() => setModalMode("clock_in")} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Clock In
              </button>
            </div>
          )}
          {view.action === "clock_out" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Clocked in at {view.clockIn}
                  {view.waitingToSync && syncNote}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">Clock out when you&apos;re done for the day.</p>
              </div>
              <button onClick={() => setModalMode("clock_out")} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Clock Out
              </button>
            </div>
          )}
          {view.action === "done" && view.waitingToSync && (
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Clocked out at {view.clockOut}
                {syncNote}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">Saved on this device — it&apos;ll be sent automatically once you&apos;re back online.</p>
            </div>
          )}
          {view.action === "done" && view.record && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Today&apos;s attendance complete</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {view.record.clock_in} to {view.record.clock_out} {view.record.hours != null && `(${view.record.hours}h)`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[view.record.status] ?? "bg-slate-100 text-slate-700"}`}>
                {view.record.status}
              </span>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Latest Attendance</h3>
          <Link href="/intern/attendance/history" className="text-sm font-semibold text-blue-600 hover:underline">
            View all history →
          </Link>
        </div>
        {loading ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Loading attendance…</p>
        ) : records.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">No attendance records yet.</p>
        ) : (
          <div className="max-w-xs">
            <AttendanceCard record={records[0]} />
          </div>
        )}
      </section>

      {modalMode && (
        <ClockCamera
          mode={modalMode}
          onClose={() => setModalMode(null)}
          onDone={(result) => {
            setModalMode(null);
            if (result?.offline) {
              setNotice("You're offline, so this was saved on your device. It'll be sent automatically once you're back online.");
              loadPending();
            } else {
              setNotice("");
              load();
            }
          }}
        />
      )}
    </div>
  );
}
