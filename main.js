const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const zlib = require('zlib');
const Store = require('electron-store');
const https = require('https');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const { shouldAutoUpdate } = require('./updater-policy');
const { conditionalHeaders } = require('./http-cache-policy');
const { isXtreamUrl, xtreamCreds, xtreamApiUrl } = require('./xtream-url');
const { openStore } = require('./store-recovery');

// Computed rather than read off the store, because the case this handles is
// the store failing to exist at all. config.json is conf's default name.
function configFilePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Kept, not deleted. The file still holds the user's settings and a later
// version may manage to read it.
function quarantineConfigFile() {
  const kept = path.join(app.getPath('userData'), `config.unreadable-${Date.now()}.json`);
  fs.renameSync(configFilePath(), kept);
  return kept;
}

const { store, recovered: settingsWereReset, backupPath: unreadableConfigPath } = openStore({
  createStore: () => new Store({ encryptionKey: 'iptv-player-key' }),
  quarantineConfig: quarantineConfigFile,
});

if (settingsWereReset) {
  console.error(`settings could not be read and were reset; previous file kept at ${unreadableConfigPath}`);
}

let mainWindow;

// The playlist is cached as its own file rather than inside electron-store.
// conf (electron-store's backend) re-reads, decrypts and JSON-parses the whole
// config file on every single get(), and does a full read *plus* a full write
// on every set(). With a multi-megabyte playlist in there, every unrelated
// settings read — favourites, last channel, window prefs — cost seconds.
function playlistCachePath() {
  return path.join(app.getPath('userData'), 'playlist-cache.m3u');
}

// One-time move of an existing cached playlist out of the store, so upgrading
// users keep their cache instead of being forced into a fresh download.
function migratePlaylistCacheOutOfStore() {
  if (!store.has('playlistCache')) return;
  try {
    const raw = store.get('playlistCache');
    if (typeof raw === 'string' && raw.length > 0) {
      fs.writeFileSync(playlistCachePath(), raw, 'utf8');
    }
    // Only drop the store copy once the file is safely on disk.
    store.delete('playlistCache');
  } catch (err) {
    // A failed migration must not block startup; the app just re-downloads.
    console.error('playlist cache migration failed:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // One title bar, not two: the app already draws "UniM3U" in the sidebar
    // header, so the native caption bar was a second copy of the same title.
    // 'hiddenInset' is macOS-only, which is why Windows kept showing its frame.
    titleBarStyle: 'hidden',
    // Windows/Linux have no traffic lights, so the caption buttons are drawn as
    // an overlay over the (black) top-right of the player area. Without this the
    // frameless window would have no minimise/maximise/close at all.
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarOverlay: { color: '#000000', symbolColor: '#aaaaaa', height: 40 } }),
    autoHideMenuBar: true, // hide the Win/Linux menu bar (Alt reveals); macOS uses the system menu
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#111111',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function initAutoUpdater() {
  if (!shouldAutoUpdate(process.platform, app.isPackaged)) return;

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-ready', info.version);
  });
  // A failed update must never interrupt playback — log and move on.
  autoUpdater.on('error', (err) => {
    console.error('auto-update failed:', err);
  });

  autoUpdater.checkForUpdates();
}

app.whenReady().then(() => {
  // Allow IPTV stream content-type
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
      },
    });
  });

  migratePlaylistCacheOutOfStore();
  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Report download progress against the originally requested url so the
// renderer can correlate events when several fetches run at once.
function progressReporter(event, url) {
  return (received, total) => event.sender.send('fetch-progress', { url, received, total });
}

// IPC: fetch a url via main process (avoids CORS), follows redirects.
// Used for the EPG, which is small enough not to need revalidation.
ipcMain.handle('fetch-url', async (event, url) => {
  const result = await fetchFollowRedirects(url, 5, progressReporter(event, url));
  // No validators were sent, so a 304 here means the server is misbehaving.
  if (result.notModified) throw new Error('Server sent 304 to an unconditional request');
  return result.body;
});

