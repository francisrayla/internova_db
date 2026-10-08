// How far from today an internship start date may be. Mirrors InternshipDeployment::START_DAYS_BACK and
// START_DAYS_AHEAD on the backend, which is what actually enforces it; this only guides the date picker.
export const START_DAYS_BACK = 60;
export const START_DAYS_AHEAD = 90;
export const START_DATE_HINT = "Up to 60 days back and 3 months ahead. An intern cannot clock in or be given tasks before this date.";

function ymd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** { min, max } as YYYY-MM-DD for an <input type="date">. */
export function startDateBounds(now = new Date()) {
  const min = new Date(now);
  min.setDate(min.getDate() - START_DAYS_BACK);
  const max = new Date(now);
  max.setDate(max.getDate() + START_DAYS_AHEAD);
  return { min: ymd(min), max: ymd(max) };
}
