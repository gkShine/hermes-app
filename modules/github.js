const https = require('https');
const HttpsProxyAgent = require('https-proxy-agent');
const { getProxyMode, getGithubProxy, getHermesPath } = require('./config');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// 获取最新版本信息
function getLatestReleaseInfo(callback, sendLog) {
  const apiUrl = 'https://api.github.com/repos/nesquena/hermes-webui/releases/latest';
  const mode = getProxyMode();
  const proxy = getGithubProxy();

  sendLog(`Checking latest release from GitHub, mode: ${mode}`, 'info');

  let requestUrl = apiUrl;
  let options;

  if (mode === 'reverse') {
    requestUrl = proxy + apiUrl;
  }

  const urlObj = new URL(requestUrl);
  options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    timeout: 10000
  };

  // Add proxy agent for http proxy mode
  if (mode === 'http' && proxy) {
    try {
      const agent = new HttpsProxyAgent(proxy);
      options.agent = agent;
      sendLog(`Created HttpsProxyAgent with: ${proxy}`, 'info');
    } catch (err) {
      sendLog(`Failed to create proxy agent: ${err.message}`, 'error');
      callback(err, null);
      return;
    }
  }

  sendLog(`Final request URL: ${requestUrl}`, 'info');
  sendLog(`Request headers: ${JSON.stringify(options.headers)}`, 'info');

  https.get(options, (res) => {
    sendLog(`Response status code: ${res.statusCode}`, 'info');
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        if (res.statusCode >= 400) {
          sendLog(`API returned error status: ${res.statusCode}, body: ${data}`, 'error');
          callback(new Error(`HTTP ${res.statusCode}`), null);
          return;
        }
        // Clean invisible control characters
        const cleanData = data.replace(/[\x00-\x1F]/g, '').trim();
        const release = JSON.parse(cleanData);
        sendLog(`Got latest release: ${release.tag_name}`, 'success');
        callback(null, {
          version: release.tag_name,
          zipUrl: release.tarball_url
        });
      } catch (err) {
        sendLog(`Failed to parse response: ${err.message}\nRaw data length: ${data.length}\nRaw data: <<<${data}>>>`, 'error');
        callback(err, null);
      }
    });
  }).on('error', (err) => {
    sendLog(`Request failed: ${err.message}`, 'error');
    callback(err, null);
  }).on('timeout', () => {
    sendLog('Request timeout', 'error');
    callback(new Error('timeout'), null);
  });
}

