const assert = require('assert');
const { parseSiteRules, matchesSiteRule, retentionCutoff, filterHistory } = require('../src/main/privacy');

const rules = parseSiteRules('example.com\n*.private.test, news.test');
assert.deepStrictEqual(rules, ['example.com', '*.private.test', 'news.test']);
assert.equal(matchesSiteRule('https://example.com/page', rules), true);
assert.equal(matchesSiteRule('https://sub.private.test/login', rules), true);
assert.equal(matchesSiteRule('https://notexample.com/', rules), false);
assert.equal(retentionCutoff('1h', 10_000_000), 6_400_000);

const now = Date.parse('2026-08-20T12:00:00Z');
const filtered = filterHistory([
  { url: 'https://keep.test', date: '2026-08-20T11:30:00Z' },
  { url: 'https://example.com', date: '2026-08-20T11:50:00Z' },
  { url: 'https://old.test', date: '2026-08-19T11:00:00Z' }
], { rules, retention: '1h', now });
assert.deepStrictEqual(filtered.map(item => item.url), ['https://keep.test']);
console.log('Flowr privacy and history regression checks passed.');
