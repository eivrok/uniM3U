/**
 * Runs a download and, if it fails, falls back to the copy already on disk.
 *
 * Providers' playlist endpoints are down or rate-limited far more often than
 * their streams are, so a failed refresh used to leave an empty app next to a
 * perfectly usable cache. Resolves { value, stale }: `stale` tells the caller
 * to let the user know the list was not refreshed.
 *
 * With no stale copy the original download error is rethrown, not swallowed —
 * it is the one that explains what went wrong. A stale copy that cannot be
 * read counts as no stale copy for the same reason.
 */
export async function freshOrStale(fetchFresh, readStale) {
  let fetchError;
  try {
    return { value: await fetchFresh(), stale: false };
  } catch (err) {
    fetchError = err;
  }

  let stale = null;
  try {
    stale = await readStale();
  } catch (err) {
    console.warn('stale copy could not be read:', err.message);
  }
  if (stale == null) throw fetchError;
  return { value: stale, stale: true };
}
