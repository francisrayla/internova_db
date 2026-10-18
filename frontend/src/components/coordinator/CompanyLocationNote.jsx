import NavIcon from "@/components/NavIcon";

/** What the coordinator sees about a company's attendance location. Read-only: only the company's
 * supervisors can set it (Settings > Company location), so there is no edit button here. */
export function locationSummary(c) {
  if (!c?.location_set) return "Location not set yet — the company's supervisor sets it in Settings → Company location.";
  const by = c.location_set_by ? ` by ${c.location_set_by}` : "";
  const when = c.location_set_date ? ` · ${c.location_set_date}` : "";
  return `Location set${by}${when} · radius ${c.allowed_radius_meters} m`;
}

/** One quiet line for a list row. */
export function CompanyLocationLine({ company }) {
  const set = company?.location_set;
  return (
    <span className={`flex min-w-0 items-start gap-1.5 ${set ? "" : "text-amber-700"}`}>
      <NavIcon name="location" size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{locationSummary(company)}</span>
    </span>
  );
}

/** The detail-page version, with a link to see the pin on OpenStreetMap. */
export default function CompanyLocationNote({ company }) {
  const set = company?.location_set;
  const mapUrl = set ? `https://www.openstreetmap.org/?mlat=${company.latitude}&mlon=${company.longitude}#map=18/${company.latitude}/${company.longitude}` : null;
  return (
    <div className={`k-note ${set ? "is-ok" : "is-warn"}`}>
      <span className="inline-flex min-w-0 items-start gap-2">
        <NavIcon name="location" size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          {locationSummary(company)}
          {set && <span className="block text-xs opacity-80">Interns who clock in outside this circle are flagged for the supervisor to review, not blocked.</span>}
        </span>
      </span>
      {mapUrl && (
        <a href={mapUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4 max-sm:flex max-sm:min-h-[44px] max-sm:items-center">
          View on map
        </a>
      )}
    </div>
  );
}
