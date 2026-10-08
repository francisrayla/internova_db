"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import Icon from "@/components/Icon";
import { ATTENDANCE_SYNCED_EVENT } from "@/components/OfflineStatus";
import { enqueueAttendance, getPendingAttendance, isNetworkError, QUEUE_CHANGED_EVENT, SUBMIT_TIMEOUT_MS } from "@/lib/offlineQueue";
import { DISPLAY_TIME_ZONE, syncTrustedClock, trustedNow } from "@/lib/trustedClock";
import AttendanceCard, { STATUS_STYLES } from "./AttendanceCard";

const LIVE_TYPES = ["attendance_reviewed"];

function formatStampDate(d) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}
function formatStampTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}
/** Straight-line distance in metres between two {lat, lng} points (enough precision for "has the phone moved"). */
function metersApart(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** True when the browser's location functions are no longer the built-in ones, which is how spoofing extensions
 * and scripts work. It cannot see a fake-GPS app on the phone itself (nothing in a web page can); the server
 * adds its own checks for that. */
function geolocationLooksTampered() {
  try {
    const geo = navigator.geolocation;
    if (!geo) return false;
    const isNative = (fn) => typeof fn === "function" && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
    const real = typeof Geolocation !== "undefined" ? geo instanceof Geolocation : true;
    return !(real && isNative(geo.getCurrentPosition) && isNative(geo.watchPosition));
  } catch {
    return false;
  }
}

/** What the stamp says about the place. `pending` (online, name not found yet) shows a wait message, never
 * coordinates: the photo can only be taken once the place has a name. Coordinates appear only when the phone is
 * offline, where no name can be looked up. */
function formatStampLocation(location, pending = false) {
  if (!location) return "Locating…";
  if (location.address) return location.address;
  if (pending) return "Finding your place name…";
  return `Lat ${location.lat.toFixed(5)}, Lng ${location.lng.toFixed(5)}`;
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One lookup is given this long before the next provider/attempt takes over. */
const GEOCODE_TIMEOUT_MS = 7000;
/** Waits before each attempt at finding the place name (3 attempts); after the last one the intern is asked to retry. */
const GEOCODE_ATTEMPT_DELAYS_MS = [0, 2500, 5000];

/** "Barangay, City, Province" without repeats ("Mamburao, Mamburao" becomes "Mamburao"). */
function joinPlaceParts(parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const text = typeof part === "string" ? part.trim() : "";
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push(text);
    }
  }
  return out.length ? truncate(out.join(", "), 60) : null;
}

