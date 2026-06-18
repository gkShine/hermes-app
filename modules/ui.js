const { app, BrowserWindow, Menu, Tray, globalShortcut, dialog } = require('electron');
const path = require('path');
const { checkHermesPathValid, getHermesPath } = require('./config');
const { getLatestReleaseInfo, downloadAndInstallHermes } = require('./github');

let mainWindow = null;
let settingsWindow = null;
let logWindow = null;
let tray = null;
let hermesProcess = null;
let hermesStartedByUs = false;

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
    height: 500,
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
        { label: '检查更新', click: () => checkAndUpdateHermes() },
        { label: '查看日志', click: () => openLogWindow() },
        { type: 'separator' },
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow) mainWindow.reload(); } },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => { if (mainWindow) mainWindow.webContents.openDevTools(); } },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }
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

async function checkAndUpdateHermes() {
  showWindow();

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['检查更新', '取消'],
    title: '检查HermesWebUI更新',
    message: '将检查GitHub最新版本，是否继续？'
  });

  if (result.response !== 0) {
    return;
  }

  openLogWindow();
  getLatestReleaseInfo(async (err, latest) => {
    if (err) {
      dialog.showErrorBox(mainWindow, '检查更新失败', `无法获取最新版本信息: ${err.message}`);
      return;
    }

    // 获取当前版本
    let currentVersion = 'unknown';
    try {
      const versionPath = path.join(getHermesPath(), 'VERSION');
      if (fs.existsSync(versionPath)) {
        currentVersion = (await fs.promises.readFile(versionPath, 'utf8')).trim();
      }
    } catch (e) {
      currentVersion = 'unknown';
    }

    sendLog(`Current version: ${currentVersion}, latest version: ${latest.version}`, 'info');

    if (currentVersion === latest.version) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '已经是最新版本',
        message: `当前版本: ${currentVersion}\n最新版本: ${latest.version}\n无需更新。`
      });
      return;
    }

    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['更新', '取消'],
      title: '发现新版本',
      message: `当前版本: ${currentVersion}\n最新版本: ${latest.version}\n是否下载并安装最新版本？`
    });

    if (confirm.response !== 0) {
      return;
    }

    const installPath = path.join(os.homedir(), '.hermes', 'hermes-webui');
    await downloadAndInstallHermes(latest.zipUrl, latest.version, installPath, dialog, mainWindow, sendLog);
  });
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
  
  http.get(options, (res) => {
    callback(res.statusCode === 200);
  });

  options.timeout = () => {
    callback(false);
  };
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
  if (module.exports.installLogs) {
    module.exports.installLogs.push({ message, type });
  }
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('new-log', { message, type });
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('install-log', { message, type });
  }
}

module.exports = {
  createWindow,
  openSettingsWindow,
  openLogWindow,
  createTray,
  createMenu,
  registerShortcuts,
  showWindow,
  sendLog,
  get installLogs() {
    return module.exports.installLogs;
  },
  clearInstallLogs() {
    module.exports.installLogs = [];
  }
};
