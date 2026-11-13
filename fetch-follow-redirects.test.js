import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import { fetchFollowRedirects, ConnectionLostError } from './fetch-follow-redirects.js';

// A hang is the bug under test, so every case gets a short timeout: without the
// fix the promise never settles and the default five seconds only slows the run.
const SETTLE_MS = 2000;

let server;

function serve(handler) {
  server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`));
  });
}

afterEach(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
}));

describe('fetchFollowRedirects', () => {
  it('resolves with the body of a complete response', async () => {
    const url = await serve((_req, res) => res.end('#EXTM3U'));
    const result = await fetchFollowRedirects(url, 5, null);
    expect(result.body).toBe('#EXTM3U');
  }, SETTLE_MS);

  it('decodes a gzip-encoded response', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(zlib.gzipSync('#EXTM3U'));
    });
    const result = await fetchFollowRedirects(url, 5, null);
    expect(result.body).toBe('#EXTM3U');
  }, SETTLE_MS);

  it('rejects when the connection drops partway through the body', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Length': 1000000 });
      res.write('x'.repeat(1000));
      setTimeout(() => res.socket.destroy(), 50);
    });
    await expect(fetchFollowRedirects(url, 5, null)).rejects.toThrow(ConnectionLostError);
  }, SETTLE_MS);

  it('rejects when the connection drops partway through a compressed body', async () => {
    const url = await serve((_req, res) => {
      const gz = zlib.gzipSync('x'.repeat(100000));
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
      res.write(gz.subarray(0, 20));
      setTimeout(() => res.socket.destroy(), 50);
    });
    await expect(fetchFollowRedirects(url, 5, null)).rejects.toThrow(ConnectionLostError);
  }, SETTLE_MS);
});
