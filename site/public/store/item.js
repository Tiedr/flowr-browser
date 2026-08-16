const A = '/store/assets/';
const items = {
  'flowr-horizons': {
    name: 'Flowr Horizons',
    kind: 'Theme',
    icon: A + 'abstract-glass.png',
    developer: 'Tieddr',
    version: '1.0.0',
    updated: '13 August 2026',
    category: 'Abstract · Nature',
    source: 'Flowr Originals',
    description: 'A complete visual collection for Flowr. Horizons pairs four original artworks with a violet accent, deeper frosted glass, comfortable tabs and a coordinated start-page treatment.',
    shots: [A + 'abstract-glass.png', A + 'nature-aurora.png', A + 'birds-rainforest.png', A + 'original-guardians.png'],
    contents: ['4 locally saved background images', 'Flowr dark interface style', 'Violet accent colour', 'Frosted toolbar, cards and sidebar', 'Comfortable tab width and type scale'],
    permissions: ['Stores the theme artwork in your Flowr profile', 'Changes appearance settings only'],
    manifest: '/store/packages/flowr-horizons/theme.json'
  },
  'quiet-earth': {
    name: 'Quiet Earth',
    kind: 'Theme',
    icon: A + 'nature-aurora.png',
    developer: 'Tieddr',
    version: '1.0.0',
    updated: '13 August 2026',
    category: 'Nature',
    source: 'Flowr Originals',
    description: 'A calm collection built around landscape, rainforest and softly refracted light. Quiet Earth gives Flowr a green accent and restrained glass treatment without changing your browsing data.',
    shots: [A + 'nature-aurora.png', A + 'birds-rainforest.png', A + 'abstract-glass.png'],
    contents: ['3 locally saved background images', 'Aurora interface style', 'Soft green accent colour', 'Balanced glass and blur settings'],
    permissions: ['Stores the theme artwork in your Flowr profile', 'Changes appearance settings only'],
    manifest: '/store/packages/quiet-earth/theme.json'
  },
  'flowr-atlas': {
    name: 'Flowr Atlas',
    kind: 'Theme',
    icon: A + 'atlas-glacial-valley.png',
    developer: 'Tieddr',
    version: '1.0.0',
    updated: '14 August 2026',
    category: 'Photography',
    source: 'Flowr Originals',
    description: 'Four restrained photographic worlds made for a calm browser surface: a glacial valley after a storm, a quetzal in cloud-forest rain, pre-dawn architecture and a remote volcanic coast.',
    shots: [A + 'atlas-glacial-valley.png', A + 'atlas-quetzal-rain.png', A + 'atlas-city-blue-hour.png', A + 'atlas-volcanic-coast.png'],
    contents: ['4 locally saved photographic backgrounds', 'Cool slate Flowr interface style', 'UI-safe compositions with natural negative space', 'Balanced frosted toolbar, cards and sidebar'],
    permissions: ['Stores the theme artwork in your Flowr profile', 'Changes appearance settings only'],
    manifest: '/store/packages/flowr-atlas/theme.json'
  },
  'flowr-vanguard': {
    name: 'Flowr Vanguard',
    kind: 'Theme',
    icon: A + 'vanguard-kinetic.png',
    developer: 'Tieddr',
    version: '1.0.0',
    updated: '14 August 2026',
    category: 'Photography',
    source: 'Flowr Originals',
    description: 'Bold action-ready photo themes tuned for better readability, sharper text contrast and long reading sessions.',
    shots: [A + 'vanguard-kinetic.png', A + 'vanguard-storm.png', A + 'vanguard-gravity.png', A + 'vanguard-united.png'],
    contents: ['4 locally saved Flowr-verified photos', 'Hero-focused start surface', 'Dynamic visual rhythm controls', 'Stronger contrast and focus mode options'],
    permissions: ['Stores the theme artwork in your Flowr profile', 'Changes appearance settings only'],
    manifest: '/store/packages/flowr-vanguard/theme.json'
  },
  'focus-bloom': {
    name: 'Focus Bloom',
    kind: 'Extension',
    icon: 'FB',
    developer: 'Tieddr',
    version: '1.0.0',
    updated: '13 August 2026',
    category: 'Productivity',
    source: 'Flowr Originals',
    description: 'A quiet focus timer for Flowr: work in deliberate intervals and let a private light garden grow as you stay with the task.',
    shots: [A + 'abstract-glass.png'],
    contents: ['25-minute focus sessions', 'A private local bloom counter', 'Pause and reset controls'],
    permissions: ['Local storage for session progress'],
    extensionManifest: '/store/packages/focus-bloom/package.json'
  },
  'tab-constellations': {
    name: 'Tab Constellations',
    kind: 'Extension',
    icon: 'TC',
    developer: 'Tieddr',
    version: 'Preview',
    updated: '13 August 2026',
    category: 'Tabs',
    source: 'Flowr Originals',
    description: 'Arrange open tabs as named visual workspaces so research, planning and everyday browsing remain distinct.',
    shots: [A + 'original-guardians.png'],
    contents: ['Named visual workspaces', 'Tab grouping and restore', 'Local workspace search'],
    permissions: ['Read and organise open tabs', 'Store workspace names locally'],
    preview: true
  },
  'quiet-reader': {
    name: 'Quiet Reader',
    kind: 'Extension',
    icon: 'QR',
    developer: 'Tieddr',
    version: '1.0.0',
    updated: '13 August 2026',
    category: 'Accessibility',
    source: 'Flowr Originals',
    description: 'Transform the current article into a warm, composed reading surface with balanced measure, typography and spacing. Click the extension again to leave.',
    shots: [A + 'nature-aurora.png'],
    contents: ['One-click focused article view', 'Readable editorial type and width', 'Preserves article images'],
    permissions: ['Read and restyle the active page only when clicked'],
    extensionManifest: '/store/packages/quiet-reader/package.json'
  },
  'send-to-space': {
    name: 'Send to Space',
    kind: 'Extension',
    icon: 'TS',
    developer: 'Tieddr',
    version: 'Preview',
    updated: '13 August 2026',
    category: 'Tieddr',
    source: 'Tieddr',
    description: 'Send a page, highlighted passage or quick note directly to your Tieddr Space without breaking your flow.',
    shots: [A + 'birds-rainforest.png'],
    contents: ['Save pages and selected text', 'Choose a Space collection', 'Add a note before sending'],
    permissions: ['Read the active page when activated', 'Connect to your Tieddr account and Space'],
    preview: true
  }
};

