/**
 * Remembers which channel logos failed to load, so re-renders (every search
 * keystroke rebuilds the list) don't re-request dead urls.
 *
 * A failure used to be remembered forever and without limit. One scroll through
 * a category while offline, or while a logo host was briefly down, blanked
 * those logos permanently, and the list grew inside the settings file that is
 * read and written in full on every settings access. So a failure now expires,
 * is not recorded at all while offline, and the list is capped.
 *
 * Pure and DOM-free so the rules stay unit-testable; app.js owns persistence.
 */
export const LOGO_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LOGO_FAILURES = 2000;

/**
 * Builds the url -> failedAt map from what was persisted. Entries from older
 * versions are bare url strings with no timestamp; they are dropped, which
 * simply gives those logos one more try.
 */
export function loadLogoFailures(stored, now = Date.now()) {
  const failures = new Map();
  if (!Array.isArray(stored)) return failures;
  for (const entry of stored) {
    if (!Array.isArray(entry)) continue;
    const [url, failedAt] = entry;
    if (typeof url !== 'string' || typeof failedAt !== 'number') continue;
    if (now - failedAt < LOGO_RETRY_MS) failures.set(url, failedAt);
  }
  return failures;
}

/** Returns whether the failure was recorded, so the caller knows to persist. */
export function recordLogoFailure(failures, url, now, online) {
  // Offline, every logo fails and none of them is the logo's fault.
  if (!online) return false;
  // Re-inserting moves the url to the end, so the Map's insertion order stays
  // oldest-first and eviction below can take from the front.
  failures.delete(url);
  failures.set(url, now);
  while (failures.size > MAX_LOGO_FAILURES) {
    failures.delete(failures.keys().next().value);
  }
  return true;
}

export function serializeLogoFailures(failures) {
  return [...failures];
}
