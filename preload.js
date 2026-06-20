const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
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
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),
  // Immersive mode: snap the window to the playing video's aspect ratio to
  // drop letterbox bars, then restore the previous size when chrome returns.
  immersiveFill: (aspect) => ipcRenderer.invoke('immersive-fill', aspect),
  immersiveFillClear: () => ipcRenderer.invoke('immersive-fill-clear'),
});
