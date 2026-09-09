import { describe, it, expect } from 'vitest';
import {
  planRecovery,
  retryDelayMs,
  stallTimeoutMs,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  STALL_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
} from './stream-recovery.js';

describe('retryDelayMs', () => {
  it('waits the base delay on the first attempt', () => {
    expect(retryDelayMs(1)).toBe(BASE_DELAY_MS);
  });

  it('doubles the delay on each further attempt', () => {
    expect(retryDelayMs(3)).toBe(BASE_DELAY_MS * 4);
  });

  it('stops growing once the delay reaches the ceiling', () => {
    expect(retryDelayMs(20)).toBe(MAX_DELAY_MS);
  });
});

describe('stallTimeoutMs', () => {
  it('grants the startup budget before the stream has ever played', () => {
    expect(stallTimeoutMs({ hasPlayed: false, bufferGrowing: false })).toBe(STARTUP_TIMEOUT_MS);
  });

  it('grants the startup budget while the buffer is still filling', () => {
    expect(stallTimeoutMs({ hasPlayed: true, bufferGrowing: true })).toBe(STARTUP_TIMEOUT_MS);
  });

  it('uses the short budget once playback started and bytes stopped arriving', () => {
    expect(stallTimeoutMs({ hasPlayed: true, bufferGrowing: false })).toBe(STALL_TIMEOUT_MS);
  });
});

describe('planRecovery', () => {
  it('gives up once the attempt budget is spent', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'network', attempt: MAX_ATTEMPTS + 1 });
    expect(plan.action).toBe('give-up');
  });

  it('omits a delay when it gives up', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'network', attempt: MAX_ATTEMPTS + 1 });
    expect(plan.delayMs).toBeUndefined();
  });

  it('resumes loading on a first HLS network error', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'network', attempt: 1 });
    expect(plan.action).toBe('resume-load');
  });

  it('escalates to a full reload after two failed HLS network retries', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'network', attempt: 3 });
    expect(plan.action).toBe('reload');
  });

  it('recovers in place on a first HLS media error', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'media', attempt: 1 });
    expect(plan.action).toBe('recover-media');
  });

  it('leaves the audio codec alone on a first HLS media error', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'media', attempt: 1 });
    expect(plan.swapAudioCodec).toBe(false);
  });

  it('swaps the audio codec on a second HLS media error', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'media', attempt: 2 });
    expect(plan.swapAudioCodec).toBe(true);
  });

  it('escalates to a full reload after two failed HLS media recoveries', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'media', attempt: 3 });
    expect(plan.action).toBe('reload');
  });

  it('reloads rather than recovering in place on an unclassified HLS error', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'other', attempt: 1 });
    expect(plan.action).toBe('reload');
  });

  it('reloads a stalled HLS stream, since no error was raised to recover from', () => {
    const plan = planRecovery({ engine: 'hls', kind: 'stall', attempt: 1 });
    expect(plan.action).toBe('reload');
  });

  it('reloads on an mpegts network error, which has no in-place recovery', () => {
    const plan = planRecovery({ engine: 'mpegts', kind: 'network', attempt: 1 });
    expect(plan.action).toBe('reload');
  });

  it('reloads on an mpegts media error, which has no in-place recovery', () => {
    const plan = planRecovery({ engine: 'mpegts', kind: 'media', attempt: 1 });
    expect(plan.action).toBe('reload');
  });

  it('reloads a stalled native stream', () => {
    const plan = planRecovery({ engine: 'native', kind: 'stall', attempt: 1 });
    expect(plan.action).toBe('reload');
  });

  it('backs off further on each consecutive attempt', () => {
    const plan = planRecovery({ engine: 'mpegts', kind: 'network', attempt: 4 });
    expect(plan.delayMs).toBe(retryDelayMs(4));
  });
});
