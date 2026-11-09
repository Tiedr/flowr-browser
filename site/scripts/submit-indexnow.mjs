import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const host = 'flowr.tieddr.com';
const keyFile = (await readdir(publicDir)).find(name => /^[a-f0-9]{48}\.txt$/.test(name));
if (!keyFile) throw new Error('IndexNow key file is missing.');
const key = keyFile.slice(0, -4);
if ((await readFile(path.join(publicDir, keyFile), 'utf8')).trim() !== key) {
  throw new Error('IndexNow key file contents do not match its filename.');
}
const sitemap = await readFile(path.join(publicDir, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
if (!urlList.length) throw new Error('No sitemap URLs found for IndexNow.');

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${keyFile}`, urlList })
});
if (!response.ok) {
  const detail = await response.text();
  throw new Error(`IndexNow submission failed with HTTP ${response.status}: ${detail.slice(0, 300)}`);
}
console.log(`IndexNow accepted ${urlList.length} Flowr URLs for fresh indexing.`);
