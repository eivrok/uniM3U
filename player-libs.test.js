import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PLAYER_LIBS, applyPatches, PatchNotApplicableError } from './player-libs.js';

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

describe('vendored player libraries', () => {
  it.each(PLAYER_LIBS)('$name matches the installed package with its patches applied', (lib) => {
    const expected = applyPatches(lib, readFileSync(lib.source, 'utf8'));
    expect(digest(readFileSync(lib.vendored, 'utf8'))).toBe(digest(expected));
  });

  it('caps mpegts.js silent-frame gap filling at ten seconds', () => {
    const mpegts = PLAYER_LIBS.find((lib) => lib.name === 'mpegts.js');
    expect(readFileSync(mpegts.vendored, 'utf8')).toContain('o>=3*d&&o<=1e4&&this._fillAudioTimestampGap');
  });
});

describe('applyPatches', () => {
  const lib = { name: 'x.js', patches: [{ find: 'a<b', replace: 'a<=b' }] };

  it('replaces the target string when it occurs exactly once', () => {
    expect(applyPatches(lib, 'if(a<b)go()')).toBe('if(a<=b)go()');
  });

  it('throws when the target string is missing', () => {
    expect(() => applyPatches(lib, 'if(a>b)go()')).toThrow(PatchNotApplicableError);
  });

  it('throws when the target string occurs more than once', () => {
    expect(() => applyPatches(lib, 'a<b;a<b')).toThrow(PatchNotApplicableError);
  });

  it('returns the text unchanged for a library without patches', () => {
    expect(applyPatches({ name: 'y.js' }, 'a<b')).toBe('a<b');
  });
});
