import { describe, it, expect } from 'vitest';
import {
  loadLogoFailures,
  recordLogoFailure,
  serializeLogoFailures,
  LOGO_RETRY_MS,
  MAX_LOGO_FAILURES,
} from './logo-failures.js';

const NOW = 1_000_000_000_000;

describe('loadLogoFailures', () => {
  it('keeps a failure recorded inside the retry window', () => {
    const failures = loadLogoFailures([['http://a/logo.png', NOW - 1000]], NOW);
    expect(failures.has('http://a/logo.png')).toBe(true);
  });

  it('forgets a failure older than the retry window, so the logo is tried again', () => {
    const failures = loadLogoFailures([['http://a/logo.png', NOW - LOGO_RETRY_MS - 1]], NOW);
    expect(failures.has('http://a/logo.png')).toBe(false);
  });

  it('drops entries saved by older versions, which carry no timestamp', () => {
    const failures = loadLogoFailures(['http://a/logo.png'], NOW);
    expect(failures.size).toBe(0);
  });

  it('returns an empty set when nothing was stored', () => {
    expect(loadLogoFailures(undefined, NOW).size).toBe(0);
  });
});

describe('recordLogoFailure', () => {
  it('records a failure while online', () => {
    const failures = new Map();
    recordLogoFailure(failures, 'http://a/logo.png', NOW, true);
    expect(failures.get('http://a/logo.png')).toBe(NOW);
  });

  it('does not record a failure while offline', () => {
    const failures = new Map();
    recordLogoFailure(failures, 'http://a/logo.png', NOW, false);
    expect(failures.size).toBe(0);
  });

  it('reports whether anything was recorded', () => {
    expect(recordLogoFailure(new Map(), 'http://a/logo.png', NOW, false)).toBe(false);
  });

  it('evicts the oldest failure once the cap is reached', () => {
    const failures = new Map();
    for (let i = 0; i <= MAX_LOGO_FAILURES; i += 1) {
      recordLogoFailure(failures, `http://a/${i}.png`, NOW + i, true);
    }
    expect([failures.size, failures.has('http://a/0.png')]).toEqual([MAX_LOGO_FAILURES, false]);
  });
});

describe('serializeLogoFailures', () => {
  it('round-trips through loadLogoFailures', () => {
    const failures = new Map([['http://a/logo.png', NOW]]);
    expect(loadLogoFailures(serializeLogoFailures(failures), NOW)).toEqual(failures);
  });
});
