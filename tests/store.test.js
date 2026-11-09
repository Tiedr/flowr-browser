const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const mainSource = read('src', 'main', 'main.js');
const preloadSource = read('src', 'main', 'preload.js');
const crxSource = read('src', 'main', 'crx.js');
const itemJs = read('site', 'public', 'store', 'item.js');
const storeIndex = read('site', 'public', 'store', 'index.html');
const sitemap = read('site', 'public', 'sitemap.xml');
const robots = read('site', 'public', 'robots.txt');

// ---------------------------------------------------------------------------
// The store hands the app an absolute manifest URL. Both sides must agree on
// the exact host, or the install is refused.
// ---------------------------------------------------------------------------
const STORE_HOST = 'flowr.tieddr.com';
assert.match(mainSource, new RegExp(`const FLOWR_STORE_HOST = '${STORE_HOST}'`), 'app pins the store host');
assert.match(itemJs, new RegExp(`const ORIGIN = 'https://${STORE_HOST}'`), 'store builds absolute install URLs');

// The install stub is recognised in the renderer (it runs on the webview's
// navigation), while the manifest URL is re-validated in the main process.
const appNav = read('src', 'renderer', 'App.js');
assert.match(appNav, /hostname === 'flowr\.tieddr\.com' && parsed\.pathname === '\/store\/install-theme\.html'/,
  'renderer intercepts the theme install stub on an exact host + path');
assert.match(appNav, /hostname === 'flowr\.tieddr\.com' && parsed\.pathname === '\/store\/install-extension\.html'/,
  'renderer intercepts the extension install stub on an exact host + path');
assert.match(appNav, /parsed\.searchParams\.get\('manifest'\)/, 'the manifest URL is read from the stub query');
assert.match(mainSource, /function assertStoreUrl\(candidate, base\)/, 'the main process re-validates every store URL');

// A relative install link would only resolve while the store is served from the
// domain root, so the deep link silently failed on any other host.
assert.doesNotMatch(itemJs, /install\.href = isFlowrBrowser \? `\/store\//,
  'install links are absolute, not root-relative');

// ---------------------------------------------------------------------------
// Every channel the new flows depend on must be reachable from the preload.
// A missing allow-list entry fails silently at runtime.
// ---------------------------------------------------------------------------
for (const channel of [
  'flowr-package-info',
  'uninstall-flowr-theme',
  'inspect-extension-folder',
  'detect-importable-browsers'
]) {
  assert.ok(preloadSource.includes(`'${channel}'`), `${channel} is exposed to the renderer`);
  assert.ok(mainSource.includes(`'${channel}'`), `${channel} has a handler`);
}
assert.ok(preloadSource.includes("'extension-loaded'"), 'the extension-changed push is allow-listed');
assert.ok(mainSource.includes("send('extension-loaded'"), 'the main process pushes extension changes');

// ---------------------------------------------------------------------------
// Store listings and the sitemap must stay in step, or a package is reachable
// but undiscoverable (or listed but 404).
// ---------------------------------------------------------------------------
// /store/assets/... is the image directory, not an item. Filter to the slug
// shape the generator actually produces.
const listed = [...storeIndex.matchAll(/href="\/store\/([a-z0-9-]+)\/"/g)].map(match => match[1]);
const uniqueListed = [...new Set(listed)];
assert.ok(uniqueListed.length >= 6, `expected the store index to list the catalogue, found ${uniqueListed.length}`);

const packagesDir = path.join(repoRoot, 'site', 'public', 'store', 'packages');
const packaged = fs.readdirSync(packagesDir)
  .filter(name => fs.existsSync(path.join(packagesDir, name, 'theme.json')) || fs.existsSync(path.join(packagesDir, name, 'package.json')));

for (const id of packaged) {
  assert.ok(uniqueListed.includes(id), `${id} is installable but not listed on the store index`);
  assert.ok(sitemap.includes(`/store/${id}/`), `${id} is installable but absent from the sitemap`);
  assert.ok(fs.existsSync(path.join(repoRoot, 'site', 'public', 'store', id, 'index.html')),
    `${id} has no generated store page`);
}
for (const id of uniqueListed) {
  assert.ok(fs.existsSync(path.join(repoRoot, 'site', 'public', 'store', id, 'index.html')),
    `store index links to ${id} but no page was generated`);
}

// item.js is the runtime source of truth for each item page; the generator is
// the static source. A new item added to one and not the other produces a page
// that renders the wrong product.
const generator = read('site', 'scripts', 'generate-store-pages.mjs');
for (const id of uniqueListed) {
  assert.ok(itemJs.includes(`'${id}'`), `item.js is missing ${id}`);
  assert.ok(generator.includes(`slug: '${id}'`), `generate-store-pages.mjs is missing ${id}`);
}

// ---------------------------------------------------------------------------
// Extension installation hardening.
// ---------------------------------------------------------------------------
assert.match(mainSource, /function extensionSession\(\)[\s\S]*?return browsingSession \|\| session\.defaultSession;/,
  'extensions load into the session the webviews render in');
assert.doesNotMatch(mainSource, /session\.defaultSession\.loadExtension/,
  'nothing loads an extension into the session no page uses');
assert.equal((mainSource.match(/allowFileAccess: true/g) || []).length, 1,
  'file access is granted only for a developer-chosen unpacked folder');
assert.match(mainSource, /allowFileAccess: false/, 'downloaded packages get no file access');
assert.match(crxSource, /allowFileAccess: false/, 'Chrome Web Store packages get no file access');
assert.match(crxSource, /\.staging-/, 'a CRX is unpacked to staging before it replaces the live copy');

// ---------------------------------------------------------------------------
// Local bookmark import must not require a Tieddr Account: it is local data.
// ---------------------------------------------------------------------------
const autoImportAt = mainSource.indexOf("ipcMain.handle('import-installed-browser-bookmarks'");
assert.ok(autoImportAt > 0, 'auto import handler exists');
assert.doesNotMatch(mainSource.slice(autoImportAt, autoImportAt + 600), /accountStore\.get\('account'\)/,
  'local bookmark import is not gated behind a cloud account');

// ---------------------------------------------------------------------------
// Crawl basics that the runtime-injected links depend on.
// ---------------------------------------------------------------------------
assert.match(robots, /^Sitemap:\s*https:\/\//im, 'robots.txt advertises an absolute sitemap URL');
assert.match(sitemap, /<loc>https:\/\/flowr\.tieddr\.com\/store\/<\/loc>/, 'the store index is in the sitemap');

console.log('Flowr store integrity regression checks passed.');