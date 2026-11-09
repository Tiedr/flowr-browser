// Suppress EPIPE crash on closed stdout/stderr — must be first, before any requires.
// A logging call must never throw: rethrowing from here turns one bad log into a
// second uncaught exception. Non-EPIPE failures fall back to a direct stderr write.
const _origWarn = console.warn;
const _origError = console.error;
const _safeLog = (fn) => (...args) => {
  try { fn(...args); } catch (e) {
    if (e?.code === 'EPIPE') return;
    try { process.stderr.write(`${args.map(String).join(' ')}\n`); } catch (_) {}
  }
};
console.warn = _safeLog(_origWarn);
console.error = _safeLog(_origError);
// Swallow-and-log rather than rethrow: a single malformed IPC payload or a
// destroyed-window race should never end the user's session.
process.on('uncaughtException', (err) => { if (err?.code !== 'EPIPE') _origError('Uncaught exception:', err); });
process.on('unhandledRejection', (reason) => { _origError('Unhandled rejection:', reason); });

const { app, BrowserWindow, ipcMain, shell, session, dialog, clipboard, safeStorage, webContents, Tray, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('./store');
const { parseExtensionId, installStoreExtension } = require('./crx');
const { shouldBlockRequest, isDangerousUrl } = require('./adblock');
const { createUpdateController } = require('./updater');
const { parseSiteRules, matchesSiteRule, filterHistory } = require('./privacy');
const { parsePasswordCsv, parseBookmarkHtml, parseChromiumBookmarks } = require('./importer');
const { resolvePackageDir, resolveInside, isInside, safeRelativePath, isValidPackageId } = require('./paths');
const { normalizeSiteApp, isUrlInSiteAppScope } = require('./site-apps');
const { requiresCompatibleBrowserIdentity, chromiumUserAgent, browserPlatform } = require('./browser-identity');
// Tieddr Vault — password manager + Tieddr Wallet, synced to the encrypted mirror.
const vault = require('./vault');
const vaultAccount = require('./vault/account');
const { APPWRITE } = require('./vault/config');

// --- Tieddr Account SSO + bookmark sync ------------------------------------
const TIEDDR_ACCOUNT_BASE = 'https://account.tieddr.com';
const TIEDDR_API_BASE = 'https://api.account.tieddr.com';
const TIEDDR_SPACE_BASE = 'https://space.tieddr.com';
const APP_ICON_PATH = path.join(__dirname, '../../build/icons/flowr-transparent.png');
// OAuth client registered on account.tieddr.com/apps for "Flow" — trusted
// first-party app, redirect_uri below matches EXACTLY what's registered.
const TIEDDR_CLIENT_ID = 'client_ohHEAmTYYKNYVdE6';
const TIEDDR_REDIRECT_URI = `${TIEDDR_ACCOUNT_BASE}/oauth/flow-browser/callback`;
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Product renames must never create a fresh profile. Pin Flowr to one durable
// directory and recover account state from known legacy directory names.
const stableUserData = path.join(app.getPath('appData'), 'Flowr');
const legacyUserData = ['Flow Browser', 'flow-browser'].map(name => path.join(app.getPath('appData'), name));
if (!fs.existsSync(stableUserData)) fs.mkdirSync(stableUserData, { recursive: true });
for (const legacyPath of legacyUserData) {
  const legacyAccount = path.join(legacyPath, 'account.json');
  const stableAccount = path.join(stableUserData, 'account.json');
  if (!fs.existsSync(stableAccount) && fs.existsSync(legacyAccount)) {
    try { fs.copyFileSync(legacyAccount, stableAccount); } catch (_) {}
  }
}
app.setPath('userData', stableUserData);

// Every Flowr window/instance shares this one directory of JSON stores. Two
// ordinary launches (double-clicking the exe twice, or the OS handing us an
// http/https URL) would race on settings, history, bookmarks and passwords and
// silently lose writes. Claim a single-instance lock so the second launch
// forwards its intent to the running browser and exits.
//
// Windows we *intend* to run as separate processes — new window, incognito,
// torn-out tab — set FLOW_CHILD=1 and are exempt, because they deliberately
// want their own process. Their writes stay safe via the merge-on-flush
// locking in store.js.
const IS_CHILD_INSTANCE = process.env.FLOW_CHILD === '1';
const OWNS_SINGLE_INSTANCE = IS_CHILD_INSTANCE || app.requestSingleInstanceLock();
if (!OWNS_SINGLE_INSTANCE) {
  // Another Flowr already owns this userData directory. Hand our argv over and
  // exit before any window or store is created.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Re-raise the existing window instead of starting a rival process.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    // An OS-level http/https handoff arrives as a raw URL argument.
    const url = argv.find(arg => /^https?:\/\//i.test(arg || ''));
    if (url && mainWindow && !mainWindow.isDestroyed()) send('open-url-in-new-tab', { url, background: false });
  });
}

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
  adBlocker: true,
  adaptiveAdBlocker: true,
  blockTrackers: true,
  httpsOnly: false,
  doNotTrack: false,
  fingerprintProtection: false,
  reducedReferrer: false,
  defaultZoom: 1,
  startup: 'start',
  restoreSession: true,
  newTab: 'start',
  newTabBehavior: 'start',
  newWindowBehavior: 'start',
  showTabBar: true,
  tabGrouping: true,
  middleClickClose: true,
  showTabClose: true,
  lazyTabs: false,
  tabSearch: true,
  tabWidth: 'normal',
  tabFontSize: 'medium',
  uiFont: 'system',
  highContrast: false,
  blurIntensity: 'medium',
  glassToolbar: true,
  glassCards: true,
  glassSidebar: true,
  searchSuggestions: true,
  historySuggestions: true,
  bookmarkSuggestions: true,
  aiTabGroups: false,
  smartCopy: false,
  downloadPath: '',
  askWhereToSave: false,
  savePasswords: true,
  autofill: true,
  memorySaver: true,
  inactiveTabTimeout: 5,
  renderProcessLimit: 3,
  lowEndMode: false,
  privateHistory: true,
  historyLock: false,
  browserLock: false,
  historyRetention: 'forever',
  autoClearSites: '',
  clearPrivateDataOnExit: false,
  blockUnpromptedPasskeys: true,
  askBeforeIdentityRedirect: true,
  hardwareAcceleration: true,
  aiSuggestions: true,
  reduceMotion: false,
  uiScale: 1,
  language: 'en',
  accentColor: '',
  startBackground: 'gradient-midnight',
  // Vault security
  vaultAutoLock: 5,
  lockOnIdle: true,
  lockOnMinimize: true,
  lockOnClose: true,
  clipboardClear: 30,
  biometricAuth: false,
  // Safe Browsing (local protection levels)
  safeBrowsing: 'standard',
  safeBrowsingData: true,
  // Performance
  gpuRasterization: false,
  acceleratedCanvas: false,
  smoothScroll: true,
  preloadPages: true,
  spellCheck: true,
  // Developer
  devTools: true,
  alwaysShowConsole: false,
  heapStats: false,
  consoleLogging: false,
  sourceMaps: true,
  remoteDebugging: false,
  debugPort: '9222',
  overrideUserAgent: false,
  customUserAgent: '',
  emulateMediaType: false,
  networkThrottling: false,
  requestBlocking: false,
  requestBlockPatterns: '',
  // System / updates
  updateChannel: 'stable',
  background: false,
  sendStats: false,
  onboardingCompleted: false,
  lastSeenVersion: '',
  tieddrNewsEndpoint: 'https://news.tieddr.com/api/feed',
  siteApps: []
};
const settingsStore = new Store('settings', SETTINGS_DEFAULTS);
const adBlockRulesStore = new Store('adblock-rules', { sites: {} });
const adBlockSessionTotals = new Map();
const sitePermissionsStore = new Store('site-permissions', { sites: {} });
// Existing installations inherited Memory Saver's old no-op/disabled default.
// Apply the efficient profile once, while leaving subsequent user choices
// untouched across upgrades.
if (settingsStore.get('performanceProfileVersion') !== 2) {
  settingsStore.set('memorySaver', true);
  settingsStore.set('inactiveTabTimeout', 5);
  settingsStore.set('renderProcessLimit', 3);
  settingsStore.set('performanceProfileVersion', 2);
}
if (settingsStore.get('hardwareAcceleration') === false) app.disableHardwareAcceleration();

// Keep Chromium from creating an unbounded renderer pool on machines with
// many tabs. This is a soft upper bound (GPU/network/extension utility
// processes are separate) and must be configured before app.ready.
const configuredRendererLimit = Number(settingsStore.get('renderProcessLimit'));
const rendererProcessLimit = Number.isFinite(configuredRendererLimit)
  ? Math.min(8, Math.max(2, Math.round(configuredRendererLimit)))
  : SETTINGS_DEFAULTS.renderProcessLimit;
app.commandLine.appendSwitch('renderer-process-limit', String(rendererProcessLimit));
if ((settingsStore.get('dnsOverHttps') || 'off') !== 'off') {
  app.commandLine.appendSwitch('dns-over-https-mode', settingsStore.get('dnsOverHttps') === 'strict' ? 'secure' : 'automatic');
  app.commandLine.appendSwitch('dns-over-https-templates', 'https://cloudflare-dns.com/dns-query{?dns}');
}
// Rendering toggles that require Chromium flags — must be registered before
// app.ready. GPU rasterization and accelerated canvas are opt-in; smooth
// scrolling is on by default and disabled explicitly when turned off.
if (settingsStore.get('gpuRasterization')) app.commandLine.appendSwitch('enable-gpu-rasterization');
if (settingsStore.get('acceleratedCanvas')) app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
if (settingsStore.get('smoothScroll') === false) app.commandLine.appendSwitch('disable-smooth-scrolling');
if (settingsStore.get('remoteDebugging') === true) {
  const debugPort = Number(settingsStore.get('debugPort')) || 9222;
  if (!app.commandLine.hasSwitch('remote-debugging-port')) {
    app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
  }
}
const downloadsStore = new Store('downloads', { downloads: [] });
const extensionsStore = new Store('extensions', { extensions: [] });
const accountStore = new Store('account', { account: null });
const sessionStore = new Store('session', { tabs: [], activeUrl: '' });
const statsStore = new Store('stats', { lastPing: '' });

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
let memoryPressureInterval = null;

const downloadItems = new Map();
const downloadPersistAt = new Map();
let downloadSeq = Date.now() * 1000;

function initStores(profileId) {
  // The profile id reaches the filesystem as a path segment. It is read back
  // from profiles.json at startup, so a tampered file could otherwise point the
  // history/passwords stores anywhere on disk. Validate before joining.
  const safeId = isValidPackageId(profileId) ? String(profileId) : 'default';
  const prefix = `profiles/${safeId}`;
  bookmarksStore = new Store(`${prefix}/bookmarks`, { bookmarks: [] });
  historyStore = new Store(`${prefix}/history`, { history: [] });
  passwordsStore = new Store(`${prefix}/passwords`, { passwords: [] });
  notesStore = new Store(`${prefix}/notes`, { notes: [], folders: [] });
  vault.init(safeId); // Tieddr Vault's per-profile encrypted-mirror cache
}

// --- IPC trust boundary ------------------------------------------------------
// Flowr has two very different callers and they must not share a privilege
// level:
//
//   1. The app chrome (main window) — Flowr's own React UI. Trusted with the
//      full handler set: vault unlock, wallet fill, account tokens, settings.
//   2. A page guest (<webview>) — untrusted remote content running
//      viewpreload.js. Allowed only password autofill, wallet fill, and the
//      bounded ad-rule/report channels; no account, settings or data access.
//
// Without this split, any script executing in a page could invoke get-account
// (raw OAuth tokens) or wallet-fill (full PAN + CVV) because those channels sit
// on the same ipcMain surface as ordinary UI actions. The preload allow-lists
// narrow the *renderer* side but say nothing about a guest reaching
// ipcRenderer directly.
const GUEST_INVOKE_ALLOWED = new Set(['pw-get-for-origin', 'wallet-cards-for-fill', 'wallet-fill', 'adblock-rules']);
const GUEST_ON_ALLOWED = new Set(['pw-captured', 'adblock-report']);
// The page preload reads its privacy switches synchronously on every document.
const GUEST_SYNC_ALLOWED = new Set(['privacy-web-preferences']);

function isAppChromeSender(event) {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed()) return false;
  if (mainWindow && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id) return true;
  // Also accept a same-document frame the chrome embeds, but only when that
  // document is our own bundle.
  let url = '';
  try { url = sender.getURL(); } catch (_) {}
  return isAppChromeUrl(url);
}

function isGuestSender(event) {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed()) return false;
  if (siteAppWebContents.has(sender.id)) return true;
  // A guest must also be one the chrome registered for a real <webview> host.
  if (!guestWebContents.has(sender.id)) return false;
  try { return sender.getType() === 'webview'; } catch (_) { return false; }
}

function ipcCallerAllowed(event, channel, style) {
  if (isAppChromeSender(event)) return true;
  if (!isGuestSender(event)) return false;
  if (style === 'invoke') return GUEST_INVOKE_ALLOWED.has(channel);
  if (style === 'sync') return GUEST_SYNC_ALLOWED.has(channel);
  return GUEST_ON_ALLOWED.has(channel);
}

// Wrap ipcMain once so every handler registered below inherits the check —
// including any added later. sendSync is wrapped too: it sets event.returnValue
// synchronously and would otherwise be the one registration style that skipped
// the boundary entirely.
const rawIpcHandle = ipcMain.handle.bind(ipcMain);
const rawIpcOn = ipcMain.on.bind(ipcMain);
const rawIpcOnSync = ipcMain.on.bind(ipcMain);
ipcMain.handle = (channel, listener) => rawIpcHandle(channel, (event, ...args) => {
  if (!ipcCallerAllowed(event, channel, 'invoke')) throw new Error('Blocked IPC invoke from untrusted sender.');
  return listener(event, ...args);
});
ipcMain.on = (channel, listener) => rawIpcOn(channel, (event, ...args) => {
  if (!ipcCallerAllowed(event, channel, 'on')) return;
  return listener(event, ...args);
});
ipcMain.onSync = (channel, listener) => rawIpcOnSync(channel, (event, ...args) => {
  if (!ipcCallerAllowed(event, channel, 'sync')) { event.returnValue = null; return; }
  return listener(event, ...args);
});

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

