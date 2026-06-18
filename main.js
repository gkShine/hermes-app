const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, dialog } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const zlib = require('zlib');
const Store = require('electron-store');

// 单实例锁定，防止多开
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

const store = new Store({
  defaults: {
    hermesPath: '',
    githubProxy: 'https://ghfast.top/'
  }
});

const WEBUI_URL = process.env.HERMES_WEBUI_URL || 'http://localhost:8787';
let mainWindow = null;
let tray = null;
let hermesProcess = null;
let hermesStartedByUs = false;

function getGithubProxy() {
  let proxy = store.get('githubProxy') || 'https://ghfast.top/';
  if (!proxy.endsWith('/')) {
    proxy += '/';
  }
  return proxy;
}

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

// 获取最新版本信息
function getLatestReleaseInfo(callback) {
  const options = {
    hostname: 'api.github.com',
    path: '/repos/nesquena/hermes-webui/releases/latest',
    method: 'GET',
    headers: {
      'User-Agent': 'Hermes-App'
    },
    timeout: 10000
  };

  sendLog(`Checking latest release from GitHub...`, 'info');

  const req = https.get(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        sendLog(`Got latest release: ${release.tag_name}`, 'success');
        callback(null, {
          version: release.tag_name,
          zipUrl: release.tarball_url
        });
      } catch (err) {
        sendLog(`Failed to parse response: ${err.message}`, 'error');
        callback(err, null);
      }
    });
  });

  req.on('error', (err) => {
    sendLog(`Request failed: ${err.message}`, 'error');
    callback(err, null);
  });
  req.on('timeout', () => { req.destroy(); callback(new Error('timeout'), null); });
  req.end();
}

function sendLog(message, type = 'info') {
  console.log('[Hermes]', message);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('install-log', { message, type });
  }
}

function startHermes(callback) {
  const hermesPath = getHermesPath();
  const hermesScript = getHermesScript();
  sendLog(`Starting hermes-webui from: ${hermesPath}`, 'info');
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
        sendLog('hermes-webui is ready!', 'success');
        callback(true);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(waitForHermes, 1000);
      } else {
        sendLog('Timeout waiting for hermes-webui', 'error');
        callback(false);
      }
    });
  };
  
  setTimeout(waitForHermes, 1000);
}

function stopHermes() {
  if (!hermesStartedByUs) return;
  
  sendLog('Stopping hermes-webui...', 'info');
  
  // Find and kill the python server process started by start.sh
  exec('pkill -f "python.*server.py" || true', (err) => {
    if (err) sendLog('pkill error: ' + err.message, 'error');
    else sendLog('hermes-webui stopped', 'success');
  });
}

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
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Hermes App');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => showWindow() },
    { label: '隐藏窗口', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showWindow());
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '设置', click: () => {
          showWindow();
          mainWindow.loadFile(path.join(__dirname, 'renderer', 'config.html'));
        } },
        { label: '检查更新', click: () => {
          checkAndUpdateHermes();
        } },
        { type: 'separator' },
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
    mainWindow.isVisible() ? mainWindow.hide() : showWindow();
  });
}

// 处理第二个实例启动
app.on('second-instance', (event, commandLine, workingDirectory) => {
  showWindow();
});

