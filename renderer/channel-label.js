/**
 * Splits an IPTV channel name into its parts so the sidebar can lay them out
 * instead of printing one long string that ellipses away the useful half.
 *
 * Providers prefix every row in a category with the same source tag and event
 * timestamp ("[Viaplay NO] (1/9) 20:35 West Ham - Wolverhampton"), which is
 * where the row's horizontal space goes. Pulling tag/date/time out lets the
 * title — the only part that differs between rows — own the width.
 *
 * Pure and DOM-free so the parsing rules stay unit-testable.
 */

const TAG_BRACKET = /^\[([^\]]+)\]\s*/;      // [Viaplay NO]
const TAG_COUNTRY = /^([A-Z]{2,4}):\s+/;     // NO:  (letters only, so "20:35" is a time)
const DATE = /^\((\d{1,2}\/\d{1,2})\)\s*/;   // (1/9)
const TIME = /^(\d{1,2}:\d{2})\s+/;          // 20:35, needs a following space or it IS the title
const ISO_TAIL = /\s*\((\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\)$/; // (2026-09-08 15:53:13)

/**
 * @param {string} name raw channel name from the playlist
 * @returns {{tag: string|null, date: string|null, time: string|null, title: string}}
 *   `title` is never empty — it falls back to the trimmed input when the name
 *   is nothing but metadata.
 */
export function parseChannelLabel(name) {
  const raw = typeof name === 'string' ? name.trim() : '';
  let rest = raw;
  let tag = null;
  let date = null;
  let time = null;

  const bracket = rest.match(TAG_BRACKET);
  if (bracket) {
    tag = bracket[1].trim();
    rest = rest.slice(bracket[0].length);
  } else {
    const country = rest.match(TAG_COUNTRY);
    if (country) {
      tag = country[1];
      rest = rest.slice(country[0].length);
    }
  }

  const d = rest.match(DATE);
  if (d) {
    date = d[1];
    rest = rest.slice(d[0].length);
  }

  const t = rest.match(TIME);
  if (t) {
    time = t[1];
    rest = rest.slice(t[0].length);
  }

  // Some providers put the start time at the *end* of the name as a full ISO
  // stamp, where it costs the title 20+ characters of the row's width. The
  // pattern is anchored to the end and fully specified so ordinary trailing
  // parentheses — "Casablanca (1942)", "(repeat)" — don't match it. A name that
  // is nothing but a timestamp keeps it: stripping would leave no title at all.
  const iso = rest.match(ISO_TAIL);
  if (iso && rest.slice(0, iso.index).trim()) {
    rest = rest.slice(0, iso.index);
    // A leading "(1/9) 20:35" is the provider's own label for the same event —
    // it was written for this list, so it wins over the stamp at the back.
    if (!date) date = `${Number(iso[3])}/${Number(iso[2])}`;
    if (!time) time = `${iso[4]}:${iso[5]}`;
  }

  const title = rest.trim();
  return title ? { tag, date, time, title } : { tag, date, time, title: raw };
}
