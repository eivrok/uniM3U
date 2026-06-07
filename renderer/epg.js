/**
 * Loads and parses XMLTV EPG data.
 * Returns a map: tvgId -> array of { title, desc, start, stop }
 */
export async function loadEPG(epgUrl, fetchUrl) {
  const raw = await fetchUrl(epgUrl);
  return parseXMLTV(raw);
}

function parseXMLTV(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const result = {};

  const programmes = doc.querySelectorAll('programme');
  programmes.forEach((prog) => {
    const channel = prog.getAttribute('channel');
    if (!channel) return;

    const title = prog.querySelector('title')?.textContent || '';
    const desc = prog.querySelector('desc')?.textContent || '';
    const start = parseXMLTVDate(prog.getAttribute('start'));
    const stop = parseXMLTVDate(prog.getAttribute('stop'));

    if (!result[channel]) result[channel] = [];
    result[channel].push({ title, desc, start, stop });
  });

  // Sort each channel's programmes by start time
  Object.values(result).forEach((progs) => progs.sort((a, b) => a.start - b.start));

  return result;
}

// XMLTV date format: 20240101120000 +0000
function parseXMLTVDate(str) {
  if (!str) return null;
  const clean = str.trim();
  // 14-digit + optional timezone
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mn, sc, tz] = m;
  const tzOffset = tz ? (parseInt(tz.slice(1, 3)) * 60 + parseInt(tz.slice(3, 5))) * (tz[0] === '-' ? -1 : 1) : 0;
  const utcMs = Date.UTC(+yr, +mo - 1, +dy, +hr, +mn, +sc) - tzOffset * 60_000;
  return new Date(utcMs);
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
