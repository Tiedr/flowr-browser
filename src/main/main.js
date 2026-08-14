// Suppress EPIPE crash on closed stdout/stderr — must be first, before any requires
const _origWarn = console.warn;
const _origError = console.error;
const _safeLog = (fn) => (...args) => { try { fn(...args); } catch (e) { if (e.code !== 'EPIPE') throw e; } };
console.warn = _safeLog(_origWarn);
console.error = _safeLog(_origError);
process.on('uncaughtException', (err) => { if (err.code !== 'EPIPE') console.error('Uncaught exception:', err); });

const { app, BrowserWindow, ipcMain, shell, session, dialog, Menu, clipboard, safeStorage, webContents } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const Store = require('./store');
const { parseExtensionId, installStoreExtension } = require('./crx');
const { shouldBlockRequest } = require('./adblock');
// Tieddr Vault — password manager + Tieddr Wallet, synced to the encrypted mirror.
const vault = require('./vault');
const vaultAccount = require('./vault/account');
const { APPWRITE } = require('./vault/config');

// --- Tieddr Account SSO + bookmark sync ------------------------------------
const TIEDDR_ACCOUNT_BASE = 'https://account.tieddr.com';
const TIEDDR_API_BASE = 'https://api.account.tieddr.com';
const TIEDDR_SPACE_BASE = 'https://space.tieddr.com';
const FLOWR_RELEASES_API = 'https://api.github.com/repos/Tiedr/flowr-browser/releases/latest';
// OAuth client registered on account.tieddr.com/apps for "Flow" — trusted
// first-party app, redirect_uri below matches EXACTLY what's registered.
const TIEDDR_CLIENT_ID = 'client_ohHEAmTYYKNYVdE6';
const TIEDDR_REDIRECT_URI = `${TIEDDR_ACCOUNT_BASE}/oauth/flow-browser/callback`;
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}
function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

// Incognito windows are separate app instances launched with FLOW_INCOGNITO=1.
// They browse in a private, in-memory session and never write history.
const INCOGNITO = process.env.FLOW_INCOGNITO === '1';

const profilesStore = new Store('profiles', {
  activeProfileId: 'default',
  profiles: [{ id: 'default', name: 'Default' }]
});
const SETTINGS_DEFAULTS = {
  theme: 'flow',
  homePage: 'about:blank',
  searchEngine: 'google',
  blockTrackers: true,
  httpsOnly: false,
  doNotTrack: false,
  defaultZoom: 1,
  startup: 'start',
  downloadPath: '',
  askWhereToSave: false,
  savePasswords: true,
  autofill: true,
  memorySaver: false,
  hardwareAcceleration: true,
  aiSuggestions: true,
  reduceMotion: false,
  uiScale: 1,
  language: 'en',
  accentColor: '',
  startBackground: 'gradient-midnight'
};
const settingsStore = new Store('settings', SETTINGS_DEFAULTS);
if (settingsStore.get('hardwareAcceleration') === false) app.disableHardwareAcceleration();
const downloadsStore = new Store('downloads', { downloads: [] });
const extensionsStore = new Store('extensions', { extensions: [] });
const accountStore = new Store('account', { account: null });

let currentProfileId = profilesStore.get('activeProfileId');
let bookmarksStore;
let historyStore;
let passwordsStore;
let notesStore;
let authWin = null;
let mainWindow;
let trackerBlockingEnabled = settingsStore.get('blockTrackers') !== false;
let adBlockerEnabled = settingsStore.get('adBlocker') !== false;
let clipboardClearTimeout = null;

const downloadItems = new Map();
const downloadPersistAt = new Map();

function initStores(profileId) {
  bookmarksStore = new Store(`profiles/${profileId}/bookmarks`, { bookmarks: [] });
  historyStore = new Store(`profiles/${profileId}/history`, { history: [] });
  passwordsStore = new Store(`profiles/${profileId}/passwords`, { passwords: [] });
  notesStore = new Store(`profiles/${profileId}/notes`, { notes: [], folders: [] });
  vault.init(profileId); // Tieddr Vault's per-profile encrypted-mirror cache
}

// Encrypt saved passwords at rest with the OS keychain (safeStorage) when
// available, falling back to base64 so the feature still works everywhere.
function encPw(plain) {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    try { return { enc: safeStorage.encryptString(plain).toString('base64'), safe: true }; } catch (_) {}
  }
  return { enc: Buffer.from(plain, 'utf8').toString('base64'), safe: false };
}
function decPw(rec) {
  try {
    const buf = Buffer.from(rec.enc, 'base64');
    return rec.safe ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return ''; }
}

// Report whether OS-level encryption is available so the UI can show an
// accurate label ("encrypted with system keychain" vs "stored on device").
ipcMain.handle('pw-encryption-available', () => {
  try { return safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; }
});

initStores(currentProfileId);

// The session web pages use (set once the app is ready). Incognito windows get a
// private in-memory partition; normal windows use the persistent default session.
let browsingSession = null;

function configureSession(ses) {
  // Present as the Chromium browser engine we actually embed. Many web apps
  // reject Electron's default UA even though the page APIs are compatible.
  const chromeMajor = String(process.versions.chrome || '142.0.0.0').split('.')[0];
  const platformTokens = {
    darwin: { ua: 'Macintosh; Intel Mac OS X 10_15_7', hint: '"macOS"' },
    linux: { ua: 'X11; Linux x86_64', hint: '"Linux"' },
    win32: { ua: 'Windows NT 10.0; Win64; x64', hint: '"Windows"' }
  };
  const platform = platformTokens[process.platform] || platformTokens.linux;
  const compatibleUA = `Mozilla/5.0 (${platform.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
  ses.setUserAgent(compatibleUA, 'en-US,en;q=0.9');
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    details.requestHeaders['User-Agent'] = compatibleUA;
    // Avoid Electron-specific client-hint brands triggering unsupported-browser gates.
    details.requestHeaders['sec-ch-ua'] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not_A Brand";v="99"`;
    details.requestHeaders['sec-ch-ua-platform'] = platform.hint;
    details.requestHeaders['sec-ch-ua-mobile'] = '?0';
    callback({ requestHeaders: details.requestHeaders });
  });
  // Match all web requests against the compact, testable Flowr filter engine.
  // It blocks known advertising hosts plus third-party tracking endpoints while
  // leaving first-party pages and navigation untouched.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: shouldBlockRequest(details, adBlockerEnabled) });
  });

  // Grant common extension permissions — these are safe, non-privileged APIs
  // that Chrome extensions routinely need. Side panel and contextMenus are
  // included so extensions like ad blockers work correctly.
  const GRANTED_PERMISSIONS = new Set([
    'notifications', 'storage', 'tabs', 'contextMenus', 'cookies',
    'webNavigation', 'webRequest', 'management', 'alarms',
    'idle', 'clipboardRead', 'clipboardWrite', 'geolocation', 'media',
    'fullscreen', 'pointerLock', 'midi', 'midiSysex', 'display-capture',
    'bookmarks', 'history', 'downloads', 'topSites',
    'browsingData', 'privacy', 'sessions', 'favicon',
    'search', 'identity', 'power', 'systemPreferences',
    'sidePanel', 'activeTab', 'scripting', 'declarativeNetRequest',
    'declarativeNetRequestFeedback', 'declarativeNetRequestWithHostAccess'
  ]);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    // Auto-grant safe permissions; prompt-style approve for known ones
    callback(GRANTED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => GRANTED_PERMISSIONS.has(permission));
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function createBrandedPopup(url) {
  if (!/^https?:\/\//i.test(url || '')) return;
  const popup = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 520,
    minHeight: 420,
    show: false,
    title: `Flowr — ${new URL(url).hostname}`,
    icon: path.join(__dirname, '../../flowricondark.png'),
    backgroundColor: '#111111',
    webPreferences: {
      session: browsingSession || session.defaultSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  popup.setMenuBarVisibility(false);
  popup.once('ready-to-show', () => popup.show());
  popup.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    createBrandedPopup(childUrl);
    return { action: 'deny' };
  });
  popup.webContents.on('page-title-updated', (_event, title) => {
    popup.setTitle(title ? `${title} — Flowr` : 'Flowr');
  });
  popup.loadURL(url);
}

