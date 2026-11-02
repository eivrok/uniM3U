class BodyTooLargeError extends Error {}

// Counts decoded bytes, not bytes off the wire: a few megabytes of brotli can
// inflate to gigabytes and exhaust the main process before 'end' ever fires.
function byteBudget(maxBytes) {
  let taken = 0;
  return (chunkBytes) => {
    taken += chunkBytes;
    if (taken > maxBytes) {
      throw new BodyTooLargeError(
        `Response is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`,
      );
    }
  };
}

module.exports = { byteBudget, BodyTooLargeError };
