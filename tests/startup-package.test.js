const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
assert.doesNotMatch(source, /require\(['"]\.\/package\.json['"]\)/, 'src/main must not resolve the app manifest as a sibling file');
assert.match(source, /const version = app\.getVersion\(\);/, 'Use Electron’s packaged app version for the user agent');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.ok(pkg.build.files.includes('package.json'), 'Electron must package the app manifest');
assert.match(pkg.scripts['dist:linux'], /preflight -- linux/, 'Linux packaging must not require a Windows signing certificate');
for (const name of ['dist:win:update', 'dist:linux', 'dist:mac:all', 'dist:mac:x64', 'dist:mac:arm64']) {
  assert.match(pkg.scripts[name], /&& electron-builder --/, `${name} must execute electron-builder after preflight`);
}

console.log('Flowr packaged-startup regression checks passed.');