function searchUrl(query) {
  const engine = settingsStore.get('searchEngine') || 'google';
  const map = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q='
  };
  return (map[engine] || map.google) + encodeURIComponent(query);
}

// Serialize the fields we need from a context-menu event, so the renderer can
// draw its own custom-skinned menu (native menus can't be themed).
function contextParams(params) {
  return {
    x: params.x, y: params.y,
    linkURL: params.linkURL || '',
    srcURL: params.srcURL || '',
    mediaType: params.mediaType,
    isEditable: params.isEditable,
    selectionText: (params.selectionText || '').trim(),
    editFlags: params.editFlags || {}
  };
}

async function refreshTieddrProfile(account) {
  if (!account?.token) return account;
  try {
    let info = {};
    const res = await fetch(`${TIEDDR_API_BASE}/v1/oauth/userinfo`, { headers: { Authorization: `Bearer ${account.token}` } });
    if (res.ok) info = await res.json();

    // Older Account API deployments only returned sub/email. Resolve the
    // canonical Appwrite identity with the user-scoped JWT that Vault already
    // mints, so Flowr always receives the real name and avatar preferences.
    vaultAccount.setAccessToken(account.token);
    const jwt = await vaultAccount.getAppwriteJwt();
    if (jwt) {
      const identityRes = await fetch(`${APPWRITE.endpoint}/account`, {
        headers: { 'X-Appwrite-Project': APPWRITE.projectId, 'X-Appwrite-JWT': jwt }
      });
      if (identityRes.ok) {
        const identity = await identityRes.json();
        info = { ...info, sub: identity.$id || info.sub, email: identity.email || info.email, name: identity.name || info.name, avatarId: identity.prefs?.avatarId || info.avatarId };
      }
    }
    const updated = {
      ...account,
      uid: info.sub || account.uid,
      email: info.email || account.email,
      name: info.name || account.name || 'Tieddr account',
      avatar: info.avatarId ? `${APPWRITE.endpoint}/storage/buckets/avatars/files/${encodeURIComponent(info.avatarId)}/view?project=${APPWRITE.projectId}` : account.avatar || ''
    };
    accountStore.set('account', updated);
    return updated;
  } catch (_) { return account; }
}

// Map a keyboard event to an action name. Ctrl on Windows/Linux, Cmd on macOS.
function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  const ctrl = input.control || input.meta;
  const shift = input.shift;
  const alt = input.alt;
  const key = (input.key || '').toLowerCase();
  if (ctrl && shift && key === 't') return 'reopen';
  if (ctrl && shift && key === 'n') return 'incognito';
  if (ctrl && key === 't') return 'new-tab';
  if (ctrl && key === 'n') return 'new-window';
  if (ctrl && key === 'w') return 'close-tab';
  if ((ctrl && key === 'l') || (alt && key === 'd') || key === 'f6') return 'focus-url';
  if (ctrl && shift && key === 'r') return 'hard-reload';
  if ((ctrl && key === 'r') || key === 'f5') return 'reload';
  if (alt && key === 'arrowleft') return 'back';
  if (alt && key === 'arrowright') return 'forward';
  if (ctrl && key === 'tab') return shift ? 'prev-tab' : 'next-tab';
  if ((ctrl && shift && key === 'i') || key === 'f12') return 'devtools';
  if (ctrl && (key === '=' || key === '+')) return 'zoom-in';
  if (ctrl && key === '-') return 'zoom-out';
  if (ctrl && key === '0') return 'zoom-reset';
  if (ctrl && key === 'd') return 'bookmark-page';
  if (ctrl && key === 'h') return 'history';
  if (ctrl && key === 'j') return 'downloads';
  if (ctrl && key === ',') return 'settings';
  if (key === 'f9') return 'reader';
  if (ctrl && /^[1-9]$/.test(key)) return key === '9' ? 'tab-last' : `tab-${key}`;
  return null;
}

// Reader Mode: lift the article out of the page into a clean, centered reading
// column (toggles off on a second call). Runs entirely inside the page. Title
// and host go in via textContent; only the article's own same-origin body is
// re-inserted as HTML, after page furniture (nav/aside/panels) is stripped.
const READER_JS = `(function(){
  var ID='__flowReader';
  var ex=document.getElementById(ID);
  if(ex){ex.remove();document.documentElement.style.overflow='';return 'off';}
  var SEL=['[itemprop=articleBody]','.mw-parser-output','article [itemprop=articleBody]','article','[role=main] article','.post-content','.entry-content','.article-body','.article__body','.story-body','.post-body','main article','main'];
  var art=null;
  for(var i=0;i<SEL.length;i++){var e=document.querySelector(SEL[i]);if(e&&(e.innerText||'').replace(/\\s+/g,' ').length>500){art=e;break;}}
  if(!art){var best=null,score=-1;document.querySelectorAll('div,section').forEach(function(el){var len=(el.innerText||'').length;if(len<600)return;var ps=el.querySelectorAll('p').length;if(ps<3)return;var sc=ps*40+len;if(sc>score){score=sc;best=el;}});art=best;}
  if(!art)return 'none';
  var clone=art.cloneNode(true);
  clone.querySelectorAll('nav,aside,header,footer,form,script,style,noscript,button,input,select,textarea,iframe,.navbox,.sidebar,.infobox,.mw-editsection,[role=navigation],[role=complementary],.reflist,.mw-references-wrap,.references,.catlinks,#toc,.toc,.hatnote,.shortdescription,.ambox,.metadata,.mw-jump-link,.noprint,.vector-toc,.mw-indicators,.thumbcaption .magnify,.advertisement,[class*=share],[class*=social],[aria-hidden=true]').forEach(function(el){el.remove();});
  var dark=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
  var fg=dark?'#e7e7e8':'#1c1c1e', bg=dark?'#17181c':'#faf8f4', sub=dark?'#8a8f98':'#8c857a', rule=dark?'#2a2c33':'#e7e1d6', lnk=dark?'#7aa2ff':'#2963d6';
  var o=document.createElement('div');o.id=ID;o.tabIndex=-1;
  o.style.cssText='position:fixed;inset:0;z-index:2147483646;overflow-y:auto;-webkit-overflow-scrolling:touch;background:'+bg+';color:'+fg+';';
  var w=document.createElement('div');
  w.style.cssText='max-width:700px;margin:0 auto;padding:76px 26px 160px;font:19px/1.78 Georgia,Cambria,"Times New Roman",serif;';
  var h1=document.querySelector('h1');
  if(h1){var t=document.createElement('h1');t.textContent=h1.innerText;t.style.cssText='font:650 34px/1.25 -apple-system,"Segoe UI",system-ui,sans-serif;letter-spacing:-.6px;margin:0 0 8px';w.appendChild(t);}
  var meta=document.createElement('div');meta.textContent=location.hostname.replace(/^www\\./,'');meta.style.cssText='font:14px/1 -apple-system,"Segoe UI",sans-serif;color:'+sub+';margin:0 0 36px;padding-bottom:22px;border-bottom:1px solid '+rule;w.appendChild(meta);
  var body=document.createElement('div');body.innerHTML=clone.innerHTML;
  body.querySelectorAll('img,video,figure,.thumb,.thumbinner,.thumbimage,.mw-halign-right,.mw-halign-left').forEach(function(el){el.style.cssText='max-width:100%;width:auto;height:auto;float:none;clear:both;display:block;margin:26px auto;border-radius:8px'});
  body.querySelectorAll('figcaption,.thumbcaption').forEach(function(el){el.style.cssText='font:14px/1.5 -apple-system,"Segoe UI",sans-serif;color:'+sub+';text-align:center;margin:10px auto 26px;max-width:100%'});
  body.querySelectorAll('a').forEach(function(el){el.style.color=lnk;el.style.textDecoration='none';});
  body.querySelectorAll('h2,h3,h4').forEach(function(el){el.style.fontFamily='-apple-system,"Segoe UI",system-ui,sans-serif';el.style.letterSpacing='-.3px';el.style.marginTop='1.7em';});
  w.appendChild(body);
  o.appendChild(w);document.body.appendChild(o);document.documentElement.style.overflow='hidden';o.focus();
  o.addEventListener('keydown',function(e){if(e.key==='Escape'){o.remove();document.documentElement.style.overflow='';}});
  return 'on';
})()`;