// IPC: fetch the playlist, revalidating against a cached copy when the caller
// has validators. Resolves { notModified: true } on a 304, otherwise
// { body, etag, lastModified }.
ipcMain.handle('fetch-playlist', (event, url, validators) =>
  fetchFollowRedirects(url, 5, progressReporter(event, url), validators));

// A panel that has player_api.php disabled still answers with 200 and an HTML
// error page, and bad credentials come back as {"user_info":{"auth":0}}. Neither
// is an array, so requiring an array is what separates "works" from "fall back
// to the M3U".
async function xtreamJson(creds, params, expectArray) {
  const url = xtreamApiUrl(creds, params);
  let body;
  try {
    ({ body } = await fetchFollowRedirects(url, 5, null));
  } catch (err) {
    // Rethrow with the prefix the contract promises, keeping the original for
    // server-side diagnosis. Never include `url` — it carries credentials.
    throw new Error(`XtreamUnavailable: ${params.action} request failed: ${err.message}`, { cause: err });
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`XtreamUnavailable: ${params.action} did not return JSON`);
  }
  if (expectArray && !Array.isArray(parsed)) {
    throw new Error(`XtreamUnavailable: ${params.action} did not return a list`);
  }
  return parsed;
}

ipcMain.handle('fetch-xtream', async (_event, m3uUrl) => {
  // null means "not an Xtream url" — an ordinary M3U, not a failure.
  if (!isXtreamUrl(m3uUrl)) return null;
  const creds = xtreamCreds(m3uUrl);

  const t0 = Date.now();
  // Categories first: they are tiny, and fetching them before the multi-megabyte
  // stream lists means bad credentials fail fast instead of after ~30 MB. Two
  // waves of three keep concurrency at a level actually measured against this
  // panel — six at once was untested and fetchFollowRedirects can't be aborted,
  // so a single rejection would otherwise leave five requests buffering unread.
  const [liveCats, vodCats, seriesCats] = await Promise.all([
    xtreamJson(creds, { action: 'get_live_categories' }, true),
    xtreamJson(creds, { action: 'get_vod_categories' }, true),
    xtreamJson(creds, { action: 'get_series_categories' }, true),
  ]);
  const [liveStreams, vodStreams, seriesList] = await Promise.all([
    xtreamJson(creds, { action: 'get_live_streams' }, true),
    xtreamJson(creds, { action: 'get_vod_streams' }, true),
    xtreamJson(creds, { action: 'get_series' }, true),
  ]);
  console.log(`[perf] xtream catalogue fetched in ${Date.now() - t0}ms`
    + ` (live ${liveStreams.length}, vod ${vodStreams.length}, series ${seriesList.length})`);

  return {
    creds,
    live: { categories: liveCats, streams: liveStreams },
    vod: { categories: vodCats, streams: vodStreams },
    series: { categories: seriesCats, streams: seriesList },
  };
});

ipcMain.handle('fetch-series-info', async (_event, m3uUrl, seriesId) => {
  if (!isXtreamUrl(m3uUrl)) throw new Error('XtreamUnavailable: not an xtream url');
  // get_series_info returns an object, not a list, so no array check here.
  return xtreamJson(xtreamCreds(m3uUrl), { action: 'get_series_info', series_id: seriesId }, false);
});

// Emit a progress event at most every PROGRESS_INTERVAL bytes to avoid
// flooding the IPC channel on large playlists.
const PROGRESS_INTERVAL = 262144; // 256 KB

