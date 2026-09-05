import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const site = 'https://flowr.tieddr.com';
const items = [
  { slug: 'flowr-horizons', name: 'Flowr Horizons', kind: 'Theme', image: '/store/assets/abstract-glass.png', description: 'A complete Flowr theme with four original backgrounds, a violet accent, deeper frosted glass and a coordinated start page.' },
  { slug: 'quiet-earth', name: 'Quiet Earth', kind: 'Theme', image: '/store/assets/nature-aurora.png', description: 'A calm nature theme for Flowr Browser with landscape, rainforest and refracted-light backgrounds plus a restrained green glass interface.' },
  { slug: 'flowr-atlas', name: 'Flowr Atlas', kind: 'Theme', image: '/store/assets/atlas-glacial-valley.png', description: 'A photographic Flowr theme featuring a glacial valley, cloud-forest quetzal, blue-hour architecture and volcanic coast.' },
  { slug: 'flowr-vanguard', name: 'Flowr Vanguard', kind: 'Theme', image: '/store/assets/vanguard-kinetic.png', description: 'A bold action photography theme for Flowr with four hero-focused backgrounds and high-contrast browser styling.' },
  { slug: 'focus-bloom', name: 'Focus Bloom', kind: 'Extension', image: '/store/assets/abstract-glass.png', description: 'A quiet focus timer extension for Flowr Browser with deliberate work intervals and a private local light garden.' },
  { slug: 'tab-constellations', name: 'Tab Constellations', kind: 'Extension', image: '/store/assets/original-guardians.png', description: 'A Flowr extension preview for arranging open tabs into named visual workspaces with local organisation and search.' },
  { slug: 'quiet-reader', name: 'Quiet Reader', kind: 'Extension', image: '/store/assets/nature-aurora.png', description: 'A one-click reading extension for Flowr Browser with balanced typography, spacing and a distraction-free editorial surface.' },
  { slug: 'send-to-space', name: 'Send to Space', kind: 'Extension', image: '/store/assets/birds-rainforest.png', description: 'A Tieddr extension preview for saving pages, selected passages and notes from Flowr directly to Tieddr Space.' }
];

const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

for (const item of items) {
  const url = `${site}/store/${item.slug}/`;
  const data = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: item.name,
    url,
    description: item.description,
    image: `${site}${item.image}`,
    applicationCategory: item.kind === 'Theme' ? 'MultimediaApplication' : 'BrowserApplication',
    operatingSystem: 'Flowr Browser',
    author: { '@type': 'Organization', name: 'Tieddr', url: 'https://tieddr.com/' },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }
  }).replaceAll('<', '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(item.name)} — ${item.kind} for Flowr Browser</title><meta name="description" content="${esc(item.description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="Flowr Browser"><meta property="og:title" content="${esc(item.name)} — Flowr Store"><meta property="og:description" content="${esc(item.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${site}${item.image}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${site}${item.image}"><link rel="icon" href="/flowr-logo.png"><link rel="stylesheet" href="/store/store.css"><link rel="stylesheet" href="/store/item.css"><script type="application/ld+json">${data}</script></head><body><header><a class="brand" href="/"><img src="/flowr-logo.png" alt=""><b>Flowr</b><span>Store</span></a><a class="back" href="/store/">All items</a></header><main class="item-main"><div class="item-crumb"><a href="/store/">Store</a> / <span id="kind">${item.kind}</span></div><section class="item-head"><div id="icon" class="item-icon"><img src="${item.image}" alt=""></div><div><h1 id="name">${esc(item.name)}</h1><div id="meta" class="item-meta">Flowr Store ${item.kind}</div></div><div class="install-stack"><a id="install" class="install">Install in Flowr</a><p id="flowr-only" class="flowr-only" hidden><strong>Flowr needed:</strong> this item installs inside Flowr only. <a id="flowr-only-cta" href="/#download">Download Flowr</a> to continue.</p></div></section><section id="gallery" class="gallery"><img src="${item.image}" alt="${esc(item.name)} preview"></section><section class="item-layout"><article><h2>Overview</h2><p id="description">${esc(item.description)}</p><h2>What is included</h2><div id="contents"></div><h2>Privacy and permissions</h2><div id="permissions"></div><h2>Reviews</h2><div class="review-empty"><b>No verified reviews yet</b><p>Reviews appear after people install this item through Flowr.</p><a href="https://account.tieddr.com">Sign in with Tieddr →</a></div></article><aside class="facts"><div class="fact"><span>Developer</span><b id="developer">Tieddr</b></div><div class="fact"><span>Version</span><b id="version"></b></div><div class="fact"><span>Updated</span><b id="updated"></b></div><div class="fact"><span>Category</span><b id="category"></b></div><div class="fact"><span>Source</span><b id="source"></b></div><div class="fact"><span>Support</span><b><a href="mailto:support@tieddr.com">Contact developer</a></b></div></aside></section></main><footer>Flowr Store <span>Items are reviewed before publication</span></footer><script src="/store/item.js"></script></body></html>`;
  const dir = path.join(publicDir, 'store', item.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html, 'utf8');
}

console.log(`Generated ${items.length} crawlable Flowr Store item pages.`);
