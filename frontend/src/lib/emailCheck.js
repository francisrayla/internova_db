// Live "is this email finished?" check for forms where someone types an
// address for another person. It mirrors the server rule (App\Rules\CompleteEmail
// + EmailDeliverability::KNOWN_TYPOS), which stays the real gate: this only
// gives the message early, before the request is sent.

// Keep in sync with EmailDeliverability::KNOWN_TYPOS.
const KNOWN_TYPOS = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "gmal.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.comm": "gmail.com", gmailcom: "gmail.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com",
};

const INCOMPLETE = "Incomplete email: add the part after the dot, like .com";
const LOCAL_CHARS = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Lowercase and drop spaces, the same cleaning the server does before saving. */
export function normalizeEmail(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

/** A short message about this address, or "" when it looks finished (or is empty). */
export function emailProblem(value) {
  const email = normalizeEmail(value);
  if (!email) return "";
  if (email.length > 254) return "This email address is too long.";

  const parts = email.split("@");
  if (parts.length !== 2) return "Enter a valid email with a single @, like name@gmail.com.";
  const [local, domain] = parts;

  if (!local) return "Add the part before the @.";
  if (local.length > 64) return "The part before the @ is too long.";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "The part before the @ cannot start or end with a dot or have two dots in a row.";
  if (!LOCAL_CHARS.test(local)) return "The part before the @ has a character that is not allowed.";

  if (!domain) return "Add the part after the @, like gmail.com.";
  if (KNOWN_TYPOS[domain]) return `Did you mean ${KNOWN_TYPOS[domain]}?`;
  if (!domain.includes(".") || domain.endsWith(".")) return INCOMPLETE;
  if (domain.startsWith(".") || domain.includes("..")) return "The part after the @ cannot start or end with a dot or have two dots in a row.";

  const labels = domain.split(".");
  if (labels.some((l) => l.length > 63 || !LABEL.test(l))) return "The part after the @ has a character that is not allowed.";
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return INCOMPLETE;

  return "";
}

/** The server's message for one field of a Laravel 422 body, or "". */
export function serverFieldError(data, field) {
  return data?.errors?.[field]?.[0] ?? "";
}
