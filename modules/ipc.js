const { ipcMain } = require('electron');
const { exec } = require('node:child_process')
const { 
  checkHermesPathValid, 
  checkHermesPathValidForSettings,
  getProxyMode,
  getGithubProxy,
  getHermesPath,
  set
} = require('./config');

const { getLatestReleaseInfo, downloadAndInstallHermes } = require('./github');

let pendingLatest = null;

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
    const ui = require('./ui');
    const mainWindow = ui.getMainWindow();
    if (mainWindow) {
      mainWindow.loadURL(process.env.HERMES_WEBUI_URL || 'http://localhost:8787');
    }
  });

  ipcMain.handle('shell-open-external', (event, url) => {
    require('electron').shell.openExternal(url);
  });

  ipcMain.handle('install-hermes', async (event) => {
    const ui = require('./ui');
    const os = require('os');
    const { dialog } = require('electron');
    const mainWindow = ui.getMainWindow();

    ui.sendLog('Starting fresh installation', 'info');

    return new Promise((resolve) => {
      getLatestReleaseInfo(async (err, latest) => {
        if (err) {
          ui.sendLog(`Failed to get latest release: ${err.message}`, 'error');
          ui.openLogWindow();
          resolve({ success: false, error: `获取最新版本失败: ${err.message}` });
          return;
        }

        const installPath = require('path').join(os.homedir(), '.hermes', 'hermes-webui');
        const result = await downloadAndInstallHermes(latest.zipUrl, latest.version, installPath, dialog, mainWindow, ui.sendLog);

        if (result.success) {
          set('hermesPath', installPath);
        } else {
          ui.openLogWindow();
        }
        resolve(result);
      });
    });
  });

  // Update flow (driven by the update window UI)
  ipcMain.handle('update-check', () => {
    const ui = require('./ui');
    return new Promise((resolve) => {
      getLatestReleaseInfo(async (err, latest) => {
        if (err) {
          ui.sendLog(`Failed to get latest release: ${err.message}`, 'error');
          resolve({ ok: false, error: `获取最新版本失败: ${err.message}` });
          return;
        }

        let currentVersion = 'unknown';
        try {
          const fs = require('fs');
          const versionPath = require('path').join(getHermesPath(), 'VERSION');
          if (fs.existsSync(versionPath)) {
            currentVersion = (await fs.promises.readFile(versionPath, 'utf8')).trim();
          }
        } catch (e) {
          currentVersion = 'unknown';
        }

        pendingLatest = latest;
        ui.sendLog(`Current version: ${currentVersion}, latest version: ${latest.version}`, 'info');
        resolve({
          ok: true,
          hasUpdate: currentVersion !== latest.version,
          currentVersion,
          latestVersion: latest.version
        });
      });
    });
  });

  ipcMain.handle('update-download', async () => {
    const ui = require('./ui');
    if (!pendingLatest) {
      return { success: false, error: '无待更新版本，请先检查更新' };
    }
    const installPath = require('path').join(require('os').homedir(), '.hermes', 'hermes-webui');
    const result = await downloadAndInstallHermes(pendingLatest.zipUrl, pendingLatest.version, installPath, null, null, ui.sendLog);
    if (result.success) {
      set('hermesPath', installPath);
    }
    return result;
  });

  ipcMain.handle('update-restart', () => {
    const ui = require('./ui');
    ui.startHermes(() => {
      ui.sendLog('Restart complete', 'success');
      const mainWindow = ui.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(process.env.HERMES_WEBUI_URL || 'http://localhost:8787');
      }
    });
    return { success: true };
  });
}

module.exports = {
  registerIpcHandlers
};
