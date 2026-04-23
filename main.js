const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const zlib = require('zlib');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    hermesPath: ''
  }
});

const WEBUI_URL = process.env.HERMES_WEBUI_URL || 'http://localhost:8787';
let mainWindow = null;
let tray = null;
let hermesProcess = null;
let hermesStartedByUs = false;

function checkHermesRunning(callback) {
  const url = new URL(WEBUI_URL);
  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: '/health',
    method: 'GET',
    timeout: 3000
  };
  
  const req = http.request(options, (res) => {
    callback(res.statusCode === 200);
  });
  
  req.on('error', () => callback(false));
  req.on('timeout', () => { req.destroy(); callback(false); });
  req.end();
}

function getHermesPath() {
  return store.get('hermesPath');
}

function getHermesScript() {
  return path.join(getHermesPath(), 'start.sh');
}

function checkHermesPathValid() {
  const scriptPath = getHermesScript();
  return fs.existsSync(scriptPath);
}

function checkHermesCLI(callback) {
  exec('which hermes', (err) => {
    callback(!err);
  });
}

function startHermes(callback) {
  const hermesPath = getHermesPath();
  const hermesScript = getHermesScript();
  console.log('[Hermes] Starting hermes-webui from:', hermesPath);
  hermesProcess = spawn('bash', [hermesScript], {
    cwd: hermesPath,
    detached: true,
    stdio: 'ignore'
  });
  
  hermesProcess.unref();
  hermesStartedByUs = true;
  
  // Wait for hermes to be ready
  const maxAttempts = 30;
  let attempts = 0;
  
  const waitForHermes = () => {
    checkHermesRunning((running) => {
      if (running) {
        console.log('[Hermes] hermes-webui is ready!');
        callback(true);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(waitForHermes, 1000);
      } else {
        console.log('[Hermes] Timeout waiting for hermes-webui');
        callback(false);
      }
    });
  };
  
  setTimeout(waitForHermes, 1000);
}

function stopHermes() {
  if (!hermesStartedByUs) return;
  
  console.log('[Hermes] Stopping hermes-webui...');
  
  // Find and kill the python server process started by start.sh
  exec('pkill -f "python.*server.py" || true', (err) => {
    if (err) console.log('[Hermes] pkill error:', err.message);
    else console.log('[Hermes] hermes-webui stopped');
  });
}

function createWindow(loadConfigPage = false) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Hermes WebUI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    show: false
  });

  if (loadConfigPage) {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'config.html'));
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

function createTray() {
  const iconPath = path.join(__dirname, 'renderer', 'icon.png');
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Hermes WebUI');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow.show() },
    { label: '隐藏窗口', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.reload() },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow.webContents.openDevTools() },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '全屏', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5) },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.setZoomLevel(0) }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', click: () => mainWindow.minimize() },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.hide() }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerShortcuts() {
  globalShortcut.register('CmdOrCtrl+Shift+H', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// IPC handlers for config
ipcMain.handle('config-get', () => {
  return {
    hermesPath: getHermesPath(),
    hermesPathValid: checkHermesPathValid()
  };
});

ipcMain.handle('config-set', (event, newPath) => {
  store.set('hermesPath', newPath);
  return { hermesPath: getHermesPath(), hermesPathValid: checkHermesPathValid() };
});

ipcMain.handle('config-check', () => {
  return { hermesPath: getHermesPath(), hermesPathValid: checkHermesPathValid() };
});

ipcMain.handle('check-hermes-cli', () => {
  return new Promise((resolve) => {
    checkHermesCLI((exists) => {
      resolve({ hermesCLIExists: exists });
    });
  });
});

ipcMain.handle('start-hermes', (event, hermesPath) => {
  if (hermesPath) {
    store.set('hermesPath', hermesPath);
  }
  return new Promise((resolve) => {
    if (!checkHermesPathValid()) {
      resolve({ success: false, error: 'invalid_path' });
      return;
    }
    startHermes((success) => {
      resolve({ success });
    });
  });
});

ipcMain.handle('window-load-url', () => {
  if (mainWindow) {
    mainWindow.loadURL(WEBUI_URL);
  }
});

ipcMain.handle('shell-open-external', (event, url) => {
  require('electron').shell.openExternal(url);
});

ipcMain.handle('install-hermes', async (event) => {
  const installPath = path.join(os.homedir(), '.hermes', 'hermes-webui');
  const zipUrl = 'https://ghfast.top/https://github.com/nesquena/hermes-webui/archive/refs/heads/master.zip';

  console.log('[Hermes] Starting installation to:', installPath);

  // Create .hermes directory if it doesn't exist
  const hermesDir = path.join(os.homedir(), '.hermes');
  try {
    await fsPromises.mkdir(hermesDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      return { success: false, error: 'Failed to create directory: ' + err.message };
    }
  }

  // Remove existing hermes-webui folder if it exists
  try {
    await fsPromises.rm(installPath, { recursive: true, force: true });
  } catch (err) {
    console.log('[Hermes] Could not remove existing folder:', err.message);
  }

  return new Promise((resolve) => {
    const zipPath = path.join(hermesDir, 'temp.zip');

    const file = fs.createWriteStream(zipPath);
    let totalBytes = 0;
    let receivedBytes = 0;

    https.get(zipUrl, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(zipPath);
        resolve({ success: false, error: 'Download failed with status: ' + response.statusCode });
        return;
      }

      totalBytes = parseInt(response.headers['content-length'], 10);

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes) {
          const progress = Math.round((receivedBytes / totalBytes) * 100);
          event.sender.send('install-progress', progress);
        }
      });

      response.pipe(file);

      file.on('finish', async () => {
        file.close();
        console.log('[Hermes] Download complete, extracting...');

        try {
          // Extract zip
          const data = await fsPromises.readFile(zipPath);
          const unzip = zlib.createUnzip();
          const extractor = spawn('unzip', ['-q', '-o', zipPath, '-d', hermesDir]);

          extractor.on('close', async (code) => {
            await fsPromises.unlink(zipPath);

            if (code === 0) {
              // Move contents from hermes-webui-master to hermes-webui if needed
              const masterPath = path.join(hermesDir, 'hermes-webui-master');
              if (fs.existsSync(masterPath)) {
                const tempInstallPath = path.join(hermesDir, 'hermes-webui-temp');
                await fsPromises.rename(installPath, tempInstallPath).catch(() => {});
                await fsPromises.rename(masterPath, installPath).catch(() => {});

                // Check if temp folder exists and merge/remove if needed
                if (fs.existsSync(tempInstallPath)) {
                  await fsPromises.rm(tempInstallPath, { recursive: true, force: true });
                }
              }

              // Save the path to config
              store.set('hermesPath', installPath);
              console.log('[Hermes] Installation complete!');
              resolve({ success: true, installPath });
            } else {
              resolve({ success: false, error: 'Extraction failed with code: ' + code });
            }
          });

          extractor.on('error', async (err) => {
            await fsPromises.unlink(zipPath).catch(() => {});
            resolve({ success: false, error: 'Extraction error: ' + err.message });
          });
        } catch (err) {
          await fsPromises.unlink(zipPath).catch(() => {});
          resolve({ success: false, error: 'Processing error: ' + err.message });
        }
      });
    }).on('error', async (err) => {
      file.close();
      await fsPromises.unlink(zipPath).catch(() => {});
      resolve({ success: false, error: 'Download error: ' + err.message });
    });
  });
});

app.whenReady().then(() => {
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
      console.log('[Hermes] hermes-webui is already running');
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopHermes();
});
