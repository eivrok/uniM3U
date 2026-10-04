import { describe, it, expect } from 'vitest';
import { searchChannels } from './search.js';

const ch = (name, country = 'NO') => ({ id: name, name, country, url: `http://x/${name}` });
const all = () => true;

describe('searchChannels', () => {
  it('matches names case-insensitively by substring', () => {
    const { results } = searchChannels([ch('NRK1 HD'), ch('TV2'), ch('nrk2')], 'NRK', all);
    expect(results.map((c) => c.name)).toEqual(['NRK1 HD', 'nrk2']);
  });

  it('ignores surrounding whitespace in the query', () => {
    const { results } = searchChannels([ch('NRK1'), ch('TV2')], '  tv2 ', all);
    expect(results.map((c) => c.name)).toEqual(['TV2']);
  });

  it('returns nothing for a blank query', () => {
    expect(searchChannels([ch('NRK1')], '   ', all)).toEqual({ results: [], total: 0 });
  });

  it('skips channels whose country is hidden', () => {
    const visible = (country) => country !== 'SE';
    const { results } = searchChannels([ch('Sport NO', 'NO'), ch('Sport SE', 'SE')], 'sport', visible);
    expect(results.map((c) => c.name)).toEqual(['Sport NO']);
  });

  it('caps results at the limit but still reports the full match count', () => {
    const channels = Array.from({ length: 5 }, (_, i) => ch(`News ${i}`));
    const { results, total } = searchChannels(channels, 'news', all, 2);
    expect({ shown: results.length, total }).toEqual({ shown: 2, total: 5 });
  });

  it('returns every match when no limit is given', () => {
    const channels = Array.from({ length: 300 }, (_, i) => ch(`News ${i}`));
    expect(searchChannels(channels, 'news', all).results).toHaveLength(300);
  });
});
