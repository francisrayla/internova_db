// One place for the Terms and Conditions + Privacy Notice version on the
// frontend. Keep it identical to config('internova.terms_version') in
// backend/config/internova.php: the backend stamps THIS version on the account
// when the person agrees. Bump both when the text changes in a way people
// should re-accept.
import { BACKEND_URL } from "@/lib/backendUrl";

export const TERMS_VERSION = "2026-10-15";
export const TERMS_UPDATED_LABEL = "October 15, 2026";

// Shown only if the backend cannot be reached when a legal page is rendered.
export const FALLBACK_SUPPORT_EMAIL = "support@internova.ai";

/** Contact address on the legal pages: the Super Admin's `support_email` system setting (public GET /api/legal). */
export async function getSupportEmail() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/legal`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return data.support_email || FALLBACK_SUPPORT_EMAIL;
  } catch {
    return FALLBACK_SUPPORT_EMAIL;
  }
}
