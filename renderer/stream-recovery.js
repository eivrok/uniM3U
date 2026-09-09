// Decides how to react when a stream drops. Kept free of DOM and player
// libraries so the ladder can be tested without a live stream.
//
// IPTV providers cap concurrent connections and treat a fast reconnect loop as
// abuse, so every step is delayed and the ladder gives up rather than hammering.
export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1000;
export const MAX_DELAY_MS = 30_000;

// How long the stall watchdog lets `currentTime` sit still before it calls the
// stream dead. Dead IPTV streams usually stop sending bytes without either
// player library ever raising an error.
export const STALL_TIMEOUT_MS = 10_000;
export const STALL_POLL_MS = 2000;

// A stream that has not started yet, or is still filling its buffer, looks
// exactly like a stalled one: playback is unpaused and currentTime is not
// moving. HEVC channels routinely need several seconds before the first frame,
// and mpegts.js runs its own startup seek in that window, so tearing the stream
// down on the short timeout kills a stream that was about to play.
export const STARTUP_TIMEOUT_MS = 30_000;

/**
 * Bytes still arriving means the network is fine and the hold-up is decode or
 * startup, which a reload does not fix and usually makes worse.
 */
export function stallTimeoutMs({ hasPlayed, bufferGrowing }) {
  if (!hasPlayed || bufferGrowing) return STARTUP_TIMEOUT_MS;
  return STALL_TIMEOUT_MS;
}

// Uninterrupted playback for this long means the stream recovered, so the next
// drop starts the ladder over from the top instead of inheriting old attempts.
export const STABLE_PLAYBACK_MS = 10_000;

export function retryDelayMs(attempt) {
  const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * @param {object} args
 * @param {'hls'|'mpegts'|'native'} args.engine
 * @param {'network'|'media'|'other'|'stall'} args.kind
 * @param {number} args.attempt  1-based count of consecutive recovery attempts
 * @returns {{action: 'resume-load'|'recover-media'|'reload'|'give-up',
 *            delayMs?: number, swapAudioCodec?: boolean}}
 */
export function planRecovery({ engine, kind, attempt }) {
  if (attempt > MAX_ATTEMPTS) return { action: 'give-up' };

  const delayMs = retryDelayMs(attempt);

  // Only hls.js exposes in-place recovery. mpegts.js and native playback have
  // no equivalent, so their single option is a full teardown and reload.
  if (engine === 'hls' && kind === 'network' && attempt <= 2) {
    return { action: 'resume-load', delayMs };
  }
  if (engine === 'hls' && kind === 'media' && attempt <= 2) {
    // A second media error on the same stream is usually an audio codec switch
    // mid-broadcast, which recoverMediaError alone does not clear.
    return { action: 'recover-media', delayMs, swapAudioCodec: attempt === 2 };
  }

  return { action: 'reload', delayMs };
}
