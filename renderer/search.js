/**
 * Channel name search, shared by the sidebar box and the full-screen search
 * overlay so both answer a query the same way.
 *
 * `total` is the full match count even when `limit` trims `results`: the
 * overlay shows a capped list and tells the user how many more there are.
 *
 * `getPrograms` lets a query hit what a channel is showing, not just its name:
 * people search for the match ("newcastle"), and the EPG title is the only
 * place that appears. The caller decides which programmes count (now and the
 * next few hours), so tomorrow's replays don't crowd the results.
 *
 * `programHits` maps channel id to the programme that matched, for channels
 * found by programme rather than name, so a row can say when that programme
 * starts.
 */
export function searchChannels(channels, query, isVisible, limit = Infinity, getPrograms = () => []) {
  const q = query.trim().toLowerCase();
  const programHits = new Map();
  if (!q) return { results: [], total: 0, programHits };

  const matches = (c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    const hit = getPrograms(c).find((p) => p.title && p.title.toLowerCase().includes(q));
    if (!hit) return false;
    programHits.set(c.id, hit);
    return true;
  };

  const results = [];
  let total = 0;
  for (const c of channels) {
    if (!isVisible(c.country) || !matches(c)) continue;
    total += 1;
    if (results.length < limit) results.push(c);
  }
  return { results, total, programHits };
}
