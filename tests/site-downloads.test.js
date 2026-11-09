const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const home = read('site/public/index.html');
const download = read('site/public/download/index.html');
const callback = read('site/public/auth/callback/index.html');
const app = read('site/public/app.js');
const nginx = read('site/nginx.conf');
const sitemap = read('site/public/sitemap.xml');

for (const page of [home, download]) {
  assert.doesNotMatch(page, /href="https:\/\/github\.com\/Tiedr\/flowr-browser\/releases\/download\//, 'Public markup must route downloads through Tieddr Account');
  for (const platform of ['windows', 'mac-arm64', 'mac-x64', 'linux']) {
    assert.match(page, new RegExp(`data-download="${platform}"`), `Missing ${platform} download action`);
  }
  assert.match(page, /src="\/auth-config\.js" defer/);
  assert.match(page, /src="\/app\.js" defer/);
  assert.match(page, /data-download-status role="status" aria-live="polite"/);
}

for (const platform of ['windows', 'mac-arm64', 'mac-x64', 'linux']) {
  assert.match(app, new RegExp(`['"]?${platform}['"]?: \\{`), `No release URL mapped for ${platform}`);
}
assert.match(app, /grant_type: 'authorization_code'/);
assert.match(app, /code_challenge_method: 'S256'/);
assert.match(app, /returnedState !== expectedState/);
assert.match(app, /code_verifier: verifier/);
assert.match(app, /\/v1\/oauth\/userinfo/);
assert.match(app, /sessionStorage\.getItem\(keys\.resume\)/);
assert.match(callback, /name="robots" content="noindex,nofollow,noarchive"/);
assert.match(nginx, /connect-src 'self' https:\/\/api\.account\.tieddr\.com/);
assert.match(nginx, /try_files \$uri \$uri\/ =404/);
assert.match(sitemap, /<loc>https:\/\/flowr\.tieddr\.com\/download\/<\/loc>/);

const keyFile = fs.readdirSync(path.join(root, 'site/public')).find(name => /^[a-f0-9]{48}\.txt$/.test(name));
assert.ok(keyFile, 'IndexNow verification file must exist');
assert.equal(read(`site/public/${keyFile}`).trim(), keyFile.slice(0, -4));

console.log('Flowr account-gated downloads and indexing regression checks passed.');
