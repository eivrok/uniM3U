import { describe, it, expect } from 'vitest';
import { migrateFavorites } from './favorites-migration.js';

const channels = [
  { id: 'ch-0', url: 'http://ex/a' },
  { id: 'ch-1579', url: 'http://ex/vsport2' },
];

describe('migrateFavorites', () => {
  it('replaces a positional id with the channel url', () => {
    expect(migrateFavorites(['ch-1579'], channels).favorites).toEqual(['http://ex/vsport2']);
  });

  it('reports that it changed something when an id was migrated', () => {
    expect(migrateFavorites(['ch-1579'], channels).changed).toBe(true);
  });

  it('leaves an entry that is already a url untouched', () => {
    expect(migrateFavorites(['http://ex/kept'], channels).favorites).toEqual(['http://ex/kept']);
  });

  it('reports no change when every entry is already a url', () => {
    expect(migrateFavorites(['http://ex/kept'], channels).changed).toBe(false);
  });

  it('keeps an unresolvable id so a later load can still migrate it', () => {
    expect(migrateFavorites(['ch-9999'], channels).favorites).toEqual(['ch-9999']);
  });

  it('reports no change when nothing could be resolved', () => {
    expect(migrateFavorites(['ch-9999'], channels).changed).toBe(false);
  });

  it('matches on id rather than array position', () => {
    // ch-1579 is at index 1, so a position-based lookup would pick the wrong row.
    expect(migrateFavorites(['ch-1579'], channels).favorites).not.toEqual(['http://ex/a']);
  });

  it('skips a matched channel that has no url', () => {
    const seriesRow = [{ id: 'ch-5', url: null }];
    expect(migrateFavorites(['ch-5'], seriesRow).favorites).toEqual(['ch-5']);
  });

  it('returns an empty list unchanged', () => {
    expect(migrateFavorites([], channels)).toEqual({ favorites: [], changed: false });
  });

  it('tolerates a missing stored value', () => {
    expect(migrateFavorites(undefined, channels)).toEqual({ favorites: [], changed: false });
  });
});
