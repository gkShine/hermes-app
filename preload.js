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
  settings: {
    get: () => ipcRenderer.invoke('settings-get'),
    checkPath: (path) => ipcRenderer.invoke('settings-check-path', path),
    save: (data) => ipcRenderer.invoke('settings-save', data)
  },
  log: {
    getLogs: () => ipcRenderer.invoke('log-get-logs'),
    clear: () => ipcRenderer.invoke('log-clear'),
    onNewLog: (callback) => {
      ipcRenderer.on('new-log', callback);
    },
    onInstallProgress: (callback) => {
      ipcRenderer.on('install-progress', callback);
    }
  },
  config: {
    get: () => ipcRenderer.invoke('config-get'),
    set: (data) => ipcRenderer.invoke('config-set', data),
    check: () => ipcRenderer.invoke('config-check'),
    startHermes: (path) => ipcRenderer.invoke('start-hermes', path),
    loadUrl: () => ipcRenderer.invoke('window-load-url'),
    installHermes: () => ipcRenderer.invoke('install-hermes'),
    checkHermesCLI: () => ipcRenderer.invoke('check-hermes-cli'),
    onInstallProgress: (callback) => {
      ipcRenderer.on('install-progress', callback);
    },
    removeInstallProgressListener: (callback) => {
      ipcRenderer.removeListener('install-progress', callback);
    },
    onInstallLog: (callback) => {
      ipcRenderer.on('install-log', callback);
    },
    removeInstallLogListener: (callback) => {
      ipcRenderer.removeListener('install-log', callback);
    }
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  },
  update: {
    check: () => ipcRenderer.invoke('update-check'),
    download: () => ipcRenderer.invoke('update-download'),
    restart: () => ipcRenderer.invoke('update-restart'),
    onProgress: (callback) => {
      ipcRenderer.on('install-progress', callback);
    },
    onLog: (callback) => {
      ipcRenderer.on('install-log', callback);
    }
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
    readText: () => ipcRenderer.invoke('clipboard-read-text')
  },
  notification: {
    show: (title, body) => ipcRenderer.invoke('notification-show', title, body),
    onNotification: (callback) => {
      ipcRenderer.on('webui-notification', (event, title, body) => callback(title, body));
    },
    removeNotificationListener: (callback) => {
      ipcRenderer.removeListener('webui-notification', callback);
    }
  },
  contextMenu: {
    show: () => ipcRenderer.send('show-context-menu')
  }
});