async function migrateLegacyTieddrCookies(targetSession) {
  if (!targetSession || targetSession === session.defaultSession || !accountStore.get('account')) return;
  try {
    const [legacy, current] = await Promise.all([
      session.defaultSession.cookies.get({}),
      targetSession.cookies.get({})
    ]);
    const keyOf = cookie => `${String(cookie.domain || '').replace(/^\./, '')}|${cookie.path || '/'}|${cookie.name}`;
    const existing = new Set(current.filter(cookie => /(^|\.)tieddr\.com$/i.test(cookie.domain || '')).map(keyOf));
    const tieddrCookies = legacy.filter(cookie => /(^|\.)tieddr\.com$/i.test(cookie.domain || '') && !existing.has(keyOf(cookie)));
    await Promise.all(tieddrCookies.map(cookie => {
      const hostname = String(cookie.domain || '').replace(/^\./, '');
      const details = {
        url: `${cookie.secure ? 'https' : 'http'}://${hostname}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly
      };
      if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
      if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
      return targetSession.cookies.set(details);
    }));
  } catch (error) {
    console.warn('[Flowr] Could not migrate the legacy Tieddr web session:', error?.message || error);
  }
}

function safeBrowsingLevel() {
  const value = settingsStore.get('safeBrowsing');
  return value === 'enhanced' || value === 'off' ? value : 'standard';
}

// Resolve the user agent presented to sites. Flowr normally spoofs a plain
// Chrome UA because many web apps reject Electron's default; users can fully
// override it from Settings → Developer.
//
// The trailing Flowr product token is deliberate and matches how every other
// branded Chromium ships (Brave, Vivaldi, Opera, Edge). Without it the Flowr
// Store cannot tell it is running inside Flowr, so every theme and extension
// install button dead-ends on "Get Flowr to install" — the deep link that
// actually installs a package was unreachable from the shipped UI.
function currentUserAgent(candidate = '') {
  if (settingsStore.get('overrideUserAgent') === true) {
    const custom = String(settingsStore.get('customUserAgent') || '').trim();
    if (custom) return custom;
  }
  // OAuth providers evaluate the full UA and can reject branded embedded tokens.
  // Keep Flowr's store-visible identity everywhere else, but present the exact
  // Chromium version for the small set of identity providers that need it.
  if (requiresCompatibleBrowserIdentity(candidate)) return chromiumUserAgent();
  const chromeMajor = String(process.versions.chrome || '142.0.0.0').split('.')[0];
  const platformTokens = {
    darwin: { ua: 'Macintosh; Intel Mac OS X 10_15_7', hint: '"macOS"' },
    linux: { ua: 'X11; Linux x86_64', hint: '"Linux"' },
    win32: { ua: 'Windows NT 10.0; Win64; x64', hint: '"Windows"' }
  };
  const platform = platformTokens[process.platform] || platformTokens.linux;
  const version = app.getVersion();
  return `Mozilla/5.0 (${platform.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36 Flowr/${version}`;
}

function applyNavigationIdentity(contents, url) {
  if (!contents || contents.isDestroyed() || typeof contents.setUserAgent !== 'function') return;
  try { contents.setUserAgent(currentUserAgent(url)); } catch (_) {}
}

function configureSession(ses) {
  // Present as the Chromium browser engine we actually embed. Many web apps
  // reject Electron's default UA even though the page APIs are compatible.
  const compatibleUA = currentUserAgent();
  ses.setUserAgent(compatibleUA, 'en-US,en;q=0.9');
  try { ses.setSpellCheckerEnabled(settingsStore.get('spellCheck') !== false); } catch (_) {}
  const chromeMajor = String(process.versions.chrome || '142.0.0.0').split('.')[0];
  const platformTokens = {
    darwin: { hint: '"macOS"' },
    linux: { hint: '"Linux"' },
    win32: { hint: '"Windows"' }
  };
  const platform = platformTokens[process.platform] || platformTokens.linux;
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    details.requestHeaders['User-Agent'] = currentUserAgent(details.url);
    // Avoid Electron-specific client-hint brands triggering unsupported-browser gates.
    details.requestHeaders['sec-ch-ua'] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not_A Brand";v="99"`;
    details.requestHeaders['sec-ch-ua-platform'] = platform.hint;
    details.requestHeaders['sec-ch-ua-mobile'] = '?0';
    if (requiresCompatibleBrowserIdentity(details.url)) {
      details.requestHeaders['sec-ch-ua-full-version-list'] = `"Chromium";v="${process.versions.chrome}", "Google Chrome";v="${process.versions.chrome}", "Not_A Brand";v="99.0.0.0"`;
    }
    if (settingsStore.get('doNotTrack')) details.requestHeaders.DNT = '1';
    if (settingsStore.get('reducedReferrer')) {
      delete details.requestHeaders.Referer;
      delete details.requestHeaders.referer;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  // User-defined request blocking patterns (Settings → Developer), wildcard
  // style. Compiled once per settings value rather than per HTTP request — this
  // runs on every subresource of every page.
  let compiledBlockPatterns = null;
  let compiledBlockSource = null;
  const requestBlockRegexes = () => {
    const source = String(settingsStore.get('requestBlockPatterns') || '');
    if (source === compiledBlockSource && compiledBlockPatterns) return compiledBlockPatterns;
    compiledBlockSource = source;
    compiledBlockPatterns = source
      .split(/[\n,]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .map(pattern => {
        try { return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i'); }
        catch (_) { return null; }
      })
      .filter(Boolean);
    return compiledBlockPatterns;
  };
  // Match all web requests against the compact, testable Flowr filter engine.
  // It blocks known advertising hosts plus third-party tracking endpoints while
  // leaving first-party pages and navigation untouched.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    let target = null;
    try { target = new URL(details.url); } catch (_) {}
    // Source maps off → cancel .map fetches outright so DevTools shows raw code.
    if (settingsStore.get('sourceMaps') === false && target && /\.map$/i.test(target.pathname)) {
      callback({ cancel: true });
      return;
    }
    if (settingsStore.get('requestBlocking') === true && requestBlockRegexes().some(regex => regex.test(details.url))) {
      callback({ cancel: true });
      return;
    }
    if (settingsStore.get('httpsOnly') && details.url.startsWith('http://')) {
      try {
        const parsed = target || new URL(details.url);
        if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
          parsed.protocol = 'https:';
          callback({ redirectURL: parsed.href });
          return;
        }
      } catch (_) {}
    }
    if (details.resourceType === 'mainFrame') {
      const level = safeBrowsingLevel();
      if (level !== 'off' && isDangerousUrl(details.url, level)) {
        send('safebrowsing-blocked', { url: details.url, level });
        callback({ cancel: true });
        return;
      }
    }
    callback({ cancel: shouldBlockRequest(details, adBlockerEnabled, trackerBlockingEnabled) });
  });

  applyPermissionPolicy(ses, { allowBrowsingWebContent: true });
}

// --- Permission policy ------------------------------------------------------
// Electron hands setPermissionRequestHandler the *web* permission vocabulary
// ("clipboard-read", "display-capture", "hid", …), not Chrome's extension
// permission names. Mixing the two silently breaks features: the old list
// allowed "clipboardWrite", which never matches "clipboard-sanitized-write", so
// navigator.clipboard.writeText() was denied on every page in the app.
const WEB_PERMISSIONS_ALLOWED = new Set([
  'clipboard-sanitized-write', // page-initiated writes; reads still require a prompt
  'fullscreen',                // standard browser behaviour, Chromium gates on user activation
  'pointerLock',
  'speaker-selection',
  'mediaKeySystem',
  'idle-detection'
]);

const WEB_PERMISSIONS_PROMPT = new Set([
  'clipboard-read',
  'geolocation',
  'notifications',
  'media',
  'midi',
  'midiSysex',
  'display-capture',
  'window-management',
  'storage-access',
  'top-level-storage-access',
  'keyboardLock'
]);

// Extension API permissions. Chromium scopes these to the extension itself via
// its manifest, so they are not a web-content escape hatch — but ad blockers
// and password managers break outright if Flowr rejects them, so they pass.
const EXTENSION_PERMISSIONS = new Set([
  'storage', 'tabs', 'contextMenus', 'cookies', 'webNavigation', 'webRequest',
  'management', 'alarms', 'bookmarks', 'history', 'downloads', 'topSites',
  'browsingData', 'privacy', 'sessions', 'favicon', 'search', 'sidePanel',
  'activeTab', 'scripting', 'declarativeNetRequest',
  'declarativeNetRequestFeedback', 'declarativeNetRequestWithHostAccess'
]);

function permissionAllowed(permission) {
  return WEB_PERMISSIONS_ALLOWED.has(permission) || EXTENSION_PERMISSIONS.has(permission);
}

function permissionOrigin(value) {
  try {
    const raw = typeof value === 'string' ? value : value?.getURL();
    const parsed = new URL(raw);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : '';
  } catch (_) { return ''; }
}

function sitePermissionDecision(origin, permission) {
  const sites = sitePermissionsStore.get('sites') || {};
  return sites[origin]?.[permission] || '';
}

function listSitePermissions() {
  const sites = sitePermissionsStore.get('sites') || {};
  return Object.entries(sites).flatMap(([origin, permissions]) =>
    Object.entries(permissions || {}).map(([permission, decision]) => ({ origin, permission, decision }))
  ).filter(item => WEB_PERMISSIONS_PROMPT.has(item.permission) && ['allow', 'block'].includes(item.decision))
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.permission.localeCompare(b.permission)).slice(0, 200);
}

function updateSitePermission(originValue, permission, decision) {
  const origin = permissionOrigin(originValue);
  if (!origin || !WEB_PERMISSIONS_PROMPT.has(permission) || !['allow', 'block', 'reset'].includes(decision)) return listSitePermissions();
  const sites = { ...(sitePermissionsStore.get('sites') || {}) };
  const permissions = { ...(sites[origin] || {}) };
  if (decision === 'reset') delete permissions[permission];
  else permissions[permission] = decision;
  delete sites[origin];
  if (Object.keys(permissions).length) sites[origin] = permissions;
  sitePermissionsStore.set('sites', Object.fromEntries(Object.entries(sites).slice(-200)));
  const items = listSitePermissions();
  send('site-permissions-changed', items);
  return items;
}

ipcMain.handle('get-site-permissions', () => listSitePermissions());
ipcMain.handle('set-site-permission', (_event, payload) => updateSitePermission(payload?.origin, payload?.permission, payload?.decision));

function applyPermissionPolicy(ses, { allowBrowsingWebContent = true } = {}) {
  // The app chrome runs in session.defaultSession and can reach privileged IPC.
  // With no handler installed Electron's default is to grant everything, so
  // notifications/camera/hid/usb/serial would be auto-approved inside our own
  // UI. Deny by default and never prompt for chrome content.
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    if (!allowBrowsingWebContent) return callback(false);
    if (permissionAllowed(permission)) return callback(true);
    if (!WEB_PERMISSIONS_PROMPT.has(permission)) return callback(false);
    const origin = permissionOrigin(wc);
    if (!origin || !mainWindow || mainWindow.isDestroyed()) return callback(false);
    const saved = sitePermissionDecision(origin, permission);
    if (saved) return callback(saved === 'allow');
    void dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Site permission',
      message: `${new URL(origin).hostname} wants permission to use ${permission.replace(/-/g, ' ')}.`,
      detail: 'Choose once, or remember an allow/block decision for this site. You can change it later under Apps & Permissions.',
      buttons: ['Block', 'Always block', 'Allow once', 'Always allow'], defaultId: 0, cancelId: 0, noLink: true
    }).then(result => {
      if (result.response === 1 || result.response === 3) updateSitePermission(origin, permission, result.response === 1 ? 'block' : 'allow');
      callback(result.response >= 2);
    }).catch(() => callback(false));
  });
  ses.setPermissionCheckHandler((wc, permission) => {
    if (permissionAllowed(permission)) return true;
    return sitePermissionDecision(permissionOrigin(wc), permission) === 'allow';
  });
  // HID/USB/serial pickers and screen capture default to prompting with no
  // context; deny outright — Flowr has no legitimate use for a web page to
  // enumerate physical devices.
  if (typeof ses.setDevicePermissionHandler === 'function') {
    ses.setDevicePermissionHandler(() => false);
  }
}

// The privileged app chrome gets the deny-everything variant.
function hardenChromeSession(ses) {
  applyPermissionPolicy(ses, { allowBrowsingWebContent: false });
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

const updateController = createUpdateController({
  app,
  autoUpdater,
  dialog,
  send,
  getWindow: () => mainWindow,
  getChannel: () => settingsStore.get('updateChannel') || 'stable'
});

const siteAppWindows = new Map();
const siteAppWebContents = new Set();

function openSiteAppWindow(input) {
  const item = normalizeSiteApp(input);
  if (!item) return { ok: false, error: 'This app needs a valid web address.' };
  const key = item.id || item.url;
  const existing = siteAppWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return { ok: true, focused: true };
  }

  const appWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    show: false,
    title: item.name,
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: browsingSession || session.defaultSession,
      preload: path.join(__dirname, 'viewpreload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });
  const contents = appWindow.webContents;
  contents.__flowrSiteApp = true;
  siteAppWebContents.add(contents.id);
  siteAppWindows.set(key, appWindow);
  appWindow.once('ready-to-show', () => appWindow.show());
  appWindow.once('closed', () => {
    siteAppWindows.delete(key);
    siteAppWebContents.delete(contents.id);
  });
  contents.on('page-title-updated', (_event, title) => {
    if (title) appWindow.setTitle(`${title} — ${item.name}`);
  });
  const keepInScope = (event, url) => {
    if (isUrlInSiteAppScope(url, item)) return;
    event.preventDefault();
    if (isWebNavigationUrl(url)) send('open-url-in-new-tab', { url, background: false });
  };
  contents.on('will-navigate', keepInScope);
  contents.on('will-redirect', keepInScope);
  contents.setWindowOpenHandler(({ url }) => {
    if (isUrlInSiteAppScope(url, item)) void contents.loadURL(url);
    else if (isWebNavigationUrl(url)) send('open-url-in-new-tab', { url, background: false });
    return { action: 'deny' };
  });
  contents.on('before-input-event', (event, inputEvent) => {
    if (inputEvent.type !== 'keyDown') return;
    const key = String(inputEvent.key || '').toLowerCase();
    if ((inputEvent.control || inputEvent.meta) && key === 'w') { event.preventDefault(); appWindow.close(); }
    else if ((inputEvent.control || inputEvent.meta) && key === 'r') { event.preventDefault(); contents.reload(); }
    else if (inputEvent.alt && key === 'arrowleft' && contents.canGoBack()) { event.preventDefault(); contents.goBack(); }
    else if (inputEvent.alt && key === 'arrowright' && contents.canGoForward()) { event.preventDefault(); contents.goForward(); }
  });
  void contents.loadURL(item.url);
  return { ok: true, focused: false };
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
    icon: APP_ICON_PATH,
    backgroundColor: '#111111',
    webPreferences: {
      session: browsingSession || session.defaultSession,
      preload: path.join(__dirname, 'viewpreload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  popup.webContents.__flowrSiteApp = true;
  siteAppWebContents.add(popup.webContents.id);
  popup.once('closed', () => siteAppWebContents.delete(popup.webContents.id));
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
  if (ctrl && shift && key === 'a') return 'tab-search';
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
  if (ctrl && key === 'p') return 'print';
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
  // Reader mode must still be useful on modern app-like pages that do not use
  // an article element or enough paragraphs to pass the readability score.
  // Fall back to the main landmark, then the document body, and strip the
  // application furniture from the clone below.
  if(!art)art=document.querySelector('main,[role=main]')||document.body;
  if(!art)return 'none';
  var clone=art.cloneNode(true);
  clone.querySelectorAll('nav,aside,header,footer,form,script,style,noscript,button,input,select,textarea,iframe,.navbox,.sidebar,.infobox,.mw-editsection,[role=navigation],[role=complementary],.reflist,.mw-references-wrap,.references,.catlinks,#toc,.toc,.hatnote,.shortdescription,.ambox,.metadata,.mw-jump-link,.noprint,.vector-toc,.mw-indicators,.thumbcaption .magnify,.advertisement,[class*=share],[class*=social],[aria-hidden=true]').forEach(function(el){el.remove();});
  // Harden the clone before it is re-inserted as HTML below: strip inline
  // event handlers, dangerous URL schemes, and plugin elements. innerHTML
  // assignment does not execute <script> (already removed), but on* attributes
  // and javascript: hrefs survive cloning and would run in the page origin.
  clone.querySelectorAll('object,embed,applet').forEach(function(el){el.remove();});
  clone.querySelectorAll('*').forEach(function(el){
    try{
      var attrs=el.attributes?Array.prototype.slice.call(el.attributes):[];
      for(var k=0;k<attrs.length;k++){var an=attrs[k].name.toLowerCase();if(an.indexOf('on')===0)el.removeAttribute(attrs[k].name);}
      ['href','src','action','xlink:href','cite','data','poster'].forEach(function(a){var v=el.getAttribute?el.getAttribute(a):null;if(typeof v==='string'&&/^\s*(javascript|data|vbscript):/i.test(v))el.removeAttribute(a);});
    }catch(_){}
  });
  var dark=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
  var fg=dark?'#e7e7e8':'#1c1c1e', bg=dark?'#17181c':'#faf8f4', sub=dark?'#8a8f98':'#8c857a', rule=dark?'#2a2c33':'#e7e1d6', lnk=dark?'#7aa2ff':'#2963d6';
  var o=document.createElement('div');o.id=ID;o.tabIndex=-1;
  o.style.cssText='position:fixed;inset:0;z-index:2147483646;overflow-y:auto;-webkit-overflow-scrolling:touch;background:'+bg+';color:'+fg+';';
  var close=document.createElement('button');close.textContent='Close reading mode';close.setAttribute('aria-label','Close reading mode');close.style.cssText='position:fixed;right:24px;top:22px;z-index:2;border:1px solid '+rule+';border-radius:999px;padding:10px 15px;background:'+bg+';color:'+fg+';font:650 13px/1 -apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.12)';close.onclick=function(){o.remove();document.documentElement.style.overflow='';};o.appendChild(close);
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
  // DevTools can be disabled from Settings → Developer.
  if (action === 'devtools' && settingsStore.get('devTools') === false) return;
  send('shortcut', action);
}

function attachShortcuts(webContents) {
  // The renderer re-registers the same guest on every dom-ready, i.e. on every
  // page load. Wiring before-input-event unconditionally meant one keypress was
  // handled N times: Ctrl+T opened N tabs, Ctrl+N spawned N processes. Wire once.
  if (webContents.__flowrShortcutsWired) return;
  webContents.__flowrShortcutsWired = true;
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

function historyRules() {
  return parseSiteRules(settingsStore.get('autoClearSites'));
}

function matchesHistoryRule(url) {
  return matchesSiteRule(url, historyRules());
}

// History is the hottest path in the app: did-navigate, did-navigate-in-page
// and page-title-updated all fire for a single page view, and each call used to
// decrypt up to 1000 records, re-filter them, and re-encrypt the whole array on
// the main thread. Keep the decoded list in memory and coalesce writes so a
// page view costs one encrypt, not three.
let historyCache = null;
let historyFlushTimer = null;
let historyPending = null;

function decryptHistory() {
  const encrypted = historyStore.get('encryptedHistory');
  if (encrypted && safeStorage?.isEncryptionAvailable()) {
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))); } catch (_) {}
  }
  return historyStore.get('history') || [];
}

function invalidateHistoryCache() {
  historyCache = null;
}

function readHistory() {
  if (historyCache) return historyCache;
  const all = decryptHistory();
  const filtered = filterHistory(all, { rules: historyRules(), retention: settingsStore.get('historyRetention') || 'forever' });
  if (filtered.length !== all.length) writeHistory(filtered);
  historyCache = filtered;
  return filtered;
}

function flushHistoryNow() {
  historyFlushTimer = null;
  if (!historyPending) return;
  const items = historyPending;
  historyPending = null;
  if (settingsStore.get('privateHistory') !== false && safeStorage?.isEncryptionAvailable()) {
    try {
      historyStore.set('encryptedHistory', safeStorage.encryptString(JSON.stringify(items)).toString('base64'));
      historyStore.set('history', []);
      return;
    } catch (_) {}
  }
  historyStore.set('history', items);
  historyStore.set('encryptedHistory', '');
}

function writeHistory(items) {
  historyCache = items;
  historyPending = items;
  if (historyFlushTimer) return;
  historyFlushTimer = setTimeout(() => {
    historyFlushTimer = null;
    try { flushHistoryNow(); } catch (_) {}
  }, 400);
  // Never hold the process open for a history write.
  historyFlushTimer.unref?.();
}

// Coalesce the three events a single page load produces into one record.
const lastHistoryEntry = new Map();
function addToHistory(url, title) {
  if (INCOGNITO || !url || url === 'about:blank' || matchesHistoryRule(url)) return;
  if (settingsStore.get('historyRetention') === 'session') return;
  if (typeof url !== 'string' || url.length > 4096) return;
  const safeTitle = typeof title === 'string' ? title.slice(0, 512) : '';
  const previousEvent = lastHistoryEntry.get(url);
  if (previousEvent && previousEvent.title === safeTitle) return;
  lastHistoryEntry.set(url, { title: safeTitle, at: Date.now() });
  if (lastHistoryEntry.size > 200) {
    for (const [key, value] of lastHistoryEntry) {
      if (Date.now() - value.at > 60000) lastHistoryEntry.delete(key);
    }
  }

  const history = readHistory();
  const previous = history.find(item => item.url === url);
  const newItem = { url, title: safeTitle || previous?.title || url, date: new Date().toISOString(), visits: (previous?.visits || 0) + 1 };
  const next = [newItem, ...history.filter((item) => item.url !== url)].slice(0, 1000);
  writeHistory(next);
  send('history-changed', settingsStore.get('historyLock') && !vault.isUnlocked() ? [] : next);
}

// --- Extension session layer -------------------------------------------------
// Chromium scopes an extension's registration — and therefore its background
// page, content scripts, webRequest hooks and chrome-extension:// origin — to
// the session it was loaded into.
//
// Every <webview> in Flowr renders in `browsingSession` (partition
// "persist:flow-main"). Loading into session.defaultSession, as the app used
// to do, meant nothing an extension did ever reached a tab: getAllExtensions()
// on browsingSession was always empty, the toolbar dropdown always read "No
// extensions installed", popups were rejected by their own allow-list, and
// chrome-extension:// pages 404'd in the options/side-panel webviews.
//
// Incognito uses an in-memory partition, which Electron explicitly refuses to
// host extensions in, so it stays extension-free by design.
function extensionSession() {
  return browsingSession || session.defaultSession;
}

function extensionsSupported() {
  return !!extensionSession() && !INCOGNITO;
}

// Electron 43 moved extension APIs under session.extensions; keep the legacy
// fallback so the app still works if the new namespace is unavailable.
function extensionApi(ses) {
  return (ses && ses.extensions && typeof ses.extensions.loadExtension === 'function') ? ses.extensions : ses;
}

// Unpacked developer extensions are the one case where file:// access is
// intentional. Store and Flowr-Store packages get none: an installed extension
// that can fetch file:/// can read the whole disk as the user.
function loadExtension(directory, { allowFileAccess = false } = {}) {
  const ses = extensionSession();
  if (!ses) throw new Error('Extensions are not available in this window.');
  return extensionApi(ses).loadExtension(directory, { allowFileAccess });
}

function removeLoadedExtension(id) {
  const ses = extensionSession();
  if (!ses) return;
  try { extensionApi(ses).removeExtension(id); } catch (_) {}
}

function allLoadedExtensions() {
  const ses = extensionSession();
  if (!ses || typeof ses.getAllExtensions !== 'function') return [];
  try { return ses.getAllExtensions() || []; } catch (_) { return []; }
}

// Let the toolbar refresh the moment the extension set changes, instead of
// waiting for the user to install or toggle something else.
let extensionsChangedTimer = null;
function notifyExtensionsChanged() {
  if (extensionsChangedTimer) return;
  extensionsChangedTimer = setTimeout(() => {
    extensionsChangedTimer = null;
    send('extension-loaded', extActions());
  }, 60);
  extensionsChangedTimer.unref?.();
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
      const loadedExtension = await loadExtension(extension.path, {
        allowFileAccess: extension.source === 'unpacked'
      });
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
  notifyExtensionsChanged();
}

function createWindow() {
  // A second ordinary launch already forwarded its intent and quit.
  if (!OWNS_SINGLE_INSTANCE) return;
  // Reopening (tray "Open Flowr") must focus the existing window, not spawn a second one.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    return mainWindow;
  }
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
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  });

  mainWindow.setMenu(null);

  // Vault lock-on-minimize / lock-on-close (Settings → Privacy & Security).
  mainWindow.on('minimize', () => { if (settingsStore.get('lockOnMinimize') !== false) lockVaultNow(); });
  mainWindow.on('close', () => { if (settingsStore.get('lockOnClose') !== false) lockVaultNow(); });

  // Keyboard shortcuts while the app chrome has focus. Per-web-view shortcuts
  // (focus inside a page) are attached from the renderer via 'register-webview'.
  attachShortcuts(mainWindow.webContents);

  // Custom-skinned context menu for the app UI (address bar, etc.).
  mainWindow.webContents.on('context-menu', (event, params) => {
    send('show-context-menu', { ...contextParams(params), webContentsId: mainWindow.webContents.id, ui: true, image: null });
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

  mainWindow.webContents.once('did-finish-load', () => {
    if (process.env.FLOW_START_URL) {
      let transferState = null;
      try { if (process.env.FLOW_TRANSFER_STATE) transferState = JSON.parse(Buffer.from(process.env.FLOW_TRANSFER_STATE, 'base64').toString('utf8')); } catch (_) {}
      send('open-start-url', { url: process.env.FLOW_START_URL, transferState });
    }
  });
  mainWindow.loadURL(startUrl).catch(() => revealWindow());

  browsingSession.on('will-download', (event, item) => {
    trackDownload(item);
  });
}

// Download bookkeeping belongs to the session, not to a window. Registering it
// inside createWindow() meant every reopen (macOS activate, tray click) stacked
// another will-download listener on the shared session, producing N duplicate
// rows per download and Nx the disk writes. Idempotent by construction now.
let downloadTrackingAttached = false;
function attachDownloadTracking() {
  if (downloadTrackingAttached || !browsingSession) return;
  downloadTrackingAttached = true;

  browsingSession.on('will-download', (event, item) => {
    trackDownload(item);
  });
}

function trackDownload(item) {
  // Monotonic per-process sequence over a boot timestamp — Date.now() alone
  // collides when several downloads start in the same millisecond, which
  // would make pause/resume/cancel hit the wrong item.
  const downloadId = downloadSeq++;
  const fileName = item.getFilename();
  downloadItems.set(downloadId, item);

  // Honor a chosen download folder (unless the user wants to be asked each time).
  const dir = settingsStore.get('downloadPath');
  if (dir && !settingsStore.get('askWhereToSave')) {
    try { item.setSavePath(path.join(dir, fileName)); } catch (_) {}
  } else if (settingsStore.get('askWhereToSave')) {
    // Without this the toggle is decorative — Electron only shows the native
    // picker when the save dialog has been explicitly enabled.
    try { item.setSaveDialogOptions({ title: 'Save file' }); } catch (_) {}
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
}

app.whenReady().then(async () => {
  if (!OWNS_SINGLE_INSTANCE) return;
  // Must be the exact same partition used by renderer webviews. Configuring
  // defaultSession does not affect <webview partition="persist:flow-main">.
  browsingSession = INCOGNITO ? session.fromPartition('flow-incognito') : session.fromPartition('persist:flow-main');
  configureSession(browsingSession);
  session.defaultSession.setUserAgent(currentUserAgent(), 'en-US,en;q=0.9');
  hardenChromeSession(session.defaultSession);
  hardenWebContents();
  attachDownloadTracking();
  if (!INCOGNITO) await migrateLegacyTieddrCookies(browsingSession);
  createWindow();
  if (!INCOGNITO) updateController.initialize();

  // Under genuine system pressure, ask the renderer to release all inactive
  // tab guests immediately rather than waiting for the normal idle timeout.
  // Values returned by Electron are in KiB.
  const checkMemoryPressure = () => {
    if (settingsStore.get('memorySaver') === false) return;
    try {
      const info = app.getSystemMemoryInfo();
      const criticallyLow = info.free < 1024 * 1024 || (info.total > 0 && info.free / info.total < 0.1);
      if (criticallyLow) send('memory-pressure', { free: info.free, total: info.total });
    } catch (_) {}
  };
  memoryPressureInterval = setInterval(checkMemoryPressure, 30000);
  memoryPressureInterval.unref?.();

  // Extensions can perform disk I/O and start background service workers.
  // Load them after the browser chrome is visible so they never block startup.
  if (!INCOGNITO) setTimeout(() => { void loadStoredExtensions(); }, 1500);

  // System idle detection for vault auto-lock
  const { powerMonitor } = require('electron');
  const lockOnSystemIdle = () => {
    if (settingsStore.get('lockOnIdle') !== false && vault.isUnlocked()) {
      vault.lock();
      send('vault-locked');
    }
  };
  powerMonitor.on('lock-screen', lockOnSystemIdle);
  powerMonitor.on('suspend', lockOnSystemIdle);

  // Preload pages: warm DNS for the sites the user actually visits so first
  // navigations resolve faster (Settings → Performance → "Preload pages").
  if (!INCOGNITO && settingsStore.get('preloadPages') !== false) {
    setTimeout(() => {
      try {
        const hosts = [...new Set(readHistory().slice(0, 40).map(item => {
          try { return new URL(item.url).hostname; } catch (_) { return ''; }
        }).filter(Boolean))].slice(0, 8);
        hosts.forEach(hostName => { try { browsingSession.prefetchDNS(hostName); } catch (_) {} });
      } catch (_) {}
    }, 2500);
  }

  // Anonymous, opt-in launch ping (Settings → System → "Send usage statistics").
  if (!INCOGNITO) setTimeout(maybeSendUsagePing, 1500);

  // Already signed in from a previous launch — sync now, then keep syncing
  // periodically for the rest of this session. Skipped in incognito.
  if (!INCOGNITO && accountStore.get('account')) {
    setTimeout(() => {
      void syncTieddrAll();
      startAutoSync();
    }, 4000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  // Without this, a throw anywhere in startup (a bad profile id, a locked
  // store file) becomes an unhandled rejection and the process dies with no
  // window and no diagnostic.
  _origError('[Flowr] Startup failed:', error);
  try {
    dialog.showErrorBox('Flowr could not start', String(error?.stack || error?.message || error));
  } catch (_) {}
  app.exit(1);
});

function flushAllStores() {
  // A pending history write is coalesced on a timer; force it out first or the
  // last few navigations would be lost on quit / profile switch / window close.
  if (historyFlushTimer) { clearTimeout(historyFlushTimer); historyFlushTimer = null; }
  try { flushHistoryNow(); } catch (_) {}
  [profilesStore, settingsStore, downloadsStore, extensionsStore, accountStore, sessionStore, statsStore].forEach(s => s.flush && s.flush());
  if (bookmarksStore) bookmarksStore.flush && bookmarksStore.flush();
  if (historyStore) historyStore.flush && historyStore.flush();
  if (passwordsStore) passwordsStore.flush && passwordsStore.flush();
  if (notesStore) notesStore.flush && notesStore.flush();
}

// "Continue running background apps" — when every window closes, Flowr stays
// resident behind a tray icon instead of quitting.
let tray = null;
function ensureBackgroundTray() {
  if (tray) return;
  try {
    tray = new Tray(APP_ICON_PATH);
    tray.setToolTip('Flowr');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Flowr', click: () => createWindow() },
      { type: 'separator' },
      { label: 'Quit Flowr', click: () => app.quit() }
    ]));
    tray.on('double-click', () => createWindow());
  } catch (_) { tray = null; }
}

app.on('window-all-closed', () => {
  flushAllStores();
  if (process.platform === 'darwin') return;
  if (settingsStore.get('background') === true) {
    ensureBackgroundTray();
    return;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (memoryPressureInterval) clearInterval(memoryPressureInterval);
  if (tray) { try { tray.destroy(); } catch (_) {} tray = null; }
  if (settingsStore.get('clearPrivateDataOnExit')) {
    writeHistory([]);
    try { void (browsingSession || session.defaultSession).clearStorageData({ storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'serviceworkers', 'websql'] }); } catch (_) {}
  }
  flushAllStores();
});

// Opt-in anonymous launch ping — one per day, fire-and-forget.
function maybeSendUsagePing() {
  if (!settingsStore.get('sendStats')) return;
  const today = new Date().toDateString();
  if (statsStore.get('lastPing') === today) return;
  statsStore.set('lastPing', today);
  void fetch(`${TIEDDR_API_BASE}/v1/stats/browser-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'flowr', version: app.getVersion(), platform: process.platform, channel: settingsStore.get('updateChannel') || 'stable' })
  }).catch(() => {});
}

// --- Web view (renderer-owned <webview> elements) -------------------------
// The renderer creates the <webview> DOM elements and drives navigation, find,
// zoom and events directly. Main only provides the preload path, persists
// history, and attaches keyboard shortcuts to each view's webContents.

// Absolute file:// URL of the per-page preload (password/wallet autofill).
ipcMain.handle('get-view-preload', () => pathToFileURL(path.join(__dirname, 'viewpreload.js')).href);
ipcMain.onSync('privacy-web-preferences', (event, pageUrl) => {
  const url = typeof pageUrl === 'string' ? pageUrl : event.sender.getURL();
  event.returnValue = {
    adBlocker: adBlockerEnabled,
    adaptiveAdBlocker: settingsStore.get('adaptiveAdBlocker') !== false,
    blockUnpromptedPasskeys: settingsStore.get('blockUnpromptedPasskeys') !== false,
    fingerprintProtection: !!settingsStore.get('fingerprintProtection'),
    smartCopy: !!settingsStore.get('smartCopy'),
    compatibleBrowserIdentity: requiresCompatibleBrowserIdentity(url),
    userAgent: currentUserAgent(url),
    browserPlatform: browserPlatform()
  };
});

function adBlockEventHost(event) {
  try {
    const host = new URL(event.sender.getURL()).hostname.toLowerCase().replace(/\.$/, '');
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : '';
  } catch (_) { return ''; }
}

function validAdaptiveSelector(selector) {
  const value = String(selector || '');
  if (value.length > 100) return false;
  const attribute = '(?:data-ad|data-ad-slot|data-adunit|data-ad-unit|data-advertisement|data-advertising|data-sponsored|data-google-query-id|data-dfp)';
  return new RegExp(`^(?:#[a-z][\\w-]{1,79}|\\.[a-z][\\w-]{1,79}|\\[${attribute}(?:="[a-z0-9_-]{1,60}")?\\])$`, 'i').test(value);
}

ipcMain.handle('adblock-rules', event => {
  if (!adBlockerEnabled || settingsStore.get('adaptiveAdBlocker') === false || INCOGNITO) return { rules: [] };
  const host = adBlockEventHost(event);
  if (!host) return { rules: [] };
  const sites = adBlockRulesStore.get('sites') || {};
  const rules = Array.isArray(sites[host]) ? sites[host].filter(validAdaptiveSelector).slice(0, 24) : [];
  return { rules };
});

ipcMain.on('adblock-report', (event, payload) => {
  if (!adBlockerEnabled || settingsStore.get('adaptiveAdBlocker') === false) return;
  const host = adBlockEventHost(event);
  const count = Math.min(500, Math.max(0, Math.floor(Number(payload?.count) || 0)));
  if (!host || !count) return;
  const total = (adBlockSessionTotals.get(host) || 0) + count;
  adBlockSessionTotals.set(host, total);
  let learned = 0;

  if (!INCOGNITO) {
    const sites = { ...(adBlockRulesStore.get('sites') || {}) };
    const existing = Array.isArray(sites[host]) ? sites[host].filter(validAdaptiveSelector) : [];
    const incoming = Array.isArray(payload?.rules) ? payload.rules.filter(validAdaptiveSelector).slice(0, 24) : [];
    const rules = [...new Set([...existing, ...incoming])].slice(0, 24);
    learned = rules.length - existing.length;
    if (learned > 0) {
      delete sites[host];
      sites[host] = rules;
      const bounded = Object.fromEntries(Object.entries(sites).slice(-100));
      adBlockRulesStore.set('sites', bounded);
    }
  }
  send('adblock-status', { webContentsId: event.sender.id, site: host, count, total, learned });
});

// Live-applied developer emulation (CSS media type / network throttling) via
// the Chrome DevTools Protocol on every registered guest webContents.
const guestWebContents = new Set();
// Resolve a renderer-supplied webContents id to a LIVE guest only. Handlers
// that operate on page guests (view commands, print, preview, page-text reads)
// must use this — a compromised renderer must not be able to aim those
// capabilities at arbitrary webContents (other tabs, the app chrome itself).
function guestWebContentsFromId(id) {
  if (typeof id !== 'number' || !guestWebContents.has(id)) return null;
  const wc = webContents.fromId(id);
  return wc && !wc.isDestroyed() ? wc : null;
}

// --- Global webContents policy ----------------------------------------------
// Every BrowserWindow the app creates inherits its parent's webPreferences. With
// no policy installed, a window.open() from the app chrome would hand a page a
// window carrying preload.js — i.e. the full privileged IPC surface. Apply one
// deny-by-default policy to everything, and let the few deliberate paths
// (branded popup, guest popups) install their own handler afterwards.
const APP_URL_PATTERN = /^(?:file:\/\/\/?.*[\\/]dist[\\/]index\.html|http:\/\/localhost:8081)/i;

function isAppChromeUrl(url) {
  return APP_URL_PATTERN.test(String(url || ''));
}

// Schemes a web page may ever hand us as a navigation target. Anything else
// (javascript:, data:, blob:, file:, view-source: on an attacker origin) is
// refused before it reaches a webContents.
function isWebNavigationUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

// A page's window.open() never becomes a window. Tab dispositions become tabs
// in Flowr; everything else becomes a branded popup — after the same Safe
// Browsing and ad checks a navigation would get.
function guestWindowOpenHandler(sourceId) {
  return ({ url, disposition }) => {
    if (isWebNavigationUrl(url)) {
      const sbLevel = safeBrowsingLevel();
      // Popup checks are the "extended" surface — gated by safeBrowsingData.
      const dangerousPopup = sbLevel !== 'off' && settingsStore.get('safeBrowsingData') !== false && isDangerousUrl(url, sbLevel);
      const shouldBlockPopup = dangerousPopup ||
        shouldBlockRequest({ url, resourceType: 'mainFrame' }, adBlockerEnabled, trackerBlockingEnabled);
      if (!shouldBlockPopup) {
        if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'new-window') {
          send('open-url-in-new-tab', { url, sourceWebContentsId: sourceId, background: disposition === 'background-tab' });
        } else {
          createBrandedPopup(url);
        }
      }
    }
    return { action: 'deny' };
  };
}

function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) applyNavigationIdentity(contents, url);
    });
    const type = contents.getType();

    if (type === 'webview') {
      // Register at creation so the preload's first privacy/rule request has an
      // authenticated guest sender rather than racing the renderer's dom-ready.
      guestWebContents.add(contents.id);
      contents.once('destroyed', () => guestWebContents.delete(contents.id));
      // A guest is a full browser page and may navigate anywhere. It is never
      // allowed to open a window the app didn't sanction, and the handler has to
      // be installed at creation — waiting for the renderer's dom-ready
      // round-trip left a window.open() race that spawned unmanaged windows.
      contents.setWindowOpenHandler(guestWindowOpenHandler(contents.id));
      return;
    }

    // Any other window type. Refuse to leave the app's own document: a
    // file:// or javascript: navigation here would run in a window holding the
    // privileged preload.
    contents.on('will-navigate', (event, url) => {
      if (!contents.__flowrSiteApp && !isAppChromeUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!contents.__flowrSiteApp && !isAppChromeUrl(url)) event.preventDefault();
    });
    // Deny-by-default. Deliberate windows (branded popup, extension popup, the
    // OAuth window) install their own handler right after construction, which
    // replaces this one.
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebNavigationUrl(url)) createBrandedPopup(url);
      return { action: 'deny' };
    });

    // <webview> attributes are renderer-controlled. Even though Flowr's own
    // renderer never sets them, strip the dangerous ones at the last moment
    // before the guest is created so a single injected attribute cannot grant
    // Node access or disable web security. Mutating webPreferences in place is
    // the supported way — it is the merged attribute set Electron is about to
    // use, and it must NOT be cancelled.
    contents.on('will-attach-webview', (_event, webPreferences) => {
      delete webPreferences.nodeintegration;
      delete webPreferences.disablewebsecurity;
      delete webPreferences.allowRunningInsecureContent;
      delete webPreferences.webviewTag;
      delete webPreferences.session;
      delete webPreferences.enableBlinkFeatures;
      delete webPreferences.backgroundThrottling;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      // The guest preload carries password autofill and wallet fill. Pin it to
      // Flowr's own file so a renderer can never point a guest at an arbitrary
      // script, and drop it entirely if the app has no preload for this build.
      webPreferences.preload = path.join(__dirname, 'viewpreload.js');
    });
  });
}
function applyDevEmulation(wc) {
  if (!wc || wc.isDestroyed()) return;
  const wantMedia = settingsStore.get('emulateMediaType') === true;
  const wantNet = settingsStore.get('networkThrottling') === true;
  try {
    if (!wantMedia && !wantNet) {
      if (wc.debugger.isAttached()) { try { wc.debugger.detach(); } catch (_) {} }
      return;
    }
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      wc.debugger.sendCommand('Network.enable').catch(() => {});
    }
    wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: wantMedia ? 'print' : 'screen' }).catch(() => {});
    const conditions = wantNet
      ? { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 }
      : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    wc.debugger.sendCommand('Network.emulateNetworkConditions', conditions).catch(() => {});
  } catch (_) {}
}