// 下载安装包
async function downloadAndInstallHermes(zipUrl, version, installPath, dialog, mainWindow, sendLog) {
  const mode = getProxyMode();
  const proxy = getGithubProxy();
  let downloadUrl = zipUrl;

  if (mode === 'reverse') {
    downloadUrl = proxy + zipUrl;
  }

  sendLog(`Starting download to version: ${version}`, 'info');
  sendLog(`Download url: ${downloadUrl}`, 'info');

  const hermesDir = require('path').dirname(installPath);
  const fs = require('fs');
  const { spawn } = require('child_process');

  try {
    await fs.promises.mkdir(hermesDir, { recursive: true });
    sendLog(`Created directory: ${hermesDir}`, 'success');
  } catch (err) {
    if (err.code !== 'EEXIST') {
      const msg = `Failed to create directory: ${err.message}`;
      sendLog(msg, 'error');
      dialog.showErrorBox(mainWindow, '安装失败', msg);
      return;
    }
  }

  // Stop hermes if running
  exec('pkill -f "python.*server.py" || true', (err) => {
    if (err) sendLog(`pkill error: ${err.message}`, 'error');
    else sendLog('hermes-webui stopped', 'success');
  });

  // Remove existing
  try {
    sendLog(`Removing old directory: ${installPath}`, 'info');
    await fs.promises.rm(installPath, { recursive: true, force: true });
    sendLog('Removed old directory successfully', 'success');
  } catch (err) {
    sendLog(`Could not remove existing folder: ${err.message}`, 'error');
  }

  const zipPath = require('path').join(hermesDir, 'temp.tar.gz');
  const file = fs.createWriteStream(zipPath);
  let totalBytes = 0;
  let receivedBytes = 0;

  const downloadUrlObj = new URL(downloadUrl);
  let requestOptions = {
    hostname: downloadUrlObj.hostname,
    path: downloadUrlObj.pathname + downloadUrlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    }
  };

  if (mode === 'http' && proxy) {
    try {
      const agent = new HttpsProxyAgent(proxy);
      requestOptions.agent = agent;
      sendLog(`Added HttpsProxyAgent for download: ${proxy}`, 'info');
    } catch (err) {
      sendLog(`Failed to create proxy agent for download: ${err.message}`, 'error');
      dialog.showErrorBox(mainWindow, '代理错误', `无法创建代理: ${err.message}`);
      return;
    }
  }

  sendLog(`Starting download, final request URL: ${downloadUrl}`, 'info');
  sendLog(`Download request headers: ${JSON.stringify(requestOptions.headers)}`, 'info');

  https.get(requestOptions, (response) => {
    sendLog(`Download response status: ${response.statusCode}`, 'info');
    if (response.statusCode !== 200) {
      file.close();
      fs.unlinkSync(zipPath);
      const msg = `Download failed with status: ${response.statusCode}`;
      sendLog(msg, 'error');
      dialog.showErrorBox(mainWindow, '下载失败', msg);
      return;
    }

    sendLog(`Starting download, total size: ${Math.round(parseInt(response.headers['content-length'], 10) / 1024 / 1024)}MB`, 'info');
    totalBytes = parseInt(response.headers['content-length'], 10);

    response.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (totalBytes && mainWindow) {
        const progress = Math.round((receivedBytes / totalBytes) * 100);
        if (mainWindow) {
          mainWindow.webContents.send('install-progress', progress);
        }
      }
      sendLog(`Received ${Math.round(receivedBytes / 1024)}KB / ${Math.round(totalBytes / 1024)}KB`, 'info');
    });

    response.pipe(file);

    file.on('finish', async () => {
      file.close();
      sendLog('Download complete, extracting...', 'info');

      try {
        const extractor = spawn('tar', ['-xzf', zipPath, '-C', hermesDir]);

        extractor.on('close', async (code) => {
          await fs.promises.unlink(zipPath);
          sendLog(`Extraction complete with code: ${code}`, code === 0 ? 'success' : 'error');

          if (code !== 0) {
            dialog.showErrorBox(mainWindow, '安装失败', `Extraction failed with code: ${code}`);
            return;
          }

          // Find extracted folder
          const files = await fs.promises.readdir(hermesDir);
          let extractedDir = null;
          for (const f of files) {
            if (f.startsWith('nesquena-hermes-webui-')) {
              extractedDir = require('path').join(hermesDir, f);
              break;
            }
          }

          if (!extractedDir) {
            const msg = 'Cannot find extracted directory';
            sendLog(msg, 'error');
            dialog.showErrorBox(mainWindow, '安装失败', msg);
            return;
          }

          sendLog(`Found extracted directory: ${extractedDir}`, 'info');

          // Rename to hermes-webui
          try {
            await fs.promises.rename(extractedDir, installPath);
            sendLog(`Renamed to ${installPath}`, 'success');
          } catch (err) {
            sendLog(`Rename error: ${err.message}, trying replace`, 'warning');
            await fs.promises.rm(installPath, { recursive: true, force: true });
            await fs.promises.rename(extractedDir, installPath);
          }

          // Save version
          await fs.promises.writeFile(require('path').join(installPath, 'VERSION'), version);
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
            if (mainWindow) {
              mainWindow.loadURL(process.env.HERMES_WEBUI_URL || 'http://localhost:8787');
            }
          });
        });
      } catch (e) {

      }

      extractor.on('error', async (err) => {
        await fs.promises.unlink(zipPath);
        const msg = `Extract error: ${err.message}`;
        sendLog(msg, 'error');
        dialog.showErrorBox(mainWindow, '解压错误', msg);
      });
  });
}).on('error', async (err) => {
    file.close();
    await fs.promises.unlink(zipPath);
    const msg = `Download error: ${err.message}`;
    sendLog(msg, 'error');
    dialog.showErrorBox(mainWindow, '下载错误', msg);
  });
}

function startHermes(callback) {
  const hermesPath = getHermesPath();
  const hermesScript = require('path').join(hermesPath, 'start.sh');
  sendLog(`Starting hermes-webui from: ${hermesScript}`, 'info');

  const { spawn } = require('child_process');
  hermesProcess = spawn('bash', [hermesScript], {
    cwd: hermesPath,
    detached: true,
    stdio: 'ignore'
  });

  hermesProcess.unref();
  hermesStartedByUs = true;
  sendLog('hermes-webui started', 'success');
  callback();
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

module.exports = {
  getLatestReleaseInfo,
  downloadAndInstallHermes
};
