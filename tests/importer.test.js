const assert = require('assert');
const { parsePasswordCsv, parseBookmarkHtml, parseChromiumBookmarks } = require('../src/main/importer');

const passwords = parsePasswordCsv('name,url,username,password\nExample,https://example.com,user@example.com,"p,ass"\n');
assert.deepStrictEqual(passwords, [{ title: 'Example', url: 'https://example.com', username: 'user@example.com', password: 'p,ass' }]);

const html = '<DT><A HREF="https://example.com?a=1&amp;b=2">Example &amp; Co</A>';
assert.deepStrictEqual(parseBookmarkHtml(html), [{ url: 'https://example.com?a=1&b=2', title: 'Example & Co' }]);

const chromium = JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [{ type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Tieddr', url: 'https://tieddr.com' }] }] } } });
assert.deepStrictEqual(parseChromiumBookmarks(chromium), [{ url: 'https://tieddr.com', title: 'Tieddr', folder: 'Work' }]);

console.log('Flowr browser import regression checks passed.');
