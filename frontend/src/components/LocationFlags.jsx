// What the server worked out about where an attendance entry was captured: how far from the company, and
// any reason the location looks unreliable. A reviewer reads this next to the "In location" link.
const FLAGS = {
  location_tampering: { label: "Location functions altered", tone: "bg-red-100 text-red-700", hint: "The browser's location functions had been replaced by a script or extension, which is how location is faked." },
  impossible_travel: { label: "Impossible travel", tone: "bg-red-100 text-red-700", hint: "This location is too far from the previous punch for the time between them." },
  repeated_coordinates: { label: "Same coordinates again", tone: "bg-amber-100 text-amber-800", hint: "The last punches were at the exact same coordinates. A real phone's GPS drifts by a few metres each time." },
  perfect_accuracy: { label: "Unusual GPS reading", tone: "bg-amber-100 text-amber-800", hint: "The phone reported a perfect 1 m accuracy, which fake-location apps often do." },
  weak_signal: { label: "Weak GPS signal", tone: "bg-slate-100 text-slate-600", hint: "The location was very imprecise." },
  old_fix: { label: "Old location", tone: "bg-slate-100 text-slate-600", hint: "The location was not fresh when the photo was taken." },
  outside_area: { label: "Outside the company area", tone: "bg-red-100 text-red-700", hint: "The punch was further from the company's map location than the radius its supervisors set (allowing for GPS error). It was saved, not blocked: please check the photo." },
};

export default function LocationFlags({ record, className = "" }) {
  // The red flag badge above the record already says "outside the company area (350 m away)", so the chip
  // below only appears where that badge is not shown.
  const flags = (record.location_flags ?? []).filter((f) => FLAGS[f] && !(f === "outside_area" && record.red_flag_text));
  const far = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  const distances = [
    record.clock_in_distance_m != null && `in ${far(record.clock_in_distance_m)}`,
    record.clock_out_distance_m != null && `out ${far(record.clock_out_distance_m)}`,
  ].filter(Boolean);
  if (flags.length === 0 && distances.length === 0) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {distances.length > 0 && (
        <span className="text-xs text-slate-500" title="Distance from the company's map location">
          {distances.join(" · ")} from company
        </span>
      )}
      {flags.map((f) => (
        <span key={f} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${FLAGS[f].tone}`} title={FLAGS[f].hint}>
          {f === "outside_area" && record.outside_area_label ? record.outside_area_label : FLAGS[f].label}
        </span>
      ))}
    </span>
  );
}