// Every shortcut is forwarded to the renderer, which owns the tab/webview and
// executes the corresponding action on the active <webview>.
function handleShortcut(action) {
  send('shortcut', action);
}

function attachShortcuts(webContents) {
  webContents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (action) { event.preventDefault(); handleShortcut(action); }
  });
}

function getSetting(key) {
  return settingsStore.get(key);
}

function persistDownload(update) {
  const downloads = downloadsStore.get('downloads') || [];
  const next = [{ date: new Date().toISOString(), ...update }, ...downloads.filter((item) => item.id !== update.id)].slice(0, 200);
  downloadsStore.set('downloads', next);
  return next;
}

function addToHistory(url, title) {
  if (INCOGNITO || !url || url === 'about:blank') return;
  const history = historyStore.get('history') || [];
  const newItem = { url, title: title || url, date: new Date().toISOString() };
  const next = [newItem, ...history.filter((item) => item.url !== url)].slice(0, 1000);
  historyStore.set('history', next);
  send('history-changed', next);
}

async function loadStoredExtensions() {
  const extensions = extensionsStore.get('extensions') || [];
  const loaded = [];

  for (const extension of extensions) {
    if (!extension.enabled || !extension.path) {
      loaded.push(extension);
      continue;
    }

    try {
      const loadedExtension = await session.defaultSession.loadExtension(extension.path, { allowFileAccess: true });
      loaded.push({
        ...extension,
        id: loadedExtension.id,
        name: loadedExtension.name || extension.name,
        version: loadedExtension.version || extension.version,
        error: null
      });
    } catch (error) {
      loaded.push({ ...extension, enabled: false, error: error.message });
    }
  }

  extensionsStore.set('extensions', loaded);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: false,
    center: true,
    transparent: false,
    backgroundColor: '#f6f7fb',
    icon: path.join(__dirname, '../../flowricondark.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  });

  mainWindow.setMenu(null);

  // Keyboard shortcuts while the app chrome has focus. Per-web-view shortcuts
  // (focus inside a page) are attached from the renderer via 'register-webview'.
  attachShortcuts(mainWindow.webContents);

  // Custom-skinned context menu for the app UI (address bar, etc.).
  mainWindow.webContents.on('context-menu', (event, params) => {
    send('show-context-menu', { ...contextParams(params), ui: true, image: null });
  });

  // Reveal the window only once it has painted, then pull it to the front.
  // We create with show:false to avoid a blank white flash, but a frameless
  // window that never calls show() (or that loses focus behind other apps)
  // looks like "nothing launched" — so we show on every reliable signal and
  // keep a timed fallback in case ready-to-show never fires.
  const revealWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  };
  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', revealWindow);
  setTimeout(revealWindow, 2500);

  const startUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:8081'
    : `file://${path.join(__dirname, '../../dist/index.html')}`;

  mainWindow.loadURL(startUrl).catch(() => revealWindow());

  browsingSession.on('will-download', (event, item) => {
    const downloadId = Date.now();
    const fileName = item.getFilename();
    downloadItems.set(downloadId, item);

    // Honor a chosen download folder (unless the user wants to be asked each time).
    const dir = settingsStore.get('downloadPath');
    if (dir && !settingsStore.get('askWhereToSave')) {
      try { item.setSavePath(path.join(dir, fileName)); } catch (_) {}
    }

    const initial = persistDownload({
      id: downloadId,
      filename: fileName,
      url: item.getURL(),
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      path: ''
    });
    send('downloads-changed', initial);

    item.on('updated', (event, state) => {
      const now = Date.now();
      if (state !== 'interrupted' && now - (downloadPersistAt.get(downloadId) || 0) < 300) return;
      downloadPersistAt.set(downloadId, now);
      const nextState = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      const downloads = persistDownload({
        id: downloadId,
        filename: fileName,
        url: item.getURL(),
        state: nextState,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        path: item.getSavePath() || ''
      });
      send('downloads-changed', downloads);
    });

    item.on('done', (event, state) => {
      const downloads = persistDownload({
        id: downloadId,
        filename: fileName,
        url: item.getURL(),
        state: state === 'completed' ? 'completed' : state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        path: item.getSavePath() || ''
      });
      downloadItems.delete(downloadId);
      downloadPersistAt.delete(downloadId);
      send('downloads-changed', downloads);
    });
  });
}

app.whenReady().then(async () => {
  // Must be the exact same partition used by renderer webviews. Configuring
  // defaultSession does not affect <webview partition="persist:flow-main">.
  browsingSession = INCOGNITO ? session.fromPartition('flow-incognito') : session.fromPartition('persist:flow-main');
  configureSession(browsingSession);
  if (!INCOGNITO) await loadStoredExtensions();
  createWindow();

  // System idle detection for vault auto-lock
  const { powerMonitor } = require('electron');
  powerMonitor.on('lock-screen', () => {
    const settings = settingsStore.get('settings') || {};
    if (settings.lockOnIdle !== false && vault.isUnlocked()) {
      vault.lock();
      if (mainWindow) mainWindow.webContents.send('vault-locked');
    }
  });
  powerMonitor.on('suspend', () => {
    const settings = settingsStore.get('settings') || {};
    if (settings.lockOnIdle !== false && vault.isUnlocked()) {
      vault.lock();
      if (mainWindow) mainWindow.webContents.send('vault-locked');
    }
  });

  // Already signed in from a previous launch — sync now, then keep syncing
  // periodically for the rest of this session. Skipped in incognito.
  if (!INCOGNITO && accountStore.get('account')) {
    void syncTieddrAll();
    startAutoSync();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Flush all pending debounced writes before quitting
  [profilesStore, settingsStore, downloadsStore, extensionsStore, accountStore].forEach(s => s.flush && s.flush());
  if (bookmarksStore) bookmarksStore.flush && bookmarksStore.flush();
  if (historyStore) historyStore.flush && historyStore.flush();
  if (passwordsStore) passwordsStore.flush && passwordsStore.flush();
  if (notesStore) notesStore.flush && notesStore.flush();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  [profilesStore, settingsStore, downloadsStore, extensionsStore, accountStore].forEach(s => s.flush && s.flush());
  if (bookmarksStore) bookmarksStore.flush && bookmarksStore.flush();
  if (historyStore) historyStore.flush && historyStore.flush();
  if (passwordsStore) passwordsStore.flush && passwordsStore.flush();
  if (notesStore) notesStore.flush && notesStore.flush();
});

// --- Web view (renderer-owned <webview> elements) -------------------------
// The renderer creates the <webview> DOM elements and drives navigation, find,
// zoom and events directly. Main only provides the preload path, persists
// history, and attaches keyboard shortcuts to each view's webContents.

// Absolute file:// URL of the per-page preload (password/wallet autofill).
ipcMain.handle('get-view-preload', () => pathToFileURL(path.join(__dirname, 'viewpreload.js')).href);

// Renderer reports a navigation so we can persist history (skipped in incognito).
ipcMain.on('add-history', (event, url, title) => addToHistory(url, title));

// Renderer registers each new <webview>'s webContents id so we can attach
// keyboard shortcuts for when focus is inside the page.
ipcMain.on('register-webview', (event, id) => {
  const wc = webContents.fromId(id);
  if (wc && !wc.isDestroyed()) {
    attachShortcuts(wc);
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) createBrandedPopup(url);
      return { action: 'deny' };
    });
  }
});

