// Corrects a number input's value to sit within [min, max] once the user
// leaves the field — not on every keystroke. Live per-keystroke clamping
// breaks typing decimals (typing "0.1" passes through "0", which if min is
// 0.1 would get snapped up mid-type, making it impossible to finish typing).
// `min`/`max` HTML attributes alone don't stop out-of-range values while
// typing or via the scroll-wheel, so this closes that gap on blur instead.
export function clampOnBlur(rawValue, min, max) {
  if (rawValue === "" || rawValue === null || rawValue === undefined) return rawValue;
  const n = Number(rawValue);
  if (Number.isNaN(n)) return rawValue;
  if (min != null && n < min) return String(min);
  if (max != null && n > max) return String(max);
  return rawValue;
}
