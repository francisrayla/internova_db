// What each kind of field accepts, in one place, so a "First name" box in
// the intern modal and one in Edit Profile can't drift apart. Every length
// here is at or under the matching backend `max:` rule — the server stays
// the real gate; this just stops people typing what it would reject.
//
// Usage:
//   <input {...inputProps("title")} value={v} onChange={(e) => set(clean("title", e.target.value))} />
// Length-only rules work with maxLength alone; rules with a filter also need
// clean() in onChange, since maxLength can't stop letters in a phone field.

const NAME_CHARS = /[^\p{L}\p{M}\s.'-]/gu;

function collapseSpaces(value) {
  return value.replace(/\s{2,}/g, " ").replace(/^\s+/, "");
}

export const INPUT_RULES = {
  // People
  personName: { maxLength: 50, autoComplete: "off", filter: (v) => collapseSpaces(v.replace(NAME_CHARS, "")) },
  fullName: { maxLength: 100, filter: (v) => collapseSpaces(v.replace(NAME_CHARS, "")) },
  position: { maxLength: 100 },

  // Contact
  email: { maxLength: 100, inputMode: "email", autoComplete: "email", spellCheck: false, filter: (v) => v.replace(/\s/g, "") },
  // PH numbers are 11 digits (09XXXXXXXXX), same rule as registration.
  phone: { maxLength: 11, inputMode: "numeric", autoComplete: "tel", filter: (v) => v.replace(/\D/g, "") },
  url: { maxLength: 255, inputMode: "url", spellCheck: false, filter: (v) => v.replace(/\s/g, "") },

  // Accounts
  password: { maxLength: 72 }, // bcrypt ignores anything past 72 bytes
  studentNumber: { maxLength: 20, autoComplete: "off", spellCheck: false, filter: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, "") },

  // Organizations
  orgName: { maxLength: 150 },
  address: { maxLength: 255 },

  // Content
  title: { maxLength: 150 },
  subject: { maxLength: 150 },
  shortText: { maxLength: 100 },
  note: { maxLength: 500 },
  comment: { maxLength: 1000 },
  longText: { maxLength: 2000 },
  message: { maxLength: 2000 },
  search: { maxLength: 100 },
  settingValue: { maxLength: 255 },
};

/** Attributes to spread onto the <input>/<textarea>. maxLength is left off
 *  when the rule filters, because the browser would truncate a raw paste
 *  ("+63 917 123 4567") before the filter could strip it down to digits. */
export function inputProps(ruleName) {
  const rule = INPUT_RULES[ruleName];
  if (!rule) return {};
  const { filter, maxLength, ...attrs } = rule;
  return filter ? attrs : { ...attrs, maxLength };
}

/** Applies the rule's filter and length cap to a typed or pasted value. */
export function clean(ruleName, value) {
  const rule = INPUT_RULES[ruleName];
  if (!rule || typeof value !== "string") return value;
  const filtered = rule.filter ? rule.filter(value) : value;
  return filtered.slice(0, rule.maxLength);
}

/** Keeps a number field within [min, max] and to `decimals` places while
 *  typing — browsers let type="number" take any length and any value. */
export function cleanNumber(value, { max, decimals = 0, maxDigits = 7 } = {}) {
  if (value === "" || value == null) return "";
  let v = String(value).replace(decimals > 0 ? /[^\d.]/g : /\D/g, "");
  if (decimals > 0) {
    const dot = v.indexOf(".");
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "").slice(0, decimals);
  }
  const [whole, frac] = v.split(".");
  v = whole.slice(0, maxDigits) + (frac !== undefined ? `.${frac}` : "");
  if (max != null && v !== "" && v !== "." && Number(v) > max) return String(max);
  return v;
}
