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
