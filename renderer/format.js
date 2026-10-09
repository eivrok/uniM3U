/**
 * Human-readable download progress text.
 *
 * When the server sends a Content-Length we show "got / total MB (pct%)";
 * otherwise only the bytes received so far ("got MB"), since percent is
 * unknowable for a chunked/length-less response.
 */
export function formatDownloadProgress(received, total) {
  const mb = (bytes) => (bytes / 1048576).toFixed(1);
  if (total > 0) {
    const pct = Math.round((received / total) * 100);
    return `Downloading playlist… ${mb(received)} / ${mb(total)} MB (${pct}%)`;
  }
  return `Downloading playlist… ${mb(received)} MB`;
}

/**
 * The user's time format setting. Anything other than '12h' — including an
 * unset store key — is 24h, which is the default.
 */
export function normalizeTimeFormat(value) {
  return value === '12h' ? '12h' : '24h';
}

/**
 * Hour and minute as "08:05" (24h) or "8:05 AM" (12h). Built by hand rather
 * than with toLocaleTimeString so the OS locale can't override the setting.
 */
function formatHourMinute(hours, minutes, timeFormat) {
  const mm = String(minutes).padStart(2, '0');
  if (timeFormat === '12h') {
    const suffix = hours < 12 ? 'AM' : 'PM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${h12}:${mm} ${suffix}`;
  }
  return `${String(hours).padStart(2, '0')}:${mm}`;
}

/** Local time of a Date in the given format. */
export function formatClockTime(date, timeFormat) {
  return formatHourMinute(date.getHours(), date.getMinutes(), timeFormat);
}

/**
 * Reformat an "H:MM" string parsed from a provider's channel name. A value
 * that isn't a valid time of day is returned as the provider wrote it.
 */
export function formatClockString(text, timeFormat) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return text;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return text;
  return formatHourMinute(hours, minutes, timeFormat);
}
