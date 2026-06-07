/**
 * Pure XMLTV parser shared by the EPG worker and its tests.
 *
 * Regex-based (DOMParser is unavailable in Web Workers). Less strict than a real
 * XML parser, but XMLTV is regular enough. Returns
 * { channelId: [{ title, desc, start, stop }] } with start/stop as epoch ms
 * (numbers) or null, each channel's list sorted by start time.
 */
export function parseXMLTV(xml) {
  const result = {};
  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = progRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const channel = attr(attrs, 'channel');
    if (!channel) continue;

    const prog = {
      title: decodeEntities(tagText(body, 'title')),
      desc: decodeEntities(tagText(body, 'desc')),
      start: parseDate(attr(attrs, 'start')),
      stop: parseDate(attr(attrs, 'stop')),
    };
    if (!result[channel]) result[channel] = [];
    result[channel].push(prog);
  }

  for (const progs of Object.values(result)) {
    progs.sort((a, b) => (a.start || 0) - (b.start || 0));
  }
  return result;
}

function attr(str, name) {
  const m = str.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

// First matching child element's inner text (tolerates attributes on the tag).
function tagText(body, name) {
  const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, ent) => {
    switch (ent) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        if (ent[0] === '#') {
          const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return whole;
    }
  });
}

// XMLTV date: 20240101120000 +0000  -> epoch ms (number) or null.
export function parseDate(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mn, sc, tz] = m;
  const tzOffset = tz ? (parseInt(tz.slice(1, 3)) * 60 + parseInt(tz.slice(3, 5))) * (tz[0] === '-' ? -1 : 1) : 0;
  return Date.UTC(+yr, +mo - 1, +dy, +hr, +mn, +sc) - tzOffset * 60_000;
}
