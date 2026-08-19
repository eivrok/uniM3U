const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
  // Playlist fetch with optional revalidation. Resolves { notModified: true }
  // when the server confirms the cached copy is still current.
  fetchPlaylist: (url, validators) => ipcRenderer.invoke('fetch-playlist', url, validators),
  // Xtream Codes catalogue. Resolves null for an ordinary M3U url, and rejects
  // with an XtreamUnavailable error when the panel cannot serve player_api.php,
  // so the caller can fall back to the M3U.
  fetchXtream: (url) => ipcRenderer.invoke('fetch-xtream', url),
  fetchSeriesInfo: (url, seriesId) => ipcRenderer.invoke('fetch-series-info', url, seriesId),
  // Subscribe to download progress. Returns an unsubscribe function — call it
  // when the download finishes so listeners don't accumulate.
  onFetchProgress: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('fetch-progress', listener);
    return () => ipcRenderer.removeListener('fetch-progress', listener);
  },
  onUpdateReady: (cb) => {
    const listener = (_event, version) => cb(version);
    ipcRenderer.on('update-ready', listener);
    return () => ipcRenderer.removeListener('update-ready', listener);
  },
  restartToUpdate: () => ipcRenderer.invoke('quit-and-install'),
  getVersion: () => ipcRenderer.invoke('app-version'),
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  // Batched variants — one IPC round trip and one config-file cycle for many
  // keys. Prefer these wherever several settings are read or written together.
  storeGetMany: (keys) => ipcRenderer.invoke('store-get-many', keys),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeSetMany: (entries) => ipcRenderer.invoke('store-set-many', entries),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),
  // Playlist cache lives in its own file, not in the settings store.
  cacheRead: () => ipcRenderer.invoke('cache-read'),
  cacheWrite: (raw) => ipcRenderer.invoke('cache-write', raw),
  xtreamCacheRead: () => ipcRenderer.invoke('xtream-cache-read'),
  xtreamCacheWrite: (json) => ipcRenderer.invoke('xtream-cache-write', json),
  // Immersive mode: snap the window to the playing video's aspect ratio to
  // drop letterbox bars, then restore the previous size when chrome returns.
  immersiveFill: (aspect) => ipcRenderer.invoke('immersive-fill', aspect),
  immersiveFillClear: () => ipcRenderer.invoke('immersive-fill-clear'),
});
