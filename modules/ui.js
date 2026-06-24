const { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const { spawn, exec } = require('child_process');
const { checkHermesPathValid, getHermesPath } = require('./config');

let mainWindow = null;
let settingsWindow = null;
let logWindow = null;
let updateWindow = null;
let tray = null;
let hermesProcess = null;
let hermesStartedByUs = false;
let installLogs = [];

const WEBUI_URL = process.env.HERMES_WEBUI_URL || 'http://localhost:8787';

function createWindow(loadConfigPage = false) {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Hermes WebUI',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    show: false
  });

  if (loadConfigPage) {
    mainWindow.loadFile(path.join(__dirname, '../renderer/config.html'));
  } else {
    mainWindow.loadURL(WEBUI_URL);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 560,
    minWidth: 500,
    minHeight: 400,
    title: 'Settings',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function openLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show();
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'Installation Log',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  logWindow.loadFile(path.join(__dirname, '../renderer/log.html'));

  logWindow.on('closed', () => {
    logWindow = null;
  });
}

function openUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.show();
    updateWindow.focus();
    return;
  }

  updateWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    title: 'Update',
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  updateWindow.loadFile(path.join(__dirname, '../renderer/update.html'));

  updateWindow.on('closed', () => {
    updateWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../renderer/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Hermes App');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => showWindow() },
    { label: '打开设置', click: () => openSettingsWindow() },
    { label: '查看日志', click: () => openLogWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showWindow());
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '设置', click: () => openSettingsWindow() },
        { label: '检查更新', click: () => openUpdateWindow() },
        { label: '查看日志', click: () => openLogWindow() },
        { type: 'separator' },
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow) mainWindow.reload(); } },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => { if (mainWindow) mainWindow.webContents.openDevTools(); } },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
        { label: '删除', role: 'delete' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '全屏', accelerator: 'F11', click: () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => { if (mainWindow) {
          const zoom = mainWindow.webContents.getZoomLevel();
          mainWindow.webContents.setZoomLevel(zoom + 0.5);
        }}},
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => { if (mainWindow) {
          const zoom = mainWindow.webContents.getZoomLevel();
          mainWindow.webContents.setZoomLevel(zoom - 0.5);
        }}},
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => { if (mainWindow) mainWindow.webContents.setZoomLevel(0); } }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', click: () => { if (mainWindow) mainWindow.minimize(); } },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', click: () => { if (mainWindow) mainWindow.hide(); } }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerShortcuts() {
  globalShortcut.register('CmdOrCtrl+Shift+H', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : showWindow();
    }
  });
}

function showWindow() {
  if (!mainWindow) {
    const pathValid = checkHermesPathValid();
    if (!pathValid) {
      console.log('[Hermes] Hermes path not configured or invalid, showing config page');
      createWindow(true);
      createTray();
      createMenu();
      registerShortcuts();
      return;
    }

    createWindow();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function checkHermesRunning(callback) {
  const url = new URL(WEBUI_URL);
  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'GET',
    timeout: 3000
  };

  const req = http.get(options, (res) => {
    res.resume();
    callback(res.statusCode === 200);
  });

  req.on('error', () => callback(false));
  req.on('timeout', () => {
    req.destroy();
    callback(false);
  });
}

function startHermes(callback) {
  const hermesPath = getHermesPath();
  const hermesScript = path.join(hermesPath, 'start.sh');
  sendLog(`Starting hermes-webui from: ${hermesScript}`, 'info');

  hermesProcess = spawn('bash', [hermesScript], {
    cwd: hermesPath,
    detached: true,
    stdio: 'ignore'
  });

  hermesProcess.unref();
  hermesStartedByUs = true;
  sendLog('hermes-webui started', 'success');
  callback(true);
}

function stopHermes() {
  if (!hermesStartedByUs) return;

  sendLog('Stopping hermes-webui...', 'info');
  exec('pkill -f "python.*server.py" || true', (err) => {
    if (err) {
      sendLog(`pkill error: ${err.message}`, 'error');
    } else {
      sendLog('hermes-webui stopped', 'success');
    }
  });
}

function sendLog(message, type = 'info') {
  console.log('[Hermes]', message);
  if (installLogs) {
    installLogs.push({ message, type });
  }
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('new-log', { message, type });
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('install-log', { message, type });
  }
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('install-log', { message, type });
  }
}

function sendProgress(payload) {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('install-progress', payload);
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('install-progress', payload);
  }
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('install-progress', payload);
  }
}

module.exports = {
  createWindow,
  openSettingsWindow,
  openLogWindow,
  openUpdateWindow,
  createTray,
  createMenu,
  registerShortcuts,
  showWindow,
  sendLog,
  sendProgress,
  getMainWindow: () => mainWindow,
  checkHermesRunning,
  startHermes,
  stopHermes,
  installLogs,
  clearInstallLogs() {
    installLogs = [];
  }
};
