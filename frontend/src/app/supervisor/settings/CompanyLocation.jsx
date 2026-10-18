"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import NavIcon from "@/components/NavIcon";
import LocationMap from "@/components/LocationMap";
import { Banner } from "@/components/ui";
import { Btn, Page, PageHeader, Section } from "@/components/dash/page";

const DEFAULT_LIMITS = { default_radius: 200, min_radius: 50, max_radius: 1000, max_accuracy: 100 };
// Stop refining the GPS reading once it is this good, or after this long.
const GOOD_ENOUGH_M = 20;
const WATCH_MS = 15000;

function gpsErrorMessage(err) {
  if (!err) return "";
  if (err.code === 1) return "Location is turned off for this site. Allow location in your browser settings (the lock icon next to the address), then try again.";
  if (err.code === 2) return "Your device could not find its location. Turn on GPS or location services and try again, ideally near a window or outside.";
  if (err.code === 3) return "Finding your location took too long. Step outside or near a window and try again.";
  return "Could not read your location. Please try again.";
}

const same = (a, b) => a != null && b != null && Math.abs(a - b) < 0.0000005;

export default function CompanyLocation() {
  const [company, setCompany] = useState(null);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [saved, setSaved] = useState(null); // the server's location payload
  const [pin, setPin] = useState(null); // { lat, lng }
  const [accuracy, setAccuracy] = useState(null); // metres, only while the pin is a GPS reading
  const [radius, setRadius] = useState(DEFAULT_LIMITS.default_radius);
  const [focusKey, setFocusKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [gps, setGps] = useState("idle"); // idle | locating | done
  const [gpsError, setGpsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const watchRef = useRef(null);
  const timerRef = useRef(null);

  const stopWatching = useCallback(() => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation?.clearWatch(watchRef.current);
    watchRef.current = null;
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    let live = true;
    fetchSupervisorData("company-location")
      .then((r) => {
        if (!live) return;
        setCompany(r.company);
        if (r.limits) setLimits(r.limits);
        const loc = r.location;
        setSaved(loc);
        if (loc?.location_set) {
          setPin({ lat: loc.latitude, lng: loc.longitude });
          setRadius(loc.allowed_radius_meters ?? r.limits?.default_radius ?? DEFAULT_LIMITS.default_radius);
        } else {
          setRadius(r.limits?.default_radius ?? DEFAULT_LIMITS.default_radius);
        }
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      stopWatching();
    };
  }, [stopWatching]);

  function locateMe() {
    setError("");
    setNotice("");
    setGpsError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("This browser cannot share its location. Open this page on your phone, or tap the map to place the pin yourself.");
      return;
    }
    stopWatching();
    setGps("locating");
    let best = null;
    const finish = () => {
      stopWatching();
      setGps(best ? "done" : "idle");
    };
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        // Keep the most precise reading seen while the GPS warms up.
        if (best && p.coords.accuracy >= best.accuracy) return;
        best = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        setPin({ lat: best.lat, lng: best.lng });
        setAccuracy(Math.round(best.accuracy));
        setFocusKey((k) => k + 1);
        if (best.accuracy <= GOOD_ENOUGH_M) finish();
      },
      (err) => {
        stopWatching();
        if (best) {
          setGps("done");
          return;
        }
        setGps("idle");
        setGpsError(gpsErrorMessage(err));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: WATCH_MS }
    );
    timerRef.current = setTimeout(finish, WATCH_MS);
  }

  // The pin was dragged or the map was tapped: this is now a hand-placed point, not a GPS reading.
  function movePin(lat, lng) {
    stopWatching();
    setGps("idle");
    setPin({ lat, lng });
    setAccuracy(null);
    setNotice("");
  }

  const savedLoc = saved?.location_set ? saved : null;
  const roughGps = accuracy != null && accuracy > limits.max_accuracy;
  const pinMoved = pin && savedLoc && (!same(pin.lat, savedLoc.latitude) || !same(pin.lng, savedLoc.longitude));
  const changed = pin && (!savedLoc || pinMoved || radius !== savedLoc.allowed_radius_meters);
  // Said next to the button, so a disabled Save never leaves the supervisor guessing.
  const saveHint = gps === "locating"
    ? "Wait until your location is found."
    : roughGps
      ? `Can't save a reading this rough (±${accuracy} m). Drag the pin to the exact building${savedLoc ? ", or go back to the saved pin" : ""}.`
      : "";

  // Undo a GPS reading or a drag, e.g. to change only the radius.
  function backToSavedPin() {
    stopWatching();
    setGps("idle");
    setPin({ lat: savedLoc.latitude, lng: savedLoc.longitude });
    setAccuracy(null);
    setFocusKey((k) => k + 1);
    setNotice("");
  }

  async function save() {
    if (!pin) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/api/supervisor/company-location", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: pin.lat, longitude: pin.lng, allowed_radius_meters: radius, ...(accuracy != null ? { accuracy_m: accuracy } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const first = data.errors ? Object.values(data.errors).flat()[0] : null;
        throw new Error(data.message || first || "Could not save the location. Please try again.");
      }
      setSaved(data.location);
      setPin({ lat: data.location.latitude, lng: data.location.longitude });
      setAccuracy(null);
      setNotice("Company location saved. Your company's other supervisors and the coordinator were told.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const companyName = company?.name;

  return (
    <Page>
      <PageHeader
        title="Company location"
        sentence={<>Set where {companyName ? <strong className="font-semibold text-slate-800">{companyName}</strong> : "your company"} is, so interns who clock in far from it are flagged for your review.</>}
      />

      {error && <Banner tone="red">{error}</Banner>}
      {notice && <Banner tone="green">{notice}</Banner>}

      {loading ? (
        <p className="dash-card text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <Section title="Pin the company on the map" help="Stand inside your company, then tap the button. After that you can drag the pin to the exact building.">
            <div className="space-y-4">
              <Btn variant="primary" onClick={locateMe} disabled={gps === "locating"} className="max-sm:w-full max-sm:min-h-[48px]">
                <NavIcon name="location" size={18} />
                {gps === "locating" ? "Finding your location…" : "Use my current location"}
              </Btn>

              {gps === "locating" && accuracy == null && (
                <p className="text-sm text-slate-600" role="status">Waiting for your device&apos;s GPS. This can take a few seconds.</p>
              )}
              {accuracy != null && (
                <p className="text-sm text-slate-700" role="status">
                  GPS accuracy <strong className="font-semibold text-slate-900">±{accuracy} m</strong>
                  {gps === "locating" ? " — still improving…" : ""}
                </p>
              )}
              {roughGps && gps !== "locating" && (
                <p className="k-note is-warn" role="alert">
                  <span className="min-w-0">
                    Your location reading is too rough (±{accuracy} m) to save. A laptop finds its place from Wi-Fi, which is often hundreds of metres off: use your phone while you are at the company, step outside and tap the button again, or drag the pin to the exact building.
                  </span>
                </p>
              )}
              {gpsError && <p className="k-note is-risk" role="alert"><span className="min-w-0">{gpsError}</span></p>}

              <div className="relative">
                <LocationMap pin={pin} radius={radius} accuracy={accuracy} focusKey={focusKey} onPinChange={movePin} />
                {!pin && (
                  <div className="loc-map-empty">
                    <span>No location yet. Tap “Use my current location”, or tap the map to place the pin.</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  {pin ? "Drag the pin, or tap the map, to move it. " : ""}Map data © OpenStreetMap contributors.
                </p>
                {pinMoved && (
                  <Btn sm onClick={backToSavedPin} className="max-sm:min-h-[44px]">Back to the saved pin</Btn>
                )}
              </div>
            </div>
          </Section>

          <Section title="How far can interns be?" help="Interns who clock in or out outside this circle are flagged for your review. They are not blocked.">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="radius" className="text-sm font-medium text-slate-800">Allowed distance from the pin</label>
                <output htmlFor="radius" className="text-lg font-semibold text-slate-900">{radius} m</output>
              </div>
              <input
                id="radius"
                type="range"
                min={limits.min_radius}
                max={limits.max_radius}
                step={10}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="block h-11 w-full cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>{limits.min_radius} m</span>
                <span>{limits.max_radius} m</span>
              </div>
              <p className="dash-note">
                Indoor GPS is often 50–100 m off, so each phone&apos;s own GPS error is allowed for (up to 100 m) before anyone is flagged. A flagged clock-in is still saved: you will see a red flag with the distance on the Attendance page.
              </p>
            </div>
          </Section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-slate-600">
              {savedLoc ? (
                <>
                  Last set{savedLoc.location_set_by ? <> by <strong className="font-semibold text-slate-800">{savedLoc.location_set_by}</strong></> : ""}
                  {savedLoc.location_set_at_label ? <> on {savedLoc.location_set_at_label}</> : ""} · radius {savedLoc.allowed_radius_meters} m
                </>
              ) : (
                "Not set yet. Until you save a location, nobody is flagged for clocking in away from the company."
              )}
            </p>
            <Btn variant="primary" onClick={save} disabled={!changed || saving || roughGps || gps === "locating"} className="max-sm:w-full">
              {saving ? "Saving…" : savedLoc ? "Save changes" : "Save location"}
            </Btn>
          </div>
          {saveHint && <p className="k-note is-warn" role="status"><span className="min-w-0">{saveHint}</span></p>}
        </>
      )}
    </Page>
  );
}
