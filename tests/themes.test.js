const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repoRoot = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'utils.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'App.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'main.js'), 'utf8');
const itemJs = fs.readFileSync(path.join(repoRoot, 'site', 'public', 'store', 'item.js'), 'utf8');

// --- The resolver is the only thing standing between a theme package and the
// --- app's colour scheme, so exercise it rather than reading its source.
const { resolveAccent, sanitizeThemeSettings, isValidPackageId } = require('../src/shared/theme-settings.js');

console.log('Flowr theme + addon regression checks started.');

// ---------------------------------------------------------------------------
// Accent colours: Flowr Store packages ship hex accents, the built-in picker
// uses preset ids. Supporting only the latter meant every published theme
// installed with its accent silently dropped.
// ---------------------------------------------------------------------------
assert.equal(resolveAccent('purple'), '#7a5fe0', 'preset ids still resolve');
assert.equal(resolveAccent('#8f75ff'), '#8f75ff', 'hex accents from store packages resolve');
assert.equal(resolveAccent('#7DD7AE'), '#7dd7ae', 'hex accents are normalised to lower case');
assert.equal(resolveAccent(''), null, 'an unset accent falls through to the theme default');
assert.equal(resolveAccent(undefined), null, 'a missing accent falls through');
assert.equal(resolveAccent('not-a-colour'), null, 'garbage is never treated as a colour');
assert.equal(resolveAccent('#fff'), null, '3-digit hex is not silently accepted');

// Package ids become directory names. Validation, not character-class
// rewriting: a rewrite that keeps "." lets ".." escape the install folder.
assert.ok(isValidPackageId('flowr-atlas'), 'ordinary ids are accepted');
for (const bad of ['..', '.', '', '  ', 'a/b', '/abs', 'C:\\win', '../x', 'a'.repeat(80)]) {
  assert.equal(isValidPackageId(bad), false, `id ${JSON.stringify(bad)} must be rejected`);
}

// sanitizeThemeSettings is the boundary between a remote document and the
// user's settings store, so assert it drops rather than passes anything odd.
const sanitized = sanitizeThemeSettings({
  theme: 'aurora',
  accentColor: '#8f75ff',
  blurIntensity: 'heavy',
  tabWidth: 'wide',
  tabFontSize: 'medium',
  glassToolbar: true,
  glassCards: false,
  glassSidebar: true,
  downloadPath: 'C:\\Windows',
  vaultAutoLock: 0,
  tieddrNewsEndpoint: 'http://evil.example'
});
assert.deepEqual(Object.keys(sanitized).sort(),
  ['accentColor', 'blurIntensity', 'glassCards', 'glassSidebar', 'glassToolbar', 'tabFontSize', 'tabWidth', 'theme'].sort(),
  'only known appearance settings survive');
assert.equal(sanitized.downloadPath, undefined, 'a package can never set the download folder');
assert.equal(sanitized.tieddrNewsEndpoint, undefined, 'a package can never set the news endpoint');
assert.deepEqual(sanitizeThemeSettings({ theme: 'not-a-theme', accentColor: 'chartreuse' }), {}, 'invalid values are dropped, not coerced');
assert.deepEqual(sanitizeThemeSettings(null), {}, 'a missing settings block is not an error');
assert.deepEqual(sanitizeThemeSettings('nope'), {}, 'a non-object settings block is rejected');

// resolveAccent lives in a shared module compiled by babel, so assert the
// wiring that actually matters to the UI.
assert.match(utilsSource, /const \{ resolveAccent, ACCENT_PRESETS: ACCENT_PRESET_COLORS \} = require\('\.\.\/shared\/theme-settings'\)/,
  'the renderer uses the shared resolver');
assert.match(utilsSource, /const accent = resolveAccent\(accentId\)/, 'resolveTheme uses the shared resolver');
assert.match(utilsSource, /accentSoft: accent \+ '1a'/, 'accentSoft is derived from the resolved colour');
assert.match(mainSource, /require\('\.\.\/shared\/theme-settings'\)/, 'the installer validates with the same schema');
assert.match(mainSource, /Object\.entries\(sanitizeThemeSettings\(manifest\.settings\)\)/, 'installer applies sanitised settings only');

// ---------------------------------------------------------------------------
// Every published theme package must declare a colour the app can actually use.
// ---------------------------------------------------------------------------
const ACCENT_PRESETS = ['blue', 'purple', 'teal', 'green', 'rose', 'orange', 'slate'];
const THEMES = ['flow', 'graphite', 'aurora', 'linen'];
const packagesDir = path.join(repoRoot, 'site', 'public', 'store', 'packages');
const themes = fs.readdirSync(packagesDir).filter(name => fs.existsSync(path.join(packagesDir, name, 'theme.json')));
assert.ok(themes.length >= 4, `expected the published theme packages to be present, found ${themes.length}`);

for (const name of themes) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packagesDir, name, 'theme.json'), 'utf8'));
  const label = `theme.json ${name}`;
  assert.equal(manifest.flowrThemeVersion, 1, `${label}: version marker`);
  assert.equal(manifest.id, name, `${label}: id matches folder`);
  assert.ok(manifest.name && manifest.developer && manifest.description,
    `${label}: name, developer and description drive the install consent dialog`);
  assert.ok(manifest.images.length > 0, `${label}: has images`);
  assert.ok(manifest.images.length <= 12, `${label}: within the app's image limit`);

  const { theme, accentColor, blurIntensity, tabWidth, tabFontSize, glassToolbar, glassCards, glassSidebar } = manifest.settings || {};
  assert.ok(THEMES.includes(theme), `${label}: theme "${theme}" is not a Flowr theme`);
  assert.ok(
    ACCENT_PRESETS.includes(accentColor) || resolveAccent(accentColor),
    `${label}: accentColor "${accentColor}" would be discarded by the app`
  );
  assert.ok(['light', 'medium', 'heavy'].includes(blurIntensity), `${label}: blurIntensity "${blurIntensity}" is invalid`);
  assert.ok(['compact', 'normal', 'wide'].includes(tabWidth), `${label}: tabWidth "${tabWidth}" is invalid`);
  assert.ok(['small', 'medium', 'large'].includes(tabFontSize), `${label}: tabFontSize "${tabFontSize}" is invalid`);
  for (const flag of [glassToolbar, glassCards, glassSidebar]) {
    assert.equal(typeof flag, 'boolean', `${label}: glass toggles must be booleans`);
  }
}

