import { describe, it, expect } from 'vitest';
import { redirectTarget, InsecureRedirectError } from './redirect-policy.js';

describe('redirectTarget', () => {
  it('follows an absolute https redirect from https', () => {
    expect(redirectTarget('https://a.example/get.php', 'https://b.example/list.m3u'))
      .toBe('https://b.example/list.m3u');
  });

  it('resolves a relative redirect against the requested url', () => {
    expect(redirectTarget('https://a.example/dir/get.php', '../other.m3u'))
      .toBe('https://a.example/other.m3u');
  });

  it('follows an http redirect from http', () => {
    expect(redirectTarget('http://a.example/get.php', 'http://b.example/list.m3u'))
      .toBe('http://b.example/list.m3u');
  });

  it('allows an upgrade from http to https', () => {
    expect(redirectTarget('http://a.example/get.php', 'https://a.example/get.php'))
      .toBe('https://a.example/get.php');
  });

  it('refuses a downgrade from https to http', () => {
    expect(() => redirectTarget('https://a.example/get.php', 'http://a.example/get.php'))
      .toThrow(InsecureRedirectError);
  });

  it('refuses a redirect to a non-http scheme', () => {
    expect(() => redirectTarget('http://a.example/get.php', 'file://evil.example/share/x'))
      .toThrow(InsecureRedirectError);
  });

  // The urls carry Xtream credentials, and this message reaches the renderer.
  it('keeps the urls out of the error message', () => {
    expect(() => redirectTarget(
      'https://a.example/get.php?username=u&password=secret',
      'http://a.example/get.php?username=u&password=secret',
    )).toThrow(/^(?!.*secret).*$/);
  });
});
