const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'src/main/viewpreload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/renderer/App.js'), 'utf8');

const start = preload.indexOf('// --- Adaptive ad blocking');
const end = preload.indexOf('\nfunction findFields()', start);
assert.ok(start >= 0 && end > start, 'Adaptive preload section must exist');
const section = preload.slice(start, end).replace(/\}\)\(\);\s*$/, 'globalThis.adTest = { adElementScore, adSelectorFor };})();');
const context = {
  privacy: { adBlocker: true, adaptiveAdBlocker: true },
  location: { protocol: 'https:', hostname: 'news.example.com', href: 'https://news.example.com/' },
  document: { readyState: 'loading', addEventListener() {} },
  window: { addEventListener() {} },
  ipcRenderer: { invoke: async () => ({ rules: [] }), send() {} },
  MutationObserver: function () {},
  URL,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(section, context);

function element(options = {}) {
  const attributes = options.attributes || {};
  return {
    nodeType: 1,
    tagName: options.tagName || 'DIV',
    id: options.id || '',
    className: options.className || '',
    classList: String(options.className || '').split(/\s+/).filter(Boolean),
    textContent: options.text || '',
    children: options.children || [],
    src: options.src || '',
    hasAttribute: name => Object.hasOwn(attributes, name),
    getAttribute: name => Object.hasOwn(attributes, name) ? attributes[name] : null,
    querySelector: selector => options.matches?.includes(selector) ? {} : null,
    getBoundingClientRect: () => ({ width: options.width || 0, height: options.height || 0 })
  };
}

const score = value => context.adTest.adElementScore(value);
const dataAd = element({ attributes: { 'data-ad-slot': '12345' } });
assert.ok(score(dataAd) >= 6, 'Explicit ad metadata is high confidence');
assert.equal(context.adTest.adSelectorFor(dataAd), '[data-ad-slot="12345"]');

const semanticAd = element({ className: 'ad-banner', text: 'Advertisement' });
assert.ok(score(semanticAd) >= 6, 'Ad semantics plus an ad label is high confidence');
assert.equal(context.adTest.adSelectorFor(semanticAd), '.ad-banner');
assert.ok(score(element({ className: 'ad-banner' })) < 6, 'One ambiguous class token is not enough');

assert.ok(score(element({ className: 'download-card', text: 'Download Flowr', width: 300, height: 250 })) < 6, 'Download content is not advertising');
assert.ok(score(element({ className: 'address-card', text: 'Our address', width: 300, height: 250 })) < 6, 'Address is not an ad token');
assert.ok(score(element({ src: 'https://cdn.example.net/video/player', tagName: 'IFRAME', width: 300, height: 250 })) < 6, 'Ordinary third-party media stays intact');
assert.ok(score(element({ src: 'https://cdn.example.net/ad/banner', tagName: 'IFRAME', width: 300, height: 250 })) >= 6, 'Ad-like frame path plus frame context and sizing is detected');
assert.ok(score(element({ children: [{}], matches: ['input,textarea,select'], className: 'ad-banner', text: 'Advertisement' })) < 6, 'Forms are not hidden by ambiguous ad semantics');

const selectorStart = main.indexOf('function validAdaptiveSelector');
const selectorEnd = main.indexOf('\nipcMain.handle(', selectorStart);
const selectorContext = {};
vm.runInNewContext(main.slice(selectorStart, selectorEnd), selectorContext);
for (const selector of ['#ad-sidebar', '.ad-banner', '[data-ad]', '[data-ad-slot="12345"]']) {
  assert.equal(selectorContext.validAdaptiveSelector(selector), true, `${selector} is stable and safe`);
}
for (const selector of ['body', 'script', 'iframe', '#ad:nth-child(2)', '[data-ad] img', 'https://evil.example']) {
  assert.equal(selectorContext.validAdaptiveSelector(selector), false, `${selector} must not be learned`);
}

assert.match(main, /adBlocker: true,\s*adaptiveAdBlocker: true/, 'Both blocking layers default to on');
assert.match(main, /Math\.min\(500, Math\.max\(0, Math\.floor\(Number\(payload\?\.count\)/, 'Page reports are count-bounded');
assert.match(main, /Object\.entries\(sites\)\.slice\(-100\)/, 'Learned site storage is bounded');
assert.match(main, /settingsStore\.get\('adaptiveAdBlocker'\) === false \|\| INCOGNITO/, 'Incognito does not read persistent learned rules');
assert.match(preload, /ipcRenderer\.send\('adblock-report', \{ count, rules \}\)/, 'Reports contain counts and selectors, not page content');
assert.match(app, /Adaptive page protection/, 'Adaptive protection is visible in settings');
assert.match(app, /adblock-status/, 'Live blocked counts reach the settings UI');

console.log('Flowr adaptive ad-block scoring, learning and safety checks passed.');
