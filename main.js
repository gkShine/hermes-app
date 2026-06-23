const { app, BrowserWindow, globalShortcut } = require('electron');
const { registerIpcHandlers } = require('./modules/ipc');
const {
  createWindow,
  createTray,
  createMenu,
  registerShortcuts,
  showWindow,
  checkHermesRunning,
  startHermes,
  stopHermes
} = require('./modules/ui');

// 单实例锁定
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

registerIpcHandlers();

app.whenReady().then(() => {
  const { checkHermesPathValid } = require('./modules/config');
  const pathValid = checkHermesPathValid();

  if (!pathValid) {
    console.log('[Hermes] Hermes path not configured or invalid, showing config page');
    createWindow(true);
    createTray();
    createMenu();
    registerShortcuts();
    return;
  }

  checkHermesRunning((running) => {
    if (running) {
      console.log('[Hermes] hermes-webui already running');
      createWindow();
      createTray();
      createMenu();
      registerShortcuts();
    } else {
      startHermes((success) => {
        createWindow();
        createTray();
        createMenu();
        registerShortcuts();
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  showWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopHermes();
});
