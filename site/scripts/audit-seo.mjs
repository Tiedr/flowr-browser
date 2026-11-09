import { readFile, access, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

// Validate published packages against the exact schema the app enforces, so a
// package that installs but changes nothing can never ship.
const require = createRequire(import.meta.url);
const { sanitizeThemeSettings, isValidPackageId } = require('../../src/shared/theme-settings.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const packagesDir = path.join(publicDir, 'store', 'packages');
const ORIGIN = 'https://flowr.tieddr.com';

const failures = [];
const warnings = [];
const fail = message => failures.push(message);
const warn = message => warnings.push(message);

// Windows tooling (PowerShell Set-Content, some editors) writes a UTF-8 BOM.
// JSON.parse rejects it, and these files are served straight off the CDN, so
// strip it on read rather than trusting every contributor's editor settings.
const readJson = async filename => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));

const sitemap = await readFile(path.join(publicDir, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]));

// ---------------------------------------------------------------------------
// 1. Sitemap hygiene
// ---------------------------------------------------------------------------
if (!urls.length) fail('sitemap.xml lists no URLs');
const seenPaths = new Set();
for (const url of urls) {
  if (url.origin !== ORIGIN) fail(`${url.pathname}: sitemap entry is not on ${ORIGIN}`);
  if (!url.href.startsWith('https://')) fail(`${url.pathname}: sitemap entry is not https`);
  if (seenPaths.has(url.pathname)) fail(`${url.pathname}: duplicated in sitemap.xml`);
  seenPaths.add(url.pathname);
}