async function checkAndUpdateHermes() {
  showWindow();
  if (mainWindow.webContents.getURL().indexOf('config.html') === -1) {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'config.html'));
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['检查更新', '取消'],
    title: '检查HermesWebUI更新',
    message: '将检查GitHub最新版本，是否继续？'
  });

  if (result.response !== 0) {
    return;
  }

  getLatestReleaseInfo(async (err, latest) => {
    if (err) {
      dialog.showErrorBox('检查更新失败', '无法获取最新版本信息: ' + err.message);
      return;
    }

    // 获取当前版本
    let currentVersion = 'unknown';
    try {
      const versionPath = path.join(getHermesPath(), 'VERSION');
      if (fs.existsSync(versionPath)) {
        currentVersion = (await fsPromises.readFile(versionPath, 'utf8')).trim();
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

    // 开始更新
    await downloadAndInstallHermes(latest.zipUrl, latest.version);
  });
}

async function downloadAndInstallHermes(zipUrl, version) {
  const installPath = path.join(os.homedir(), '.hermes', 'hermes-webui');
  const proxyUrl = getGithubProxy();
  const downloadUrl = proxyUrl + zipUrl;

  sendLog(`Starting update to version: ${version}`, 'info');
  sendLog(`Download url: ${downloadUrl}`, 'info');

  // Create .hermes directory if it doesn't exist
  const hermesDir = path.join(os.homedir(), '.hermes');
  try {
    await fsPromises.mkdir(hermesDir, { recursive: true });
    sendLog(`Created directory: ${hermesDir}`, 'success');
  } catch (err) {
    if (err.code !== 'EEXIST') {
      const msg = 'Failed to create directory: ' + err.message;
      sendLog(msg, 'error');
      dialog.showErrorBox('安装失败', msg);
      return;
    } else {
      sendLog(`Directory ${hermesDir} already exists`, 'info');
    }
  }

  // Stop hermes if running
  stopHermes();

  // Remove existing hermes-webui folder if it exists
  try {
    sendLog(`Removing old directory: ${installPath}`, 'info');
    await fsPromises.rm(installPath, { recursive: true, force: true });
    sendLog('Removed old directory successfully', 'success');
  } catch (err) {
    sendLog('Could not remove existing folder: ' + err.message, 'error');
  }

  const zipPath = path.join(hermesDir, 'temp.tar.gz');

  const file = fs.createWriteStream(zipPath);
  let totalBytes = 0;
  let receivedBytes = 0;

  https.get(downloadUrl, (response) => {
    if (response.statusCode !== 200) {
      file.close();
      fs.unlinkSync(zipPath);
      const msg = 'Download failed with status: ' + response.statusCode;
      sendLog(msg, 'error');
      dialog.showErrorBox('下载失败', msg);
      return;
    }

    sendLog(`Starting download, total size: ${Math.round(parseInt(response.headers['content-length'], 10) / 1024 / 1024)}MB`, 'info');
    totalBytes = parseInt(response.headers['content-length'], 10);

    response.on('data', (chunk) => {
      receivedBytes += chunk.length;
      sendLog(`Received ${Math.round(receivedBytes / 1024)}KB / ${Math.round(totalBytes / 1024)}KB`, 'info');
      if (totalBytes && mainWindow) {
        const progress = Math.round((receivedBytes / totalBytes) * 100);
        if (mainWindow) {
          mainWindow.webContents.send('install-progress', progress);
        }
      }
    });

    response.pipe(file);

    file.on('finish', async () => {
      file.close();
      sendLog('Download complete, extracting...', 'info');

      try {
        // Extract tar.gz
        const extractor = spawn('tar', ['-xzf', zipPath, '-C', hermesDir]);

        extractor.on('close', async (code) => {
          await fsPromises.unlink(zipPath);
          sendLog('Extraction complete with code: ' + code, code === 0 ? 'success' : 'error');

          if (code === 0) {
            // The extracted folder is nesquena-hermes-webui-xxxxxxx (commit hash)
            // Find it
            const files = await fsPromises.readdir(hermesDir);
            let extractedDir = null;
            for (const f of files) {
              if (f.startsWith('nesquena-hermes-webui-')) {
                extractedDir = path.join(hermesDir, f);
                break;
              }
            }

            if (!extractedDir || !fs.existsSync(extractedDir)) {
              const msg = 'Cannot find extracted directory';
              sendLog(msg, 'error');
              dialog.showErrorBox('安装失败', msg);
              return;
            }

            sendLog(`Found extracted directory: ${extractedDir}`, 'info');

            // Rename to hermes-webui
            try {
              await fsPromises.rename(extractedDir, installPath);
              sendLog(`Renamed to ${installPath}`, 'success');
            } catch (err) {
              sendLog(`Rename error: ${err.message}, trying replace`, 'warning');
              await fsPromises.rm(installPath, { recursive: true, force: true });
              await fsPromises.rename(extractedDir, installPath);
            }

            // Save version file
            await fsPromises.writeFile(path.join(installPath, 'VERSION'), version);
            sendLog(`Saved version file: ${version}`, 'success');

            sendLog('Update complete!', 'success');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '更新完成',
              message: `HermesWebUI 已更新到版本 ${version}\n将重新启动`
            });

            // Restart hermes
            startHermes(() => {
              sendLog('Restart complete', 'success');
              mainWindow.loadURL(WEBUI_URL);
            });
          } else {
            dialog.showErrorBox('安装失败', 'Extraction failed with code: ' + code);
          }
        });

        extractor.on('error', async (err) => {
          await fsPromises.unlink(zipPath).catch(() => {});
          const msg = 'Extraction error: ' + err.message;
          sendLog(msg, 'error');
          dialog.showErrorBox('解压错误', msg);
        });
      } catch (err) {
        await fsPromises.unlink(zipPath).catch(() => {});
        const msg = 'Processing error: ' + err.message;
        sendLog(msg, 'error');
        dialog.showErrorBox('处理错误', msg);
      }
    });
  }).on('error', async (err) => {
    file.close();
    await fsPromises.unlink(zipPath).catch(() => {});
    const msg = 'Download error: ' + err.message;
    sendLog(msg, 'error');
    dialog.showErrorBox('下载错误', msg);
  });
}

// IPC handlers for config
ipcMain.handle('config-get', () => {
  return {
    hermesPath: getHermesPath(),
    hermesPathValid: checkHermesPathValid(),
    githubProxy: getGithubProxy()
  };
});

ipcMain.handle('config-set', (event, { hermesPath, githubProxy }) => {
  if (typeof hermesPath !== 'undefined') {
    store.set('hermesPath', hermesPath);
  }
  if (typeof githubProxy !== 'undefined') {
    store.set('githubProxy', githubProxy);
  }
  return { 
    hermesPath: getHermesPath(), 
    hermesPathValid: checkHermesPathValid(),
    githubProxy: getGithubProxy()
  };
});

ipcMain.handle('config-check', () => {
  return { hermesPath: getHermesPath(), hermesPathValid: checkHermesPathValid(), githubProxy: getGithubProxy() };
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
  console.log('[Hermes] Starting fresh installation');
  sendLog('Starting fresh installation', 'info');

  getLatestReleaseInfo(async (err, latest) => {
    if (err) {
      event.reply('install-error', '获取最新版本失败: ' + err.message);
      sendLog('Failed to get latest release: ' + err.message, 'error');
      return;
    }

    await downloadAndInstallHermes(latest.zipUrl, latest.version);
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
  showWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopHermes();
});
