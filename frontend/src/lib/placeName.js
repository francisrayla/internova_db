// Turns the answer of a reverse geocoder into the place line stamped on an attendance selfie:
// "<barangay or locality>, <municipality or city>, <province>" (Metro Manila for the capital region).
// Pure functions only (no fetch, no React) so they can be checked against recorded provider JSON.
//
// Each provider function returns { locality, municipality, province } (any can be null) or null when the
// provider knows nothing. Exactly ONE municipality is ever produced: it is read from the field that names the
// area containing the point, never from a "nearest city" field, so two different towns cannot end up in one line.

const MAX_LENGTH = 60;

/** A name or null. */
function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** First usable value of the given names. */
function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

/** Comparison key so "Makati" and "Makati City" count as the same place. */
function nameKey(text) {
  return text
    .toLowerCase()
    .replace(/^city of\s+/, "")
    .replace(/\s+city$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Wikidata and OpenStreetMap disagree on word order for a few provinces; people say "Oriental Mindoro". */
const PROVINCE_ALIASES = {
  "mindoro oriental": "Oriental Mindoro",
  "mindoro occidental": "Occidental Mindoro",
  "national capital region": "Metro Manila",
  "metropolitan manila": "Metro Manila",
  ncr: "Metro Manila",
};

function provinceName(text) {
  const name = clean(text);
  if (!name) return null;
  return PROVINCE_ALIASES[name.toLowerCase()] ?? name;
}

/** "Barangay, Municipality, Province" with repeats removed. When it is too long for the photo, the barangay is
 * dropped first (the municipality and province matter most), and only then is the text cut. */
export function joinPlaceParts(parts, max = MAX_LENGTH) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const text = clean(part);
    if (text && !seen.has(nameKey(text))) {
      seen.add(nameKey(text));
      out.push(text);
    }
  }
  if (!out.length) return null;
  const full = out.join(", ");
  if (full.length <= max) return full;
  if (out.length > 2) {
    const short = out.slice(1).join(", ");
    if (short.length <= max) return short;
  }
  return truncate(full, max);
}

/** The line for a { locality, municipality, province } place. */
export function formatPlace(place) {
  if (!place) return null;
  return joinPlaceParts([place.locality, place.municipality, place.province ?? place.region]);
}

/** Nominatim `reverse?format=jsonv2&addressdetails=1` JSON. In the Philippines `state` is the PROVINCE and
 * `region` the region (Mimaropa); Metro Manila has no state, only `region: "Metro Manila"`. */
export function nominatimPlace(data) {
  const a = data?.address;
  if (!a) {
    const display = clean(data?.display_name);
    return display ? { locality: null, municipality: null, province: null, raw: truncate(display, MAX_LENGTH) } : null;
  }
  // Barangays are mapped as suburb/village/quarter in the Philippines; the road is only a last resort.
  const locality = first(a.suburb, a.village, a.quarter, a.neighbourhood, a.hamlet, a.city_district, a.road);
  const municipality = first(a.city, a.town, a.municipality);
  const province = provinceName(first(a.province, a.state, a.county));
  // The region (Mimaropa) is shown only when no province is known; Metro Manila has no province, its region reads fine.
  const region = clean(a.region);
  const place = { locality, municipality, province: province ?? (region === "Metro Manila" ? region : null), region };
  if (!place.locality && !place.municipality && !place.province && !place.region) {
    const display = clean(data.display_name);
    return display ? { ...place, raw: truncate(display, MAX_LENGTH) } : null;
  }
  return place;
}

const MUNICIPALITY_TEXT = /^(?:highly urbanized |independent component |component )?(?:city|municipality)\b/i;

/** BigDataCloud `reverse-geocode-client` JSON, used only when OpenStreetMap cannot name the town. Its `city` is the
 * nearest populated place (it can be the next town over, which is how "Pinamalayan, Socorro" was produced), and its
 * municipality boundaries are coarse near town borders (a point in Marayos, Pinamalayan was listed under Socorro),
 * so the town is read from `locality` first, which named Pinamalayan correctly there. */
export function bigDataCloudPlace(data) {
  if (!data) return null;
  const admin = Array.isArray(data.localityInfo?.administrative) ? data.localityInfo.administrative : [];
  const informative = Array.isArray(data.localityInfo?.informative) ? data.localityInfo.informative : [];
  const isPH = data.countryCode === "PH";

  if (!isPH) {
    const place = { locality: null, municipality: first(data.locality, data.city), province: provinceName(data.principalSubdivision) };
    return place.municipality || place.province ? place : null;
  }

  const level = (n) => admin.find((entry) => entry?.adminLevel === n && clean(entry.name));
  const municipalityEntry =
    level(6) ??
    informative.find((entry) => clean(entry?.name) && MUNICIPALITY_TEXT.test(clean(entry.description) ?? "") && /Philippines/i.test(entry.description));
  const municipality = first(data.locality, municipalityEntry?.name);
  const province = provinceName(first(level(4)?.name, data.principalSubdivision));
  const place = { locality: null, municipality, province: level(4) || province === "Metro Manila" ? province : null, region: province };
  return place.municipality || place.province || place.region ? place : null;
}

/** Fills the gaps of `main` from `other` (municipality, province, locality). Both come from the same point, and a
 * place never gets a second municipality: a municipality is only taken when `main` has none. */
export function mergePlaces(main, other) {
  if (!main) return other ?? null;
  if (!other) return main;
  return {
    locality: main.locality ?? other.locality ?? null,
    municipality: main.municipality ?? other.municipality ?? null,
    province: main.province ?? other.province ?? null,
    region: main.region ?? other.region ?? null,
    raw: main.raw ?? other.raw,
  };
}

/** True when the place already reads "<something>, <municipality>, <province>" (nothing to wait for). */
export function isCompletePlace(place) {
  return !!(place && place.municipality && place.province);
}

/** The string for a place (the raw display name only when nothing structured was found). */
export function placeLine(place) {
  if (!place) return null;
  return formatPlace(place) ?? place.raw ?? null;
}
