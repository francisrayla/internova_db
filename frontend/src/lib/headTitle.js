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
