import { describe, it, expect } from 'vitest';
import { freshOrStale } from './stale-fallback.js';

describe('freshOrStale', () => {
  it('returns the fresh value when the fetch succeeds', async () => {
    const result = await freshOrStale(async () => 'fresh', async () => 'old');
    expect(result).toEqual({ value: 'fresh', stale: false });
  });

  it('does not read the stale copy when the fetch succeeds', async () => {
    let read = false;
    await freshOrStale(async () => 'fresh', async () => { read = true; return 'old'; });
    expect(read).toBe(false);
  });

  it('falls back to the stale copy when the fetch fails', async () => {
    const result = await freshOrStale(async () => { throw new Error('offline'); }, async () => 'old');
    expect(result).toEqual({ value: 'old', stale: true });
  });

  it('rethrows the fetch error when there is no stale copy', async () => {
    const attempt = freshOrStale(async () => { throw new Error('offline'); }, async () => null);
    await expect(attempt).rejects.toThrow('offline');
  });

  it('rethrows the fetch error when the stale copy cannot be read', async () => {
    const attempt = freshOrStale(
      async () => { throw new Error('offline'); },
      async () => { throw new Error('disk'); },
    );
    await expect(attempt).rejects.toThrow('offline');
  });
});
