/**
 * What the school's head is called on screen: "Dean", "Principal" or "School Head".
 * It is chosen on the registration form and arrives as `head_title` in the session
 * payload for EVERY user of the school (dean, coordinator, supervisor, intern).
 * The role key stays "dean" in routes, permissions and the database; only the shown
 * word changes, so never hard-code "Dean" in user-facing text, use these helpers.
 */
export const HEAD_TITLES = ["Dean", "Principal", "School Head"];
export const DEFAULT_HEAD_TITLE = "Dean";

/** The title for the signed-in user's school. Safe for a missing user or an old cached session. */
export function headTitle(user) {
  const value = user?.head_title;
  return HEAD_TITLES.includes(value) ? value : DEFAULT_HEAD_TITLE;
}

/** Normalises a bare value (for example a Super Admin row's `dean_title`). */
export function headTitleOf(value) {
  return HEAD_TITLES.includes(value) ? value : DEFAULT_HEAD_TITLE;
}

/**
 * How to address the head in a greeting: "<Title> <last name>" ("Principal Reyes"). Words of the name that are
 * themselves part of a head title ("School", "Head", "Dean", "Principal") are ignored, so a head whose name is
 * "School Head" is greeted "School Head", never "School Head Head". No usable name gives just the title.
 */
export function headAddress(title, fullName) {
  const titleWords = new Set(HEAD_TITLES.flatMap((t) => t.toLowerCase().split(" ")));
  const words = String(fullName ?? "").trim().split(/\s+/).filter((w) => w && !titleWords.has(w.toLowerCase()));
  return words.length ? `${title} ${words[words.length - 1]}` : title;
}
