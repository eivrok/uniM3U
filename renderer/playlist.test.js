import { describe, it, expect } from 'vitest';
import { parseM3U, parseGroup } from './playlist.js';

describe('parseGroup', () => {
  it('splits country and subcategory on the first " - "', () => {
    expect(parseGroup('SWEDEN - SPORT')).toEqual({ country: 'SWEDEN', sub: 'SPORT' });
  });

  it('returns null sub when there is no separator', () => {
    expect(parseGroup('24-7 Channels')).toEqual({ country: '24-7 Channels', sub: null });
  });

  it('splits only on the first separator, keeping the rest as sub', () => {
    expect(parseGroup('UK - SPORT - HD')).toEqual({ country: 'UK', sub: 'SPORT - HD' });
  });

  it('defaults country to Uncategorized when group is empty', () => {
    expect(parseGroup('')).toEqual({ country: 'Uncategorized', sub: null });
  });

  it('defaults country to Uncategorized when group is null', () => {
    expect(parseGroup(null)).toEqual({ country: 'Uncategorized', sub: null });
  });

  it('trims surrounding whitespace from country and sub', () => {
    expect(parseGroup('  SWEDEN  -  SPORT  ')).toEqual({ country: 'SWEDEN', sub: 'SPORT' });
  });
});

describe('parseM3U', () => {
  const M3U = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="abc" tvg-name="ABC News" tvg-logo="http://logo/abc.png" group-title="US - News",ABC News',
    'http://stream/abc-sd',
    '#EXTINF:-1 tvg-id="abc" tvg-name="ABC News HD" group-title="US - News",ABC News HD',
    'http://stream/abc-hd',
  ].join('\n');

  it('assigns unique ids to channels that share a tvg-id', () => {
    const channels = parseM3U(M3U);
    const ids = channels.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the shared tvg-id available for EPG mapping', () => {
    const channels = parseM3U(M3U);
    expect(channels.map((c) => c.tvgId)).toEqual(['abc', 'abc']);
  });

  it('parses name, url, group, and logo from an EXTINF line', () => {
    const [first] = parseM3U(M3U);
    expect(first).toMatchObject({
      name: 'ABC News',
      url: 'http://stream/abc-sd',
      group: 'US - News',
      logo: 'http://logo/abc.png',
    });
  });

  it('drops an EXTINF entry that has no following url line', () => {
    const dangling = '#EXTINF:-1,Orphan Channel';
    expect(parseM3U(dangling)).toEqual([]);
  });
});
