import { describe, it, expect } from 'vitest';
import { getProgramsStartingWithin } from './epg.js';

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;
const prog = (title, startH, stopH) => ({ title, start: NOW + startH * HOUR, stop: NOW + stopH * HOUR });

describe('getProgramsStartingWithin', () => {
  const epg = {
    sky: [
      prog('Finished', -3, -1),
      prog('On now', -1, 1),
      prog('Kick-off soon', 1, 3),
      prog('Tomorrow replay', 20, 22),
    ],
  };

  it('returns the current programme and those starting inside the window', () => {
    const titles = getProgramsStartingWithin(epg, 'sky', 3 * HOUR, NOW).map((p) => p.title);
    expect(titles).toEqual(['On now', 'Kick-off soon']);
  });

  it('returns nothing for a channel with no EPG data', () => {
    expect(getProgramsStartingWithin(epg, 'nrk1', 3 * HOUR, NOW)).toEqual([]);
  });
});
