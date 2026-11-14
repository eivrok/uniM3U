// hls.js and mpegts.js fetch streams from the renderer, and most IPTV hosts
// send no CORS headers at all, so every response is marked as readable.
//
// Header names are case-sensitive keys here but not on the wire. Adding
// 'Access-Control-Allow-Origin' next to a server's own lowercase copy (which
// is every HTTP/2 server) sends the header twice, and Chromium rejects
// "*, *" as an invalid value — breaking exactly the hosts that had CORS right.
// So any existing copy is removed first, whatever its casing.
const ALLOW_ORIGIN = 'access-control-allow-origin';

function withOpenCors(responseHeaders) {
  const headers = {};
  for (const [name, value] of Object.entries(responseHeaders || {})) {
    if (name.toLowerCase() !== ALLOW_ORIGIN) headers[name] = value;
  }
  headers['Access-Control-Allow-Origin'] = ['*'];
  return headers;
}

module.exports = { withOpenCors };
