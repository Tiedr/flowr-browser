const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeSiteApp, siteAppScope, isUrlInSiteAppScope, siteAppId } = require('../src/main/site-apps');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/renderer/App.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/main/preload.js'), 'utf8');

const item = normalizeSiteApp({
  id: 'site-example-com-docs',
  name: 'Example Docs',
  url: 'https://example.com/docs/home',
  scope: 'https://example.com/docs/',
  display: 'standalone',
  icon: 'https://example.com/icon.png'
});
assert.equal(item.standalone, true);
assert.equal(siteAppScope(item).href, 'https://example.com/docs/');
assert.equal(isUrlInSiteAppScope('https://example.com/docs/page?tab=1', item), true);
assert.equal(isUrlInSiteAppScope('https://example.com/other', item), false);
assert.equal(isUrlInSiteAppScope('https://example.com/docs-other', item), false);
assert.equal(isUrlInSiteAppScope('https://other.example/docs/page', item), false);
assert.equal(normalizeSiteApp({ url: 'javascript:alert(1)' }), null);
assert.notEqual(siteAppId('https://example.com/docs'), siteAppId('https://example.com/mail'), 'Different apps can share a hostname');
assert.equal(siteAppScope(normalizeSiteApp({ url: 'https://example.com/docs/home' })).pathname, '/docs/');

const permissionStart = main.indexOf('function permissionOrigin');
const permissionEnd = main.indexOf("ipcMain.handle('get-site-permissions'", permissionStart);
const permissionContext = {
  URL,
  WEB_PERMISSIONS_PROMPT: new Set(['media', 'geolocation', 'notifications']),
  sitePermissionsStore: { sites: {}, get(key) { return this.sites[key]; }, set(key, value) { this.sites[key] = value; } },
  send() {}
};
vm.runInNewContext(main.slice(permissionStart, permissionEnd), permissionContext);
assert.equal(permissionContext.permissionOrigin('https://example.com/path?q=1'), 'https://example.com');
assert.equal(permissionContext.permissionOrigin('file:///etc/passwd'), '');
permissionContext.updateSitePermission('https://example.com/path', 'media', 'allow');
assert.equal(permissionContext.sitePermissionDecision('https://example.com', 'media'), 'allow');
permissionContext.updateSitePermission('https://example.com', 'geolocation', 'block');
assert.equal(permissionContext.listSitePermissions().length, 2);
permissionContext.updateSitePermission('https://example.com', 'media', 'reset');
assert.equal(permissionContext.sitePermissionDecision('https://example.com', 'media'), '');
permissionContext.updateSitePermission('https://example.com', 'geolocation', 'reset');
assert.equal(permissionContext.listSitePermissions().length, 0);
const beforeInvalid = JSON.stringify(permissionContext.sitePermissionsStore.sites);
permissionContext.updateSitePermission('https://example.com', 'usb', 'allow');
assert.equal(JSON.stringify(permissionContext.sitePermissionsStore.sites), beforeInvalid, 'Unknown permissions cannot be persisted');

assert.match(main, /function openSiteAppWindow\(input\)/);
assert.match(main, /session: browsingSession \|\| session\.defaultSession/);
assert.match(main, /isUrlInSiteAppScope\(url, item\)/);
assert.match(main, /contents\.__flowrSiteApp &&/);
assert.match(main, /buttons: \['Block', 'Always block', 'Allow once', 'Always allow'\]/);
assert.match(main, /sitePermissionDecision\(permissionOrigin\(wc\), permission\) === 'allow'/);
assert.match(app, /appItem\.standalone/);
assert.match(app, /Apps & Permissions/);
assert.match(app, /apps=\{settings\.siteApps \|\| \[\]\} openApp=\{openSiteApp\}/);
assert.match(app, /scope: current\.pwa\?\.scope/);
assert.match(preload, /'open-site-app', 'get-site-permissions', 'set-site-permission'/);
assert.match(preload, /'site-permissions-changed'/);

const resizeAssertions = app.match(/guestFrame\.style\.width = '100%'/g) || [];
assert.ok(resizeAssertions.length >= 2, 'Both regular and sidebar guest frames must resize horizontally');
assert.match(app, /\[layout, sidePanelWidth, active\]/, 'Layout changes must reapply guest geometry');
const panelStart = app.indexOf('function SidePanelHost');
const panelEnd = app.indexOf('function SideShortcutRail', panelStart);
assert.match(app.slice(panelStart, panelEnd), /new ResizeObserver\(sizeGuest\)/);
assert.match(app.slice(panelStart, panelEnd), /rect\.height - 42/);
assert.match(app.slice(panelStart, panelEnd), /window\.addEventListener\('resize', sizeGuest\)/);

console.log('Flowr standalone apps, site permissions and sidebar geometry checks passed.');
