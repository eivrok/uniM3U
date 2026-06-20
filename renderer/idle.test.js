import { describe, it, expect } from 'vitest';
import { clampIdleSeconds, formatIdleLabel, shouldHideChrome, decideChrome } from './idle.js';

describe('clampIdleSeconds', () => {
  it('returns the default of 5 when value is not a number', () => {
    expect(clampIdleSeconds(null)).toBe(5);
    expect(clampIdleSeconds('abc')).toBe(5);
    expect(clampIdleSeconds(undefined)).toBe(5);
  });

  it('floors fractional input to an integer', () => {
    expect(clampIdleSeconds(7.9)).toBe(7);
  });

  it('clamps below zero up to zero', () => {
    expect(clampIdleSeconds(-3)).toBe(0);
  });

  it('clamps above thirty down to thirty', () => {
    expect(clampIdleSeconds(99)).toBe(30);
  });

  it('coerces a numeric string (the slider .value path) to an integer', () => {
    expect(clampIdleSeconds('7')).toBe(7);
  });
});

describe('formatIdleLabel', () => {
  it('returns Never when seconds is zero', () => {
    expect(formatIdleLabel(0)).toBe('Never');
  });

  it('returns the seconds with an s suffix when positive', () => {
    expect(formatIdleLabel(5)).toBe('5s');
  });
});

describe('shouldHideChrome', () => {
  it('returns false when no channel is playing', () => {
    expect(shouldHideChrome({ playing: false, idleHideSeconds: 5, idleElapsedMs: 9999 })).toBe(false);
  });

  it('returns false when the delay is zero (disabled)', () => {
    expect(shouldHideChrome({ playing: true, idleHideSeconds: 0, idleElapsedMs: 9999 })).toBe(false);
  });

  it('returns false before the idle delay has elapsed', () => {
    expect(shouldHideChrome({ playing: true, idleHideSeconds: 5, idleElapsedMs: 4999 })).toBe(false);
  });

  it('returns true once the idle delay has elapsed while playing', () => {
    expect(shouldHideChrome({ playing: true, idleHideSeconds: 5, idleElapsedMs: 5000 })).toBe(true);
  });
});

describe('decideChrome', () => {
  it('hides nothing when no channel is playing', () => {
    expect(decideChrome({ playing: false, settingsOpen: false, idleHideSeconds: 5, idleElapsedMs: 9999 }))
      .toEqual({ immersive: false, overlay: false });
  });

  it('never engages immersive while the settings screen is open', () => {
    expect(decideChrome({ playing: true, settingsOpen: true, idleHideSeconds: 5, idleElapsedMs: 9999 }))
      .toEqual({ immersive: false, overlay: false });
  });

  it('shows the overlay but stays out of immersive in the peek window', () => {
    expect(decideChrome({ playing: true, settingsOpen: false, idleHideSeconds: 5, idleElapsedMs: 1000 }))
      .toEqual({ immersive: false, overlay: true });
  });

  it('fades the overlay after its peek window even while immersive is still off', () => {
    expect(decideChrome({ playing: true, settingsOpen: false, idleHideSeconds: 10, idleElapsedMs: 4000 }))
      .toEqual({ immersive: false, overlay: false });
  });

  it('fades the overlay after the peek window when auto-hide is disabled (Never)', () => {
    expect(decideChrome({ playing: true, settingsOpen: false, idleHideSeconds: 0, idleElapsedMs: 4000 }))
      .toEqual({ immersive: false, overlay: false });
  });

  it('enters immersive and drops the overlay once idle while playing', () => {
    expect(decideChrome({ playing: true, settingsOpen: false, idleHideSeconds: 5, idleElapsedMs: 5000 }))
      .toEqual({ immersive: true, overlay: false });
  });
});
