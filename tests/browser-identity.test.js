const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requiresCompatibleBrowserIdentity, chromiumUserAgent, browserPlatform } = require('../src/main/browser-identity');

for (const url of [
  'https://accounts.google.com/signin',
  'https://accounts.google.com.ng/ServiceLogin',
  'https://accounts.google.co.uk/oauth',
  'https://accounts.youtube.com/signin',
  'https://myaccount.google.com/',
  'https://login.microsoftonline.com/common/oauth2',
  'https://login.live.com/oauth20_authorize.srf',
  'https://appleid.apple.com/auth/authorize'
]) assert.equal(requiresCompatibleBrowserIdentity(url), true, `${url} needs provider-compatible identity`);

for (const url of [
  'https://example.com',
  'https://flowr.tieddr.com/store/',
  'https://account.tieddr.com/oauth/authorize',
  'https://accounts.google.com.evil.example',
  'not a url'
]) assert.equal(requiresCompatibleBrowserIdentity(url), false, `${url} keeps normal Flowr identity`);

const ua = chromiumUserAgent('win32', '150.0.7871.47');
assert.equal(ua, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.47 Safari/537.36');
assert.doesNotMatch(ua, /Flowr|Electron|flow-browser/);
assert.equal(browserPlatform('win32'), 'Windows');
assert.equal(browserPlatform('darwin'), 'macOS');
assert.equal(browserPlatform('linux'), 'Linux');
assert.match(chromiumUserAgent('linux', 'invalid'), /Chrome\/142\.0\.0\.0/);

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/main/viewpreload.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'site/public/store/item.js'), 'utf8');
assert.match(main, /if \(requiresCompatibleBrowserIdentity\(candidate\)\) return chromiumUserAgent\(\)/);
assert.match(main, /currentUserAgent\(details\.url\)/);
assert.match(main, /sec-ch-ua-full-version-list/);
assert.match(main, /contents\.setUserAgent\(currentUserAgent\(url\)\)/, 'Main-frame navigation must update the main-world UA');
assert.match(main, /if \(isMainFrame && !isInPlace\) applyNavigationIdentity\(contents, url\)/);
assert.match(main, /compatibleBrowserIdentity: requiresCompatibleBrowserIdentity\(url\)/);
assert.match(main, /session\.defaultSession\.setUserAgent\(currentUserAgent\(\), 'en-US,en;q=0\.9'\)/, 'The default session must not expose Electron');
assert.match(store, /const isFlowrBrowser = \/\\bflowr\\\/\/\.test\(ua\)/, 'Store detection must require Flowr, not Electron');
assert.match(main, /Chrome\/\$\{chromeMajor\}\.0\.0\.0 Safari\/537\.36 Flowr\/\$\{version\}/, 'Normal browsing must keep the store-visible Flowr token');
assert.match(preload, /sendSync\('privacy-web-preferences', location\.href\)/, 'Early preload must use the actual document URL');
assert.match(preload, /Object\.defineProperty\(navigator, 'userAgent'/);
assert.match(preload, /fullVersionList/);
assert.match(preload, /platform: privacy\.browserPlatform/);

const signInStart = main.indexOf("ipcMain.handle('tieddr-sign-in'");
const signInEnd = main.indexOf("ipcMain.handle('tieddr-sign-out'", signInStart);
const signIn = main.slice(signInStart, signInEnd);
assert.match(signIn, /preload: path\.join\(__dirname, 'viewpreload\.js'\)/);
assert.match(signIn, /siteAppWebContents\.add\(authWin\.webContents\.id\)/);
assert.match(signIn, /__flowrSiteApp = true/);
const popupStart = main.indexOf('function createBrandedPopup');
const popupEnd = main.indexOf('function searchUrl', popupStart);
const popup = main.slice(popupStart, popupEnd);
assert.match(popup, /preload: path\.join\(__dirname, 'viewpreload\.js'\)/);
assert.match(popup, /siteAppWebContents\.add\(popup\.webContents\.id\)/);
assert.match(popup, /once\('closed', \(\) => siteAppWebContents\.delete/);

console.log('Flowr OAuth browser identity and popup compatibility checks passed.');
