"use client";

import { useEffect, useRef, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import Icon from "@/components/Icon";

const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

const LIVE_TYPES = ["attendance_reviewed"];

function mapsLink(loc) {
  return loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
}

function formatStampDate(d) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}
function formatStampTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatStampLocation(location) {
  return location ? `Lat ${location.lat.toFixed(5)}, Lng ${location.lng.toFixed(5)}` : "Locating…";
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

function CameraCapture({ location, onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [supported] = useState(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState(supported ? "" : "This browser doesn't support camera access.");
  const [preview, setPreview] = useState(null);
  const [now, setNow] = useState(() => new Date());

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function startCamera() {
    if (!supported) return;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch(() => setCamError("Camera access was denied — allow it to take a selfie."));
  }

  useEffect(() => {
    startCamera();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  function drawStamp(ctx, canvas, stampAt) {
    const padding = Math.round(canvas.width * 0.035);
    const barHeight = Math.round(canvas.height * 0.2);
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
    drawStamp(ctx, canvas, new Date());
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        setReady(false);
        setPreview(URL.createObjectURL(blob));
        onCaptured(blob);
      },
      "image/jpeg",
      0.92
    );
  }

  function retake() {
    setPreview(null);
    onCaptured(null);
    startCamera();
  }

  const canCapture = ready && !!location;

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Selfie</span>
      <div className="relative mb-2 flex h-52 w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-900">
        {preview ? (
          <img src={preview} alt="Captured selfie" className="h-full w-full object-contain" />
        ) : ready ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-contain" />
            <StampOverlay now={now} location={location} />
          </>
        ) : (
          <p className="px-4 text-center text-sm text-slate-300">{camError || "Starting camera…"}</p>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>
      {camError && !ready && !preview && (
        <button type="button" onClick={startCamera} className="mb-2 text-xs font-semibold text-blue-600 hover:underline">
          Try again
        </button>
      )}
      {ready && !location && !preview && <p className="mb-2 text-center text-xs text-slate-400">Waiting for your location to stamp the photo…</p>}
      <div className="flex justify-center">
        {preview ? (
          <button type="button" onClick={retake} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Retake
          </button>
        ) : (
          ready && (
            <button
              type="button"
              onClick={capture}
              disabled={!canCapture}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Capture
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ClockModal({ mode, onClose, onDone }) {
  const isIn = mode === "clock_in";
  const [supported] = useState(() => typeof navigator !== "undefined" && !!navigator.geolocation);
  const [selfie, setSelfie] = useState(null);
  const [location, setLocation] = useState(null);
  const [locError, setLocError] = useState(supported ? "" : "This browser doesn't support location access.");
  const [locating, setLocating] = useState(supported);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function requestLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocError(err.code === err.PERMISSION_DENIED ? "Location access was denied — allow it to continue." : "Couldn't get your location. Try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  useEffect(() => {
    if (supported) requestLocation();
  }, [supported]);

  function retryLocation() {
    setLocating(true);
    setLocError("");
    requestLocation();
  }

  async function handleSubmit() {
    if (!selfie || !location) return;
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("selfie", selfie, "selfie.jpg");
      formData.append("latitude", String(location.lat));
      formData.append("longitude", String(location.lng));
      const res = await apiFetch(`/api/intern/attendance/${isIn ? "clock-in" : "clock-out"}`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save this.");
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">{isIn ? "Clock In" : "Clock Out"}</h3>
        <p className="mt-1 text-sm text-slate-500">Take a selfie and share your location — this is how your supervisor verifies it&apos;s really you.</p>

        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Location</p>
            {locating ? (
              <p className="text-sm text-slate-500">Getting your location…</p>
            ) : location ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                <Icon name="check" size={14} /> Location captured
              </p>
            ) : (
              <div>
                <p className="text-sm text-red-600">{locError}</p>
                <button type="button" onClick={retryLocation} className="mt-1.5 text-xs font-semibold text-blue-600 hover:underline">
                  Try again
                </button>
              </div>
            )}
          </div>

          <CameraCapture location={location} onCaptured={setSelfie} />

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!selfie || !location || saving}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : isIn ? "Clock In" : "Clock Out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Attendance() {
  const [today, setToday] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalMode, setModalMode] = useState(null);

  function load() {
    Promise.all([fetchInternData("attendance/today"), fetchInternData("attendance")])
      .then(([t, r]) => {
        setToday(t);
        setRecords(r.records ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useLiveRefresh(LIVE_TYPES, load);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Attendance</h2>
        <p className="mt-1 text-sm text-slate-600">Clock in and out with a selfie and your location — your supervisor reviews each entry.</p>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {!loading && today && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {today.next_action === "clock_in" && (
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
          {today.next_action === "clock_out" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Clocked in at {today.record.clock_in}</p>
                <p className="mt-0.5 text-sm text-slate-500">Clock out when you&apos;re done for the day.</p>
              </div>
              <button onClick={() => setModalMode("clock_out")} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Clock Out
              </button>
            </div>
          )}
          {today.next_action === null && today.record && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Today&apos;s attendance complete</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {today.record.clock_in} to {today.record.clock_out} {today.record.hours != null && `(${today.record.hours}h)`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[today.record.status] ?? "bg-slate-100 text-slate-700"}`}>
                {today.record.status}
              </span>
            </div>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <h3 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h3>
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading attendance…</p>
        ) : records.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No attendance records yet.</p>
        ) : (
          records.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {r.clock_in_selfie_url && <img src={r.clock_in_selfie_url} alt="Clock in selfie" className="h-10 w-10 rounded-full border-2 border-white object-cover" />}
                  {r.clock_out_selfie_url && <img src={r.clock_out_selfie_url} alt="Clock out selfie" className="h-10 w-10 rounded-full border-2 border-white object-cover" />}
                </div>
                <div>
                  <p className="text-sm text-slate-700">
                    {r.attendance_date} · {r.clock_in ?? "—"} to {r.clock_out ?? "—"} {r.hours != null && `(${r.hours}h)`}
                  </p>
                  <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
                    {r.clock_in_location && (
                      <a href={mapsLink(r.clock_in_location)} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                        In location ↗
                      </a>
                    )}
                    {r.clock_out_location && (
                      <a href={mapsLink(r.clock_out_location)} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                        Out location ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-700"}`}>{r.status}</span>
            </div>
          ))
        )}
      </section>

      {modalMode && (
        <ClockModal
          mode={modalMode}
          onClose={() => setModalMode(null)}
          onDone={() => {
            setModalMode(null);
            load();
          }}
        />
      )}
    </div>
  );
}
