"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "./LocationMap.css";

// Philippines overview, shown until a pin exists.
const DEFAULT_VIEW = { lat: 12.8797, lng: 121.774, zoom: 5 };

// A map pin drawn in the app's blue (Lucide "map-pin" shape). A divIcon avoids Leaflet's default marker
// images, which a bundler cannot find.
const PIN_HTML =
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 24 24" fill="#1a5fd6" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>' +
  '<circle cx="12" cy="10" r="3" fill="#ffffff" stroke="none"/></svg>';

/**
 * Client-only OpenStreetMap (Leaflet) with one draggable pin, the allowed-radius circle and, optionally, the
 * GPS accuracy circle. Leaflet touches `window` as soon as it loads, so it is imported inside an effect.
 * No API key: tiles come from tile.openstreetmap.org and the attribution below is required by their policy.
 *
 * pin: {lat, lng} | null.  focusKey: change it to re-centre the map on the pin (a new GPS fix).
 * onPinChange(lat, lng) fires when the pin is dragged or the map is tapped.
 */
export default function LocationMap({ pin, radius, accuracy, focusKey, onPinChange, label = "Company location map" }) {
  const hostRef = useRef(null);
  const ctxRef = useRef(null); // { L, map, marker, circle, accuracyCircle }
  const readyRef = useRef(null); // promise of ctxRef.current
  const changeRef = useRef(onPinChange);
  const lastFocus = useRef(undefined);

  useEffect(() => {
    changeRef.current = onPinChange;
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map = null;
    readyRef.current = import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      if (cancelled || !hostRef.current) return null;
      map = L.map(hostRef.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      map.on("click", (e) => changeRef.current?.(e.latlng.lat, e.latlng.lng));
      ctxRef.current = { L, map, marker: null, circle: null, accuracyCircle: null };
      return ctxRef.current;
    });
    return () => {
      cancelled = true;
      ctxRef.current = null;
      if (map) map.remove();
    };
  }, []);

  // Keep the pin, the circles and the view in step with the props.
  const lat = pin?.lat ?? null;
  const lng = pin?.lng ?? null;
  useEffect(() => {
    readyRef.current?.then((ctx) => {
      if (!ctx || ctx !== ctxRef.current) return;
      const { L, map } = ctx;
      if (lat == null || lng == null) {
        ctx.marker?.remove();
        ctx.circle?.remove();
        ctx.accuracyCircle?.remove();
        ctx.marker = ctx.circle = ctx.accuracyCircle = null;
        return;
      }
      const at = [lat, lng];
      if (!ctx.marker) {
        ctx.marker = L.marker(at, {
          draggable: true,
          title: "Company location (drag to move)",
          alt: "Company location pin",
          icon: L.divIcon({ className: "company-pin", html: PIN_HTML, iconSize: [36, 44], iconAnchor: [18, 42] }),
        }).addTo(map);
        ctx.marker.on("dragend", () => {
          const p = ctx.marker.getLatLng();
          changeRef.current?.(p.lat, p.lng);
        });
        ctx.circle = L.circle(at, { radius, color: "#1a5fd6", weight: 2, fillColor: "#1a5fd6", fillOpacity: 0.12 }).addTo(map);
      } else {
        ctx.marker.setLatLng(at);
        ctx.circle.setLatLng(at).setRadius(radius);
      }

      if (accuracy != null && accuracy > 0) {
        if (!ctx.accuracyCircle) ctx.accuracyCircle = L.circle(at, { radius: accuracy, color: "#5f6e6b", weight: 1, dashArray: "4 4", fillOpacity: 0.05, interactive: false }).addTo(map);
        else ctx.accuracyCircle.setLatLng(at).setRadius(accuracy);
      } else if (ctx.accuracyCircle) {
        ctx.accuracyCircle.remove();
        ctx.accuracyCircle = null;
      }

      // Re-centre on the first pin and on every new GPS fix, not while the pin is being dragged.
      if (lastFocus.current !== focusKey) {
        lastFocus.current = focusKey;
        map.fitBounds(ctx.circle.getBounds(), { padding: [24, 24], maxZoom: 18 });
      }
    });
  }, [lat, lng, radius, accuracy, focusKey]);

  return <div ref={hostRef} className="loc-map" role="application" aria-label={label} />;
}
