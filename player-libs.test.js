import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PLAYER_LIBS } from './player-libs.js';

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('vendored player libraries', () => {
  it.each(PLAYER_LIBS)('$name matches the installed package', ({ source, vendored }) => {
    expect(digest(vendored)).toBe(digest(source));
  });
});
