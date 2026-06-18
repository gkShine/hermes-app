const Store = require('electron-store');
const path = require('path');
const fs = require('fs');

const store = new Store({
  defaults: {
    hermesPath: '',
    githubProxy: 'https://ghfast.top/',
    proxyMode: 'reverse'
  }
});

function getProxyMode() {
  return store.get('proxyMode') || 'reverse';
}

function getGithubProxy() {
  let proxy = store.get('githubProxy');
  if (typeof proxy === 'undefined' || proxy === null) {
    proxy = 'https://ghfast.top/';
  }
  const mode = getProxyMode();
  if (proxy && mode !== 'direct' && !proxy.endsWith('/')) {
    proxy += '/';
  }
  return proxy;
}

function getHermesPath() {
  return store.get('hermesPath');
}

function set(key, value) {
  store.set(key, value);
}

function checkHermesPathValid() {
  const scriptPath = path.join(getHermesPath(), 'start.sh');
  return fs.existsSync(scriptPath);
}

function checkHermesPathValidForSettings(path) {
  const scriptPath = path.join(path, 'start.sh');
  return fs.existsSync(scriptPath);
}

module.exports = {
  getProxyMode,
  getGithubProxy,
  getHermesPath,
  set,
  checkHermesPathValid,
  checkHermesPathValidForSettings
};
