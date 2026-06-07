/**
 * Runs the XMLTV parse off the main thread. Module worker so it can share the
 * pure parser with the test suite. Receives the raw XML string, posts back
 * { ok, data } (or { ok:false, error }).
 */
import { parseXMLTV } from './epg-parse.js';

self.onmessage = (e) => {
  try {
    self.postMessage({ ok: true, data: parseXMLTV(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
