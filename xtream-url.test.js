import { describe, it, expect } from 'vitest';
import { isXtreamUrl, xtreamCreds, xtreamApiUrl } from './xtream-url.js';

const XTREAM = 'http://example.club:8080/get.php?username=alice&password=s3cret&type=m3u_plus';

describe('isXtreamUrl', () => {
  it('accepts a get.php url carrying username and password', () => {
    expect(isXtreamUrl(XTREAM)).toBe(true);
  });

  it('rejects a get.php url with no username', () => {
    expect(isXtreamUrl('http://example.club:8080/get.php?password=s3cret')).toBe(false);
  });

  it('rejects a get.php url with no password', () => {
    expect(isXtreamUrl('http://example.club:8080/get.php?username=alice')).toBe(false);
  });

  it('rejects a plain m3u url', () => {
    expect(isXtreamUrl('http://example.com/playlist.m3u')).toBe(false);
  });

  it('rejects a string that is not a url', () => {
    expect(isXtreamUrl('not a url')).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(isXtreamUrl('')).toBe(false);
  });
});

describe('xtreamCreds', () => {
  it('extracts origin, username and password', () => {
    expect(xtreamCreds(XTREAM)).toEqual({
      origin: 'http://example.club:8080',
      username: 'alice',
      password: 's3cret',
    });
  });

  it('returns null for a non-xtream url', () => {
    expect(xtreamCreds('http://example.com/playlist.m3u')).toBe(null);
  });
});

describe('xtreamApiUrl', () => {
  const creds = { origin: 'http://example.club:8080', username: 'alice', password: 's3cret' };

  it('builds a player_api url carrying credentials and the action', () => {
    expect(xtreamApiUrl(creds, { action: 'get_live_streams' })).toBe(
      'http://example.club:8080/player_api.php?username=alice&password=s3cret&action=get_live_streams'
    );
  });

  it('appends extra params after the action', () => {
    expect(xtreamApiUrl(creds, { action: 'get_series_info', series_id: 42 })).toBe(
      'http://example.club:8080/player_api.php?username=alice&password=s3cret&action=get_series_info&series_id=42'
    );
  });

  it('encodes credentials that contain url-unsafe characters', () => {
    const odd = { origin: 'http://h:8080', username: 'a b', password: 'p&q' };
    expect(xtreamApiUrl(odd, { action: 'x' })).toBe(
      'http://h:8080/player_api.php?username=a+b&password=p%26q&action=x'
    );
  });
});
