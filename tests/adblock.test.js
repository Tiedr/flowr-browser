const assert = require('node:assert/strict');
const { isBlockedHost, shouldBlockRequest } = require('../src/main/adblock');

assert.equal(isBlockedHost('securepubads.g.doubleclick.net'), true);
assert.equal(isBlockedHost('doubleclick.net'), true);
assert.equal(isBlockedHost('example.com'), false);
assert.equal(shouldBlockRequest({ url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', resourceType: 'script' }), true);
assert.equal(shouldBlockRequest({ url: 'https://doubleclick.net/ad.js', resourceType: 'mainFrame' }), true);
assert.equal(shouldBlockRequest({ url: 'https://example.com/ads/banner/home', resourceType: 'mainFrame' }), true);
assert.equal(shouldBlockRequest({ url: 'https://cdn.example.net/analytics/collect.gif', initiator: 'https://news.example.com', resourceType: 'image' }), true);
assert.equal(shouldBlockRequest({ url: 'https://news.example.com/analytics/dashboard', initiator: 'https://news.example.com', resourceType: 'mainFrame' }), false);
assert.equal(shouldBlockRequest({ url: 'https://popads.net/redirect', initiator: 'https://example.com', resourceType: 'mainFrame' }), true);
assert.equal(shouldBlockRequest({ url: 'https://random-ad-domain.example/landing?clickid=123&zoneid=7', initiator: 'https://example.com', resourceType: 'mainFrame' }), true);
assert.equal(shouldBlockRequest({ url: 'https://doubleclick.net/ad.js', resourceType: 'script' }, false), false);
assert.equal(shouldBlockRequest({ url: 'data:text/plain,ad', resourceType: 'script' }), false);

console.log('Flowr ad-block regression checks passed.');
