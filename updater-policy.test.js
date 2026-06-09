import { describe, it, expect } from 'vitest';
import { shouldAutoUpdate } from './updater-policy.js';

describe('shouldAutoUpdate', () => {
  it('is true for a packaged Windows build', () => {
    expect(shouldAutoUpdate('win32', true)).toBe(true);
  });

  it('is true for a packaged Linux build', () => {
    expect(shouldAutoUpdate('linux', true)).toBe(true);
  });

  it('is false on macOS even when packaged', () => {
    expect(shouldAutoUpdate('darwin', true)).toBe(false);
  });

  it('is false when not packaged (dev)', () => {
    expect(shouldAutoUpdate('win32', false)).toBe(false);
  });
});
