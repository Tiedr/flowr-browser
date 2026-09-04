const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
const signInStart = mainSource.indexOf("ipcMain.handle('tieddr-sign-in'");
const signInEnd = mainSource.indexOf("ipcMain.handle('tieddr-sign-out'", signInStart);
assert.ok(signInStart >= 0 && signInEnd > signInStart, 'Tieddr sign-in handler must exist');

const signInSource = mainSource.slice(signInStart, signInEnd);
assert.match(signInSource, /webPreferences:\s*\{\s*session:\s*browsingSession,/);
assert.doesNotMatch(signInSource, /session\.defaultSession/);
assert.match(mainSource, /async function migrateLegacyTieddrCookies\(targetSession\)/);
assert.match(mainSource, /if \(!INCOGNITO\) await migrateLegacyTieddrCookies\(browsingSession\)/);
assert.match(mainSource, /\(\^\|\\\.\)tieddr\\\.com\$/);

console.log('Flowr browser-wide Tieddr session regression checks passed.');
