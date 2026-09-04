const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'App.js'), 'utf8');

// Page-reported URL changes (pushState, replaceState and hash navigation) must
// only update browser chrome. Feeding them back into `src` remounts the page
// and destroys in-memory state in React/Next/Vue and other SPA applications.
assert.equal(appSource.includes('prevUrlRef'), false);
assert.equal((appSource.match(/setAttribute\(\s*['"]src['"]\s*,\s*tab\.url\s*\)/g) || []).length, 1);

// Explicit address-bar navigation remains an imperative browser command.
assert.match(appSource, /const go = useCallback[\s\S]*?wv\.loadURL\(u\)/);

// A newly-created tab owns its initial URL before its webview is mounted, so
// no reactive URL-to-src synchronization is needed.
assert.match(appSource, /const targetUrl = u \|\| 'about:blank'/);
assert.match(appSource, /url: targetUrl/);

// Mouse selection must execute before TextInput blur can unmount the popup.
assert.match(appSource, /onMouseDown=\{e => \{[\s\S]*?e\.preventDefault\?\.\(\);[\s\S]*?navigateSuggestion\(sg\.url\);/);
assert.match(appSource, /zIndex: 5000, pointerEvents: 'auto'/);

console.log('Flowr navigation ownership regression checks passed.');
