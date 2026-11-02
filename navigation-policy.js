// The app is a single local page and never navigates or opens windows on
// purpose. Anything that tries to (a file dropped on the window, a stray link)
// would land a foreign page in a window whose preload exposes window.api.
function lockNavigation(contents) {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = { lockNavigation };