ipcMain.on('set-webview-active', (_event, id, active) => {
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed()) return;
  try { wc.setBackgroundThrottling(!active); } catch (_) {}
  try { wc.setFrameRate(active ? 60 : 8); } catch (_) {}
});

// Commands that need the main process (dialogs, reader mode, save-page). The
// renderer passes the target view's webContents id; we operate on it directly.
ipcMain.on('view-command', (event, id, cmd, arg) => {
  const wc = id != null ? webContents.fromId(id) : null;
  if (!wc || wc.isDestroyed()) return;
  switch (cmd) {
    case 'back': if (wc.canGoBack()) wc.goBack(); break;
    case 'forward': if (wc.canGoForward()) wc.goForward(); break;
    case 'reload': wc.reload(); break;
    case 'hard-reload': wc.reloadIgnoringCache(); break;
    case 'stop': wc.stop(); break;
    case 'copy': wc.copy(); break;
    case 'cut': wc.cut(); break;
    case 'paste': wc.paste(); break;
    case 'selectAll': wc.selectAll(); break;
    case 'undo': wc.undo(); break;
    case 'redo': wc.redo(); break;
    case 'copyText': if (arg) clipboard.writeText(arg); break;
    case 'copyImage': if (arg) wc.copyImageAt(arg.x, arg.y); break;
    case 'saveImage': if (arg) wc.downloadURL(arg); break;
    case 'inspect': if (arg) wc.inspectElement(arg.x | 0, arg.y | 0); break;
    case 'devtools': wc.toggleDevTools(); break;
    case 'reader': wc.executeJavaScript(READER_JS).catch(() => {}); break;
    case 'print': wc.print(); break;
    case 'savePage': {
      dialog.showSaveDialog(mainWindow, {
        title: 'Save page as', defaultPath: 'page.html',
        filters: [{ name: 'Web page, complete', extensions: ['html'] }]
      }).then(({ canceled, filePath }) => { if (!canceled && filePath) wc.savePage(filePath, 'HTMLComplete').catch(() => {}); }).catch(() => {});
      break;
    }
  }
});

// New window / incognito: launch a fresh, fully-isolated app instance. Each is
// its own process, so windows never interfere with each other's tabs.
ipcMain.on('new-window', (event, opts) => {
  const args = process.defaultApp ? [app.getAppPath()] : [];
  const env = { ...process.env };
  if (opts && opts.incognito) env.FLOW_INCOGNITO = '1'; else delete env.FLOW_INCOGNITO;
  try { spawn(process.execPath, args, { detached: true, stdio: 'ignore', env }).unref(); } catch (_) {}
});

ipcMain.handle('get-incognito', () => INCOGNITO);

// --- Password manager (backed by the Tieddr Vault when unlocked) ----------
// When the vault is unlocked it's the source of truth — synced across every
// Tieddr client. When locked / signed-out we fall back to Flow's on-device
// password store so autofill still works. Same IPC surface + pw-save-prompt, so
// viewpreload.js and the Settings UI are unchanged.
const vaultOn = () => vault.isUnlocked();

ipcMain.handle('pw-get-for-origin', async (event, origin) => {
  if (settingsStore.get('autofill') === false) return null;
  if (vaultOn()) { const c = await vault.getForOrigin(origin); if (c) return c; }
  const rec = (passwordsStore.get('passwords') || []).filter(p => p.origin === origin).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return rec ? { username: rec.username, password: decPw(rec) } : null;
});

ipcMain.on('pw-captured', async (event, { origin, username, password } = {}) => {
  if (!password || INCOGNITO || settingsStore.get('savePasswords') === false) return;
  if (vaultOn()) {
    const h = await vault.hasLogin(origin, username);
    if (h.exists) return; // already saved for this account
    send('pw-save-prompt', { origin, username, password });
    return;
  }
  const existing = (passwordsStore.get('passwords') || []).find(p => p.origin === origin && p.username === username);
  if (existing && decPw(existing) === password) return; // unchanged
  send('pw-save-prompt', { origin, username, password });
});

const pwPublic = () => (passwordsStore.get('passwords') || []).map(p => ({ origin: p.origin, username: p.username, date: p.date }));
async function pwListNow() {
  if (vaultOn()) {
    const r = await vault.listItems();
    return (r.items || []).filter(i => i.type === 'PASSWORD').map(i => ({ origin: i.url, username: i.username, date: new Date(i.updatedAt || Date.now()).toISOString() }));
  }
  return pwPublic();
}
async function vaultPwItem(origin, username) {
  const r = await vault.listItems();
  return (r.items || []).find(i => i.type === 'PASSWORD' && i.url === origin && (i.username || '') === (username || ''));
}

ipcMain.handle('pw-save', async (event, { origin, username, password } = {}) => {
  if (!password) return pwListNow();
  if (vaultOn()) { await vault.saveLogin({ origin, url: origin, username, password }); return pwListNow(); }
  const { enc, safe } = encPw(password);
  const list = (passwordsStore.get('passwords') || []).filter(p => !(p.origin === origin && p.username === username));
  list.unshift({ origin, username: username || '', enc, safe, date: new Date().toISOString() });
  passwordsStore.set('passwords', list);
  return pwListNow();
});

ipcMain.handle('pw-list', () => pwListNow());
ipcMain.handle('pw-reveal', async (event, origin, username) => {
  if (!vaultOn()) {
    mainWindow.webContents.send('vault-require-unlock', { action: 'reveal', origin, username });
    return '';
  }
  const it = await vaultPwItem(origin, username);
  if (it) { const rv = await vault.reveal(it.id); return rv.ok ? (rv.value || '') : ''; }
  return '';
});
ipcMain.handle('pw-copy', async (event, origin, username) => {
  if (!vaultOn()) {
    mainWindow.webContents.send('vault-require-unlock', { action: 'copy', origin, username });
    return false;
  }
  let val = '';
  const it = await vaultPwItem(origin, username);
  if (it) { const rv = await vault.reveal(it.id); val = rv.ok ? (rv.value || '') : ''; }
  if (val) {
    clipboard.writeText(val);
    const settings = settingsStore.get('settings') || {};
    const clearTime = settings.clipboardClear || 30;
    if (clearTime > 0) {
      if (clipboardClearTimeout) clearTimeout(clipboardClearTimeout);
      clipboardClearTimeout = setTimeout(() => { clipboard.writeText(''); }, clearTime * 1000);
    }
  }
  return true;
});
ipcMain.handle('pw-delete', async (event, origin, username) => {
  if (vaultOn()) { const it = await vaultPwItem(origin, username); if (it) await vault.deleteItem(it.id); return pwListNow(); }
  passwordsStore.set('passwords', (passwordsStore.get('passwords') || []).filter(p => !(p.origin === origin && p.username === username)));
  return pwListNow();
});

// --- Tieddr Vault (rich surface: passwords, Tieddr Wallet, secrets) --------
vault.onLock(() => send('vault-locked'));

