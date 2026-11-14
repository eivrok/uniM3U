const zlib = require('zlib');
const https = require('https');
const http = require('http');
const { conditionalHeaders } = require('./http-cache-policy');
const { redirectTarget } = require('./redirect-policy');
const { byteBudget } = require('./body-limit');

class ConnectionLostError extends Error {}

// Emit a progress event at most every PROGRESS_INTERVAL bytes to avoid
// flooding the IPC channel on large playlists.
const PROGRESS_INTERVAL = 262144; // 256 KB

// Far above any real playlist or Xtream list (the largest seen are tens of MB),
// and below V8's string limit of roughly 512 MB, which toString() would hit.
const MAX_BODY_BYTES = 256 * 1024 * 1024;

// An M3U is highly repetitive text and compresses roughly ten to one, but Node
// neither asks for compression nor decodes it on its own. Servers that don't
// support this just reply with an identity encoding, so asking costs nothing.
function decompressor(contentEncoding) {
  switch ((contentEncoding || '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

// Guide hosts publish guide.xml.gz as a plain file download: the body is gzip
// but no Content-Encoding says so, and decoded as text it parses to an empty
// guide with no error. Neither an M3U nor XML nor JSON can start with the gzip
// magic bytes, so sniffing them is safe.
function isGzipFile(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function fetchFollowRedirects(url, maxRedirects, onProgress, validators) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const tStart = Date.now();
    const req = client.get(url, {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IPTV-Player/1.0)',
        'Accept-Encoding': 'gzip, deflate, br',
        ...conditionalHeaders(validators),
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        res.destroy();
        // Inside the response callback a throw would escape as an uncaught
        // exception in the main process, so it has to become a rejection.
        let redirectUrl;
        try {
          redirectUrl = redirectTarget(url, res.headers.location);
        } catch (err) {
          reject(err);
          return;
        }
        resolve(fetchFollowRedirects(redirectUrl, maxRedirects - 1, onProgress, validators));
        return;
      }
      if (res.statusCode === 304) {
        res.destroy();
        console.log(`[perf] fetch 304 not modified after ${Date.now() - tStart}ms — cache reused`);
        resolve({ notModified: true });
        return;
      }
      if (res.statusCode !== 200) {
        // The error page is never read, and an unread body keeps the socket
        // open until the idle timeout.
        res.destroy();
        reject(new Error(`HTTP ${res.statusCode} from server`));
        return;
      }
      // content-length is the compressed size when the body is encoded, which
      // is also what `received` counts — progress stays a true fraction.
      const total = Number(res.headers['content-length']) || 0;
      const encoding = res.headers['content-encoding'];
      const inflate = decompressor(encoding);
      const body = inflate ? res.pipe(inflate) : res;

      const chunks = [];
      let received = 0;
      let lastEmit = 0;

      // Progress tracks bytes off the wire; chunks collect decoded bytes.
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received - lastEmit >= PROGRESS_INTERVAL) {
          lastEmit = received;
          onProgress?.(received, total);
        }
      });
      if (inflate) inflate.on('error', reject);

      // A connection that drops after the headers reaches neither req 'error'
      // nor the 60s timeout, and 'end' never fires, so nothing would settle
      // the promise and the caller would wait forever. 'close' always fires;
      // an incomplete message at that point means the body was cut short.
      // After a normal 'end' the promise is already resolved and this is a
      // no-op. The 'error' listener is there because Node only reports the
      // drop as an error when someone is listening, and with the listener in
      // place it must not go unhandled.
      const connectionLost = (cause) => {
        inflate?.destroy();
        reject(new ConnectionLostError('Connection lost before the download finished', { cause }));
      };
      res.on('error', connectionLost);
      res.on('close', () => {
        if (!res.complete) connectionLost();
      });

      const takeBytes = byteBudget(MAX_BODY_BYTES);
      body.on('data', (chunk) => {
        try {
          takeBytes(chunk.length);
        } catch (err) {
          // Destroying the request stops the download; the 'end' handler
          // never runs, so nothing further is buffered or resolved.
          chunks.length = 0;
          req.destroy();
          inflate?.destroy();
          reject(err);
          return;
        }
        chunks.push(chunk);
      });
      body.on('end', () => {
        onProgress?.(received, total);
        const finish = (buffer) => resolve({
          body: buffer.toString('utf8'),
          etag: res.headers.etag || null,
          lastModified: res.headers['last-modified'] || null,
        });
        const buffer = Buffer.concat(chunks);
        if (inflate || !isGzipFile(buffer)) {
          finish(buffer);
          return;
        }
        // Same decoded-size ceiling as the streamed path: the budget above
        // only counted the compressed bytes of this body.
        zlib.gunzip(buffer, { maxOutputLength: MAX_BODY_BYTES }, (err, decoded) => {
          if (err) reject(err);
          else finish(decoded);
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 60s')); });
  });
}

module.exports = { fetchFollowRedirects, ConnectionLostError };