/** OpenStreetMap's Nominatim: free, no API key, but slow or rate-limited at times. */
async function nominatimName(lat, lng) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`, {
    headers: { Accept: "application/json", "Accept-Language": "en" },
    signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const a = data.address;
  const name = a ? joinPlaceParts([a.road || a.neighbourhood || a.suburb || a.hamlet, a.city || a.town || a.municipality || a.village, a.state || a.province]) : null;
  return name ?? (data.display_name ? truncate(data.display_name, 60) : null);
}

/** BigDataCloud's client-side reverse geocoder: free, no API key, allowed from a browser. The fallback. */
async function bigDataCloudName(lat, lng) {
  const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return joinPlaceParts([data.locality, data.city, data.principalSubdivision]);
}

/** Resolves with the first provider that gives a name; null when every one failed or knew nothing. */
function firstName(lookups) {
  return new Promise((resolve) => {
    let left = lookups.length;
    const miss = () => {
      left -= 1;
      if (left === 0) resolve(null);
    };
    lookups.forEach((lookup) => lookup.then((name) => (name ? resolve(name) : miss()), miss));
  });
}

/** Turns raw coordinates into a short, readable place name (barangay, city, province). Coordinates alone aren't
 * what a supervisor can glance at and recognize. Both providers are asked at once and whichever answers first
 * wins, so one being slow, blocked or rate-limited does not hold the intern up. Returns null when neither knows. */
function reverseGeocode(lat, lng) {
  return firstName([nominatimName(lat, lng), bigDataCloudName(lat, lng)]);
}

/** Live overlay + the identical stamp baked into the captured image itself,
 * mimicking a timestamp/GPS camera — so the date, time, and coordinates are
 * part of the photo's pixels, not just separate form fields. */
function StampOverlay({ now, location, pending }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-6 text-white">
      <p className="text-sm font-semibold leading-tight">
        {formatStampDate(now)} · {formatStampTime(now)}
      </p>
      <p className="mt-0.5 text-xs leading-tight text-white/90">📍 {formatStampLocation(location, pending)}</p>
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
function ClockCamera({ mode, session, label, onClose, onDone }) {
  const isIn = mode === "clock_in";
  // A normal day keeps the original wording; the morning and afternoon punches say which one they are.
  const title = !session || session === "full" ? (isIn ? "Clock In" : "Clock Out") : label;
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
  const [fix, setFix] = useState(null);
  // The place name is kept apart from the GPS fix: the fix changes every few seconds, and a name that arrives a
  // moment after the next reading must still be used (tying it to exact coordinates lost it before).
  const [placeName, setPlaceName] = useState(null);
  // idle: nothing to look up (offline, or already found) - looking: first try - retrying: trying again - failed: all tries used.
  const [placeState, setPlaceState] = useState("idle");
  const watchIdRef = useRef(null);
  const lastGeocodeRef = useRef(null);
  const placeJobRef = useRef(0);
  const fixRef = useRef(null);
  const placeNameRef = useRef(null);
  const location = fix && { ...fix, address: placeName };
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

  // The location is watched, not read once, so the fix stays fresh while the camera is open and its
  // accuracy improves. maximumAge 0 refuses a cached position. The reading used for the photo is the
  // one at the moment of capture (see capture()), together with its precision and age, which the
  // server uses to refuse a stale or very imprecise fix.
  function stopLocationWatch() {
    if (watchIdRef.current != null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }

  /** Finds the place name for a point: up to 3 attempts, each asking both providers. While it is not found the
   * shutter stays off (the stamp must carry a place name, not raw coordinates). Offline there is nothing to ask,
   * so it stops quietly and the entry is saved with coordinates. */
  async function lookupPlace(lat, lng) {
    const job = ++placeJobRef.current;
    lastGeocodeRef.current = { lat, lng };
    for (let attempt = 0; attempt < GEOCODE_ATTEMPT_DELAYS_MS.length; attempt++) {
      setPlaceState(attempt === 0 ? "looking" : "retrying");
      if (GEOCODE_ATTEMPT_DELAYS_MS[attempt]) await sleep(GEOCODE_ATTEMPT_DELAYS_MS[attempt]);
      if (job !== placeJobRef.current) return;
      if (!navigator.onLine) {
        setPlaceState("idle");
        return;
      }
      const name = await reverseGeocode(lat, lng);
      if (job !== placeJobRef.current) return;
      if (name) {
        placeNameRef.current = name;
        setPlaceName(name);
        setPlaceState("idle");
        return;
      }
    }
    setPlaceState("failed");
  }

  function retryPlace() {
    const at = fixRef.current;
    if (at) lookupPlace(at.lat, at.lng);
  }

  function requestLocation() {
    stopLocationWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setLocError("");
        fixRef.current = { lat, lng };
        setFix({ lat, lng, accuracy, fixedAt: pos.timestamp });
        // The place name is looked up separately so the location itself is never held up by it, and again
        // only after the phone has really moved. A name for a spot far from here is dropped at once.
        const last = lastGeocodeRef.current;
        const moved = last ? metersApart(last, { lat, lng }) : Infinity;
        if (moved > 150) {
          placeNameRef.current = null;
          setPlaceName(null);
        }
        if (moved > 40) lookupPlace(lat, lng);
      },
      (err) => {
        if (!fixRef.current) setLocError(err.code === err.PERMISSION_DENIED ? "Location access was denied — allow it to continue." : "Couldn't get your location. Try again.");
      },
      // GPS still works offline, but without network-assisted positioning a
      // first fix can take noticeably longer — give it room before giving up.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  useEffect(() => {
    startCamera();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (locSupported) requestLocation();
    return () => {
      stopLocationWatch();
      placeJobRef.current += 1; // a lookup still running must not touch the closed screen
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locSupported]);

  useEffect(() => {
    syncTrustedClock().then(() => setNow(trustedNow().date));
    const id = setInterval(() => setNow(trustedNow().date), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      // Back online with a place that never got a name (it was offline when the fix came): find it now.
      const at = fixRef.current;
      if (navigator.onLine && at && !placeNameRef.current) lookupPlace(at.lat, at.lng);
    };
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
    if (!video || !canvas || !canCapture) return;
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
    // Where the phone was at this moment, how precise that fix was and how old it is.
    const fix = location && {
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy ?? null,
      fixAge: location.fixedAt ? Math.max(0, (Date.now() - location.fixedAt) / 1000) : null,
      tampered: geolocationLooksTampered(),
    };
    const meta = { deviceTime: new Date().toISOString(), anchoredTime: clock.source === "server" ? stampAt.toISOString() : null, fix };
    drawStamp(ctx, canvas, stampAt, clock.source === "server");
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        stopLocationWatch();
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
    if (locSupported) requestLocation();
  }

  /** No connection: keep the entry on the device and let OfflineStatus
   * submit it (with this capture time) once the connection is back. */
  async function saveOffline() {
    await enqueueAttendance({
      mode,
      session,
      selfie,
      lat: (captureMeta?.fix ?? location).lat,
      lng: (captureMeta?.fix ?? location).lng,
      accuracy: captureMeta?.fix?.accuracy ?? null,
      fixAge: captureMeta?.fix?.fixAge ?? null,
      tampered: captureMeta?.fix?.tampered ?? false,
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
      const fix = captureMeta?.fix ?? location;
      formData.append("latitude", String(fix.lat));
      formData.append("longitude", String(fix.lng));
      if (fix.accuracy != null) formData.append("accuracy", String(Math.round(fix.accuracy)));
      if (fix.fixAge != null) formData.append("fix_age", String(Math.round(fix.fixAge)));
      if (fix.tampered) formData.append("geo_tampered", "1");
      if (session) formData.append("session", session);
      const res = await apiFetch(`/api/intern/attendance/${isIn ? "clock-in" : "clock-out"}`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
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

  // Online, the photo waits for a place name so the stamp never reads "Lat …, Lng …". Offline no name can be
  // looked up, so the entry is allowed with coordinates (and says so).
  const needsPlace = online && !location?.address;
  const canCapture = ready && !!location && !needsPlace;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-white/10">
          <Icon name="x" size={22} />
        </button>
        <p className="text-sm font-semibold">{title}</p>
        <div className="w-9" />
      </div>

      <div className="relative flex-1 overflow-hidden bg-slate-900">
        {preview ? (
          <img src={preview} alt="Captured selfie" className="h-full w-full object-contain" />
        ) : ready ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            <StampOverlay now={now} location={location} pending={online} />
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
        {ready && !!location && needsPlace && !preview && (
          <p className="text-center text-xs text-slate-300" role="status">
            {placeState === "failed" ? (
              <>
                <span className="text-red-400">We couldn&apos;t find your place name. Check your internet connection.</span>{" "}
                <button type="button" onClick={retryPlace} className="font-semibold text-blue-400 hover:underline">
                  Try again
                </button>
              </>
            ) : placeState === "retrying" ? (
              "Still finding your place name…"
            ) : (
              "Finding your place name…"
            )}
          </p>
        )}
        {!online && (
          <p className="text-center text-xs text-amber-300">
            You&apos;re offline — this will be saved on your device and sent automatically once you&apos;re back online.
            {" "}No internet: your place name will not be on the photo.
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
              {saving ? "Saving…" : title}
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

const SINGLE_STEPS = [
  { session: "full", action: "clock_in", label: "Time in" },
  { session: "full", action: "clock_out", label: "Time out" },
];
const SPLIT_STEPS = [
  { session: "am", action: "clock_in", label: "Morning time in" },
  { session: "am", action: "clock_out", label: "Morning time out" },
  { session: "pm", action: "clock_in", label: "Afternoon time in" },
  { session: "pm", action: "clock_out", label: "Afternoon time out" },
];

const BLOCK_TITLES = {
  not_started: "Your internship hasn't started yet",
  finished: "You've completed your internship hours",
  inactive: "Attendance is closed",
};

/** What the today-card should show, combining the server's answer (possibly
 * a cached copy from an earlier day, if offline) with anything still sitting
 * in the offline queue — an offline time in has to move the card on to the
 * next step right away, not after it eventually syncs. The steps are one
 * time in and out, or morning and afternoon, depending on the company. */
function resolveTodayView(today, pending, online) {
  // A cached response whose day is already over says nothing about today.
  const stale = today?.day_ends_at && trustedNow().date.getTime() > Date.parse(today.day_ends_at);
  let steps;
  if (today && !stale && today.steps?.length) {
    steps = today.steps.map((st) => ({ ...st }));
  } else if (today || !online) {
    // Nothing usable loaded (offline, never cached here) — still let them
    // clock in; the server sorts out duplicates when the entry syncs.
    steps = (today?.mode === "split" ? SPLIT_STEPS : SINGLE_STEPS).map((st) => ({ ...st, time: null }));
  } else {
    return null;
  }

  let waitingToSync = false;
  for (const entry of pending) {
    const i = steps.findIndex((st) => !st.time);
    if (i < 0) break;
    steps[i] = { ...steps[i], time: formatPendingTime(entry.anchoredTime ?? entry.deviceTime), pending: true };
    waitingToSync = true;
  }

  const split = steps.length > 2;
  const next = steps.find((st) => !st.time);
  if (next) {
    const i = steps.indexOf(next);
    return {
      steps, split, waitingToSync, action: next.action, session: next.session, label: next.label,
      clockIn: next.action === "clock_out" ? steps[i - 1]?.time : null,
      started: steps.some((st) => st.time),
      // Why clocking in is closed (the internship has not started, or it is finished). Only trusted
      // for today's copy of the answer, and nothing queued on this device is waiting to be sent.
      block: next.action === "clock_in" && !stale && !waitingToSync ? today?.clock_block ?? null : null,
    };
  }
  const rows = (today && !stale ? today.rows : null) ?? [];
  return {
    steps, split, waitingToSync, action: "done",
    clockOut: steps[steps.length - 1]?.time,
    record: !waitingToSync && today && !stale ? today.record : null,
    hours: rows.reduce((sum, r) => sum + (r.hours ?? 0), 0),
  };
}

export default function Attendance() {
  const [today, setToday] = useState(null);
  const [records, setRecords] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalMode, setModalMode] = useState(null); // { mode, session, label } of the punch being captured
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
          {view.split && (
            <ol className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {view.steps.map((st) => (
                <li
                  key={`${st.session}-${st.action}`}
                  className={`rounded-xl border px-3 py-2 ${st.time ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{st.label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">
                    {st.time ?? "—"}
                    {st.pending && <span className="ml-1 text-[10px] font-semibold text-amber-700">· waiting to sync</span>}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {view.action === "clock_in" && view.block && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">{BLOCK_TITLES[view.block.code] ?? "Attendance is closed"}</p>
              <p className="mt-0.5 text-sm text-amber-800">{view.block.message}</p>
            </div>
          )}
          {view.action === "clock_in" && !view.block && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {view.split ? `Next: ${view.label}` : "You haven't clocked in today."}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {view.split ? "Take a selfie and log it when you are ready." : "Log your arrival to start today's attendance."}
                </p>
              </div>
              <button onClick={() => setModalMode({ mode: "clock_in", session: view.session, label: view.label })} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                {view.split ? view.label : "Clock In"}
              </button>
            </div>
          )}
          {view.action === "clock_out" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {view.split ? `Next: ${view.label}` : `Clocked in at ${view.clockIn}`}
                  {!view.split && view.waitingToSync && syncNote}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {view.split ? `Timed in at ${view.clockIn}.` : "Clock out when you're done for the day."}
                </p>
              </div>
              <button onClick={() => setModalMode({ mode: "clock_out", session: view.session, label: view.label })} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                {view.split ? view.label : "Clock Out"}
              </button>
            </div>
          )}
          {view.action === "done" && view.waitingToSync && (
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {view.split ? "Today's attendance is complete" : `Clocked out at ${view.clockOut}`}
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
                  {view.split
                    ? `${view.steps[0].time} to ${view.clockOut} (${Math.round(view.hours * 10) / 10}h)`
                    : `${view.record.clock_in} to ${view.record.clock_out} ${view.record.hours != null ? `(${view.record.hours}h)` : ""}`}
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
          mode={modalMode.mode}
          session={modalMode.session}
          label={modalMode.label}
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