// An M3U is highly repetitive text and compresses roughly ten to one, but Node
// neither asks for compression nor decodes it on its own. Servers that don't
// support this just reply with an identity encoding, so asking costs nothing.
function decompressor(contentEncoding) {
  switch ((contentEncoding || '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function fetchFollowRedirects(url, maxRedirects, onProgress, validators) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const tStart = Date.now();
    const req = client.get(url, {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IPTV-Player/1.0)',
        'Accept-Encoding': 'gzip, deflate, br',
        ...conditionalHeaders(validators),
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.destroy();
        resolve(fetchFollowRedirects(redirectUrl, maxRedirects - 1, onProgress, validators));
        return;
      }
      if (res.statusCode === 304) {
        res.destroy();
        console.log(`[perf] fetch 304 not modified after ${Date.now() - tStart}ms — cache reused`);
        resolve({ notModified: true });
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from server`));
        return;
      }
      // content-length is the compressed size when the body is encoded, which
      // is also what `received` counts — progress stays a true fraction.
      const total = Number(res.headers['content-length']) || 0;
      const encoding = res.headers['content-encoding'];
      const inflate = decompressor(encoding);
      const body = inflate ? res.pipe(inflate) : res;

      const chunks = [];
      let received = 0;
      let lastEmit = 0;

      // Progress tracks bytes off the wire; chunks collect decoded bytes.
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received - lastEmit >= PROGRESS_INTERVAL) {
          lastEmit = received;
          onProgress?.(received, total);
        }
      });
      if (inflate) inflate.on('error', reject);

      body.on('data', (chunk) => { chunks.push(chunk); });
      body.on('end', () => {
        onProgress?.(received, total);
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          body: text,
          etag: res.headers.etag || null,
          lastModified: res.headers['last-modified'] || null,
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 60s')); });
  });
}

// IPC: playlist cache file
ipcMain.handle('cache-read', async () => {
  try {
    return await fsp.readFile(playlistCachePath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null; // nothing cached yet
    throw err;
  }
});

// Write via a temp file + rename so a crash mid-write can't leave a truncated
// playlist behind — a partial M3U parses fine and would silently lose channels.
ipcMain.handle('cache-write', async (_event, raw) => {
  const target = playlistCachePath();
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, raw, 'utf8');
  await fsp.rename(tmp, target);
});

function xtreamCachePath() {
  return path.join(app.getPath('userData'), 'xtream-cache.json');
}

ipcMain.handle('xtream-cache-read', async () => {
  try {
    return await fsp.readFile(xtreamCachePath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('xtream-cache-write', async (_event, json) => {
  const target = xtreamCachePath();
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, json, 'utf8');
  await fsp.rename(tmp, target);
});

// IPC: settings store
ipcMain.handle('store-get', (_event, key) => store.get(key));
// Batched reads: one decrypt + parse of the config file for all keys, instead
// of one full cycle per key.
ipcMain.handle('store-get-many', (_event, keys) => {
  const all = store.store;
  return Object.fromEntries(keys.map((key) => [key, all[key]]));
});
ipcMain.handle('store-set', (_event, key, value) => { store.set(key, value); });
// Batched writes: conf accepts an object and persists it in a single write.
ipcMain.handle('store-set-many', (_event, entries) => { store.set(entries); });
ipcMain.handle('store-delete', (_event, key) => { store.delete(key); });
ipcMain.handle('quit-and-install', () => autoUpdater.quitAndInstall());
ipcMain.handle('app-version', () => app.getVersion());

// IPC: immersive aspect-snap. Shrink the over-sized dimension to the video's
// aspect ratio so letterbox bars disappear, remembering the prior bounds so
// the window pops back to its original size when chrome is revealed.
let preFillBounds = null;
ipcMain.handle('immersive-fill', (_event, aspect) => {
  if (!mainWindow || typeof aspect !== 'number' || !Number.isFinite(aspect) || aspect <= 0) return;
  // Maximized/fullscreen windows can't be freely resized — leave them be.
  if (preFillBounds || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  preFillBounds = mainWindow.getBounds();
  const [w, h] = mainWindow.getContentSize();
  // Keep the picture the same size; trim whichever axis is too long.
  if (w / h > aspect) {
    mainWindow.setContentSize(Math.round(h * aspect), h);
  } else {
    mainWindow.setContentSize(w, Math.round(w / aspect));
  }
});
ipcMain.handle('immersive-fill-clear', () => {
  if (!mainWindow || !preFillBounds) return;
  mainWindow.setBounds(preFillBounds);
  preFillBounds = null;
});