async function resolveTarget(pathname) {
  const target = path.join(publicDir, pathname.slice(1));
  const candidates = pathname.endsWith('/')
    ? [path.join(target, 'index.html')]
    : [target, path.join(target, 'index.html')];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Per-page metadata
// ---------------------------------------------------------------------------
const titles = new Map();
const descriptions = new Map();
const inboundLinks = new Map(urls.map(url => [url.pathname, 0]));

for (const url of urls) {
  const relative = url.pathname === '/' ? 'index.html' : path.join(url.pathname.slice(1), 'index.html');
  const filename = path.join(publicDir, relative);
  let html;
  try {
    html = await readFile(filename, 'utf8');
  } catch {
    fail(`${url.pathname}: sitemap target is missing (${relative})`);
    continue;
  }

  const title = html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim() || '';
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() || '';
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1]?.trim() || '';
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const schemas = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];

  if (title.length < 20 || title.length > 70) fail(`${url.pathname}: title length is ${title.length} (want 20-70)`);
  if (description.length < 70 || description.length > 170) fail(`${url.pathname}: description length is ${description.length} (want 70-170)`);
  if (canonical !== url.href) fail(`${url.pathname}: canonical is ${canonical || 'missing'} (want ${url.href})`);
  if (h1Count !== 1) fail(`${url.pathname}: expected one H1, found ${h1Count}`);

  // Open Graph has to be complete enough for a real link preview, not merely present.
  for (const property of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:site_name']) {
    if (!html.includes(`property="${property}"`)) fail(`${url.pathname}: ${property} is missing`);
  }
  const ogUrl = html.match(/property="og:url"\s+content="([^"]+)"/i)?.[1]?.trim();
  if (ogUrl !== url.href) fail(`${url.pathname}: og:url is ${ogUrl || 'missing'} (want ${url.href})`);
  if (!html.includes('name="twitter:card"')) fail(`${url.pathname}: Twitter card metadata is missing`);
  if (!html.includes('name="viewport"')) fail(`${url.pathname}: viewport meta is missing`);
  if (!/name="robots"/.test(html)) warn(`${url.pathname}: no robots meta (defaults to index,follow)`);

  // An indexable page that is a thin shell will not rank for anything.
  if (html.length < 1200) fail(`${url.pathname}: page body is only ${html.length} bytes, too thin to index`);

  if (!schemas.length) fail(`${url.pathname}: JSON-LD is missing`);
  for (const schema of schemas) {
    let parsed;
    try {
      parsed = JSON.parse(schema[1]);
    } catch (error) {
      fail(`${url.pathname}: invalid JSON-LD (${error.message})`);
      continue;
    }
    // A page may publish a single object, an array, or a @graph wrapper. Every
    // entity inside has to name its own @type for any of it to be useful.
    const entities = Array.isArray(parsed) ? parsed : (Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
    if (!entities.length) fail(`${url.pathname}: JSON-LD contains no entities`);
    for (const entity of entities) {
      if (!entity || typeof entity !== 'object' || !entity['@type']) {
        fail(`${url.pathname}: a JSON-LD entity is missing @type`);
      }
    }
    if (!Array.isArray(parsed) && !parsed['@context']) fail(`${url.pathname}: JSON-LD is missing @context`);
  }

  // Duplicate metadata is a classic soft ranking killer.
  if (titles.has(title)) fail(`${url.pathname}: title duplicates ${titles.get(title)}`);
  else titles.set(title, url.pathname);
  if (descriptions.has(description)) fail(`${url.pathname}: description duplicates ${descriptions.get(description)}`);
  else descriptions.set(description, url.pathname);

  for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/i.test(img[0])) fail(`${url.pathname}: img without alt - ${img[0].slice(0, 90)}`);
  }

  for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    const raw = match[1];
    if (raw.startsWith('/#')) continue;
    const targetUrl = new URL(raw, ORIGIN);
    inboundLinks.set(targetUrl.pathname, (inboundLinks.get(targetUrl.pathname) || 0) + 1);
    if (!(await resolveTarget(targetUrl.pathname))) {
      fail(`${url.pathname}: local asset or link is missing (${targetUrl.pathname})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Runtime-injected install URLs
//    item.js builds these in JavaScript, so the static scan above can never see
//    them - and they are the exact URLs that decide whether a theme or extension
//    can be installed at all.
// ---------------------------------------------------------------------------
const itemJs = await readFile(path.join(publicDir, 'store', 'item.js'), 'utf8');
for (const stub of ['install-theme.html', 'install-extension.html']) {
  if (!itemJs.includes(stub)) fail(`store/item.js never references ${stub} - the install deep link is dead`);
  if (!(await resolveTarget(`/store/${stub}`))) fail(`/store/${stub} is missing but item.js links to it`);
}
if (!itemJs.includes('isFlowrBrowser')) {
  fail('store/item.js has no Flowr browser detection - install links will always dead-end');
} else if (!/isFlowrBrowser\s*=\s*\/[^\n]*flowr/i.test(itemJs)) {
  fail('store/item.js does not match the Flowr user-agent product token');
}
for (const match of itemJs.matchAll(/['"](\/store\/packages\/[^'"]+)['"]/g)) {
  if (!(await resolveTarget(match[1]))) fail(`store/item.js references a missing package manifest: ${match[1]}`);
}

// ---------------------------------------------------------------------------
// 4. Package integrity
//    The installers download exactly these files. A missing one turns a listed
//    "Install" into a failed install at runtime with nothing failing in CI.
// ---------------------------------------------------------------------------
const themeIds = new Set();
const extensionIds = new Set();
let packageDirs;
try {
  packageDirs = (await readdir(packagesDir, { withFileTypes: true })).filter(entry => entry.isDirectory());
} catch {
  fail('store/packages is missing');
}

for (const entry of packageDirs || []) {
  const dir = path.join(packagesDir, entry.name);
  const label = `store/packages/${entry.name}`;
  const listing = await readdir(dir);
  const files = new Set(listing.filter(name => !name.startsWith('.')));

  const hasTheme = files.has('theme.json');
  const hasExtension = files.has('package.json');
  if (!hasTheme && !hasExtension) fail(`${label}: neither theme.json nor package.json`);
  const declared = new Set();

  if (hasTheme) {
    const theme = await readJson(path.join(dir, 'theme.json'));
if (theme.flowrThemeVersion !== 1) fail(`${label}/theme.json: flowrThemeVersion must be 1`);
    if (!isValidPackageId(theme.id)) fail(`${label}/theme.json: id "${theme.id}" is not a safe package id`);
    if (theme.id !== entry.name) fail(`${label}/theme.json: id "${theme.id}" does not match its folder`);
    if (!theme.name || !theme.developer || !theme.description) fail(`${label}/theme.json: name, developer and description are all required`);
    if (!Array.isArray(theme.images) || !theme.images.length) fail(`${label}/theme.json: images[] is empty`);
    if (Array.isArray(theme.images) && theme.images.length > 12) fail(`${label}/theme.json: images[] exceeds the app limit of 12`);
    for (const image of theme.images || []) {
      const parsed = new URL(image, ORIGIN);
      if (parsed.origin !== ORIGIN) fail(`${label}/theme.json: image is not served from ${ORIGIN}`);
      if (!(await resolveTarget(parsed.pathname))) fail(`${label}/theme.json: image is missing (${parsed.pathname})`);
    }
    // The app applies exactly what sanitizeThemeSettings returns. Anything it
    // would drop is a promise the store cannot keep.
    const applied = sanitizeThemeSettings(theme.settings);
    const dropped = Object.keys(theme.settings || {}).filter(key => !(key in applied));
    if (dropped.length) {
      fail(`${label}/theme.json: the app would ignore ${dropped.join(', ')}`);
    }
    if (!applied.accentColor) fail(`${label}/theme.json: no usable accent colour - the theme would install with no accent`);
    themeIds.add(theme.id);
  }

  if (hasExtension) {
    const pkg = await readJson(path.join(dir, 'package.json'));
    if (pkg.flowrExtensionVersion !== 1) fail(`${label}/package.json: flowrExtensionVersion must be 1`);
    if (!isValidPackageId(pkg.id)) fail(`${label}/package.json: id "${pkg.id}" is not a safe package id`);
    if (pkg.id !== entry.name) fail(`${label}/package.json: id "${pkg.id}" does not match its folder`);
    if (!pkg.name || !pkg.developer || !pkg.description) fail(`${label}/package.json: name, developer and description are all required`);
    if (!Array.isArray(pkg.files) || !pkg.files.length) fail(`${label}/package.json: files[] is empty`);
    if (Array.isArray(pkg.files) && pkg.files.length > 64) fail(`${label}/package.json: files[] exceeds the app limit of 64`);
    for (const file of pkg.files || []) {
      if (!file || typeof file.path !== 'string' || !file.path) {
        fail(`${label}/package.json: a files[] entry has no path`);
        continue;
      }
      if (file.path.includes('..') || file.path.startsWith('/')) fail(`${label}/package.json: unsafe file path "${file.path}"`);
      if (!files.has(file.path.split('/').pop())) fail(`${label}/package.json: declared file is missing (${file.path})`);
      declared.add(file.path);
      const assetUrl = new URL(file.url, ORIGIN);
      if (assetUrl.origin !== ORIGIN) fail(`${label}/package.json: asset is not served from ${ORIGIN}`);
      if (!(await resolveTarget(assetUrl.pathname))) fail(`${label}/package.json: asset is missing (${assetUrl.pathname})`);
    }
    extensionIds.add(pkg.id);

    // Electron does not run MV3 service workers. A package built around one
    // installs successfully and then never fires, which is worse than not
    // shipping it at all.
    const manifest = await readJson(path.join(dir, 'manifest.json'));
    if (manifest.background) {
      fail(`${label}/manifest.json: background workers never run in Flowr - use an action popup instead`);
    }
    if (!manifest.action || !manifest.action.default_popup) {
      fail(`${label}/manifest.json: chrome.action.onClicked never fires without a default_popup`);
    }
  }

  // Every shipped file must be declared, or it is dead weight the app installs
  // without knowing about.
  for (const file of files) {
    if (file === 'theme.json' || file === 'package.json') continue;
    if (!declared.has(file)) fail(`${label}: ${file} is shipped but not declared in a package manifest`);
  }
}

// ---------------------------------------------------------------------------
// 5. Store coverage and internal linking
// ---------------------------------------------------------------------------
for (const id of [...themeIds, ...extensionIds]) {
  if (!seenPaths.has(`/store/${id}/`)) fail(`/store/${id}/ is installable but absent from sitemap.xml`);
  if (!(await resolveTarget(`/store/${id}/`))) fail(`/store/${id}/ has no generated page - run generate-store-pages.mjs`);
}
for (const url of urls) {
  if (url.pathname.startsWith('/store/') && url.pathname !== '/store/' && !inboundLinks.get(url.pathname)) {
    fail(`${url.pathname}: orphaned - nothing on the site links to it`);
  }
}

// ---------------------------------------------------------------------------
// 6. Crawl infrastructure
// ---------------------------------------------------------------------------
const robots = await readFile(path.join(publicDir, 'robots.txt'), 'utf8');
if (!/^User-agent:\s*\*/im.test(robots)) fail('robots.txt has no User-agent: * group');
if (!/^Sitemap:\s*https:\/\//im.test(robots)) fail('robots.txt does not advertise an absolute Sitemap URL');
const webmanifest = await readJson(path.join(publicDir, 'site.webmanifest'));
for (const key of ['name', 'short_name', 'start_url', 'display']) {
  if (!webmanifest[key]) fail(`site.webmanifest is missing "${key}"`);
}

// ---------------------------------------------------------------------------
// 7. Page weight
// ---------------------------------------------------------------------------
let heaviest = null;
for (const url of urls) {
  const filename = path.join(publicDir, url.pathname === '/' ? 'index.html' : path.join(url.pathname.slice(1), 'index.html'));
  let info;
  try { info = await stat(filename); } catch { continue; }
  if (info.size > 90000) warn(`${url.pathname}: ${(info.size / 1024).toFixed(0)} KB of inline HTML`);
  if (!heaviest || info.size > heaviest.size) heaviest = { url: url.pathname, size: info.size };
}
if (heaviest && heaviest.size > 400000) {
  fail(`${heaviest.url}: ${(heaviest.size / 1024).toFixed(0)} KB page is too heavy to load quickly`);
}

// ---------------------------------------------------------------------------
if (warnings.length) console.warn(warnings.map(value => `! ${value}`).join('\n'));
if (failures.length) {
  console.error(failures.map(value => `- ${value}`).join('\n'));
  process.exit(1);
}

console.log(`SEO audit passed for ${urls.length} indexable pages (${themeIds.size} themes and ${extensionIds.size} extensions verified end to end).`);