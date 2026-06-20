/**
 * Pure timing helpers for immersive idle mode. Kept DOM-free so the hide
 * decision is unit-testable without a renderer; app.js owns the listeners,
 * timers, and class toggles.
 */

const DEFAULT_IDLE_SECONDS = 5;
const MAX_IDLE_SECONDS = 30;

/**
 * Coerce stored/slider input into a valid integer delay in [0, 30].
 * Slider `.value` arrives as a string, so we coerce numerically; null,
 * undefined, empty, and non-numeric input fall back to the default.
 */
export function clampIdleSeconds(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_IDLE_SECONDS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_IDLE_SECONDS;
  return Math.min(MAX_IDLE_SECONDS, Math.max(0, Math.floor(n)));
}

/** Slider label: 0 disables hiding, so show "Never" instead of "0s". */
export function formatIdleLabel(seconds) {
  return seconds <= 0 ? 'Never' : `${seconds}s`;
}

/**
 * Whether chrome should be hidden now. Only while a channel plays and the
 * feature is enabled (delay > 0); 0 means the user disabled auto-hide.
 */
export function shouldHideChrome({ playing, idleHideSeconds, idleElapsedMs }) {
  if (!playing || idleHideSeconds <= 0) return false;
  return idleElapsedMs >= idleHideSeconds * 1000;
}

/** The now-playing overlay is a quick peek: it fades this long after input. */
export const OVERLAY_FADE_MS = 3000;

/**
 * Resolve the two visual flags the controller toggles, so the gating rules are
 * testable without a DOM. Nothing shows unless a channel is playing and the
 * settings screen is closed — otherwise immersive must not engage behind an
 * open settings card. The now-playing overlay is a short peek (OVERLAY_FADE_MS)
 * after the last input, on its own timer, independent of the full-chrome hide;
 * it is always gone once immersive engages.
 */
export function decideChrome({ playing, settingsOpen, idleHideSeconds, idleElapsedMs }) {
  if (!playing || settingsOpen) return { immersive: false, overlay: false };
  const immersive = shouldHideChrome({ playing, idleHideSeconds, idleElapsedMs });
  const overlay = !immersive && idleElapsedMs < OVERLAY_FADE_MS;
  return { immersive, overlay };
}