ipcMain.handle('vault-state', async () => {
  const acc = accountStore.get('account');
  const st = await vault.state();
  return { linked: !!(acc && acc.uid), email: acc ? acc.email : null, ...st };
});
ipcMain.handle('vault-unlock', async (event, pin) => {
  const acc = accountStore.get('account');
  if (!acc || !acc.uid) return { ok: false, error: 'Sign in with Tieddr Account first' };
  // Hand the vault the current access token so its first sync can mint a
  // per-user Appwrite JWT via the vault-sso bridge (falls back to the key).
  vault.setAccessToken(acc.token || null, acc.tokenExp || 0);
  try {
    const r = await vault.unlock(acc.uid, pin);
    // One-time import of Flow's pre-vault on-device logins (skips dupes).
    const local = (passwordsStore.get('passwords') || []).map(p => ({ origin: p.origin, username: p.username, password: decPw(p) }));
    const mig = await vault.migrateLocalPasswords(local).catch(() => ({ imported: 0 }));
    return { ...r, migrated: mig.imported || 0 };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('vault-lock', () => vault.lock());
ipcMain.handle('vault-list', () => vault.listItems());
ipcMain.handle('vault-reveal', (event, id) => vault.reveal(id));
ipcMain.handle('vault-add', (event, payload) => vault.addItem(payload || {}));
ipcMain.handle('vault-delete', (event, id) => vault.deleteItem(id));
ipcMain.handle('vault-sync', () => vault.sync());
ipcMain.handle('vault-copy', async (event, id) => {
  const rv = await vault.reveal(id);
  if (rv && rv.ok && typeof rv.value === 'string') {
    clipboard.writeText(rv.value);
    const settings = settingsStore.get('settings') || {};
    const clearTime = settings.clipboardClear || 30;
    if (clearTime > 0) {
      if (clipboardClearTimeout) clearTimeout(clipboardClearTimeout);
      clipboardClearTimeout = setTimeout(() => { clipboard.writeText(''); }, clearTime * 1000);
    }
  }
  return !!(rv && rv.ok);
});

ipcMain.handle('change-vault-pin', async (event, currentPin, newPin) => {
  const acc = accountStore.get('account');
  if (!acc || !acc.uid) return { error: 'Not signed in' };
  try {
    await vault.unlock(acc.uid, currentPin);
  } catch (err) {
    return { error: 'Current PIN is incorrect' };
  }
  if (!/^\d{6}$/.test(newPin)) {
    return { error: 'New PIN must be 6 digits' };
  }
  try {
    await vault.changePin(newPin);
    return { success: true };
  } catch (err) {
    return { error: 'Failed to change PIN' };
  }
});

ipcMain.on('cancel-clipboard-clear', () => {
  if (clipboardClearTimeout) {
    clearTimeout(clipboardClearTimeout);
    clipboardClearTimeout = null;
  }
});

ipcMain.handle('check-biometric-available', () => {
  const { safeStorage } = require('electron');
  return safeStorage.isEncryptionAvailable();
});

// Tieddr Wallet — checkout card autofill (called from viewpreload.js).
ipcMain.handle('wallet-cards-for-fill', () => vault.cardsForFill());
ipcMain.handle('wallet-fill', (event, id) => vault.fillCard(id));

// --- Tieddr Account SSO (OAuth 2.0 Authorization Code + PKCE) -------------
// The previous version of this used the OAuth *implicit* flow
// (response_type=token) — but account.tieddr.com's real OAuth server only
// ever implemented Authorization Code + PKCE (confirmed against
// Tieddr-Space-Official's own src/lib/tieddr-sso.ts, the same contract every
// other Tieddr platform — web, mobile, desktop — already uses). The old flow
// almost certainly never completed a real sign-in. This mirrors that exact
// contract: authorize with response_type=code + S256 code_challenge,
// intercept the redirect in this window before it ever loads (same mechanic
// as before — no page needs to exist at TIEDDR_REDIRECT_URI, Electron just
// needs to *attempt* to navigate there), then exchange the code server-side.
async function exchangeTieddrCode(code, verifier) {
  const tokenRes = await fetch(`${TIEDDR_API_BASE}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: TIEDDR_REDIRECT_URI,
      client_id: TIEDDR_CLIENT_ID,
      code_verifier: verifier
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Sign-in failed');
  }

  // userinfo only guarantees sub/email — there's no display name/avatar on
  // the Tieddr Account side, so the local part of the email stands in. `sub` is
  // the stable account id the Tieddr Vault derives its encryption key + sync
  // scope from (the SAME id the phone/extension/desktop use), so we keep it.
  let email = '';
  let uid = '';
  let name = '';
  let avatar = '';
  try {
    const infoRes = await fetch(`${TIEDDR_API_BASE}/v1/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (infoRes.ok) {
      const info = await infoRes.json();
      email = info.email || '';
      uid = info.sub || '';
      name = info.name || '';
      // Build a Gravatar URL from the email hash — widely used default avatar
      if (email) {
        const emailHash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
        avatar = info.avatarId ? `${APPWRITE.endpoint}/storage/buckets/avatars/files/${encodeURIComponent(info.avatarId)}/view?project=${APPWRITE.projectId}` : '';
      }
    }
  } catch (_) { /* profile display is best-effort; the token itself is what matters */ }

  return refreshTieddrProfile({
    token: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    uid, email,
    name: name || 'Tieddr account',
    avatar
  });
}

// Attempt to refresh an expired access token using the stored refresh token.
// Returns the updated account object on success, or null if refresh fails.
async function refreshTieddrToken(account) {
  if (!account || !account.refreshToken) return null;
  try {
    const res = await fetch(`${TIEDDR_API_BASE}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: TIEDDR_CLIENT_ID
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return null;
    const updated = {
      ...account,
      token: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken
    };
    return refreshTieddrProfile(updated);
  } catch (_) {
    return null;
  }
}

ipcMain.handle('get-account', async () => {
  const account = accountStore.get('account');
  const refreshed = await refreshTieddrProfile(account);
  if (refreshed !== account) send('account-changed', refreshed);
  return refreshed;
});

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  try {
    const res = await fetch(FLOWR_RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Flowr/${currentVersion}` } });
    if (!res.ok) throw new Error(`Update service returned ${res.status}`);
    const release = await res.json();
    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find(a => /installer.*\.exe$/i.test(a.name)) || assets.find(a => /windows.*\.zip$/i.test(a.name));
    return { ok: true, currentVersion, latestVersion, available: compareVersions(latestVersion, currentVersion) > 0, releaseUrl: release.html_url, downloadUrl: asset?.browser_download_url || release.html_url, notes: release.body || '', publishedAt: release.published_at };
  } catch (error) {
    return { ok: false, currentVersion, error: error?.message || 'Could not check for updates' };
  }
});

