const https = require('https');
const { exec } = require('child_process');
const HttpsProxyAgent = require('https-proxy-agent');
const { getProxyMode, getGithubProxy, getHermesPath } = require('./config');
function sendLog(...args) {
  return require('./ui').sendLog(...args);
}

function sendProgress(payload) {
  return require('./ui').sendProgress(payload);
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// 获取最新版本信息
function getLatestReleaseInfo(callback) {
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
      'User-Agent': USER_AGENT
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

// 下载安装包，返回 { success: true, installPath, version } 或 { success: false, error }
function downloadAndInstallHermes(zipUrl, version, installPath, dialog, mainWindow, sendLog) {
  return new Promise((resolve) => {
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

    const run = async () => {
      try {
        await fs.promises.mkdir(hermesDir, { recursive: true });
        sendLog(`Created directory: ${hermesDir}`, 'success');
      } catch (err) {
        if (err.code !== 'EEXIST') {
          const msg = `Failed to create directory: ${err.message}`;
          sendLog(msg, 'error');
          resolve({ success: false, error: msg });
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

      const buildOptions = (urlStr) => {
        const u = new URL(urlStr);
        const opts = {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
          }
        };
        if (mode === 'http' && proxy) {
          opts.agent = new HttpsProxyAgent(proxy);
          sendLog(`Added HttpsProxyAgent for download: ${proxy}`, 'info');
        }
        return opts;
      };

      const REDIRECT_CODES = [301, 302, 303, 307, 308];
      const MAX_REDIRECTS = 5;

      const doRequest = (urlStr, redirectsLeft) => {
        let requestOptions;
        try {
          requestOptions = buildOptions(urlStr);
        } catch (err) {
          const msg = `Failed to build download request: ${err.message}`;
          sendLog(msg, 'error');
          resolve({ success: false, error: msg });
          return;
        }

        sendLog(`Requesting download URL: ${urlStr}`, 'info');

        https.get(requestOptions, (response) => {
          sendLog(`Download response status: ${response.statusCode}`, 'info');

          // Follow redirects (e.g. GitHub tarball_url -> codeload.github.com)
          if (REDIRECT_CODES.includes(response.statusCode) && response.headers.location) {
            response.resume(); // drain so the socket can be reused
            if (redirectsLeft <= 0) {
              const msg = 'Too many redirects while downloading';
              sendLog(msg, 'error');
              file.close();
              fs.unlinkSync(zipPath);
              resolve({ success: false, error: msg });
              return;
            }
            const nextUrl = new URL(response.headers.location, urlStr).toString();
            sendLog(`Redirect ${response.statusCode} -> ${nextUrl}`, 'info');
            doRequest(nextUrl, redirectsLeft - 1);
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            fs.unlinkSync(zipPath);
            const msg = `Download failed with status: ${response.statusCode}`;
            sendLog(msg, 'error');
            resolve({ success: false, error: msg });
            return;
          }

          const contentLength = parseInt(response.headers['content-length'], 10);
          totalBytes = Number.isFinite(contentLength) ? contentLength : 0;
          if (totalBytes) {
            sendLog(`Starting download, total size: ${Math.round(totalBytes / 1024 / 1024)}MB`, 'info');
          } else {
            sendLog('Starting download, total size: unknown (no Content-Length)', 'info');
          }

          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes) {
              const progress = Math.round((receivedBytes / totalBytes) * 100);
              sendProgress({ indeterminate: false, progress, receivedBytes, totalBytes });
            } else {
              sendProgress({ indeterminate: true, receivedBytes });
            }
            if (totalBytes) {
              sendLog(`Received ${Math.round(receivedBytes / 1024)}KB / ${Math.round(totalBytes / 1024)}KB`, 'info');
            } else {
              sendLog(`Received ${Math.round(receivedBytes / 1024)}KB`, 'info');
            }
          });

          response.pipe(file);

          file.on('finish', async () => {
            file.close();
            sendLog('Download complete, extracting...', 'info');

            const extractor = spawn('tar', ['-xzf', zipPath, '-C', hermesDir]);

            extractor.on('close', async (code) => {
              await fs.promises.unlink(zipPath);
              sendLog(`Extraction complete with code: ${code}`, code === 0 ? 'success' : 'error');

              if (code !== 0) {
                resolve({ success: false, error: `Extraction failed with code: ${code}` });
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
                resolve({ success: false, error: msg });
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
              resolve({ success: true, installPath, version });
            });

            extractor.on('error', async (err) => {
              await fs.promises.unlink(zipPath).catch(() => {});
              const msg = `Extract error: ${err.message}`;
              sendLog(msg, 'error');
              resolve({ success: false, error: msg });
            });
          });
        }).on('error', async (err) => {
          file.close();
          await fs.promises.unlink(zipPath).catch(() => {});
          const msg = `Download error: ${err.message}`;
          sendLog(msg, 'error');
          resolve({ success: false, error: msg });
        });
      };

      sendLog(`Starting download, final request URL: ${downloadUrl}`, 'info');
      doRequest(downloadUrl, MAX_REDIRECTS);
    };

    run();
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
