// Shared by the single "Add intern" form and the Excel import, so both offer
// the same programs, year levels and required hours.

// The programs this school actually offers — kept as a fixed list (with an
// "Other" escape hatch) instead of free text so course names stay consistent
// across every intern record instead of drifting into typos/variants.
export const COURSE_OPTIONS = ["BSIT", "BSTM", "BSBA", "BSHM", "BSAIS", "BTELED", "BSCRIM"];

// OJT only ever places graduating students — 4th year for most programs, 5th
// for the handful of 5-year tracks — so only those two are offered, with the
// far more common 4th Year as the default.
export const YEAR_LEVEL_OPTIONS = ["4th Year", "5th Year"];

// Required OJT hours by program — display-only copy of the backend's
// CoordinatorMonitoringController::COURSE_HOURS, which is what's enforced.
// BSCRIM follows a shorter practicum; every other program (including
// "Other") runs the default until the school confirms its own figures.
const HOURS_BY_COURSE = { BSIT: 500, BSCRIM: 250 };
const DEFAULT_COURSE_HOURS = 500;

export function hoursForCourse(course) {
  return HOURS_BY_COURSE[course] ?? DEFAULT_COURSE_HOURS;
}

/** "bs it", "B.S.I.T." and "Bsit" all become "BSIT"; anything that isn't a
 *  listed program is kept as typed (tidied), like the form's "Other". */
export function normalizeCourse(value) {
  const tidy = String(value ?? "").replace(/\s+/g, " ").trim();
  const compact = tidy.toUpperCase().replace(/[\s.]/g, "");
  return COURSE_OPTIONS.includes(compact) ? compact : tidy;
}

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
