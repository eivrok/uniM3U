import { describe, it, expect } from 'vitest';
import { redactUrl } from './redact.js';

describe('redactUrl', () => {
  it('masks the credentials in an Xtream live stream path', () => {
    expect(redactUrl('http://example.club:8080/someuser/somepass/182691'))
      .toBe('http://example.club:8080/***/***/182691');
  });

  it('keeps the stream id, which carries no secret and identifies the channel', () => {
    expect(redactUrl('http://example.club:8080/someuser/somepass/182691'))
      .toContain('182691');
  });

  it('keeps the host so a redacted log still names the provider', () => {
    expect(redactUrl('http://example.club:8080/someuser/somepass/182691'))
      .toContain('example.club:8080');
  });

  it('keeps a live category prefix ahead of the credentials', () => {
    expect(redactUrl('http://example.club:8080/live/someuser/somepass/182691.ts'))
      .toBe('http://example.club:8080/live/***/***/182691.ts');
  });

  it('keeps a movie category prefix ahead of the credentials', () => {
    expect(redactUrl('http://example.club:8080/movie/someuser/somepass/9.mp4'))
      .toBe('http://example.club:8080/movie/***/***/9.mp4');
  });

  it('masks the username query parameter on a get.php playlist url', () => {
    expect(redactUrl('http://example.club:8080/get.php?username=someuser&password=somepass'))
      .not.toContain('someuser');
  });

  it('masks the password query parameter on a get.php playlist url', () => {
    expect(redactUrl('http://example.club:8080/get.php?username=someuser&password=somepass'))
      .not.toContain('somepass');
  });

  it('leaves a plain url with no credentials untouched', () => {
    expect(redactUrl('https://example.com/stream.m3u8'))
      .toBe('https://example.com/stream.m3u8');
  });

  it('leaves non-secret query parameters readable', () => {
    expect(redactUrl('http://example.club:8080/get.php?username=u&password=p&type=m3u_plus'))
      .toContain('type=m3u_plus');
  });

  it('refuses to echo back a url it cannot parse', () => {
    expect(redactUrl('not a url at all')).toBe('<unparseable url>');
  });

  it('returns a placeholder rather than throwing on a null url', () => {
    expect(redactUrl(null)).toBe('<unparseable url>');
  });
});
