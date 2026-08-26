// electron-store is constructed while main.js is still being imported, so an
// unreadable config.json used to throw before any window, logger or handler
// existed. The user saw "A JavaScript error occurred in the main process" with
// a raw stack trace and the app never started. Losing settings is bad; refusing
// to launch is worse, so an unreadable config is set aside and the app starts
// on a fresh one.

// conf decrypts the file and then JSON.parses it. A payload it cannot decrypt
// is handed to JSON.parse as-is, so the failure surfaces as a SyntaxError
// rather than anything crypto-specific. Other failures (a locked file, denied
// permissions) are not the config's fault and must not cost the user's data.
function isUnreadableConfig(err) {
  return err instanceof SyntaxError;
}

function openStore({ createStore, quarantineConfig }) {
  try {
    return { store: createStore(), recovered: false, backupPath: null };
  } catch (err) {
    if (!isUnreadableConfig(err)) throw err;

    const backupPath = quarantineConfig();
    // A fresh store failing too means the config was never the problem, so let
    // that error escape rather than looping.
    return { store: createStore(), recovered: true, backupPath };
  }
}

module.exports = { openStore, isUnreadableConfig };
