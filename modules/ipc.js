const { ipcMain } = require('electron');
const { 
  checkHermesPathValid, 
  checkHermesPathValidForSettings,
  getProxyMode,
  getGithubProxy,
  getHermesPath,
  set
} = require('./config');

const { getLatestReleaseInfo, downloadAndInstallHermes } = require('./github');

function registerIpcHandlers() {
  // Settings handlers
  ipcMain.handle('settings-get', () => {
    return {
      hermesPath: getHermesPath(),
      githubProxy: getGithubProxy(),
      proxyMode: getProxyMode()
    };
  });

  ipcMain.handle('settings-check-path', (event, path) => {
    return { valid: checkHermesPathValidForSettings(path) };
  });

  ipcMain.handle('settings-save', (event, { hermesPath, githubProxy, proxyMode }) => {
    if (typeof hermesPath !== 'undefined') {
      set('hermesPath', hermesPath);
    }
    if (typeof githubProxy !== 'undefined') {
      set('githubProxy', githubProxy);
    }
    if (typeof proxyMode !== 'undefined') {
      set('proxyMode', proxyMode);
    }
    return { success: true };
  });

  // Log handlers
  ipcMain.handle('log-get-logs', () => {
    const ui = require('./ui');
    return ui.installLogs;
  });

  ipcMain.handle('log-clear', () => {
    const ui = require('./ui');
    ui.clearInstallLogs();
    return { success: true };
  });

  // Config handlers
  ipcMain.handle('config-get', () => {
    return {
      hermesPath: getHermesPath(),
      hermesPathValid: checkHermesPathValid()
    };
  });

  ipcMain.handle('config-set', (event, { hermesPath }) => {
    set('hermesPath', hermesPath);
    return { 
      hermesPath: getHermesPath(), 
      hermesPathValid: checkHermesPathValid()
    };
  });

  ipcMain.handle('config-check', () => {
    return { 
      hermesPath: getHermesPath(), 
      hermesPathValid: checkHermesPathValid()
    };
  });

  ipcMain.handle('check-hermes-cli', (event) => {
    return new Promise((resolve) => {
      exec('which hermes', (err) => {
        resolve({ hermesCLIExists: !err });
      });
    });
  });

  ipcMain.handle('start-hermes', (event, hermesPath) => {
    const ui = require('./ui');
    if (hermesPath) {
      set('hermesPath', hermesPath);
    }
    return new Promise((resolve) => {
      if (!checkHermesPathValid()) {
        resolve({ success: false, error: 'invalid_path' });
        return;
      }
      const { spawn } = require('child_process');
      const scriptPath = require('path').join(getHermesPath(), 'start.sh');
      ui.sendLog(`Starting hermes-webui from: ${scriptPath}`, 'info');
      hermesProcess = spawn('bash', [scriptPath], {
        cwd: getHermesPath(),
        detached: true,
        stdio: 'ignore'
      });
      hermesProcess.unref();
      hermesStartedByUs = true;
      ui.sendLog('hermes-webui started', 'success');
      resolve({ success: true });
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
    const ui = require('./ui');
    ui.sendLog('Starting fresh installation', 'info');
    getLatestReleaseInfo(async (err, latest) => {
      if (err) {
        event.reply('install-error', `获取最新版本失败: ${err.message}`);
        ui.sendLog(`Failed to get latest release: ${err.message}`, 'error');
        return;
      }

      ui.openLogWindow();
      const installPath = require('path').join(os.homedir(), '.hermes', 'hermes-webui');
      await downloadAndInstallHermes(latest.zipUrl, latest.version, installPath, dialog, mainWindow, ui.sendLog);
    });
  });
}

module.exports = {
  registerIpcHandlers
};
