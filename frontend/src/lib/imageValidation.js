// Mirrors every backend image-upload endpoint's `mimes:` whitelist exactly
// (see AuthController::uploadAvatar, InternMonitoringController::storeActivity
// and ::storePortfolioItem) — checked client-side too so a rejected format
// shows instantly instead of round-tripping to the server first. HEIC/HEIF
// (the default on iPhone cameras) isn't included: the server has no HEIC
// decoder installed, so accepting it here would just trade an early, clear
// error for a confusing one.
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function validateImageFile(file, maxBytes) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Please choose a JPG, PNG, WEBP, or GIF image — other formats (like HEIC from an iPhone) aren't supported yet.";
  }
  if (maxBytes && file.size > maxBytes) {
    return `Image must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`;
  }
  return null;
}

// Messenger file attachments accept any document/photo type, unlike the
// image-only uploads above — the only checks worth making client-side are a
// size cap (mirrors MessageController::store's `max:10240` KB limit) and a
// short blocklist of executable extensions, so a picked file never silently
// round-trips to the server just to fail there.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const BLOCKED_ATTACHMENT_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "js", "jar", "sh"];

export function validateAttachmentFile(file, maxBytes) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && BLOCKED_ATTACHMENT_EXTENSIONS.includes(ext)) {
    return "This file type isn't allowed for security reasons.";
  }
  if (maxBytes && file.size > maxBytes) {
    return `File must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`;
  }
  return null;
}
