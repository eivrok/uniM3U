import { describe, it, expect } from 'vitest';
import { isCacheFresh, DEFAULT_TTL_HOURS } from './cache-policy.js';

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe('isCacheFresh', () => {
  it('returns false when the playlist has never been downloaded', () => {
    expect(isCacheFresh(null, 24, NOW)).toBe(false);
  });

  it('returns true within the TTL window', () => {
    expect(isCacheFresh(NOW - 3 * HOUR, 24, NOW)).toBe(true);
  });

  it('returns false once the TTL window has passed', () => {
    expect(isCacheFresh(NOW - 25 * HOUR, 24, NOW)).toBe(false);
  });

  it('returns false exactly at the TTL boundary', () => {
    expect(isCacheFresh(NOW - 24 * HOUR, 24, NOW)).toBe(false);
  });

  it('returns true for a negative TTL, which means manual refresh only', () => {
    expect(isCacheFresh(NOW - 10_000 * HOUR, -1, NOW)).toBe(true);
  });

  it('returns false for a zero TTL, which means always re-download', () => {
    expect(isCacheFresh(NOW, 0, NOW)).toBe(false);
  });

  it('falls back to the default TTL when the setting is unset', () => {
    expect(isCacheFresh(NOW - (DEFAULT_TTL_HOURS - 1) * HOUR, null, NOW)).toBe(true);
  });

  it('returns false when the stored TTL is not a number', () => {
    expect(isCacheFresh(NOW, 'soon', NOW)).toBe(false);
  });
});