const id = new URLSearchParams(location.search).get('id');
const x = items[id] || items['flowr-horizons'];
const q = sel => document.querySelector(sel);

const ua = (navigator.userAgent || '').toLowerCase();
const isFlowrBrowser = /electron|flowr/.test(ua);

document.title = `${x.name} — Flowr Store`;
q('#name').textContent = x.name;
q('#kind').textContent = x.kind;
q('#meta').textContent = `${x.source} · ${x.category}`;
q('#developer').textContent = x.developer;
q('#version').textContent = x.version;
q('#updated').textContent = x.updated;
q('#category').textContent = x.category;
q('#source').textContent = x.source;
q('#description').textContent = x.description;

if (x.icon.startsWith('/')) {
  q('#icon').innerHTML = `<img src="${x.icon}" alt="">`;
} else {
  q('#icon').textContent = x.icon;
}

q('#gallery').innerHTML = x.shots.map((s, i) => `<img src="${s}" alt="${x.name} screenshot ${i + 1}">`).join('');
q('#contents').innerHTML = x.contents.map(v => `<div class="permission"><i>✓</i><span>${v}</span></div>`).join('');
q('#permissions').innerHTML = x.permissions.map(v => `<div class="permission"><i>✓</i><span>${v}</span></div>`).join('');

const install = q('#install');
const flowrOnly = q('#flowr-only');

if (x.preview) {
  install.textContent = 'Coming soon';
  install.removeAttribute('href');
  install.setAttribute('aria-disabled', 'true');
  install.style.background = '#e8e8eb';
  install.style.color = '#777d8a';
  flowrOnly.hidden = true;
} else if (x.extensionManifest) {
  const manifest = `https://flowr.tieddr.com${x.extensionManifest}`;
  install.href = isFlowrBrowser ? `/store/install-extension.html?manifest=${encodeURIComponent(manifest)}` : `/#download`;
  if (!isFlowrBrowser) {
    install.textContent = 'Get Flowr to install';
  }
  flowrOnly.hidden = isFlowrBrowser;
} else {
  const manifest = `https://flowr.tieddr.com${x.manifest}`;
  install.href = isFlowrBrowser ? `/store/install-theme.html?manifest=${encodeURIComponent(manifest)}` : `/#download`;
  if (!isFlowrBrowser) {
    install.textContent = 'Get Flowr to install';
  }
  flowrOnly.hidden = isFlowrBrowser;
}

if (!flowrOnly.hidden) {
  q('#flowr-only-cta').href = '/#download';
}
