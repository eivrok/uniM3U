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

export function getCurrentProgram(epgData, channelId) {
  if (!channelId || !epgData[channelId]) return null;
  const now = Date.now();
  return epgData[channelId].find((p) => p.start <= now && p.stop > now) || null;
}

export function getNextProgram(epgData, channelId) {
  if (!channelId || !epgData[channelId]) return null;
  const now = Date.now();
  return epgData[channelId].find((p) => p.start > now) || null;
}

export function getProgramsForChannel(epgData, channelId, count = 5) {
  if (!channelId || !epgData[channelId]) return [];
  const now = Date.now();
  return epgData[channelId].filter((p) => p.stop > now).slice(0, count);
}