// ---------------------------------------------------------------------------
// Extension packages: Electron cannot run MV3 service workers, so a package
// that depends on one installs and then silently never fires.
// ---------------------------------------------------------------------------
const extensions = fs.readdirSync(packagesDir).filter(name => fs.existsSync(path.join(packagesDir, name, 'package.json')));
assert.ok(extensions.length >= 2, `expected the published extension packages to be present, found ${extensions.length}`);

for (const name of extensions) {
  const dir = path.join(packagesDir, name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const label = `package.json ${name}`;
  assert.equal(pkg.flowrExtensionVersion, 1, `${label}: version marker`);
  assert.equal(pkg.id, name, `${label}: id matches folder`);
  assert.ok(pkg.name && pkg.developer && pkg.description, `${label}: consent dialog needs metadata`);

  const shipped = fs.readdirSync(dir).filter(file => !['package.json'].includes(file));
  const declared = (pkg.files || []).map(file => file.path);
  assert.deepEqual([...declared].sort(), [...shipped].sort(), `${label}: declared files match what is shipped`);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3, `${label}: MV3`);
  // The decisive check: an Electron-hosted MV3 extension never runs a service
  // worker, so the click handler has to live in a popup.
  assert.equal(manifest.background, undefined, `${label}: must not rely on a background service worker`);
  assert.ok(manifest.action && manifest.action.default_popup,
    `${label}: needs a default_popup, since chrome.action.onClicked never fires without one`);
  const popup = manifest.action.default_popup;
  assert.ok(fs.existsSync(path.join(dir, popup)), `${label}: declared popup exists`);
}

// ---------------------------------------------------------------------------
// Install consent: the deep link must never install on navigation alone.
// ---------------------------------------------------------------------------
assert.match(appSource, /requestPackageInstall: async \(manifestUrl, wv\)/, 'install goes through a consent flow');
assert.match(appSource, /ipc\?\.invoke\('flowr-package-info', manifestUrl\)/, 'package metadata is read before consent');
const consentAt = appSource.indexOf('requestPackageInstall: async');
const consentBody = appSource.slice(consentAt, consentAt + 3000);
assert.ok(consentBody.indexOf('confirmDialog') > -1, 'consent is requested');
assert.ok(
  consentBody.indexOf('confirmDialog') < consentBody.indexOf("invoke('install-flowr-theme'"),
  'consent is requested BEFORE anything is installed'
);
assert.ok(
  consentBody.indexOf('confirmDialog') < consentBody.indexOf("invoke('install-flowr-extension'"),
  'consent is requested BEFORE an extension is installed'
);
assert.match(mainSource, /ipcMain\.handle\('flowr-package-info'/, 'main process exposes package metadata read-only');
assert.match(mainSource, /changedSettings/, 'theme consent lists which settings will change');
assert.match(mainSource, /hostPermissions/, 'extension consent lists requested host access');

// ---------------------------------------------------------------------------
// The store can only offer an install if it can tell it is inside Flowr.
// ---------------------------------------------------------------------------
assert.match(itemJs, /isFlowrBrowser\s*=\s*\/[^\n]*flowr/i, 'store detects the Flowr user-agent token');
assert.match(mainSource, /Flowr\/\$\{version\}/, 'app advertises its own product token in the user agent');
assert.match(itemJs, /const ORIGIN = 'https:\/\/flowr\.tieddr\.com'/, 'install URLs are absolute');
assert.match(itemJs, /installUrl = \(page, manifestPath\)/, 'install URLs are built by one shared helper');

// ---------------------------------------------------------------------------
// Theme lifecycle: applying and removing must both be possible.
// ---------------------------------------------------------------------------
assert.match(mainSource, /ipcMain\.handle\('uninstall-flowr-theme'/, 'themes can be removed');
assert.match(mainSource, /fs\.rmSync\(resolved, \{ recursive: true, force: true \}\)/, 'removal deletes the images, not just the record');
assert.match(appSource, /Card title="Installed themes"/, 'installed themes are listed in Appearance settings');
assert.match(appSource, /removeTheme=\{removeTheme\}/, 'the settings page can trigger removal');
// "Restore defaults" used to leave installed themes and the custom background
// behind, contradicting the copy in its own confirmation dialog.
const resetAt = mainSource.indexOf("ipcMain.handle('reset-settings'");
assert.match(mainSource.slice(resetAt, resetAt + 600), /set\('installedThemes', \[\]\)/, 'reset clears installed themes');
assert.match(mainSource.slice(resetAt, resetAt + 600), /set\('customBackgroundUrl', ''\)/, 'reset clears the custom background');

// ---------------------------------------------------------------------------
// The install stub must exist, because the app matches on its exact path.
// ---------------------------------------------------------------------------
for (const stub of ['install-theme.html', 'install-extension.html']) {
  assert.ok(fs.existsSync(path.join(repoRoot, 'site', 'public', 'store', stub)), `${stub} exists`);
}

console.log('Flowr theme + addon regression checks passed.');