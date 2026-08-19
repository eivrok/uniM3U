/**
 * Favourites were originally keyed on `ch-${index}`, which is the channel's
 * position in M3U parse order. That silently repoints every favourite whenever
 * the provider reorders its playlist, and it means nothing at all in the Xtream
 * id space. This rekeys them onto the stream url, which is stable across both.
 *
 * Callers must only pass M3U-sourced channels: resolving a `ch-N` id against
 * Xtream channels would match an unrelated row.
 */
const POSITIONAL_ID = /^ch-\d+$/;

export function migrateFavorites(stored, channels) {
  const favorites = [];
  let changed = false;

  for (const entry of stored || []) {
    if (!POSITIONAL_ID.test(entry)) {
      favorites.push(entry); // already a url
      continue;
    }
    const match = channels.find((c) => c.id === entry);
    if (match?.url) {
      favorites.push(match.url);
      changed = true;
    } else {
      // Unresolvable today — keep it so a later M3U load can still migrate it.
      favorites.push(entry);
    }
  }

  return { favorites, changed };
}
