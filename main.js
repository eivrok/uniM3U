const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const https = require('https');
const http = require('http');

const store = new Store({
  encryptionKey: 'iptv-player-key',
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: fetch M3U playlist via main process (avoids CORS), follows redirects
ipcMain.handle('fetch-url', async (event, url) => {
  // Report download progress against the originally requested url so the
  // renderer can correlate events when several fetches run at once.
  const onProgress = (received, total) =>
    event.sender.send('fetch-progress', { url, received, total });
  return fetchFollowRedirects(url, 5, onProgress);
});

// Emit a progress event at most every PROGRESS_INTERVAL bytes to avoid
// flooding the IPC channel on large playlists.
const PROGRESS_INTERVAL = 262144; // 256 KB

function fetchFollowRedirects(url, maxRedirects, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IPTV-Player/1.0)' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.destroy();
        resolve(fetchFollowRedirects(redirectUrl, maxRedirects - 1, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from server`));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      const chunks = [];
      let received = 0;
      let lastEmit = 0;
      res.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        if (received - lastEmit >= PROGRESS_INTERVAL) {
          lastEmit = received;
          onProgress?.(received, total);
        }
      });
      res.on('end', () => {
        onProgress?.(received, total);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 60s')); });
  });
}

// IPC: settings store
ipcMain.handle('store-get', (_event, key) => store.get(key));
ipcMain.handle('store-set', (_event, key, value) => { store.set(key, value); });
ipcMain.handle('store-delete', (_event, key) => { store.delete(key); });
