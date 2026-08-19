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
 *
 * chunkSize is 10000 because each yield costs far more than the work between
 * them: at 2000 the yields alone took ~186ms of a ~220ms parse for 30k
 * channels. Three progress updates still keep the counter visibly climbing.
 */
export async function parseM3UProgressive(raw, onProgress, chunkSize = 10000) {
  // TEMPORARY instrumentation — splits this phase into split / work / yield.
  const t0 = performance.now();
  const lines = splitLines(raw);
  const tSplit = performance.now();
  let yieldMs = 0;
  let progressMs = 0;
  let yields = 0;

  const channels = [];
  for (const channel of channelsFromLines(lines)) {
    channels.push(channel);
    if (channels.length % chunkSize === 0) {
      const p0 = performance.now();
      onProgress?.(channels.length);
      const p1 = performance.now();
      await tick();
      progressMs += p1 - p0;
      yieldMs += performance.now() - p1;
      yields++;
    }
  }
  onProgress?.(channels.length);

  const total = performance.now() - t0;
  console.log(`[perf] parse total ${Math.round(total)}ms = splitLines ${Math.round(tSplit - t0)}ms`
    + ` + onProgress ${Math.round(progressMs)}ms + yields ${Math.round(yieldMs)}ms over ${yields}`
    + ` + work ${Math.round(total - (tSplit - t0) - progressMs - yieldMs)}ms`
    + ` (${lines.length} lines, ${channels.length} channels)`);
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

// One compiled pattern per attribute name, reused for every channel. Building
// them inline meant five RegExp compilations per channel, which measured as
// half the total parse time on a 30k-channel playlist.
const attrPatterns = new Map();

function attrPattern(name) {
  let re = attrPatterns.get(name);
  if (!re) {
    re = new RegExp(`${name}="([^"]*)"`, 'i');
    attrPatterns.set(name, re);
  }
  return re;
}

function attr(str, name) {
  const m = str.match(attrPattern(name));
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