// Renderer reports a navigation so we can persist history (skipped in incognito).
ipcMain.on('add-history', (event, url, title) => {
  // Bound both fields: 1000 records with an unbounded title is disk
  // amplification from any renderer that can reach this channel.
  const cleanUrl = typeof url === 'string' ? url.slice(0, 4096) : '';
  if (!cleanUrl) return;
  addToHistory(cleanUrl, typeof title === 'string' ? title.slice(0, 512) : '');
});

ipcMain.handle('get-top-sites', () => {
  const counts = new Map();
  for (const item of readHistory()) {
    try {
      const parsed = new URL(item.url);
      if (!/^https?:$/.test(parsed.protocol)) continue;
      const key = parsed.origin;
      const previous = counts.get(key) || { url: key, title: item.title || parsed.hostname, visits: 0, lastVisit: item.date || '' };
      previous.visits += Math.max(1, Number(item.visits) || 1);
      if ((item.date || '') > previous.lastVisit) {
        previous.lastVisit = item.date || '';
        previous.title = item.title || previous.title;
      }
      counts.set(key, previous);
    } catch (_) {}
  }
  return [...counts.values()].sort((a, b) => b.visits - a.visits || b.lastVisit.localeCompare(a.lastVisit)).slice(0, 8);
});

// Renderer registers each new <webview>'s webContents id so we can attach
// keyboard shortcuts for when focus is inside the page.
//
// Registration is the trust anchor for guestWebContentsFromId, so it must only
// ever accept a real <webview> guest. Without the type check a compromised
// renderer could register the app chrome's own webContents and then aim
// view-command / printToPDF / page-text reads at itself.
ipcMain.on('register-webview', (event, id) => {
  if (typeof id !== 'number' || !Number.isInteger(id)) return;
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed()) return;
  try {
    if (wc.getType() !== 'webview') return;
  } catch (_) {
    return;
  }
  {
    attachShortcuts(wc);
    if (!guestWebContents.has(id)) wc.once('destroyed', () => guestWebContents.delete(id));
    guestWebContents.add(id);
    applyDevEmulation(wc);
    if (!wc.__flowrNavigationWired) {
      wc.__flowrNavigationWired = true;
      const record = (_event, url, _httpResponseCode, _httpStatusText, isMainFrame) => {
        if (isMainFrame === false) return;
        if (!/^https?:\/\//i.test(url || '')) return;
        let title = '';
        try { title = wc.getTitle(); } catch (_) {}
        addToHistory(url, title);
      };
      wc.on('did-navigate', record);
      wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame === false || !/^https?:\/\//i.test(url || '')) return;
        let title = ''; try { title = wc.getTitle(); } catch (_) {}
        addToHistory(url, title);
      });
      wc.on('page-title-updated', (_event, title) => {
        let url = '';
        try { url = wc.getURL(); } catch (_) {}
        if (/^https?:\/\//i.test(url)) addToHistory(url, title);
      });
      wc.on('console-message', (_event, level, message, line, sourceId) => {
        if (INCOGNITO || settingsStore.get('consoleLogging') !== true) return;
        const tag = ['log', 'warn', 'error', 'debug', 'info'][level] || 'log';
        console[tag === 'debug' ? 'log' : tag](`[page:${tag}] ${message} (${sourceId}:${line})`);
      });
      wc.on('context-menu', (_event, params) => send('show-context-menu', { ...contextParams(params), webContentsId: wc.id, ui: false }));
      wc.on('will-redirect', (event, url) => {
        let sourceUrl = '';
        try { sourceUrl = wc.getURL(); } catch (_) {}
        const sbLevel = safeBrowsingLevel();
        if ((sbLevel !== 'off' && isDangerousUrl(url, sbLevel)) ||
            shouldBlockRequest({ url, resourceType: 'mainFrame', initiator: sourceUrl, referrer: sourceUrl }, adBlockerEnabled, trackerBlockingEnabled)) {
          event.preventDefault();
          send('ad-navigation-blocked', { sourceUrl, url });
          return;
        }
        if (!settingsStore.get('askBeforeIdentityRedirect')) return;
        let destination = '';
        try { destination = new URL(url).hostname.toLowerCase(); } catch (_) { return; }
        if (!/(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com)$/.test(destination)) return;
        event.preventDefault();
        void dialog.showMessageBox(mainWindow, {
          type: 'question', title: 'Identity redirect blocked',
          message: `Allow this page to continue to ${destination}?`,
          detail: 'Flowr stopped the redirect before an external account page could load.',
          buttons: ['Stay on this page', 'Allow redirect'], defaultId: 0, cancelId: 0, noLink: true
        }).then(result => { if (result.response === 1 && !wc.isDestroyed()) wc.loadURL(url); }).catch(() => {});
      });
    }
wc.setWindowOpenHandler(guestWindowOpenHandler(wc.id));
  }
});

