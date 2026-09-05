import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const sitemap = await readFile(path.join(publicDir, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]));
const failures = [];

for (const url of urls) {
  const relative = url.pathname === '/' ? 'index.html' : path.join(url.pathname.slice(1), 'index.html');
  const filename = path.join(publicDir, relative);
  let html;
  try {
    html = await readFile(filename, 'utf8');
  } catch {
    failures.push(`${url.pathname}: sitemap target is missing (${relative})`);
    continue;
  }
  const title = html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim() || '';
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() || '';
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1]?.trim() || '';
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const schemas = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (title.length < 20 || title.length > 70) failures.push(`${url.pathname}: title length is ${title.length}`);
  if (description.length < 70 || description.length > 170) failures.push(`${url.pathname}: description length is ${description.length}`);
  if (canonical !== url.href) failures.push(`${url.pathname}: canonical is ${canonical || 'missing'}`);
  if (h1Count !== 1) failures.push(`${url.pathname}: expected one H1, found ${h1Count}`);
  if (!html.includes('property="og:title"') || !html.includes('property="og:image"')) failures.push(`${url.pathname}: Open Graph metadata is incomplete`);
  if (!html.includes('name="twitter:card"')) failures.push(`${url.pathname}: Twitter card metadata is missing`);
  if (!schemas.length) failures.push(`${url.pathname}: JSON-LD is missing`);
  for (const schema of schemas) {
    try { JSON.parse(schema[1]); } catch (error) { failures.push(`${url.pathname}: invalid JSON-LD (${error.message})`); }
  }
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    const targetUrl = new URL(match[1], 'https://flowr.tieddr.com');
    if (targetUrl.pathname.startsWith('/#')) continue;
    const target = path.join(publicDir, targetUrl.pathname.slice(1));
    const candidates = targetUrl.pathname.endsWith('/') ? [path.join(target, 'index.html')] : [target, path.join(target, 'index.html')];
    let found = false;
    for (const candidate of candidates) {
      try { await access(candidate); found = true; break; } catch {}
    }
    if (!found && !targetUrl.pathname.startsWith('/#')) failures.push(`${url.pathname}: local asset or link is missing (${targetUrl.pathname})`);
  }
}

if (failures.length) {
  console.error(failures.map(value => `- ${value}`).join('\n'));
  process.exit(1);
}

console.log(`SEO audit passed for ${urls.length} indexable pages.`);
