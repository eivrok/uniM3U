/**
 * Parses M3U/M3U+ playlist format into channel objects.
 */
export function parseM3U(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const channels = [];
  let current = null;
  let idCounter = 0;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      current = parseExtInf(line, idCounter++);
    } else if (line.startsWith('#')) {
      // skip other directives
    } else if (current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }

  return channels;
}

function parseExtInf(line, fallbackId) {
  // #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Channel Name
  const commaIdx = line.lastIndexOf(',');
  const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : 'Unknown';
  const attrs = line.slice(0, commaIdx >= 0 ? commaIdx : line.length);

  return {
    id: attr(attrs, 'tvg-id') || attr(attrs, 'tvg-name') || `ch-${fallbackId}`,
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
