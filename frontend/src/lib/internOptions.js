// Shared by the single "Add intern" form and the Excel import, so both offer the same year levels.
// Courses are NOT here any more: each school picks the courses it offers (Settings -> Courses offered) and the
// catalog lives on the server — see lib/schoolCourses.js.

// OJT only ever places graduating students — 4th year for most programs, 5th
// for the handful of 5-year tracks — so only those two are offered, with the
// far more common 4th Year as the default.
export const YEAR_LEVEL_OPTIONS = ["4th Year", "5th Year"];

/** Accepts the ways a year level tends to be written in a masterlist —
 *  "4", "4th", "IV", "Fourth Year", "4th yr" — and returns the canonical
 *  label, or the original text when it isn't a 4th/5th year at all. */
export function normalizeYearLevel(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return "4th Year";
  const v = raw.toLowerCase().replace(/[\s.-]/g, "");
  if (/^(4|4th|iv|fourth)(year|yr)?$/.test(v)) return "4th Year";
  if (/^(5|5th|v|fifth)(year|yr)?$/.test(v)) return "5th Year";
  return raw;
}