ipcMain.on('set-webview-active', (_event, id, active) => {
  const wc = guestWebContentsFromId(id);
  if (!wc) return;
  try { wc.setBackgroundThrottling(!active); } catch (_) {}
  try { wc.setFrameRate(active ? 60 : 1); } catch (_) {}
});

// Commands that need the main process (dialogs, reader mode, save-page). The
// renderer passes the target view's webContents id — resolved as a registered
// guest only, so these capabilities can't be aimed at other tabs or the app.
ipcMain.on('view-command', (event, id, cmd, arg) => {
  const wc = guestWebContentsFromId(id);
  if (!wc) return;
  switch (cmd) {
    case 'back': if (wc.canGoBack()) wc.goBack(); break;
    case 'forward': if (wc.canGoForward()) wc.goForward(); break;
    case 'reload': wc.reload(); break;
    case 'hard-reload': wc.reloadIgnoringCache(); break;
    case 'mute': wc.setAudioMuted(!wc.isAudioMuted()); break;
    case 'stop': wc.stop(); break;
    case 'copy': wc.copy(); break;
    case 'cut': wc.cut(); break;
    case 'paste': wc.paste(); break;
    case 'selectAll': wc.selectAll(); break;
    case 'undo': wc.undo(); break;
    case 'redo': wc.redo(); break;
    case 'copyText': if (typeof arg === 'string' && arg.length <= 100000) clipboard.writeText(arg); break;
    case 'copyImage': if (arg && Number.isFinite(Number(arg.x)) && Number.isFinite(Number(arg.y))) wc.copyImageAt(Number(arg.x), Number(arg.y)); break;
    // An unvalidated renderer string here reached downloadURL() directly, so
    // file://, data: and javascript: were all live — a local-file copy
    // primitive. Only real web URLs may be downloaded.
    case 'saveImage': if (isWebNavigationUrl(arg) || /^data:image\//i.test(String(arg || ''))) wc.downloadURL(String(arg)); break;
    case 'inspect':
      if (settingsStore.get('devTools') === false) break;
      if (arg) { wc.openDevTools({ mode: 'right', activate: true }); wc.inspectElement(arg.x | 0, arg.y | 0); } break;
    case 'devtools': {
      if (settingsStore.get('devTools') === false) break;
      const mode = settingsStore.get('alwaysShowConsole') ? 'bottom' : 'right';
      wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode, activate: true });
      break;
    }
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

ipcMain.handle('open-site-app', (_event, item) => openSiteAppWindow(item));

// New window / incognito: launch a fresh, fully-isolated app instance. Each is
// its own process, so windows never interfere with each other's tabs.
ipcMain.on('new-window', (event, opts) => {
  const args = process.defaultApp ? [app.getAppPath()] : [];
  const env = { ...process.env };
  if (opts && opts.incognito) env.FLOW_INCOGNITO = '1'; else delete env.FLOW_INCOGNITO;
  if (opts?.url && /^https:\/\//i.test(String(opts.url))) env.FLOW_START_URL = String(opts.url);
  else delete env.FLOW_START_URL;
  // Settings → Tabs → "New window opens: Blank page" hides the start page.
  if (opts?.blankStart) env.FLOW_BLANK_START = '1'; else delete env.FLOW_BLANK_START;
  try { spawn(process.execPath, args, { detached: true, stdio: 'ignore', env }).unref(); } catch (_) {}
});

// A tab tear-out is a transfer, not "open the same URL again". The renderer
// removes the source tab only after this handler confirms the destination
// process was started, preventing both accidental duplicates and lost tabs.
ipcMain.handle('tear-out-tab', async (_event, payload = {}) => {
  const url = typeof payload.url === 'string' ? payload.url : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'This tab cannot be moved to a window.' };
  const args = process.defaultApp ? [app.getAppPath()] : [];
  const env = { ...process.env, FLOW_START_URL: url, FLOW_TRANSFERRED_TAB: '1' };
  if (payload.state && typeof payload.state === 'object') {
    try {
      const encoded = Buffer.from(JSON.stringify(payload.state), 'utf8').toString('base64');
      if (encoded.length < 24000) env.FLOW_TRANSFER_STATE = encoded;
    } catch (_) {}
  } else delete env.FLOW_TRANSFER_STATE;
  if (payload.incognito) env.FLOW_INCOGNITO = '1'; else delete env.FLOW_INCOGNITO;
  try {
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not create the new window.' };
  }
});

ipcMain.handle('get-incognito', () => INCOGNITO);
ipcMain.handle('get-window-flags', () => ({
  incognito: INCOGNITO,
  blankStart: process.env.FLOW_BLANK_START === '1'
}));
ipcMain.handle('get-clipboard-text', () => clipboard.readText());

// --- Session restore (Settings → Tabs & Startup) ---------------------------
ipcMain.on('save-session', (_event, payload) => {
  if (INCOGNITO) return;
  try {
    const tabs = (Array.isArray(payload?.tabs) ? payload.tabs : [])
      .filter(url => typeof url === 'string' && /^https?:\/\//i.test(url))
      .slice(0, 20);
    sessionStore.set('tabs', tabs);
    sessionStore.set('activeUrl', typeof payload?.activeUrl === 'string' ? payload.activeUrl : '');
  } catch (_) {}
});

ipcMain.handle('get-last-session', () => {
  if (INCOGNITO) return { tabs: [], activeUrl: '' };
  return { tabs: sessionStore.get('tabs') || [], activeUrl: sessionStore.get('activeUrl') || '' };
});

// --- Password manager (backed by the Tieddr Vault when unlocked) ----------
// When the vault is unlocked it's the source of truth — synced across every
// Tieddr client. When locked / signed-out we fall back to Flow's on-device
// password store so autofill still works. Same IPC surface + pw-save-prompt, so
// viewpreload.js and the Settings UI are unchanged.
const vaultOn = () => vault.isUnlocked();

ipcMain.handle('pw-get-for-origin', async (event, origin) => {
  if (settingsStore.get('autofill') === false) return null;
  // Only page guests may request credentials, and only for the origin they
  // actually present. A definite mismatch between the sender frame and the
  // claimed origin is rejected (lenient when the frame origin is opaque).
  try {
    const sender = event.sender;
    if (!sender || sender.isDestroyed() || !guestWebContents.has(sender.id)) return null;
    const frameOrigin = event.senderFrame && event.senderFrame.origin;
    if (frameOrigin && frameOrigin !== 'null' && /^https?:\/\//i.test(frameOrigin) && /^https?:\/\//i.test(String(origin || ''))) {
      if (new URL(origin).origin !== new URL(frameOrigin).origin) return null;
    }
  } catch (_) { return null; }
  if (vaultOn()) { const c = await vault.getForOrigin(origin); if (c) return c; }
  const rec = (passwordsStore.get('passwords') || []).filter(p => p.origin === origin).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return rec ? { username: rec.username, password: decPw(rec) } : null;
});

ipcMain.on('pw-captured', async (event, { origin, username, password } = {}) => {
  if (!password || INCOGNITO || settingsStore.get('savePasswords') === false) return;
  // Guests only, well-formed https origin. Plain-http captures are dropped —
  // viewpreload already refuses to report them; this is the backstop.
  try {
    const sender = event.sender;
    if (!sender || sender.isDestroyed() || !guestWebContents.has(sender.id)) return;
    if (!/^https:\/\/[^/]+/i.test(String(origin || ''))) return;
    if (typeof password !== 'string' || password.length > 1000) return;
  } catch (_) { return; }
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
    send('vault-require-unlock', { action: 'reveal', origin, username });
    return '';
  }
  const it = await vaultPwItem(origin, username);
  if (it) { const rv = await vault.reveal(it.id); return rv.ok ? (rv.value || '') : ''; }
  return '';
});
ipcMain.handle('pw-copy', async (event, origin, username) => {
  if (!vaultOn()) {
    send('vault-require-unlock', { action: 'copy', origin, username });
    return false;
  }
  let val = '';
  const it = await vaultPwItem(origin, username);
  if (it) { const rv = await vault.reveal(it.id); val = rv.ok ? (rv.value || '') : ''; }
  if (val) {
    clipboard.writeText(val);
    touchVaultActivity();
    const clearTime = Number(settingsStore.get('clipboardClear') ?? 30);
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

// Vault auto-lock — release the vault after N minutes with no vault activity
// (Settings → Privacy & Security → "Lock vault after").
let lastVaultActivity = Date.now();
const touchVaultActivity = () => { lastVaultActivity = Date.now(); };
setInterval(() => {
  const minutes = Number(settingsStore.get('vaultAutoLock')) || 0;
  if (minutes > 0 && vault.isUnlocked() && Date.now() - lastVaultActivity > minutes * 60 * 1000) {
    vault.lock();
  }
}, 30000).unref?.();

// Lock-on-minimize / lock-on-close (Settings → Privacy & Security). Locking
// persists the locked state, so a closed browser always reopens sealed.
function lockVaultNow() {
  if (vault.isUnlocked()) vault.lock();
}

ipcMain.handle('vault-state', async () => {
  const acc = accountStore.get('account');
  const st = await vault.state();
  return { linked: !!(acc && acc.uid), email: acc ? acc.email : null, ...st };
});
ipcMain.handle('vault-unlock', async (event, pin) => {
  const acc = accountStore.get('account');
  if (!acc || !acc.uid) return { ok: false, error: 'Sign in with Tieddr Account first' };
  // Hand the vault the current access token so its first sync can mint a
  // per-user Appwrite JWT via the vault-sso bridge (JWT-only, local-only if minting fails).
  vault.setAccessToken(acc.token || null, acc.tokenExp || 0);
  try {
    const r = await vault.unlock(acc.uid, pin);
    touchVaultActivity();
    // One-time import of Flow's pre-vault on-device logins (skips dupes).
    const local = (passwordsStore.get('passwords') || []).map(p => ({ origin: p.origin, username: p.username, password: decPw(p) }));
    const mig = await vault.migrateLocalPasswords(local).catch(() => ({ imported: 0 }));
    return { ...r, migrated: mig.imported || 0 };
  } catch (e) {
    if (e && e.message === 'locked') {
      const s = Math.max(1, Math.ceil(Number(e.retryAfterMs || 0) / 1000));
      return { ok: false, locked: true, retryAfterMs: e.retryAfterMs || 0, error: `Too many attempts. Try again in ${s}s.` };
    }
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('vault-lock', () => vault.lock());
ipcMain.handle('vault-list', () => { touchVaultActivity(); return vault.listItems(); });
ipcMain.handle('vault-reveal', (event, id) => { touchVaultActivity(); return vault.reveal(id); });
ipcMain.handle('vault-add', (event, payload) => { touchVaultActivity(); return vault.addItem(payload || {}); });
ipcMain.handle('vault-delete', (event, id) => { touchVaultActivity(); return vault.deleteItem(id); });
ipcMain.handle('vault-sync', () => { touchVaultActivity(); return vault.sync(); });
ipcMain.handle('vault-copy', async (event, id) => {
  const rv = await vault.reveal(id);
  if (rv && rv.ok && typeof rv.value === 'string') {
    clipboard.writeText(rv.value);
    touchVaultActivity();
    const clearTime = Number(settingsStore.get('clipboardClear') ?? 30);
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
  if (!/^\d{6}$/.test(String(newPin || ''))) {
    return { error: 'New PIN must be 6 digits' };
  }
  // Hand the vault the current access token so the post-rotation mirror push
  // can mint a per-user Appwrite JWT (JWT-only — no key fallback).
  vault.setAccessToken(acc.token || null, acc.tokenExp || 0);
  try {
    const r = await vault.changePin(acc.uid, currentPin, newPin);
    if (r && r.ok) touchVaultActivity();
    return { success: true };
  } catch (err) {
    if (err && err.message === 'wrong-pin') return { error: 'Current PIN is incorrect' };
    if (err && err.message === 'locked') {
      const s = Math.max(1, Math.ceil(Number(err.retryAfterMs || 0) / 1000));
      return { error: `Too many attempts. Try again in ${s}s.`, locked: true, retryAfterMs: err.retryAfterMs || 0 };
    }
    if (err && err.message === 'no-vault') return { error: 'No vault found for this account' };
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
  let account = accountStore.get('account');
  // Refresh on launch when possible, but never erase a durable signed-in
  // identity merely because the machine is offline or the token service fails.
  if (account?.refreshToken) account = await refreshTieddrToken(account) || account;
  const refreshed = await refreshTieddrProfile(account);
  if (refreshed) accountStore.set('account', refreshed);
  if (refreshed !== account) send('account-changed', refreshed);
  return refreshed || account;
});

ipcMain.handle('check-for-updates', (_event, options) => updateController.check(options || {}));
ipcMain.handle('download-update', () => updateController.download());
ipcMain.handle('install-update', () => updateController.install());
ipcMain.handle('get-update-status', () => updateController.status());
ipcMain.handle('set-update-channel', (_event, channel) => {
  const next = ['stable', 'beta', 'dev'].includes(channel) ? channel : 'stable';
  settingsStore.set('updateChannel', next);
  updateController.setChannel();
  return settingsStore.data;
});
// Re-apply developer emulation (CSS media / throttling) to all live guests.
ipcMain.handle('apply-dev-emulation', () => {
  for (const id of guestWebContents) {
    const wc = webContents.fromId(id);
    if (wc && !wc.isDestroyed()) applyDevEmulation(wc);
  }
  return true;
});

ipcMain.handle('open-external', (_event, url) => {
  // Parse rather than regex-test: a value containing embedded whitespace or a
  // newline can satisfy /^https:\/\// while resolving somewhere else entirely.
  // Only https may be handed to the OS — never file:, javascript: or a custom
  // scheme handler.
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch (_) { return false; }
  if (parsed.protocol !== 'https:') return false;
  void shell.openExternal(parsed.href);
  return true;
});

ipcMain.handle('create-print-preview', async (_event, id, options = {}) => {
  const wc = guestWebContentsFromId(id);
  if (!wc) return { ok: false, error: 'The page is no longer available.' };
  try {
    const pdf = await wc.printToPDF({
      printBackground: options.printBackground !== false,
      landscape: !!options.landscape,
      pageSize: options.pageSize || 'A4'
    });
    return { ok: true, dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`, bytes: pdf.length };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not create the print preview.' };
  }
});

ipcMain.handle('capture-webview-preview', async (_event, id) => {
  const wc = guestWebContentsFromId(id);
  if (!wc) return '';
  try {
    const image = await wc.capturePage();
    return image.resize({ width: 420, quality: 'good' }).toDataURL();
  } catch (_) { return ''; }
});

ipcMain.handle('print-page', async (_event, id, options = {}) => {
  const wc = guestWebContentsFromId(id);
  if (!wc) return { ok: false, error: 'The page is no longer available.' };
  return new Promise(resolve => wc.print({
    silent: false,
    printBackground: options.printBackground !== false,
    landscape: !!options.landscape,
    pageSize: options.pageSize || 'A4',
    margins: { marginType: options.marginType || 'default' }
  }, (success, failureReason) => resolve(success ? { ok: true } : { ok: false, error: failureReason || 'Printing was cancelled.' })));
});

ipcMain.handle('mavis-chat', async (_event, payload = {}) => {
  const account = accountStore.get('account');
  if (!account?.token) return { ok: false, requiresAccount: true, error: 'Connect your Tieddr Account to use Mavis.' };
  const input = String(payload.input || '').trim().slice(0, 4000);
  if (!input) return { ok: false, error: 'Ask Mavis something first.' };
  try {
    vaultAccount.setAccessToken(account.token);
    const jwt = await vaultAccount.getAppwriteJwt();
    if (!jwt) return { ok: false, requiresAccount: true, error: 'Your Tieddr session needs to be refreshed.' };
    let pageContext = String(payload.context || '').slice(0, 8000);
    // Page-text reads are guest-only: a renderer-supplied id for any other
    // webContents (another tab, the app chrome) yields no page context rather
    // than cross-tab content.
    const wc = payload.webContentsId != null ? guestWebContentsFromId(payload.webContentsId) : null;
    if (wc) {
      try {
        const page = await wc.executeJavaScript(`({title:document.title,url:location.href,text:(document.querySelector('main,article,[role=main]')||document.body)?.innerText?.slice(0,6000)||''})`);
        pageContext = `The user is browsing in Flowr.\nPage: ${page?.title || ''}\nURL: ${page?.url || ''}\nVisible page text:\n${page?.text || ''}\n${pageContext}`.slice(0, 10000);
      } catch (_) {}
    }
    const response = await fetch('https://space.tieddr.com/api/mavis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt, action: 'ask', input, context: pageContext, history: Array.isArray(payload.history) ? payload.history.slice(-12) : [] })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || `Mavis returned ${response.status}.` };
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, error: error?.message || 'Mavis is unavailable right now.' };
  }
});

ipcMain.handle('get-tieddr-news', async () => {
  // Fixed operator endpoint — never trust a renderer-controlled URL (SSRF).
  const endpoint = 'https://news.tieddr.com/api/feed';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const payload = await response.json();
    const source = Array.isArray(payload) ? payload : (payload.items || payload.articles || []);
    const items = source.slice(0, 12).map((item, index) => ({
      id: String(item.id || item.url || index), title: String(item.title || '').trim(),
      summary: String(item.summary || item.description || '').trim(), url: String(item.url || item.link || ''),
      image: String(item.image || item.imageUrl || ''), source: String(item.source?.name || item.source || 'Tieddr News'),
      publishedAt: item.publishedAt || item.published_at || item.date || ''
    })).filter(item => item.title && /^https?:\/\//i.test(item.url));
    return { ok: true, items, endpoint };
  } catch (error) {
    return { ok: false, items: [], endpoint, error: error?.name === 'AbortError' ? 'Tieddr News took too long to respond.' : 'Tieddr News is not available yet.' };
  }
});

ipcMain.handle('import-browser-data', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import browser data into Flowr', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Browser exports', extensions: ['html', 'htm', 'json', 'csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true, bookmarks: 0, passwords: 0 };
  let importedBookmarks = 0, importedPasswords = 0;
  let vaultRequired = false;
  const existing = bookmarksStore.get('bookmarks') || [];
  const byUrl = new Map(existing.map(item => [item.url, item]));
  const saveBookmarks = () => {
    const bookmarks = [...byUrl.values()];
    bookmarksStore.set('bookmarks', bookmarks);
    const folders = [...new Set(bookmarks.map(item => item.folder).filter(Boolean))];
    bookmarksStore.set('folders', folders);
    send('bookmarks-changed', bookmarks);
    send('bookmark-folders-changed', folders);
  };
  for (const filePath of result.filePaths) {
    const extension = path.extname(filePath).toLowerCase();
    let stat = null;
    try { stat = fs.statSync(filePath); } catch (_) { continue; }
    // 10 MB cap — import files are parsed fully in memory.
    if (!stat || !stat.isFile() || stat.size > 10 * 1024 * 1024) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if (extension === '.csv') {
      // Skip the file rather than returning early: the early return skipped the
      // bookmark write below entirely, so a locked vault silently discarded
      // every bookmark the user had already selected to import.
      if (!vault.isUnlocked()) { vaultRequired = true; continue; }
      for (const item of parsePasswordCsv(content)) {
        const saved = await vault.saveLogin({ origin: item.url, url: item.url, username: item.username, password: item.password, title: item.title });
        if (saved?.ok) importedPasswords++;
      }
    } else {
      let parsed = [];
      try { parsed = extension === '.json' ? parseChromiumBookmarks(content) : parseBookmarkHtml(content); } catch (_) {}
      for (const item of parsed) {
        if (!byUrl.has(item.url)) importedBookmarks++;
        byUrl.set(item.url, { ...item, source: 'imported', date: new Date().toISOString() });
      }
    }
  }
  saveBookmarks();
  if (importedPasswords) void vault.sync().catch(() => {});
  if (vaultRequired) {
    return {
      error: 'Unlock Tieddr Vault to import passwords. Your bookmarks were imported.',
      bookmarks: importedBookmarks, passwords: 0, requiresVault: true
    };
  }
  return { canceled: false, bookmarks: importedBookmarks, passwords: importedPasswords };
});

// Discover browsers already on the machine so first-run setup can offer a
// one-tap import instead of making the user hunt for a bookmarks file.
function chromiumBookmarkFiles() {
  const local = app.getPath('localAppData');
  const mac = app.getPath('userData');
  const roots = [
    ['Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
    ['Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
    ['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
    ['Vivaldi', path.join(local, 'Vivaldi', 'User Data')],
    ['Opera', path.join(local, 'Opera Software', 'Opera Stable')],
    ['Chromium', path.join(local, 'Chromium', 'User Data')],
    // macOS keeps every Chromium browser profile under ~/Library/Application Support.
    ['Google Chrome', path.join(mac, 'Google', 'Chrome')],
    ['Microsoft Edge', path.join(mac, 'Microsoft Edge')],
    ['Brave', path.join(mac, 'BraveSoftware', 'Brave-Browser')]
  ];
  const files = [];
  const seen = new Set();
  for (const [browser, root] of roots) {
    if (!fs.existsSync(root)) continue;
    let profiles = [];
    try { profiles = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^(Default|Profile \d+)$/.test(entry.name)); } catch (_) {}
    if (!profiles.length) profiles = [{ name: '' }];
    for (const profile of profiles) {
      const file = path.join(root, profile.name, 'Bookmarks');
      // readFileSync dedupes by real path, but an explicit guard keeps the
      // reported counts honest when two roots resolve to the same profile.
      if (seen.has(file) || !fs.existsSync(file)) continue;
      seen.add(file);
      files.push({ browser, profile: profile.name, file });
    }
  }
  return files;
}

// A cheap, read-only summary for the setup UI. Counts come from the file size
// rather than a full parse so this can run before the user commits to anything.
ipcMain.handle('detect-importable-browsers', () => {
  const files = chromiumBookmarkFiles();
  const byBrowser = new Map();
  for (const source of files) {
    let bytes = 0;
    let bookmarks = 0;
    try { bytes = fs.statSync(source.file).size; } catch (_) {}
    // A Bookmarks file is pretty-printed JSON with one URL per entry; counting
    // "url": occurrences is a good enough estimate for a setup prompt.
    try {
      const text = fs.readFileSync(source.file, 'utf8');
      bookmarks = (text.match(/"type"\s*:\s*"url"/g) || []).length;
    } catch (_) {}
    const key = `${source.browser}|${source.profile}`;
    if (!byBrowser.has(key)) byBrowser.set(key, { browser: source.browser, profile: source.profile, bytes, bookmarks });
    else byBrowser.get(key).bookmarks += bookmarks;
  }
  return [...byBrowser.values()];
});

ipcMain.handle('import-installed-browser-bookmarks', async () => {
  // Local bookmarks are local data — no Tieddr Account required. The gate here
  // meant a signed-out user could not move their bookmarks across at all.
  const sources = chromiumBookmarkFiles();
  if (!sources.length) return { ok: false, error: 'No Chrome, Edge, Brave, Vivaldi, Opera or Chromium bookmarks were found on this device.' };
  const existing = bookmarksStore.get('bookmarks') || [];
  const byUrl = new Map(existing.map(item => [item.url, item]));
  let imported = 0;
for (const source of sources) {
    let parsed = [];
    try {
      // These files live in another browser's profile directory and are read
      // fully into memory. Cap them the same way as a manual import.
      const stat = fs.statSync(source.file);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) continue;
      parsed = parseChromiumBookmarks(fs.readFileSync(source.file, 'utf8'));
    } catch (_) { continue; }
    for (const item of parsed) {
      if (!byUrl.has(item.url)) imported++;
      byUrl.set(item.url, { ...item, source: 'imported', importedFrom: source.browser, date: new Date().toISOString() });
    }
  }
  const bookmarks = [...byUrl.values()];
  bookmarksStore.set('bookmarks', bookmarks);
  bookmarksStore.set('folders', [...new Set(bookmarks.map(item => item.folder).filter(Boolean))]);
  send('bookmarks-changed', bookmarks);
  send('bookmark-folders-changed', bookmarksStore.get('folders') || []);
  return { ok: true, imported, sources: [...new Set(sources.map(item => item.browser))] };
});

ipcMain.handle('should-block-url', (_event, url) => {
  const level = safeBrowsingLevel();
  if (level !== 'off' && isDangerousUrl(url, level)) return true;
  return shouldBlockRequest({ url, resourceType: 'mainFrame' }, adBlockerEnabled, trackerBlockingEnabled);
});

ipcMain.handle('tieddr-sign-in', () => new Promise((resolve) => {
  if (authWin && !authWin.isDestroyed()) { authWin.focus(); return resolve(accountStore.get('account')); }

  const { verifier, challenge } = pkcePair();
  const state = randomState();

  authWin = new BrowserWindow({
    parent: mainWindow, width: 480, height: 660, resizable: false, minimizable: false, maximizable: false,
    title: 'Sign in to Tieddr', autoHideMenuBar: true, backgroundColor: '#ffffff',
    // Use the same persistent session as normal Flowr tabs. The successful
    // account.tieddr.com SSO cookie is then immediately available browser-wide
    // to Tieddr Account, Vault, Space, Mavis and other Tieddr web apps.
    webPreferences: { session: browsingSession, preload: path.join(__dirname, 'viewpreload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  authWin.webContents.__flowrSiteApp = true;
  siteAppWebContents.add(authWin.webContents.id);
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
  authWin.on('closed', () => { siteAppWebContents.delete(authWin.webContents.id); authWin = null; finish(() => resolve(accountStore.get('account'))); });
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
      return { ok: false, reason: 'reauthentication-required' };
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
    const targetSession = browsingSession || session.defaultSession;
    await targetSession.clearCache();
    await targetSession.clearStorageData({ storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'serviceworkers', 'websql'] });
  } catch (_) {}
  writeHistory([]);
  send('history-changed', []);
  return true;
});

// Cache-only clear (Settings → Data & Storage → "Clear cache") — keeps
// history, cookies, and site data intact.
ipcMain.handle('clear-cache', async () => {
  try { await (browsingSession || session.defaultSession).clearCache(); } catch (_) {}
  return true;
});

function dirSize(dirPath, depth = 0) {
  let total = 0;
  try {
    if (depth > 5) return 0;
    const stat = fs.statSync(dirPath);
    if (stat.isFile()) return stat.size;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      total += dirSize(path.join(dirPath, entry.name), depth + 1);
    }
  } catch (_) {}
  return total;
}

// Real storage usage for Settings → Data & Storage (bytes).
ipcMain.handle('get-storage-sizes', async () => {
  const userData = app.getPath('userData');
  const partition = INCOGNITO ? 'flow-incognito' : 'flow-main';
  const profileDir = path.join(userData, 'profiles', currentProfileId);
  const extensionsDir = dirSize(path.join(userData, 'extensions')) + dirSize(path.join(userData, 'flowr-extensions'));
  const localStorageDir = dirSize(path.join(userData, 'Partitions', partition, 'Local Storage')) +
    dirSize(path.join(userData, 'Partitions', partition, 'IndexedDB'));
  let cacheBytes = 0;
  try { cacheBytes = Number(await (browsingSession || session.defaultSession).getCacheSize()) || 0; } catch (_) {}
  return {
    browsing: dirSize(profileDir) + cacheBytes,
    extensions: extensionsDir,
    localStorage: localStorageDir,
    cache: cacheBytes
  };
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
  // Installed themes and the custom background are writable by the renderer but
  // are not SETTINGS_DEFAULTS, so "Restore defaults" used to leave both behind
  // while the UI promised the theme would return to default.
  settingsStore.set('installedThemes', []);
  settingsStore.set('customBackgroundUrl', '');
  settingsStore.set('siteApps', []);
  adBlockRulesStore.set('sites', {});
  adBlockSessionTotals.clear();
  sitePermissionsStore.set('sites', {});
  send('site-permissions-changed', []);
  trackerBlockingEnabled = true;
  adBlockerEnabled = true;
  invalidateHistoryCache();
  try { browsingSession && browsingSession.setUserAgent(currentUserAgent(), 'en-US,en;q=0.9'); } catch (_) {}
  return settingsStore.data;
});

ipcMain.on('window-control', (event, action) => {
  // isDestroyed, not just a truthy reference: the window can be gone while the
  // app lingers in the tray, and minimize() on a dead window throws.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === 'close') mainWindow.close();
});

ipcMain.handle('get-settings', () => settingsStore.data);

// Settings the renderer may not write directly: the download folder is only
// ever set from a native picker, and the news endpoint is operator-controlled.
const MAIN_PROCESS_ONLY_SETTINGS = new Set(['downloadPath', 'tieddrNewsEndpoint']);

// Enum-valued settings. A renderer-supplied value outside these sets is
// rejected outright — updateChannel in particular used to accept any string,
// which let a compromised renderer force allowPrerelease and assign junk to
// autoUpdater.channel.
const SETTING_ENUMS = {
  updateChannel: ['stable', 'beta', 'dev'],
  safeBrowsing: ['standard', 'enhanced', 'off'],
  historyRetention: ['forever', 'session', '30days', '90days', '7days'],
  theme: ['flow', 'graphite', 'aurora', 'linen'],
  accentColor: ['', 'blue', 'purple', 'teal', 'green', 'rose', 'orange', 'slate', '#3268e6', '#7a5fe0', '#0ea5a1', '#0e9d62', '#e04670', '#e67a32', '#64748b'],
  blurIntensity: ['light', 'medium', 'heavy'],
  tabWidth: ['compact', 'normal', 'wide'],
  tabFontSize: ['small', 'medium', 'large'],
  dnsOverHttps: ['off', 'automatic', 'strict'],
  searchEngine: ['google', 'duckduckgo', 'bing'],
  language: ['en'],
  uiFont: ['system', 'sans', 'serif', 'mono'],
  startup: ['start', 'blank', 'restore', 'custom'],
  newTab: ['start', 'blank'],
  newTabBehavior: ['start', 'blank'],
  newWindowBehavior: ['start', 'blank']
};

// Never accept an arbitrary string where an enum is expected, and coerce a
// renderer write to the type its default declares. This kills the whole class
// of "object where a string was expected" downstream bugs in one place.
function coerceSettingValue(key, value, defaultValue) {
  if (SETTING_ENUMS[key]) {
    return SETTING_ENUMS[key].includes(value) ? value : defaultValue;
  }
  if (key === 'debugPort') {
    const port = Number.parseInt(value, 10);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? String(port) : '9222';
  }
  if (key === 'customUserAgent' || key === 'autoClearSites' || key === 'requestBlockPatterns' || key === 'homePage') {
    return typeof value === 'string' ? value.slice(0, 8000) : defaultValue;
  }
  if (typeof defaultValue === 'boolean') {
    return typeof value === 'boolean' ? value : defaultValue;
  }
  if (typeof defaultValue === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : defaultValue;
  }
  if (Array.isArray(defaultValue)) {
    return Array.isArray(value) ? value.slice(0, 2000) : defaultValue;
  }
  if (typeof defaultValue === 'string') {
    return typeof value === 'string' ? value.slice(0, 8000) : defaultValue;
  }
  return value;
}

ipcMain.handle('update-settings', (event, patch) => {
  // Allow-list settings writes: the renderer must never be able to inject
  // arbitrary keys (e.g. tieddrNewsEndpoint for SSRF, downloadPath, etc.).
  //
  // downloadPath is deliberately absent: it is only ever set from
  // choose-download-path, i.e. from a native folder picker. Left writable, it
  // was both a local-file-write primitive (downloads were saved to whatever
  // the renderer asked for) and a way to widen the show-in-folder allow-list
  // to the whole disk.
  const ALLOWED = new Set([
    ...Object.keys(SETTINGS_DEFAULTS).filter(key => !MAIN_PROCESS_ONLY_SETTINGS.has(key)),
    'adBlocker', 'dnsOverHttps', 'tabDiscarding',
    'installedThemes', 'customBackgroundUrl',
    'performanceProfileVersion', 'siteApps'
  ]);

  const safePatch = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED.has(key)) continue;
    safePatch[key] = coerceSettingValue(key, value, SETTINGS_DEFAULTS[key]);
  }
  Object.entries(safePatch).forEach(([key, value]) => settingsStore.set(key, value));
  const patchKeys = safePatch;
  trackerBlockingEnabled = settingsStore.get('blockTrackers') !== false;
  adBlockerEnabled = settingsStore.get('adBlocker') !== false;
  // Live-apply the toggles that don't need a restart.
  try {
    const liveSession = browsingSession || session.defaultSession;
    if ('overrideUserAgent' in patchKeys || 'customUserAgent' in patchKeys) {
      liveSession.setUserAgent(currentUserAgent(), 'en-US,en;q=0.9');
    }
    if (('spellCheck' in patchKeys) && typeof liveSession.setSpellCheckerEnabled === 'function') {
      liveSession.setSpellCheckerEnabled(settingsStore.get('spellCheck') !== false);
    }
  } catch (_) {}
  if (('emulateMediaType' in patchKeys || 'networkThrottling' in patchKeys)) {
    for (const id of guestWebContents) {
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) applyDevEmulation(wc);
    }
  }
  if (('updateChannel' in patchKeys)) updateController.setChannel();
  if (('privateHistory' in patchKeys || 'historyRetention' in patchKeys || 'autoClearSites' in patchKeys)) {
    const current = readHistory();
    writeHistory(current);
    send('history-changed', settingsStore.get('historyLock') && !vault.isUnlocked() ? [] : current);
  }
  if ('historyLock' in patchKeys) {
    send('history-changed', settingsStore.get('historyLock') && !vault.isUnlocked() ? [] : readHistory());
  }
  return settingsStore.data;
});

// --- Flowr Store: themes -----------------------------------------------------
const FLOWR_STORE_HOST = 'flowr.tieddr.com';
const STORE_FETCH_TIMEOUT_MS = 8000;
const STORE_MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_THEME_IMAGES = 12;
const MAX_PACKAGE_FILES = 64;

// Only the first-party store may serve installable packages, and the *final*
// response URL is re-checked because fetch() follows redirects — otherwise a
// redirect off flowr.tieddr.com defeats the host check entirely.
function assertStoreUrl(candidate, base) {
  const parsed = base ? new URL(candidate, base) : new URL(candidate);
  if (parsed.protocol !== 'https:' || parsed.hostname !== FLOWR_STORE_HOST) {
    throw new Error('Only Flowr Store packages can be installed.');
  }
  return parsed;
}

async function fetchStoreAsset(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.href, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`${label} could not be downloaded.`);
    if (response.url) assertStoreUrl(response.url);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > STORE_MAX_ASSET_BYTES) throw new Error(`${label} is too large to install.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > STORE_MAX_ASSET_BYTES) throw new Error(`${label} is too large to install.`);
    return buffer;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} timed out.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStoreJson(url, label) {
  const buffer = await fetchStoreAsset(url, label);
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (_) { throw new Error(`${label} is not valid JSON.`); }
}

// Theme settings a package may set are validated by the same module the
// renderer and the packaging audit use, so the store can never publish a value
// the app would quietly drop.
const { sanitizeThemeSettings } = require('../shared/theme-settings');

// Only image files may be written into a theme folder. Deriving the extension
// from a remote URL let a package write background-1.html and have its file://
// URL handed straight to the renderer's CSS url().
const THEME_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

function themeImageExtension(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return THEME_IMAGE_EXT.has(ext) ? ext : '.png';
}

// Read-only metadata fetch so the renderer can show the user what is about to
// be installed — name, publisher and exactly which settings it will change —
// before any consent is given.
ipcMain.handle('flowr-package-info', async (_event, manifestUrl) => {
  try {
    const parsed = assertStoreUrl(manifestUrl);
    const manifest = await fetchStoreJson(parsed, 'The package');
    if (manifest.flowrThemeVersion !== 1) {
      if (manifest.flowrExtensionVersion !== 1) throw new Error('This is not a Flowr package.');
      const files = Array.isArray(manifest.files) ? manifest.files.slice(0, MAX_PACKAGE_FILES) : [];
      return {
        kind: 'extension',
        id: String(manifest.id || ''),
        name: String(manifest.name || 'Unnamed extension'),
        version: String(manifest.version || '1.0.0'),
        developer: String(manifest.developer || 'Unknown'),
        description: String(manifest.description || '').slice(0, 600),
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions.filter(p => typeof p === 'string').slice(0, 50) : [],
        hostPermissions: Array.isArray(manifest.hostPermissions) ? manifest.hostPermissions.filter(p => typeof p === 'string').slice(0, 50) : [],
        files: files.map(f => String(f.path || '')).slice(0, MAX_PACKAGE_FILES)
      };
    }
    const settings = manifest.settings && typeof manifest.settings === 'object' ? manifest.settings : {};
    const changedSettings = Object.keys(sanitizeThemeSettings(settings));
    return {
      kind: 'theme',
      id: String(manifest.id || ''),
      name: String(manifest.name || 'Unnamed theme'),
      version: String(manifest.version || '1.0.0'),
      developer: String(manifest.developer || 'Unknown'),
      description: String(manifest.description || '').slice(0, 600),
      images: Array.isArray(manifest.images) ? manifest.images.length : 0,
      changedSettings
    };
  } catch (error) {
    return { ok: false, error: error.message || 'The package could not be read.' };
  }
});

ipcMain.handle('install-flowr-theme', async (_event, manifestUrl) => {
  try {
    const parsed = assertStoreUrl(manifestUrl);
    const manifest = await fetchStoreJson(parsed, 'The theme package');
    if (manifest.flowrThemeVersion !== 1 || !manifest.id || !manifest.name ||
        !Array.isArray(manifest.images) || !manifest.images.length) {
      throw new Error('Theme package is invalid.');
    }
    if (manifest.images.length > MAX_THEME_IMAGES) throw new Error('Theme package has too many images.');

    const themeDir = resolvePackageDir(path.join(app.getPath('userData'), 'themes'), manifest.id);
    // Replace, don't merge — a re-install must not leave stale images behind.
    fs.rmSync(themeDir, { recursive: true, force: true });
    fs.mkdirSync(themeDir, { recursive: true });

    const savedImages = [];
    for (let i = 0; i < manifest.images.length; i++) {
      const imageUrl = assertStoreUrl(manifest.images[i], parsed.href);
      const bytes = await fetchStoreAsset(imageUrl, 'A theme image');
      const destination = path.join(themeDir, `background-${i + 1}${themeImageExtension(imageUrl.href)}`);
      fs.writeFileSync(destination, bytes);
      savedImages.push(destination);
    }

    const localImageUrls = savedImages.map(file => pathToFileURL(file).href);
    fs.writeFileSync(
      path.join(themeDir, 'manifest.json'),
      JSON.stringify({ ...manifest, installedAt: new Date().toISOString(), localImages: localImageUrls }, null, 2)
    );

    const installed = settingsStore.get('installedThemes') || [];
    settingsStore.set('installedThemes', [
      {
        id: String(manifest.id),
        name: String(manifest.name).slice(0, 120),
        version: String(manifest.version || '1.0.0'),
        developer: String(manifest.developer || 'Unknown').slice(0, 120),
        path: themeDir,
        images: localImageUrls
      },
      ...installed.filter(t => t.id !== manifest.id)
    ]);

    // Apply only the settings this package actually declares, each validated
    // against the shared theme schema.
    for (const [key, value] of Object.entries(sanitizeThemeSettings(manifest.settings))) {
      settingsStore.set(key, value);
    }
    settingsStore.set('customBackgroundUrl', localImageUrls[0]);
    return { ok: true, name: manifest.name, settings: settingsStore.data };
  } catch (error) {
    return { ok: false, error: error.message || 'Theme installation failed.' };
  }
});

// Removing a theme has to clean up the directory it owns, otherwise disk usage
// grows forever and "Restore defaults" leaves the images behind.
ipcMain.handle('uninstall-flowr-theme', (_event, themeId) => {
  try {
    const id = String(themeId || '');
    const installed = settingsStore.get('installedThemes') || [];
    const target = installed.find(t => t.id === id);
    if (!target) return { ok: false, error: 'That theme is not installed.' };
    if (typeof target.path === 'string' && target.path) {
      const themesRoot = path.resolve(path.join(app.getPath('userData'), 'themes'));
      const resolved = path.resolve(target.path);
      if (isInside(themesRoot, resolved)) fs.rmSync(resolved, { recursive: true, force: true });
    }
    const next = installed.filter(t => t.id !== id);
    settingsStore.set('installedThemes', next);
    const remaining = next.flatMap(t => t.images || []);
    if (!remaining.includes(settingsStore.get('customBackgroundUrl'))) {
      settingsStore.set('customBackgroundUrl', remaining[0] || '');
    }
    return { ok: true, settings: settingsStore.data };
  } catch (error) {
    return { ok: false, error: error.message || 'The theme could not be removed.' };
  }
});

ipcMain.handle('install-flowr-extension', async (_event, packageUrl) => {
  try {
    if (!extensionsSupported()) throw new Error('Extensions are unavailable in this window.');
    const parsed = assertStoreUrl(packageUrl);
    const pkg = await fetchStoreJson(parsed, 'The extension package');
    if (pkg.flowrExtensionVersion !== 1 || !pkg.id || !pkg.name ||
        !Array.isArray(pkg.files) || !pkg.files.length) {
      throw new Error('Extension package is invalid.');
    }
    if (pkg.files.length > MAX_PACKAGE_FILES) throw new Error('Extension package has too many files.');

    const extensionDir = resolvePackageDir(path.join(app.getPath('userData'), 'flowr-extensions'), pkg.id);
    fs.rmSync(extensionDir, { recursive: true, force: true });
    fs.mkdirSync(extensionDir, { recursive: true });
    for (const entry of pkg.files) {
      const relative = safeRelativePath(entry && entry.path);
      const assetUrl = assertStoreUrl(entry && entry.url, parsed.href);
      const bytes = await fetchStoreAsset(assetUrl, relative);
      const destination = resolveInside(extensionDir, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
    if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('Extension manifest is missing.');

    const loadedExtension = await loadExtension(extensionDir, { allowFileAccess: false });
    const extensions = extensionsStore.get('extensions') || [];
    const record = {
      id: loadedExtension.id,
      packageId: String(pkg.id),
      name: loadedExtension.name || String(pkg.name).slice(0, 120),
      version: loadedExtension.version || String(pkg.version || '1.0.0'),
      developer: String(pkg.developer || 'Unknown').slice(0, 120),
      path: extensionDir,
      source: 'store',
      enabled: true,
      error: null,
      date: new Date().toISOString()
    };
    const next = [record, ...extensions.filter(item => item.id !== record.id && item.packageId !== record.packageId)];
    extensionsStore.set('extensions', next);
    notifyExtensionsChanged();
    return { ok: true, name: record.name, extensions: next, actions: extActions() };
  } catch (error) {
    return { ok: false, error: error.message || 'Extension installation failed.' };
  }
});

const MAX_BOOKMARKS = 20000;

ipcMain.handle('get-bookmarks', () => bookmarksStore.get('bookmarks') || []);

ipcMain.handle('add-bookmark', (event, bookmark) => {
  // A non-object payload used to throw a TypeError inside the handler, which
  // surfaced as an unhandled rejection rather than a clean failure.
  if (!bookmark || typeof bookmark !== 'object') return bookmarksStore.get('bookmarks') || [];
  const url = String(bookmark.url || '');
  if (!url || url.length > 4096) return bookmarksStore.get('bookmarks') || [];
  const bookmarks = bookmarksStore.get('bookmarks') || [];
  if (bookmarks.length >= MAX_BOOKMARKS && !bookmarks.some(item => item.url === url)) return bookmarks;
  const next = [{
    ...bookmark,
    url,
    title: String(bookmark.title || '').slice(0, 512),
    folder: String(bookmark.folder || '').slice(0, 200),
    date: new Date().toISOString()
  }, ...bookmarks.filter((item) => item.url !== url)].slice(0, MAX_BOOKMARKS);
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

ipcMain.handle('get-history', () => {
  if (settingsStore.get('historyLock') && !vault.isUnlocked()) return [];
  return readHistory();
});

ipcMain.handle('clear-history', () => {
  writeHistory([]);
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
  if (!filePath || typeof filePath !== 'string') return;
  // Constrain to files inside known safe roots (downloads dir / userData).
  try {
    const resolved = path.resolve(filePath);
    const roots = [app.getPath('downloads'), app.getPath('userData'), settingsStore.get('downloadPath')].filter(Boolean).map(r => path.resolve(String(r)));
    if (!roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) return;
    if (!fs.existsSync(resolved)) return;
    shell.showItemInFolder(resolved);
  } catch (_) {}
});

ipcMain.handle('get-profiles', () => profilesStore.get('profiles') || []);

ipcMain.handle('get-active-profile', () => currentProfileId);

ipcMain.handle('create-profile', (event, name) => {
  const profiles = profilesStore.get('profiles') || [];
  const clean = String(name || '').trim().slice(0, 60) || 'Profile';
  // Date.now() collides when two profiles are created in the same millisecond,
  // which merged their per-profile stores. A counter + timestamp never does.
  let id = `${Date.now().toString(36)}-${(profiles.length + 1).toString(36)}`;
  while (profiles.some(p => p.id === id)) id = `${id}x`;
  const newProfile = { id, name: clean };
  const next = [...profiles, newProfile];
  profilesStore.set('profiles', next);
  return next;
});

ipcMain.handle('switch-profile', (event, profileId) => {
  const profiles = profilesStore.get('profiles') || [];
  if (!profiles.find((profile) => profile.id === profileId)) return false;
  // initStores swaps the per-profile Store objects. Anything still sitting in
  // their debounce timers at that moment was never written, so force it out
  // first — otherwise switching profiles silently lost the last few bookmarks,
  // passwords and history entries of the profile being left.
  flushAllStores();
  vault.lock();
  currentProfileId = profileId;
  profilesStore.set('activeProfileId', profileId);
  initStores(profileId);
  invalidateHistoryCache();
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

// A Chrome extension's manifest is the only description of what it will do.
// Surface it at install time so the user can see the permissions and hosts
// before anything is loaded.
async function readExtensionManifest(folderPath) {
  try {
    const raw = fs.readFileSync(path.join(folderPath, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    const strings = value => (Array.isArray(value) ? value.filter(p => typeof p === 'string') : []);
    return {
      name: String(manifest.name || path.basename(folderPath)).slice(0, 120),
      version: String(manifest.version || ''),
      manifestVersion: manifest.manifest_version || null,
      permissions: strings(manifest.permissions).slice(0, 50),
      hostPermissions: strings(manifest.host_permissions).slice(0, 50),
      contentScripts: Array.isArray(manifest.content_scripts) ? manifest.content_scripts.length : 0
    };
  } catch (_) {
    return null;
  }
}

ipcMain.handle('inspect-extension-folder', async () => {
  if (!extensionsSupported()) return { ok: false, error: 'Extensions are unavailable in this window.' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose unpacked Chrome extension folder',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const folderPath = result.filePaths[0];
  const manifest = await readExtensionManifest(folderPath);
  if (!manifest) return { ok: false, error: 'That folder has no readable manifest.json.' };
  return { ok: true, path: folderPath, manifest };
});

ipcMain.handle('install-unpacked-extension', async (_event, folderPath) => {
  try {
    if (!extensionsSupported()) throw new Error('Extensions are unavailable in this window.');
    let folder = typeof folderPath === 'string' ? folderPath : '';
    if (!folder) {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose unpacked Chrome extension folder',
        properties: ['openDirectory']
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      folder = picked.filePaths[0];
    }
    const resolved = path.resolve(folder);
    if (!fs.existsSync(path.join(resolved, 'manifest.json'))) throw new Error('That folder has no manifest.json.');

    // Only unpacked (developer) extensions get file:// access — they are an
    // explicit local choice. Everything downloaded gets none.
    const loadedExtension = await loadExtension(resolved, { allowFileAccess: true });
    const extensions = extensionsStore.get('extensions') || [];
    const record = {
      id: loadedExtension.id,
      name: loadedExtension.name || path.basename(resolved),
      version: loadedExtension.version || '',
      path: resolved,
      source: 'unpacked',
      enabled: true,
      error: null,
      date: new Date().toISOString()
    };
    const next = [record, ...extensions.filter((item) => item.id !== record.id && item.path !== resolved)];
    extensionsStore.set('extensions', next);
    notifyExtensionsChanged();
    return { ok: true, name: record.name, extensions: next, actions: extActions() };
  } catch (error) {
    return { ok: false, error: error.message || 'The extension could not be installed.' };
  }
});

// Chrome Web Store install: given a store URL or bare ID, download the CRX,
// unpack it, load it, and persist a record — no manual folder picking.
ipcMain.handle('install-store-extension', async (event, idOrUrl) => {
  const storeId = parseExtensionId(idOrUrl);
  if (!storeId) {
    return { ok: false, error: "That doesn't look like a Chrome Web Store link or extension ID." };
  }
  if (!extensionsSupported()) return { ok: false, error: 'Extensions are unavailable in this window.' };

  try {
    const info = await installStoreExtension(idOrUrl, extensionSession(), app.getPath('userData'));
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
    notifyExtensionsChanged();
    return { ok: true, name: info.name, extensions: next, actions: extActions() };
  } catch (error) {
    return { ok: false, error: error.message || 'The extension could not be installed.' };
  }
});

ipcMain.handle('remove-extension', async (event, extensionId) => {
  removeLoadedExtension(extensionId);
  const stored = extensionsStore.get('extensions') || [];
  const target = stored.find((item) => item.id === extensionId);
  // Delete the files Flowr itself unpacked. An unpacked developer folder belongs
  // to the user, so it is left alone — but a store/Flowr-store download is ours.
  if (target && typeof target.path === 'string' && target.source !== 'unpacked') {
    const managed = [
      path.resolve(path.join(app.getPath('userData'), 'flowr-extensions')),
      path.resolve(path.join(app.getPath('userData'), 'Extensions')),
      path.resolve(path.join(app.getPath('userData'), 'extensions'))
    ];
    const resolved = path.resolve(target.path);
    if (managed.some(root => isInside(root, resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); } catch (_) {}
    }
  }
  const next = stored.filter((item) => item.id !== extensionId);
  extensionsStore.set('extensions', next);
  notifyExtensionsChanged();
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

// Only real image bytes leave the disk, and only from inside the extension's
// own directory. iconPath comes from the extension's own manifest, so a
// "../../../../secrets" default_icon would otherwise be read and returned to
// the renderer as a data: URL.
const EXT_ICON_MIME = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['svg', 'image/svg+xml'], ['ico', 'image/x-icon']
]);

function extIconDataUrl(extPath, iconPath) {
  try {
    if (typeof extPath !== 'string' || typeof iconPath !== 'string' || !iconPath) return null;
    const root = path.resolve(extPath.replace(/^file:\/\//, ''));
    const relative = safeRelativePath(iconPath);
    const full = resolveInside(root, relative);
    const mime = EXT_ICON_MIME.get(path.extname(relative).toLowerCase().replace('.', ''));
    if (!mime) return null;
    const buf = fs.readFileSync(full);
    if (buf.length > 1024 * 1024) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function extActions() {
  const stored = extensionsStore.get('extensions') || [];
  const byId = new Map(stored.map(e => [e.id, e]));
  return allLoadedExtensions().map(ext => {
    const m = ext.manifest || {};
    const action = m.action || m.browser_action || {};
    const iconPath = pickIcon(action.default_icon) || pickIcon(m.icons);
    const record = byId.get(ext.id);
    const dataUrl = iconPath && record ? extIconDataUrl(record.path, iconPath) : null;
    // ext.url already ends in '/', but never rely on an upstream detail for a
    // URL join — a missing separator produced "chrome-extension://idpopup.html".
    const rel = p => (typeof p === 'string' && p ? new URL(p.replace(/^\/+/, ''), ext.url).href : null);
    const opt = (m.options_ui && m.options_ui.page) || m.options_page;
    // Side panel support — Chrome extensions declare side_panel in manifest v3
    const sidePanel = m.side_panel && m.side_panel.default_path
      ? rel(m.side_panel.default_path)
      : (m.side_panel && typeof m.side_panel === 'string' ? rel(m.side_panel) : null);
    return {
      id: ext.id,
      name: ext.name || (record && record.name) || 'Extension',
      version: ext.version || (m.version || ''),
      developer: (record && record.developer) || '',
      // `enabled` is not derivable from a loaded extension — a disabled one is
      // absent from getAllExtensions(). Carry it from the store so the toolbar
      // toggle reflects reality instead of always rendering "off".
      enabled: record ? record.enabled !== false : true,
      pinned: record ? !!record.pinned : false,
      iconUrl: dataUrl || rel(iconPath),
      popup: rel(action.default_popup),
      options: rel(opt),
      sidePanel
    };
  });
}

// A chrome-extension:// page is only legitimate if that extension is installed.
// Check against the live session, not just the protocol.
function isInstalledExtensionUrl(candidate) {
  let target;
  try { target = new URL(candidate); } catch (_) { return false; }
  if (target.protocol !== 'chrome-extension:') return false;
  return allLoadedExtensions().some(ext => target.host === ext.id);
}

ipcMain.on('open-extension-options', (event, url) => {
  if (!isInstalledExtensionUrl(url)) return;
  send('request-new-tab', url);
});

ipcMain.handle('get-extension-actions', () => extActions());

ipcMain.handle('pin-extension', (event, id, pinned) => {
  const stored = extensionsStore.get('extensions') || [];
  const target = stored.find(e => e.id === id);
  // Never invent a record for an unknown id — a bare { id, pinned } stub
  // rendered forever as a nameless card on the Extensions page.
  if (!target) return extActions();
  target.pinned = !!pinned;
  extensionsStore.set('extensions', stored);
  return extActions();
});

// Open an extension's popup in an auto-sized frameless window below its button.
ipcMain.on('open-extension-popup', (event, { popup, x, y } = {}) => {
  if (typeof popup !== 'string' || !popup || !mainWindow) return;
  if (!isInstalledExtensionUrl(popup)) return;
  if (extPopupWin && !extPopupWin.isDestroyed()) extPopupWin.destroy();
  // Capture the window in a local: the did-finish-load handler used to read the
  // module-level global, so popup A's load could resize and show popup B.
  const popupWindow = new BrowserWindow({
    parent: mainWindow, frame: false, resizable: false, skipTaskbar: true, show: false,
    width: 360, height: 480, backgroundColor: '#ffffff',
    webPreferences: { session: browsingSession, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  extPopupWin = popupWindow;
  popupWindow.setMenu(null);
  const b = mainWindow.getBounds();
  popupWindow.setPosition(Math.round(b.x + Math.min(Math.max(8, (x || 0) - 180), b.width - 368)), Math.round(b.y + (y || 92) + 4));
  popupWindow.loadURL(popup).catch(() => {});
  popupWindow.webContents.on('did-finish-load', async () => {
    if (popupWindow.isDestroyed()) return;
    try {
      const w = await popupWindow.webContents.executeJavaScript('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth||0)');
      const h = await popupWindow.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight||0)');
      if (popupWindow.isDestroyed()) return;
      popupWindow.setContentSize(Math.min(760, Math.max(240, Math.ceil(w) || 360)), Math.min(600, Math.max(80, Math.ceil(h) || 400)));
    } catch (_) {}
    if (!popupWindow.isDestroyed()) popupWindow.show();
  });
  popupWindow.on('blur', () => { if (!popupWindow.isDestroyed()) popupWindow.destroy(); });
  popupWindow.on('closed', () => { if (extPopupWin === popupWindow) extPopupWin = null; });
});

ipcMain.handle('toggle-extension', async (event, extensionId, enabled) => {
  const extensions = extensionsStore.get('extensions') || [];
  const target = extensions.find((item) => item.id === extensionId);
  if (!target) return extActions();
  const nextEnabled = enabled !== false;

  try {
    if (nextEnabled) {
      const loadedExtension = await loadExtension(target.path, {
        allowFileAccess: target.source === 'unpacked'
      });
      target.id = loadedExtension.id;
      target.name = loadedExtension.name || target.name;
      target.version = loadedExtension.version || target.version;
      target.error = null;
    } else {
      removeLoadedExtension(extensionId);
    }
    target.enabled = nextEnabled;
  } catch (error) {
    target.enabled = false;
    target.error = error.message;
  }

  extensionsStore.set('extensions', extensions);
  notifyExtensionsChanged();
  // Return the action list, not the raw store records: the toolbar dropdown
  // assigns this straight to its action state, and the two shapes differ.
  return extActions();
});

// --- Side Panel Extension Support ---------------------------------------------
// The side panel is rendered by the renderer as a docked <webview> (see App.js),
// so the main process only needs to forward open/close intents. The renderer
// owns the webview element and its geometry relative to the page area.
ipcMain.on('open-extension-side-panel', (event, { extId, url, width } = {}) => {
  // Protocol-only validation let a compromised renderer point the side-panel
  // webview at any chrome-extension:// page, installed or not.
  if (!isInstalledExtensionUrl(url)) return;
  send('side-panel-opened', { extId, url, width: width || 400 });
});

ipcMain.on('close-side-panel', () => {
  send('side-panel-closed');
});
