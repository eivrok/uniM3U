// How long a downloaded playlist stays usable before the app re-downloads it.
// The TTL comes from a user setting where two values are special:
//   -1 = never auto-expire (the user refreshes manually)
//    0 = always re-download on launch
export const DEFAULT_TTL_HOURS = 24;

export function isCacheFresh(cachedAt, ttlHours, now = Date.now()) {
  if (!cachedAt) return false;
  const hours = ttlHours == null ? DEFAULT_TTL_HOURS : Number(ttlHours);
  if (!Number.isFinite(hours)) return false;
  if (hours < 0) return true;
  if (hours === 0) return false;
  return now - cachedAt < hours * 60 * 60 * 1000;
}
