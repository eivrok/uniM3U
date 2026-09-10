import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Player } from './player.js';
import {
  STALL_POLL_MS,
  STALL_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
  STABLE_PLAYBACK_MS,
  MAX_ATTEMPTS,
} from './stream-recovery.js';

// A .mp4 url routes to the native path, which touches only the video element —
// so the recovery ladder can be driven end to end without hls.js or mpegts.js.
const VOD_URL = 'http://example.com/movie.mp4';

function fakeVideo() {
  return {
    currentTime: 0,
    paused: false,
    seeking: false,
    ended: false,
    src: '',
    buffered: { length: 0, end: () => 0 },
    playCount: 0,
    play() {
      this.playCount += 1;
      return Promise.resolve();
    },
    load() {},
    removeAttribute() {},
    canPlayType: () => '',
  };
}

/** Simulates a healthy stream: currentTime keeps up with wall clock. */
function playFor(video, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += STALL_POLL_MS) {
    video.currentTime += STALL_POLL_MS / 1000;
    vi.advanceTimersByTime(STALL_POLL_MS);
  }
}

/** Advances past the poll that would notice a stall, plus its backoff delay. */
function runStallCycle(timeoutMs, backoffMs) {
  vi.advanceTimersByTime(timeoutMs + STALL_POLL_MS);
  vi.advanceTimersByTime(backoffMs);
}

function fakeNetwork() {
  return {
    online: true,
    onlineCbs: [],
    offlineCbs: [],
    isOnline() {
      return this.online;
    },
    onOnline(cb) {
      this.onlineCbs.push(cb);
      return () => {};
    },
    onOffline(cb) {
      this.offlineCbs.push(cb);
      return () => {};
    },
    goOffline() {
      this.online = false;
      this.offlineCbs.forEach((cb) => cb());
    },
    goOnline() {
      this.online = true;
      this.onlineCbs.forEach((cb) => cb());
    },
  };
}

describe('Player stream recovery', () => {
  let video;
  let net;
  let player;

  beforeEach(() => {
    vi.useFakeTimers();
    video = fakeVideo();
    net = fakeNetwork();
    player = new Player(video, net);
  });

  afterEach(() => {
    player._destroy();
    vi.useRealTimers();
  });

  it('starts playback once when a channel is loaded', () => {
    player.load(VOD_URL);
    expect(video.playCount).toBe(1);
  });

  it('leaves a stream that has not started yet alone during the startup grace period', () => {
    player.load(VOD_URL);
    vi.advanceTimersByTime(STALL_TIMEOUT_MS + STALL_POLL_MS);
    expect(video.playCount).toBe(1);
  });

  it('reloads a stream that never starts once the startup budget expires', () => {
    player.load(VOD_URL);
    runStallCycle(STARTUP_TIMEOUT_MS, 1000);
    expect(video.playCount).toBe(2);
  });

  it('leaves a stalled stream alone while its buffer is still growing', () => {
    player.load(VOD_URL);
    let end = 0;
    video.buffered = { length: 1, end: () => (end += 1) };
    vi.advanceTimersByTime(STALL_TIMEOUT_MS + STALL_POLL_MS);
    expect(video.playCount).toBe(1);
  });

  it('reloads a stream that stops progressing after it has played', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS); // records progress, sets hasPlayed
    runStallCycle(STALL_TIMEOUT_MS, 1000);
    expect(video.playCount).toBe(2);
  });

  it('holds the attempt budget open while a recovered stream is still proving itself', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    runStallCycle(STALL_TIMEOUT_MS, 1000);

    playFor(video, STABLE_PLAYBACK_MS / 2);
    expect(player._attempt).toBe(1);
  });

  it('clears the attempt budget once a recovered stream plays steadily again', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    runStallCycle(STALL_TIMEOUT_MS, 1000);

    playFor(video, STABLE_PLAYBACK_MS + STALL_POLL_MS);
    expect(player._attempt).toBe(0);
  });

  it('stops retrying once the attempt budget is spent', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);

    for (const backoff of [1000, 2000, 4000, 8000, 16_000]) {
      runStallCycle(STALL_TIMEOUT_MS, backoff);
    }
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(video.playCount).toBe(1 + MAX_ATTEMPTS);
  });

  it('stops polling after it gives up, so a dead channel costs nothing', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    for (const backoff of [1000, 2000, 4000, 8000, 16_000]) {
      runStallCycle(STALL_TIMEOUT_MS, backoff);
    }
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives a newly selected channel its own attempt budget', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    for (const backoff of [1000, 2000, 4000, 8000, 16_000]) {
      runStallCycle(STALL_TIMEOUT_MS, backoff);
    }

    player.load('http://example.com/other.mp4');
    const afterSwitch = video.playCount;
    runStallCycle(STARTUP_TIMEOUT_MS, 1000);

    expect(video.playCount).toBe(afterSwitch + 1);
  });

  it('does not reload a stalled stream while the machine is offline', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    net.goOffline();

    runStallCycle(STALL_TIMEOUT_MS, 1000);
    expect(video.playCount).toBe(1);
  });

  it('spends no attempt budget on an outage', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    net.goOffline();
    runStallCycle(STALL_TIMEOUT_MS, 1000);

    expect(player._attempt).toBe(0);
  });

  it('survives an outage longer than the whole backoff ladder', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    net.goOffline();
    vi.advanceTimersByTime(10 * 60 * 1000);
    net.goOnline();

    expect(video.playCount).toBe(2);
  });

  it('reloads as soon as the network returns, without waiting out a backoff', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    net.goOffline();
    runStallCycle(STALL_TIMEOUT_MS, 1000);
    net.goOnline();

    expect(video.playCount).toBe(2);
  });

  it('drops a retry that was already scheduled when the network went away', () => {
    player.load(VOD_URL);
    video.currentTime = 5;
    vi.advanceTimersByTime(STALL_POLL_MS);
    // Stops on the poll that detects the stall, before its 1000ms retry fires.
    vi.advanceTimersByTime(STALL_TIMEOUT_MS);
    net.goOffline();
    vi.advanceTimersByTime(60_000);

    expect(video.playCount).toBe(1);
  });

  it('ignores the network returning when no channel is loaded', () => {
    net.goOffline();
    net.goOnline();
    expect(video.playCount).toBe(0);
  });

  it('stops the watchdog when the player is destroyed', () => {
    player.load(VOD_URL);
    player._destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
