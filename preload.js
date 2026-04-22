const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized')
  },
  app: {
    quit: () => ipcRenderer.invoke('app-quit'),
    getVersion: () => ipcRenderer.invoke('app-version')
  },
  config: {
    get: () => ipcRenderer.invoke('config-get'),
    set: (path) => ipcRenderer.invoke('config-set', path),
    check: () => ipcRenderer.invoke('config-check'),
    startHermes: (path) => ipcRenderer.invoke('start-hermes', path),
    loadUrl: () => ipcRenderer.invoke('window-load-url')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  }
});
