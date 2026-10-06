/** Tone for a 0-100 evaluation score: 90+ green, 75+ blue, otherwise amber. */
export function scoreTone(pct) {
  if (pct >= 90) return "green";
  if (pct >= 75) return "blue";
  return "amber";
}

/** Simple grade band label for a percentage. */
export function gradeBand(pct) {
  if (pct >= 90) return "Outstanding";
  if (pct >= 75) return "Very satisfactory";
  if (pct >= 60) return "Satisfactory";
  return "Needs improvement";
}
