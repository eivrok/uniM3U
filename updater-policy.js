// Auto-update only makes sense in a packaged build, and only on platforms we
// can update without code signing. macOS (Squirrel.Mac) refuses unsigned apps,
// so it is excluded.
function shouldAutoUpdate(platform, isPackaged) {
  return isPackaged && (platform === 'win32' || platform === 'linux');
}

module.exports = { shouldAutoUpdate };
