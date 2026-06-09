/**
 * Parses M3U/M3U+ playlist format into channel objects.
 */
function splitLines(raw) {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

function* channelsFromLines(lines) {
  let current = null;
  let idCounter = 0;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      current = parseExtInf(line, idCounter++);
    } else if (line.startsWith('#')) {
      // skip other directives
    } else if (current) {
      current.url = line;
      yield current;
      current = null;
    }
  }
}

export function parseM3U(raw) {
  return [...channelsFromLines(splitLines(raw))];
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Async sibling of parseM3U. Yields to the event loop every `chunkSize`
 * channels and reports the running count via onProgress, so the UI can show
 * a climbing total on large playlists. Returns the full channel array.
 */
export async function parseM3UProgressive(raw, onProgress, chunkSize = 2000) {
  const channels = [];
  for (const channel of channelsFromLines(splitLines(raw))) {
    channels.push(channel);
    if (channels.length % chunkSize === 0) {
      onProgress?.(channels.length);
      await tick();
    }
  }
  onProgress?.(channels.length);
  return channels;
}

function parseExtInf(line, fallbackId) {
  // #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Channel Name
  const commaIdx = line.lastIndexOf(',');
  const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : 'Unknown';
  const attrs = line.slice(0, commaIdx >= 0 ? commaIdx : line.length);

  return {
    id: `ch-${fallbackId}`, // unique per channel; tvg-id is unreliable (SD/HD share one)
    name,
    tvgId: attr(attrs, 'tvg-id'),
    tvgName: attr(attrs, 'tvg-name'),
    logo: attr(attrs, 'tvg-logo'),
    group: attr(attrs, 'group-title'),
    url: null,
  };
}

function attr(str, name) {
  const re = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = str.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Splits a group-title into country + subcategory on the first " - ".
 * "SWEDEN - SPORT" -> { country: "SWEDEN", sub: "SPORT" }
 * "24-7 Channels"  -> { country: "24-7 Channels", sub: null }
 */
export function parseGroup(group) {
  const g = (group || 'Uncategorized').trim();
  const idx = g.indexOf(' - ');
  if (idx === -1) return { country: g, sub: null };
  return { country: g.slice(0, idx).trim(), sub: g.slice(idx + 3).trim() };
}