ipcMain.handle('open-external', (_event, url) => {
  if (!/^https:\/\//i.test(String(url || ''))) return false;
  void shell.openExternal(url);
  return true;
});

ipcMain.handle('tieddr-sign-in', () => new Promise((resolve) => {
  if (authWin && !authWin.isDestroyed()) { authWin.focus(); return resolve(accountStore.get('account')); }

  const { verifier, challenge } = pkcePair();
  const state = randomState();

  authWin = new BrowserWindow({
    parent: mainWindow, width: 480, height: 660, resizable: false, minimizable: false, maximizable: false,
    title: 'Sign in to Tieddr', autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  authWin.setMenu(null);

  const authUrl = `${TIEDDR_ACCOUNT_BASE}/oauth/authorize` +
    '?response_type=code' +
    `&client_id=${encodeURIComponent(TIEDDR_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(TIEDDR_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent('email profile')}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    '&code_challenge_method=S256';
  authWin.loadURL(authUrl).catch(() => {});

  let settled = false;
  const finish = (fn) => { if (settled) return; settled = true; fn(); };

  const capture = (url) => {
    if (!url || url.indexOf(TIEDDR_REDIRECT_URI) !== 0) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    const code = u.searchParams.get('code');
    const returnedState = u.searchParams.get('state');
    const err = u.searchParams.get('error');
    if (err) {
      finish(() => { if (authWin && !authWin.isDestroyed()) authWin.destroy(); resolve(accountStore.get('account')); });
      return true;
    }
    if (!code || returnedState !== state) return false;

    finish(() => {
      exchangeTieddrCode(code, verifier)
        .then((account) => {
          accountStore.set('account', account);
          send('account-changed', account);
          resolve(account);
          void syncTieddrAll();
          startAutoSync();
        })
        .catch((err) => {
          console.error('[Flow] Sign-in exchange failed:', err?.message || err);
          // Even on failure, notify the renderer so the UI can show the
          // signed-out state rather than hanging on a stale account.
          const current = accountStore.get('account');
          send('account-changed', current);
          resolve(current);
        })
        .finally(() => { if (authWin && !authWin.isDestroyed()) authWin.destroy(); });
    });
    return true;
  };
  authWin.webContents.on('will-redirect', (e, url) => { if (capture(url)) e.preventDefault(); });
  authWin.webContents.on('will-navigate', (e, url) => { if (capture(url)) e.preventDefault(); });
  authWin.on('closed', () => { authWin = null; finish(() => resolve(accountStore.get('account'))); });
}));

ipcMain.handle('tieddr-sign-out', () => {
  accountStore.set('account', null);
  stopAutoSync();
  // Drop synced bookmarks/notes on sign-out — they aren't "yours" to keep
  // showing once logged out of the account they came from. Local-only
  // bookmarks (never touched Tieddr) are untouched; notes are Tieddr-only so
  // the list just empties.
  const localOnly = (bookmarksStore.get('bookmarks') || []).filter((b) => b.source !== 'tieddr');
  bookmarksStore.set('bookmarks', localOnly);
  clearSyncedNotes();
  send('account-changed', null);
  send('bookmarks-changed', localOnly);
  return null;
});

// --- Tieddr Space bookmark sync (one-way: Space -> Flow Browser) ---------
// Merges into the SAME local bookmarksStore the rest of the app already
// reads/writes, so BookmarksPage/folder pills need no changes: each synced
// bookmark gets folder set to the Tieddr folder's NAME (Flow Browser's local
// folder model is a flat array of name strings, unlike Tieddr Space's
// id-based folders — if two Tieddr folders ever share a name they'll
// collapse into one bucket locally; an acceptable simplification for now).
function mergeTieddrBookmarks(remoteBookmarks, remoteFolders) {
  const folderNameById = new Map(remoteFolders.map((f) => [f.id, f.name]));

  const synced = remoteBookmarks.map((b) => ({
    url: b.url,
    title: b.title || b.url,
    favicon: b.faviconUrl || '',
    folder: b.folderId ? (folderNameById.get(b.folderId) || '') : '',
    date: new Date().toISOString(),
    source: 'tieddr',
    tieddrId: b.id
  }));
  const syncedUrls = new Set(synced.map((b) => b.url));
  // If the same URL exists both as a local-only save and a Tieddr sync, keep
  // only the synced copy — the row is keyed by url in the renderer, so a
  // duplicate would be both a visual dupe and a React key collision.
  const localOnly = (bookmarksStore.get('bookmarks') || []).filter(
    (b) => b.source !== 'tieddr' && !syncedUrls.has(b.url)
  );
  const nextBookmarks = [...synced, ...localOnly];
  bookmarksStore.set('bookmarks', nextBookmarks);

  const localFolderNames = (bookmarksStore.get('folders') || []).filter(Boolean);
  const remoteFolderNames = remoteFolders.map((f) => f.name).filter(Boolean);
  bookmarksStore.set('folders', Array.from(new Set([...remoteFolderNames, ...localFolderNames])));

  return nextBookmarks;
}

async function syncTieddrBookmarks() {
  let account = accountStore.get('account');
  if (!account || !account.token) return { ok: false, reason: 'signed-out' };
  try {
    let res = await fetch(`${TIEDDR_SPACE_BASE}/api/sync/bookmarks`, {
      headers: { Authorization: `Bearer ${account.token}` }
    });
    // If the token is expired, try refreshing before giving up
    if (res.status === 401 && account.refreshToken) {
      const refreshed = await refreshTieddrToken(account);
      if (refreshed) {
        account = refreshed;
        res = await fetch(`${TIEDDR_SPACE_BASE}/api/sync/bookmarks`, {
          headers: { Authorization: `Bearer ${account.token}` }
        });
      }
    }
    if (res.status === 401) {
      // Token expired/invalid and refresh failed — sign out
      accountStore.set('account', null);
      stopAutoSync();
      const localOnly = (bookmarksStore.get('bookmarks') || []).filter((b) => b.source !== 'tieddr');
      bookmarksStore.set('bookmarks', localOnly);
      clearSyncedNotes();
      send('account-changed', null);
      send('bookmarks-changed', localOnly);
      return { ok: false, reason: 'expired' };
    }
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = await res.json();
    const merged = mergeTieddrBookmarks(data.bookmarks || [], data.folders || []);
    send('bookmarks-changed', merged);
    send('bookmark-folders-changed', bookmarksStore.get('folders') || []);
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'network' };
  }
}

// --- Tieddr Space note sync (one-way: Space -> Flow Browser) -------------
// Same shape/rationale as the bookmark sync above: notes get their own
// profile-scoped store (note_folders is a separate Tieddr Space collection
// from bookmark folders, so this stays a separate flat folder-name array
// too) and read-only merge semantics — content comes back as plain text
// (see /api/sync/notes's TipTap-JSON extraction), so there's no rich-text
// rendering or dangerouslySetInnerHTML surface here.
function mergeTieddrNotes(remoteNotes, remoteFolders) {
  const folderNameById = new Map(remoteFolders.map((f) => [f.id, f.name]));

  const synced = remoteNotes.map((n) => ({
    title: n.title || 'Untitled',
    text: n.text || '',
    folder: n.folderId ? (folderNameById.get(n.folderId) || '') : '',
    updatedAt: n.updatedAt || new Date().toISOString(),
    tieddrId: n.id
  }));

  notesStore.set('notes', synced);
  const remoteFolderNames = remoteFolders.map((f) => f.name).filter(Boolean);
  notesStore.set('folders', remoteFolderNames);

  return synced;
}

async function syncTieddrNotes() {
  let account = accountStore.get('account');
  if (!account || !account.token) return { ok: false, reason: 'signed-out' };
  try {
    let res = await fetch(`${TIEDDR_SPACE_BASE}/api/sync/notes`, {
      headers: { Authorization: `Bearer ${account.token}` }
    });
    // Try token refresh on 401
    if (res.status === 401 && account.refreshToken) {
      const refreshed = await refreshTieddrToken(account);
      if (refreshed) {
        account = refreshed;
        res = await fetch(`${TIEDDR_SPACE_BASE}/api/sync/notes`, {
          headers: { Authorization: `Bearer ${account.token}` }
        });
      }
    }
    if (res.status === 401) return { ok: false, reason: 'expired' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = await res.json();
    const merged = mergeTieddrNotes(data.notes || [], data.folders || []);
    send('notes-changed', merged);
    send('note-folders-changed', notesStore.get('folders') || []);
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'network' };
  }
}

function clearSyncedNotes() {
  notesStore.set('notes', []);
  notesStore.set('folders', []);
  send('notes-changed', []);
  send('note-folders-changed', []);
}

// Runs both syncs together — the one function every trigger point (sign-in,
// startup, the periodic interval) calls, so bookmarks and notes never drift
// out of sync with each other.
async function syncTieddrAll() {
  const [bookmarks, notes] = await Promise.all([syncTieddrBookmarks(), syncTieddrNotes()]);
  return { bookmarks, notes };
}

let syncIntervalHandle = null;
function startAutoSync() {
  if (syncIntervalHandle) return;
  syncIntervalHandle = setInterval(() => { void syncTieddrAll(); }, SYNC_INTERVAL_MS);
}
function stopAutoSync() {
  if (syncIntervalHandle) { clearInterval(syncIntervalHandle); syncIntervalHandle = null; }
}

ipcMain.handle('sync-tieddr-bookmarks', () => syncTieddrAll());
ipcMain.handle('get-notes', () => notesStore.get('notes') || []);
ipcMain.handle('get-note-folders', () => notesStore.get('folders') || []);

ipcMain.handle('clear-browsing-data', async () => {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'serviceworkers', 'websql'] });
  } catch (_) {}
  historyStore.set('history', []);
  return true;
});

ipcMain.handle('set-default-browser', () => {
  try {
    const okHttp = app.setAsDefaultProtocolClient('http');
    const okHttps = app.setAsDefaultProtocolClient('https');
    return okHttp || okHttps;
  } catch { return false; }
});

ipcMain.handle('choose-download-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose download folder', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return settingsStore.get('downloadPath') || '';
  settingsStore.set('downloadPath', result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('reset-settings', () => {
  Object.entries(SETTINGS_DEFAULTS).forEach(([k, v]) => settingsStore.set(k, v));
  trackerBlockingEnabled = true;
  adBlockerEnabled = true;
  return settingsStore.data;
});

ipcMain.on('window-control', (event, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === 'close') mainWindow.close();
});

ipcMain.handle('get-settings', () => settingsStore.data);

ipcMain.handle('update-settings', (event, patch) => {
  Object.entries(patch || {}).forEach(([key, value]) => settingsStore.set(key, value));
  trackerBlockingEnabled = settingsStore.get('blockTrackers') !== false;
  adBlockerEnabled = settingsStore.get('adBlocker') !== false;
  return settingsStore.data;
});

ipcMain.handle('install-flowr-theme', async (_event, manifestUrl) => {
  try {
    const parsed = new URL(manifestUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'flowr.tieddr.com') throw new Error('Only verified Flowr Store packages can be installed.');
    const response = await fetch(parsed.href);
    if (!response.ok) throw new Error('Theme package could not be downloaded.');
    const manifest = await response.json();
    if (manifest.flowrThemeVersion !== 1 || !manifest.id || !manifest.name || !Array.isArray(manifest.images) || !manifest.images.length) throw new Error('Theme package is invalid.');
    const themeDir = path.join(app.getPath('userData'), 'themes', manifest.id.replace(/[^a-z0-9._-]/gi, '-'));
    fs.mkdirSync(themeDir, { recursive: true });
    const savedImages = [];
    for (let i = 0; i < manifest.images.length; i++) {
      const imageUrl = new URL(manifest.images[i], parsed.href);
      if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'flowr.tieddr.com') throw new Error('Theme contains an untrusted asset.');
      const imageResponse = await fetch(imageUrl.href);
      if (!imageResponse.ok) throw new Error('A theme image could not be downloaded.');
      const ext = path.extname(imageUrl.pathname) || '.png';
      const destination = path.join(themeDir, `background-${i + 1}${ext}`);
      fs.writeFileSync(destination, Buffer.from(await imageResponse.arrayBuffer()));
      savedImages.push(destination);
    }
    const localImageUrls = savedImages.map(file => pathToFileURL(file).href);
    fs.writeFileSync(path.join(themeDir, 'manifest.json'), JSON.stringify({ ...manifest, installedAt: new Date().toISOString(), localImages: localImageUrls }, null, 2));
    const installed = settingsStore.get('installedThemes') || [];
    settingsStore.set('installedThemes', [{ id: manifest.id, name: manifest.name, version: manifest.version || '1.0.0', path: themeDir, images: localImageUrls }, ...installed.filter(t => t.id !== manifest.id)]);
    const themeSettings = manifest.settings || {};
    const allowed = ['theme', 'accentColor', 'blurIntensity', 'glassToolbar', 'glassCards', 'glassSidebar', 'tabWidth', 'tabFontSize'];
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(themeSettings, key)) settingsStore.set(key, themeSettings[key]);
    settingsStore.set('customBackgroundUrl', localImageUrls[0]);
    return { ok: true, name: manifest.name, settings: settingsStore.data };
  } catch (error) {
    return { ok: false, error: error.message || 'Theme installation failed.' };
  }
});

ipcMain.handle('install-flowr-extension', async (_event, packageUrl) => {
  try {
    const parsed = new URL(packageUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'flowr.tieddr.com') throw new Error('Only verified Flowr Store packages can be installed.');
    const response = await fetch(parsed.href);
    if (!response.ok) throw new Error('Extension package could not be downloaded.');
    const pkg = await response.json();
    if (pkg.flowrExtensionVersion !== 1 || !pkg.id || !pkg.name || !Array.isArray(pkg.files) || !pkg.files.length) throw new Error('Extension package is invalid.');
    const extensionDir = path.join(app.getPath('userData'), 'flowr-extensions', pkg.id.replace(/[^a-z0-9._-]/gi, '-'));
    fs.mkdirSync(extensionDir, { recursive: true });
    for (const entry of pkg.files) {
      const relative = String(entry.path || '').replace(/\\/g, '/');
      if (!relative || relative.startsWith('/') || relative.includes('..')) throw new Error('Extension contains an unsafe file path.');
      const assetUrl = new URL(entry.url, parsed.href);
      if (assetUrl.protocol !== 'https:' || assetUrl.hostname !== 'flowr.tieddr.com') throw new Error('Extension contains an untrusted asset.');
      const assetResponse = await fetch(assetUrl.href);
      if (!assetResponse.ok) throw new Error(`Could not download ${relative}.`);
      const destination = path.join(extensionDir, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, Buffer.from(await assetResponse.arrayBuffer()));
    }
    if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('Extension manifest is missing.');
    const loadedExtension = await session.defaultSession.loadExtension(extensionDir, { allowFileAccess: true });
    const extensions = extensionsStore.get('extensions') || [];
    const record = { id: loadedExtension.id, packageId: pkg.id, name: loadedExtension.name || pkg.name, version: loadedExtension.version || pkg.version || '1.0.0', path: extensionDir, source: 'flowr-store', enabled: true, error: null, date: new Date().toISOString() };
    const next = [record, ...extensions.filter(item => item.id !== record.id && item.packageId !== pkg.id)];
    extensionsStore.set('extensions', next);
    return { ok: true, name: record.name, extensions: next };
  } catch (error) {
    return { ok: false, error: error.message || 'Extension installation failed.' };
  }
});

ipcMain.handle('get-bookmarks', () => bookmarksStore.get('bookmarks') || []);

ipcMain.handle('add-bookmark', (event, bookmark) => {
  const bookmarks = bookmarksStore.get('bookmarks') || [];
  const next = [{ ...bookmark, date: new Date().toISOString() }, ...bookmarks.filter((item) => item.url !== bookmark.url)];
  bookmarksStore.set('bookmarks', next);
  return next;
});

ipcMain.handle('remove-bookmark', (event, url) => {
  const next = (bookmarksStore.get('bookmarks') || []).filter((item) => item.url !== url);
  bookmarksStore.set('bookmarks', next);
  return next;
});

ipcMain.handle('get-bookmark-folders', () => bookmarksStore.get('folders') || []);

ipcMain.handle('create-bookmark-folder', (event, name) => {
  const n = (name || '').trim();
  const folders = bookmarksStore.get('folders') || [];
  if (n && !folders.includes(n)) folders.push(n);
  bookmarksStore.set('folders', folders);
  return folders;
});

ipcMain.handle('move-bookmark', (event, url, folder) => {
  const next = (bookmarksStore.get('bookmarks') || []).map((b) => b.url === url ? { ...b, folder: folder || '' } : b);
  bookmarksStore.set('bookmarks', next);
  return next;
});

ipcMain.handle('get-history', () => historyStore.get('history') || []);

ipcMain.handle('clear-history', () => {
  historyStore.set('history', []);
  send('history-changed', []);
  return [];
});

ipcMain.handle('get-downloads', () => downloadsStore.get('downloads') || []);

ipcMain.handle('clear-downloads', () => {
  downloadsStore.set('downloads', []);
  return [];
});

ipcMain.handle('pause-download', (event, id) => {
  const item = downloadItems.get(id);
  if (item) item.pause();
});

ipcMain.handle('resume-download', (event, id) => {
  const item = downloadItems.get(id);
  if (item && item.canResume()) item.resume();
});

ipcMain.handle('cancel-download', (event, id) => {
  const item = downloadItems.get(id);
  if (item) item.cancel();
});

ipcMain.handle('show-in-folder', (event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

ipcMain.handle('get-profiles', () => profilesStore.get('profiles') || []);

ipcMain.handle('get-active-profile', () => currentProfileId);

ipcMain.handle('create-profile', (event, name) => {
  const profiles = profilesStore.get('profiles') || [];
  const newProfile = { id: Date.now().toString(), name: name || 'Profile' };
  const next = [...profiles, newProfile];
  profilesStore.set('profiles', next);
  return next;
});

ipcMain.handle('switch-profile', (event, profileId) => {
  const profiles = profilesStore.get('profiles') || [];
  if (!profiles.find((profile) => profile.id === profileId)) return false;
  currentProfileId = profileId;
  profilesStore.set('activeProfileId', profileId);
  initStores(profileId);
  send('profile-changed', profileId);
  // After switching profiles, re-send the current account info and bookmarks
  // to the renderer so the UI stays in sync. Trigger a background sync if
  // the user is signed in so the new profile gets fresh Tieddr Space data.
  const account = accountStore.get('account');
  send('account-changed', account);
  send('bookmarks-changed', bookmarksStore.get('bookmarks') || []);
  send('bookmark-folders-changed', bookmarksStore.get('folders') || []);
  send('notes-changed', notesStore.get('notes') || []);
  send('note-folders-changed', notesStore.get('folders') || []);
  if (account && account.token) {
    void syncTieddrAll();
  }
  return true;
});

ipcMain.handle('get-extensions', () => extensionsStore.get('extensions') || []);

ipcMain.handle('install-unpacked-extension', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose unpacked Chrome extension folder',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths[0]) return extensionsStore.get('extensions') || [];

  const folderPath = result.filePaths[0];
  const loadedExtension = await session.defaultSession.loadExtension(folderPath, { allowFileAccess: true });
  const extensions = extensionsStore.get('extensions') || [];
  const record = {
    id: loadedExtension.id,
    name: loadedExtension.name || path.basename(folderPath),
    version: loadedExtension.version || '',
    path: folderPath,
    enabled: true,
    error: null,
    date: new Date().toISOString()
  };
  const next = [record, ...extensions.filter((item) => item.id !== record.id && item.path !== folderPath)];
  extensionsStore.set('extensions', next);
  return next;
});

// Chrome Web Store install: given a store URL or bare ID, download the CRX,
// unpack it, load it, and persist a record — no manual folder picking.
ipcMain.handle('install-store-extension', async (event, idOrUrl) => {
  const storeId = parseExtensionId(idOrUrl);
  if (!storeId) {
    return { ok: false, error: "That doesn't look like a Chrome Web Store link or extension ID." };
  }

  try {
    const info = await installStoreExtension(idOrUrl, session.defaultSession, app.getPath('userData'));
    const extensions = extensionsStore.get('extensions') || [];
    const record = {
      id: info.id,
      name: info.name,
      version: info.version,
      path: info.dir,
      storeId: info.storeId,
      source: 'store',
      enabled: true,
      error: null,
      date: new Date().toISOString()
    };
    const next = [record, ...extensions.filter((item) => item.id !== record.id && item.path !== info.dir)];
    extensionsStore.set('extensions', next);
    return { ok: true, name: info.name, extensions: next };
  } catch (error) {
    return { ok: false, error: error.message || 'The extension could not be installed.' };
  }
});

ipcMain.handle('remove-extension', async (event, extensionId) => {
  try {
    session.defaultSession.removeExtension(extensionId);
  } catch (_) {}
  const next = (extensionsStore.get('extensions') || []).filter((item) => item.id !== extensionId);
  extensionsStore.set('extensions', next);
  return next;
});

// --- Extension toolbar actions (icons, pin, popup) -----------------------
let extPopupWin = null;

function pickIcon(map) {
  if (!map) return null;
  if (typeof map === 'string') return map;
  // Try to find the largest icon >= 32px, fallback to largest available
  const sizes = Object.keys(map).sort((a, b) => Number(b) - Number(a));
  return map[sizes.find(s => Number(s) >= 32)] || map[sizes[0]];
}

function extIconDataUrl(extPath, iconPath) {
  try {
    const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
    const full = path.join(extPath.replace(/^file:\/\//, ''), iconPath);
    const buf = fs.readFileSync(full);
    const ext = path.extname(iconPath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

function extActions() {
  const stored = extensionsStore.get('extensions') || [];
  const pinned = {}; stored.forEach(e => { pinned[e.id] = !!e.pinned; });
  const loaded = browsingSession ? browsingSession.getAllExtensions() : [];
  return loaded.map(ext => {
    const m = ext.manifest || {};
    const action = m.action || m.browser_action || {};
    const iconPath = pickIcon(action.default_icon) || pickIcon(m.icons);
    const dataUrl = iconPath ? extIconDataUrl(ext.path, iconPath) : null;
    const rel = p => p ? ext.url + String(p).replace(/^\/+/, '') : null;
    const opt = (m.options_ui && m.options_ui.page) || m.options_page;
    // Side panel support — Chrome extensions declare side_panel in manifest v3
    const sidePanel = m.side_panel && m.side_panel.default_path
      ? rel(m.side_panel.default_path)
      : (m.side_panel && typeof m.side_panel === 'string' ? rel(m.side_panel) : null);
    return {
      id: ext.id, name: ext.name, version: ext.version || (m.version || ''),
      iconUrl: dataUrl || rel(iconPath), popup: rel(action.default_popup),
      options: rel(opt), sidePanel, pinned: !!pinned[ext.id]
    };
  });
}

ipcMain.on('open-extension-options', (event, url) => { if (url) send('request-new-tab', url); });

ipcMain.handle('get-extension-actions', () => extActions());

ipcMain.handle('pin-extension', (event, id, pinned) => {
  const stored = extensionsStore.get('extensions') || [];
  const target = stored.find(e => e.id === id);
  if (target) target.pinned = !!pinned;
  else stored.push({ id, pinned: !!pinned });
  extensionsStore.set('extensions', stored);
  return extActions();
});

// Open an extension's popup in an auto-sized frameless window below its button.
ipcMain.on('open-extension-popup', (event, { popup, x, y } = {}) => {
  if (!popup || !mainWindow) return;
  if (extPopupWin && !extPopupWin.isDestroyed()) extPopupWin.destroy();
  extPopupWin = new BrowserWindow({
    parent: mainWindow, frame: false, resizable: false, skipTaskbar: true, show: false,
    width: 360, height: 480, backgroundColor: '#ffffff',
    webPreferences: { session: browsingSession, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  extPopupWin.setMenu(null);
  const b = mainWindow.getBounds();
  extPopupWin.setPosition(Math.round(b.x + Math.min(Math.max(8, (x || 0) - 180), b.width - 368)), Math.round(b.y + (y || 92) + 4));
  extPopupWin.loadURL(popup).catch(() => {});
  extPopupWin.webContents.on('did-finish-load', async () => {
    try {
      const w = await extPopupWin.webContents.executeJavaScript('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth||0)');
      const h = await extPopupWin.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight||0)');
      extPopupWin.setContentSize(Math.min(760, Math.max(240, Math.ceil(w) || 360)), Math.min(600, Math.max(80, Math.ceil(h) || 400)));
    } catch (_) {}
    extPopupWin.show();
  });
  extPopupWin.on('blur', () => { if (extPopupWin && !extPopupWin.isDestroyed()) extPopupWin.destroy(); });
});

ipcMain.handle('toggle-extension', async (event, extensionId, enabled) => {
  const extensions = extensionsStore.get('extensions') || [];
  const target = extensions.find((item) => item.id === extensionId);
  if (!target) return extensions;

  try {
    if (enabled) {
      const loadedExtension = await session.defaultSession.loadExtension(target.path, { allowFileAccess: true });
      target.id = loadedExtension.id;
      target.name = loadedExtension.name || target.name;
      target.version = loadedExtension.version || target.version;
      target.error = null;
    } else {
      session.defaultSession.removeExtension(extensionId);
    }
    target.enabled = enabled;
  } catch (error) {
    target.enabled = false;
    target.error = error.message;
  }

  extensionsStore.set('extensions', extensions);
  return extensions;
});

// --- Side Panel Extension Support ---------------------------------------------
// The side panel is rendered by the renderer as a docked <webview> (see App.js),
// so the main process only needs to forward open/close intents. The renderer
// owns the webview element and its geometry relative to the page area.
ipcMain.on('open-extension-side-panel', (event, { extId, url, width } = {}) => {
  if (!url) return;
  send('side-panel-opened', { extId, url, width: width || 400 });
});

ipcMain.on('close-side-panel', () => {
  send('side-panel-closed');
});
