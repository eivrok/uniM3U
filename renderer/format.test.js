import { describe, it, expect } from 'vitest';
import { formatDownloadProgress, normalizeTimeFormat, formatClockTime, formatClockString } from './format.js';

describe('formatDownloadProgress', () => {
  it('shows received, total, and percent when total is known', () => {
    const text = formatDownloadProgress(4_404_019, 18_874_368);
    expect(text).toBe('Downloading playlist… 4.2 / 18.0 MB (23%)');
  });

  it('shows only received megabytes when total is zero', () => {
    expect(formatDownloadProgress(4_404_019, 0)).toBe('Downloading playlist… 4.2 MB');
  });

  it('reports 100% when received equals total', () => {
    const text = formatDownloadProgress(10_485_760, 10_485_760);
    expect(text).toBe('Downloading playlist… 10.0 / 10.0 MB (100%)');
  });
});

describe('normalizeTimeFormat', () => {
  it('keeps 12h when stored as 12h', () => {
    expect(normalizeTimeFormat('12h')).toBe('12h');
  });

  it('defaults to 24h when unset', () => {
    expect(normalizeTimeFormat(undefined)).toBe('24h');
  });

  it('defaults to 24h for an unknown value', () => {
    expect(normalizeTimeFormat('bogus')).toBe('24h');
  });
});

describe('formatClockTime', () => {
  it('shows zero-padded 24h time', () => {
    expect(formatClockTime(new Date(2026, 9, 9, 8, 5), '24h')).toBe('08:05');
  });

  it('shows afternoon as 12h with PM', () => {
    expect(formatClockTime(new Date(2026, 9, 9, 20, 35), '12h')).toBe('8:35 PM');
  });

  it('shows midnight as 12 AM in 12h', () => {
    expect(formatClockTime(new Date(2026, 9, 9, 0, 7), '12h')).toBe('12:07 AM');
  });

  it('shows noon as 12 PM in 12h', () => {
    expect(formatClockTime(new Date(2026, 9, 9, 12, 0), '12h')).toBe('12:00 PM');
  });
});

describe('formatClockString', () => {
  it('converts a provider time to 12h', () => {
    expect(formatClockString('20:35', '12h')).toBe('8:35 PM');
  });

  it('pads a single-digit provider hour in 24h', () => {
    expect(formatClockString('9:15', '24h')).toBe('09:15');
  });

  it('leaves an out-of-range provider time as written', () => {
    expect(formatClockString('25:70', '12h')).toBe('25:70');
  });
});
