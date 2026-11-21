/**
 * Loads XMLTV EPG data and parses it in a Web Worker (off the main thread).
 * Returns a map: channelId -> array of { title, desc, start, stop }
 * where start/stop are epoch milliseconds (numbers) or null.
 */
export async function loadEPG(epgUrl, fetchUrl) {
  const raw = await fetchUrl(epgUrl);
  return parseInWorker(raw);
}

function parseInWorker(xml) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./epg-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.data);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage(xml);
  });
}

// Channel ids come from the playlist and the guide file. A plain lookup would
// treat an id like "constructor" as present, because every object inherits
// that name, and then fail calling array methods on a function.
function programmesOf(epgData, channelId) {
  if (!channelId || !Object.hasOwn(epgData, channelId)) return null;
  return epgData[channelId];
}

export function getCurrentProgram(epgData, channelId) {
  const programmes = programmesOf(epgData, channelId);
  if (!programmes) return null;
  const now = Date.now();
  return programmes.find((p) => p.start <= now && p.stop > now) || null;
}

export function getNextProgram(epgData, channelId) {
  const programmes = programmesOf(epgData, channelId);
  if (!programmes) return null;
  const now = Date.now();
  return programmes.find((p) => p.start > now) || null;
}

/** The programme on now plus any that start within `windowMs` of `now`. */
export function getProgramsStartingWithin(epgData, channelId, windowMs, now = Date.now()) {
  const programmes = programmesOf(epgData, channelId);
  if (!programmes) return [];
  return programmes.filter((p) => p.stop > now && p.start <= now + windowMs);
}

export function getProgramsForChannel(epgData, channelId, count = 5) {
  const programmes = programmesOf(epgData, channelId);
  if (!programmes) return [];
  const now = Date.now();
  return programmes.filter((p) => p.stop > now).slice(0, count);
}
