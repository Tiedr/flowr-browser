const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'preload.js'), 'utf8');
const viewpreloadSrc = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'viewpreload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'App.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'index.html'), 'utf8');

// Find the body of a specific ipcMain handler rather than the first mention of
// its channel name anywhere in the file — an allow-list mention earlier in the
// source used to shift the window these assertions look at.
function handlerBody(channel, span = 1400) {
  const anchor = `ipcMain.handle('${channel}'`;
  const start = mainSource.indexOf(anchor);
  assert.ok(start >= 0, `${channel} handler must exist`);
  return mainSource.slice(start, start + span);
}

(async () => {
  // --- Credential origin matching fails closed --------------------------------
  const V = require('../src/main/vault/vault.js');
  const saved = (url, title = '') => ({ url, title });
  assert.ok(V.itemMatchesHost(saved('https://example.com/login'), 'example.com'), 'exact host matches');
  assert.ok(V.itemMatchesHost(saved('https://example.com'), 'login.example.com'), 'page subdomain of saved host matches');
  assert.ok(!V.itemMatchesHost(saved('https://login.example.com'), 'example.com'), 'saved subdomain never fills its parent');
  assert.ok(!V.itemMatchesHost(saved('https://example.com'), 'example.com.evil.com'), 'suffix lookalike rejected');
  assert.ok(!V.itemMatchesHost(saved('https://example.com'), 'evil-example.com'), 'sibling lookalike rejected');
  assert.ok(!V.itemMatchesHost(saved('https://example.com'), 'example.org'), 'different TLD rejected');
  assert.ok(!V.itemMatchesHost(saved('', 'Example Bank'), 'example.com'), 'title-only items never match (no fuzzy fallback)');
  assert.ok(!V.itemMatchesHost(saved('https://example.com'), ''), 'empty page host never matches');
  assert.ok(!V.itemMatchesHost(saved('not a url'), 'example.com'), 'unparseable item URL never matches');

  // --- Reader Mode strips active content before re-inserting HTML -------------
  const readerStart = mainSource.indexOf('const READER_JS');
  assert.ok(readerStart >= 0, 'READER_JS must exist');
  const readerSrc = mainSource.slice(readerStart, mainSource.indexOf('}`;', readerStart));
  assert.match(readerSrc, /indexOf\('on'\)===0/, 'inline event-handler attributes stripped');
  assert.match(readerSrc, /javascript\|data\|vbscript/, 'dangerous URL schemes stripped');
  assert.match(readerSrc, /object,embed,applet/, 'plugin elements removed');

  // --- Privileged IPC resolves renderer-supplied ids as guests only -----------
  assert.match(mainSource, /function guestWebContentsFromId\(id\)/, 'guest-only resolver exists');
  assert.match(mainSource, /typeof id !== 'number' \|\| !guestWebContents\.has\(id\)/, 'unregistered ids rejected');
  for (const h of ["view-command", "create-print-preview", "capture-webview-preview", "print-page", "set-webview-active"]) {
    const s = mainSource.indexOf(`'${h}'`);
    assert.ok(s >= 0, `${h} handler must exist`);
    assert.match(mainSource.slice(s, s + 400), /guestWebContentsFromId/, `${h} resolves guests only`);
  }
  const mavisStart = mainSource.indexOf("'mavis-chat'");
  assert.match(mainSource.slice(mavisStart, mavisStart + 1200), /guestWebContentsFromId/, 'mavis page-text reads are guest-only');
  assert.match(mainSource.slice(mavisStart, mavisStart + 600), /\.slice\(0, 4000\)/, 'mavis input bounded');
  assert.match(mainSource, /copyText.*length <= 100000/, 'clipboard writes bounded');

  // --- Credential IPC: guests only, sender origin cross-checked --------------
  assert.match(handlerBody('pw-get-for-origin'), /guestWebContents\.has\(sender\.id\)/, 'autofill serves guests only');
  assert.match(handlerBody('pw-get-for-origin'), /senderFrame/, 'claimed origin cross-checked against sender frame');
  const pwCapStart = mainSource.indexOf("ipcMain.on('pw-captured'");
  assert.match(mainSource.slice(pwCapStart, pwCapStart + 900), /\^https:\\\/\\\//, 'captures require an https origin');

  // --- Page-side: credentials never move over plain http ----------------------
  assert.match(viewpreloadSrc, /credentialOriginAllowed/, 'origin gate exists in viewpreload');
  assert.match(viewpreloadSrc, /location\.protocol === 'https:'/, 'https allowed');
  assert.match(viewpreloadSrc, /localhost/, 'localhost exception for development');

  // --- Download ids are monotonic, not millisecond timestamps -----------------
  assert.match(mainSource, /downloadSeq\+\+/, 'download ids come from a sequence');
  assert.doesNotMatch(mainSource, /const downloadId = Date\.now\(\)/, 'Date.now() collision source removed');

  // ==== App-chrome hardening =================================================

  // A CSP on the privileged document. webviewTag is on, and Electron exposes
  // nodeintegration / disablewebsecurity as settable <webview> attributes, so
  // without this one injected script in the chrome is full RCE.
  assert.match(htmlSource, /http-equiv="Content-Security-Policy"/, 'app chrome ships a CSP');
  assert.match(htmlSource, /script-src 'self'/, 'no inline or remote script in the chrome');
  assert.match(htmlSource, /object-src 'none'/, 'plugins blocked in the chrome');
  assert.match(htmlSource, /base-uri 'none'/, 'base-href hijack blocked in the chrome');
  assert.equal(appSource.includes('dangerouslySetInnerHTML'), false, 'no innerHTML sink in the renderer');

  // --- One trusted caller: the app chrome. Guests get a minimal allow-list. ---
  assert.match(mainSource, /const GUEST_INVOKE_ALLOWED = new Set\(\['pw-get-for-origin', 'wallet-cards-for-fill', 'wallet-fill', 'adblock-rules'\]\)/,
    'guest invoke allow-list is limited to autofill, wallet fill and ad rules');
  assert.match(mainSource, /const GUEST_ON_ALLOWED = new Set\(\['pw-captured', 'adblock-report'\]\)/, 'guest send allow-list is limited to password capture and ad reports');
  assert.match(mainSource, /ipcMain\.handle = \(channel, listener\)/, 'every handler inherits the sender check');
  assert.match(mainSource, /ipcMain\.on = \(channel, listener\)/, 'every listener inherits the sender check');
  assert.match(mainSource, /ipcMain\.onSync = \(channel, listener\)/, 'synchronous handlers inherit the sender check too');
  assert.match(mainSource, /ipcMain\.onSync\('privacy-web-preferences'/, 'the page preload reads privacy switches through the guarded path');
  assert.match(mainSource, /const GUEST_SYNC_ALLOWED = new Set\(\['privacy-web-preferences'\]\)/, 'exactly one sync channel is guest-reachable');
  assert.match(mainSource, /Blocked IPC invoke from untrusted sender/, 'blocked invokes fail loudly');
  // Chrome-only capabilities must never appear in a guest allow-list. These are
  // the ones that hand out credentials, tokens or destructive power.
  for (const secret of ['get-account', 'vault-reveal', 'vault-copy', 'vault-list', 'vault-add', 'vault-delete',
    'vault-sync', 'pw-list', 'pw-reveal', 'pw-copy', 'pw-save', 'pw-delete', 'clear-browsing-data',
    'reset-settings', 'update-settings', 'install-flowr-theme', 'install-flowr-extension',
    'install-unpacked-extension', 'remove-extension', 'toggle-extension']) {
    assert.ok(preloadSource.includes(`'${secret}'`), `${secret} exists as a channel`);
    assert.equal(
      new RegExp(`GUEST_(?:INVOKE|ON)_ALLOWED[^\\n]*'${secret}'`).test(mainSource),
      false,
      `${secret} must not be reachable from a page guest`
    );
  }
  // wallet-fill is deliberately guest-reachable (autofill at checkout) but only
  // ever returns a card for an explicit user pick, never as a bulk list.
  assert.match(mainSource, /const GUEST_INVOKE_ALLOWED = new Set\(\['pw-get-for-origin', 'wallet-cards-for-fill', 'wallet-fill', 'adblock-rules'\]\)/,
    'wallet-fill is the only card-handling channel exposed to a guest');

  // --- Guests cannot register a non-guest as a privileged target -------------
  const regStart = mainSource.indexOf("ipcMain.on('register-webview'");
  assert.match(mainSource.slice(regStart, regStart + 700), /wc\.getType\(\) !== 'webview'/, 'register-webview accepts webviews only');

  // --- One instance owns the userData directory ------------------------------
  assert.match(mainSource, /app\.requestSingleInstanceLock\(\)/, 'single-instance lock claimed');
  assert.match(mainSource, /app\.on\('second-instance'/, 'a second launch is forwarded, not raced');
  assert.match(mainSource, /FLOW_CHILD === '1'/, 'deliberate child windows are exempt');

  // --- Session-wide permission policy ---------------------------------------
  assert.match(mainSource, /applyPermissionPolicy\(ses, \{ allowBrowsingWebContent: false \}\)/,
    'the privileged defaultSession denies web content permissions');
  assert.match(mainSource, /'clipboard-sanitized-write'/, 'the real clipboard permission name is allowed');
  assert.doesNotMatch(mainSource, /'clipboardWrite'/, 'Chrome extension names are not used as web permissions');
  assert.match(mainSource, /ses\.setDevicePermissionHandler\(\(\) => false\)/, 'HID/USB/serial pickers denied');

  // --- Global webContents policy --------------------------------------------
  assert.match(mainSource, /app\.on\('web-contents-created'/, 'every window gets the same policy');
  assert.match(mainSource, /'will-attach-webview'/, 'webview attributes are locked down before attach');
  assert.match(mainSource, /webPreferences\.nodeIntegration = false/, 'guest node integration forced off');
  assert.match(mainSource, /webPreferences\.sandbox = true/, 'guests forced into a sandbox');
  assert.match(mainSource, /webPreferences\.webSecurity = true/, 'guest web security forced on');
  assert.match(mainSource, /webPreferences\.preload = path\.join\(__dirname, 'viewpreload\.js'\)/, 'guest preload is pinned to our own file');

  // --- Renderer-writable settings are validated ------------------------------
  assert.match(mainSource, /MAIN_PROCESS_ONLY_SETTINGS = new Set\(\['downloadPath', 'tieddrNewsEndpoint'\]\)/,
    'filesystem paths and operator endpoints are not renderer-writable');
  assert.match(mainSource, /function coerceSettingValue\(/, 'settings values are coerced to their declared type');
  assert.match(mainSource, /updateChannel: \['stable', 'beta', 'dev'\]/, 'update channel is an allow-list');
  assert.match(handlerBody('open-external', 700), /new URL\(String\(url/, 'open-external parses rather than regex-tests');

  // --- Package install path safety ------------------------------------------
  const paths = require('../src/main/paths.js');
  const os = require('node:os');
  const root = os.tmpdir();
  for (const bad of ['..', '.', '../evil', 'a/b', '', '   ', 'a'.repeat(80), '/abs', 'C:\\win', null, undefined]) {
    assert.throws(() => paths.resolvePackageDir(root, bad), `package id ${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(paths.resolvePackageDir(root, 'flowr-atlas'), path.resolve(root, 'flowr-atlas'));
  assert.throws(() => paths.resolveInside(root, '../../etc/passwd'), 'traversal in a package file path must be rejected');
  assert.throws(() => paths.resolveInside(root, 'a/../../b'), 'embedded traversal must be rejected');
  assert.throws(() => paths.resolveInside(root, 'C:/Windows/system.ini'), 'absolute windows path must be rejected');
  assert.equal(paths.resolveInside(root, 'popup.html'), path.resolve(root, 'popup.html'));
  assert.equal(paths.resolveInside(root, 'assets\\icon.png'), path.resolve(root, 'assets/icon.png'), 'backslashes normalise');
  assert.ok(paths.isInside(root, path.join(root, 'child')), 'child is inside');
  assert.equal(paths.isInside(root, path.resolve(root, '..', 'sibling')), false, 'sibling is not inside');
  // The installers must route ids through the validator, not a character-class
  // rewrite that keeps '.' and therefore lets ".." escape.
  assert.doesNotMatch(mainSource, /replace\(\/\[\^a-z0-9\._-\]\/gi, '-'\)/, 'no dot-preserving id sanitiser remains');
  assert.match(mainSource, /resolvePackageDir\(path\.join\(app\.getPath\('userData'\), 'themes'\)/, 'theme dir resolved through the validator');
  assert.match(mainSource, /resolvePackageDir\(path\.join\(app\.getPath\('userData'\), 'flowr-extensions'\)/, 'extension dir resolved through the validator');

  // --- Installing a package requires consent ---------------------------------
  assert.match(mainSource, /ipcMain\.handle\('flowr-package-info'/, 'package metadata is readable before install');
  assert.match(appSource, /requestPackageInstall/, 'the install deep link goes through a consent flow');
  assert.match(appSource, /confirmDialog\(\{/, 'consent is an explicit decision');
  assert.doesNotMatch(appSource, /installTheme: async \(manifest/, 'no unconditional install on navigation');

  // --- Store fetches are host-pinned after redirects ------------------------
  assert.match(mainSource, /function assertStoreUrl\(/, 'store assets are host-checked');
  assert.match(mainSource, /if \(response\.url\) assertStoreUrl\(response\.url\)/, 'the final URL is re-checked after redirects');
  assert.match(mainSource, /STORE_FETCH_TIMEOUT_MS/, 'store fetches time out');
  assert.match(mainSource, /STORE_MAX_ASSET_BYTES/, 'store fetches are size-capped');

  // ==== Extensions ===========================================================

  // Extensions must load into the session the webviews actually render in.
  assert.match(mainSource, /function extensionSession\(\)\s*\{\s*return browsingSession \|\| session\.defaultSession;/,
    'extensions load into the browsing session');
  assert.doesNotMatch(mainSource, /session\.defaultSession\.loadExtension/, 'nothing loads into defaultSession any more');
  assert.doesNotMatch(mainSource, /session\.defaultSession\.removeExtension/, 'nothing removes from defaultSession any more');
  assert.match(mainSource, /function allLoadedExtensions\(\)/, 'installed extensions are read from the same session');
  assert.equal(
    (mainSource.match(/allowFileAccess: true/g) || []).length,
    1,
    'file access is requested only where a developer chose an unpacked folder'
  );

  // The toolbar model must carry `enabled`, or every toggle renders as off.
  assert.match(mainSource, /enabled: record \? record\.enabled !== false : true/, 'actions carry the enabled flag');
  const toggleAt = mainSource.indexOf("ipcMain.handle('toggle-extension'");
  const toggleBody = mainSource.slice(toggleAt, toggleAt + 1200);
  assert.match(toggleBody, /return extActions\(\);/, 'toggle-extension returns actions, not store records');
  assert.doesNotMatch(toggleBody, /return extensions;/, 'toggle-extension never returns raw store records');

  // No arbitrary local-file read through an extension manifest.
  assert.match(mainSource, /function isInstalledExtensionUrl\(/, 'chrome-extension URLs are validated against installed extensions');
  const sidePanelAt = mainSource.indexOf("ipcMain.on('open-extension-side-panel'");
  assert.match(mainSource.slice(sidePanelAt, sidePanelAt + 400), /isInstalledExtensionUrl\(url\)/, 'side panel validates the extension');
  assert.match(mainSource, /function extIconDataUrl/, 'icon reads go through a checked helper');
  assert.match(mainSource, /const full = resolveInside\(root, relative\)/, 'extension icons are containment-checked');
  assert.doesNotMatch(mainSource, /path\.join\(extPath\.replace\(\/\^file/, 'no unchecked icon path join');

  // ==== Performance / leaks =================================================

  // Re-registering a guest on every dom-ready used to stack before-input-event
  // handlers, so one Ctrl+T opened N tabs.
  assert.match(mainSource, /__flowrShortcutsWired/, 'per-guest shortcut wiring is idempotent');
  assert.match(mainSource, /let downloadTrackingAttached = false/, 'download tracking registers once');
  assert.match(mainSource, /if \(compiledBlockSource === source|compiledBlockSource = source/, 'request-block regexes are compiled per settings value, not per request');
  assert.match(mainSource, /let historyCache = null/, 'history is decoded once, not per navigation event');
  assert.match(mainSource, /historyFlushTimer = setTimeout/, 'history writes are coalesced');
  assert.match(mainSource, /flushHistoryNow\(\);[\s\S]*?flush\(\)/, 'flushAllStores forces pending history out');
  assert.match(mainSource, /ipcMain\.handle\('switch-profile'[\s\S]{0,600}?flushAllStores\(\)/, 'profile switch flushes the old profile first');

  console.log('Flowr app-chrome hardening, guest isolation + credential-flow regression checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });