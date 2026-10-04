/**
 * Channel name search, shared by the sidebar box and the full-screen search
 * overlay so both answer a query the same way.
 *
 * `total` is the full match count even when `limit` trims `results`: the
 * overlay shows a capped list and tells the user how many more there are.
 */
export function searchChannels(channels, query, isVisible, limit = Infinity) {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], total: 0 };

  const results = [];
  let total = 0;
  for (const c of channels) {
    if (!isVisible(c.country) || !c.name.toLowerCase().includes(q)) continue;
    total += 1;
    if (results.length < limit) results.push(c);
  }
  return { results, total };
}
