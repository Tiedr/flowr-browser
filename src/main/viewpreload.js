// Runs inside every web page (isolated from page JS). Handles password autofill
// on load and capture on submit, talking to the main process over IPC. It never
// exposes anything to the page — no contextBridge, just DOM + ipc.
const { ipcRenderer } = require('electron');
let privacy = {};

// Chromium can surface conditional passkey UI before a user explicitly asks
// for it. Flowr blocks WebAuthn credential requests by default; the user can
// opt back in from Privacy settings.
try {
  privacy = ipcRenderer.sendSync('privacy-web-preferences', location.href) || {};
  if (privacy.compatibleBrowserIdentity && privacy.userAgent) {
    const compatibleUA = privacy.userAgent;
    const fullVersion = compatibleUA.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '142.0.0.0';
    const major = fullVersion.split('.')[0];
    const brands = [{ brand: 'Google Chrome', version: major }, { brand: 'Chromium', version: major }, { brand: 'Not_A Brand', version: '99' }];
    try { Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => compatibleUA }); } catch (_) {}
    try { Object.defineProperty(navigator, 'appVersion', { configurable: true, get: () => compatibleUA.replace(/^Mozilla\/5.0 /, '') }); } catch (_) {}
    try { Object.defineProperty(navigator, 'vendor', { configurable: true, get: () => 'Google Inc.' }); } catch (_) {}
    if (navigator.userAgentData) {
      const data = navigator.userAgentData;
      const original = data.getHighEntropyValues?.bind(data);
      try { Object.defineProperty(data, 'brands', { configurable: true, get: () => brands }); } catch (_) {}
      try {
        Object.defineProperty(data, 'getHighEntropyValues', {
          configurable: true,
          value: async hints => {
            let current = {};
            if (original) { try { current = await original(hints); } catch (_) {} }
            return {
              ...current,
              brands,
              fullVersionList: brands.map(item => ({ brand: item.brand, version: item.brand === 'Not_A Brand' ? '99.0.0.0' : fullVersion })),
              uaFullVersion: fullVersion,
              platform: privacy.browserPlatform,
              mobile: false
            };
          }
        });
      } catch (_) {}
    }
  }
  if (privacy.blockUnpromptedPasskeys && navigator.credentials) {
    const credentials = navigator.credentials;
    const originalGet = credentials.get.bind(credentials);
    Object.defineProperty(credentials, 'get', {
      configurable: true,
      value: options => {
        if (options && options.publicKey) return Promise.reject(new DOMException('Passkeys are blocked by Flowr Privacy.', 'NotAllowedError'));
        return originalGet(options);
      }
    });
  }

  // Fingerprint spoofing — report generic, high-entropy-reducing hardware
  // values instead of the real machine's. Applied once per page.
  if (privacy.fingerprintProtection) {
    try {
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 4 });
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 8 });
    } catch (_) {}
    try {
      const patchGetParameter = proto => {
        if (!proto) return;
        const original = proto.getParameter;
        proto.getParameter = function (param) {
          try {
            // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
            if (param === 37445) return 'Intel Inc.';
            if (param === 37446) return 'Intel Iris OpenGL Engine';
          } catch (_) {}
          return original.call(this, param);
        };
      };
      if (window.WebGLRenderingContext) patchGetParameter(WebGLRenderingContext.prototype);
      if (window.WebGL2RenderingContext) patchGetParameter(WebGL2RenderingContext.prototype);
    } catch (_) {}
    try {
      // Tiny deterministic-ish noise on canvas reads breaks pixel-perfect
      // canvas fingerprints without visibly changing page graphics.
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const imageData = origGetImageData.apply(this, args);
        try {
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 997) data[i] = Math.min(255, data[i] ^ 1);
        } catch (_) {}
        return imageData;
      };
    } catch (_) {}
  }

  // Smart copy — long selections gain a source line when pasted as plain text.
  if (privacy.smartCopy) {
    document.addEventListener('copy', event => {
      try {
        if (event.clipboardData.getData('text/plain')) return;
        const selection = String(window.getSelection ? window.getSelection() : '');
        if (!selection || selection.trim().length < 60) return;
        event.clipboardData.setData('text/plain', `${selection.replace(/\s+\n/g, '\n')}\n\nSource: ${location.href}`);
        event.preventDefault();
      } catch (_) {}
    }, true);
  }
} catch (_) {}

// --- Adaptive ad blocking --------------------------------------------------
(function adaptiveAdBlocker() {
  if (!privacy.adBlocker || !privacy.adaptiveAdBlocker || !/^https?:$/.test(location.protocol)) return;

  const CANDIDATES = 'div,section,aside,iframe,ins,img,object,embed,amp-ad';
  const AD_TOKEN = /(?:^|[^a-z0-9])(?:ad|ads|adslot|adunit|advert|advertisement|advertising|sponsor|sponsored|dfp|doubleclick|taboola|outbrain)(?:$|[^a-z0-9])/i;
  const AD_LABEL = /^(?:ad|advert|advertisement|advertising|sponsored|sponsored content|sponsored link)$/i;
  const KNOWN_ATTRIBUTES = ['data-ad', 'data-ad-slot', 'data-adunit', 'data-ad-unit', 'data-advertisement', 'data-advertising', 'data-sponsored', 'data-google-query-id', 'data-dfp'];
  const COMMON_SIZES = [[300, 250], [300, 600], [160, 600], [320, 50], [320, 100], [728, 90], [970, 90], [970, 250]];
  const processed = new WeakSet();
  const learnedRules = new Set();
  const pendingRules = new Set();
  const pendingRoots = new Set();
  let pendingCount = 0;
  let reportTimer = null;
  let scanTimer = null;
  let observer = null;

  function knownAdAttribute(element) {
    return KNOWN_ATTRIBUTES.find(name => element.hasAttribute(name)) || '';
  }

  function adElementScore(element) {
    if (!element || element.nodeType !== 1 || processed.has(element)) return 0;
    if (element.hasAttribute('data-flowr-ad-blocked')) return 0;
    if (element.querySelector('input,textarea,select') && !knownAdAttribute(element)) return 0;

    let score = knownAdAttribute(element) ? 6 : 0;
    const identity = `${element.id || ''} ${String(element.className || '')}`;
    if (AD_TOKEN.test(identity)) score += 3;
    const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')]
      .filter(Boolean).join(' ').trim();
    if (AD_LABEL.test(label)) score += 4;
    const text = String(element.textContent || '').trim();
    if (text.length <= 120 && AD_LABEL.test(text)) score += 4;
    if (element.querySelector('a[rel~="sponsored"]')) score += 2;

    if (element.tagName === 'IFRAME') {
      try {
        const source = new URL(element.src || element.getAttribute('src') || '', location.href);
        if (AD_TOKEN.test(source.hostname)) score += 2;
        if (AD_TOKEN.test(`${source.pathname}${source.search}`)) score += 3;
        if (source.hostname !== location.hostname) score += 1;
      } catch (_) {}
    }
    if (element.querySelector('a[href*="adurl="],a[href*="clickid="],a[href*="zoneid="]')) score += 2;

    try {
      const rect = element.getBoundingClientRect();
      if (COMMON_SIZES.some(([width, height]) => Math.abs(rect.width - width) <= 12 && Math.abs(rect.height - height) <= 12)) score += 2;
    } catch (_) {}
    if (element.children.length > 24 && text.length > 800 && score < 6) return 0;
    return score;
  }

  function adSelectorFor(element) {
    const id = String(element.id || '');
    if (/^[a-z][\w-]{1,79}$/i.test(id) && AD_TOKEN.test(id)) return `#${id}`;
    for (const name of KNOWN_ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      if (!value) return `[${name}]`;
      if (/^[a-z0-9_-]{1,60}$/i.test(value)) return `[${name}="${value}"]`;
    }
    for (const name of element.classList || []) {
      if (/^[a-z][\w-]{1,79}$/i.test(name) && AD_TOKEN.test(name)) return `.${name}`;
    }
    return '';
  }

  function reportBlocked(selector) {
    pendingCount += 1;
    if (selector && !learnedRules.has(selector)) {
      learnedRules.add(selector);
      pendingRules.add(selector);
    }
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const count = pendingCount;
      const rules = [...pendingRules];
      pendingCount = 0;
      pendingRules.clear();
      if (count > 0) ipcRenderer.send('adblock-report', { count, rules });
    }, 700);
  }

  function blockElement(element, learnedSelector = '') {
    if (processed.has(element)) return;
    if (!learnedSelector && adElementScore(element) < 6) return;
    processed.add(element);
    const selector = learnedSelector || adSelectorFor(element);
    element.setAttribute('data-flowr-ad-blocked', 'true');
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
    if (/^(?:IFRAME|OBJECT|EMBED)$/.test(element.tagName)) {
      try { element.src = 'about:blank'; } catch (_) {}
      try { element.data = 'about:blank'; } catch (_) {}
    }
    reportBlocked(selector);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    const elements = [];
    if (root.matches(CANDIDATES)) elements.push(root);
    elements.push(...root.querySelectorAll(CANDIDATES));
    for (const element of elements.slice(0, 3000)) blockElement(element);
    for (const selector of learnedRules) {
      try {
        if (root.matches(selector)) blockElement(root, selector);
        for (const element of root.querySelectorAll(selector)) blockElement(element, selector);
      } catch (_) {}
    }
  }

  function flushScans() {
    scanTimer = null;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) scan(root);
  }

  function start() {
    if (!document.documentElement) return;
    scan(document.documentElement);
    ipcRenderer.invoke('adblock-rules').then(result => {
      for (const selector of result?.rules || []) learnedRules.add(selector);
      scan(document.documentElement);
    }).catch(() => {});
    if (observer) observer.disconnect();
    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) pendingRoots.add(node);
        }
      }
      if (pendingRoots.size && !scanTimer) scanTimer = setTimeout(flushScans, 160);
      if (pendingRoots.size > 500) pendingRoots.clear();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('load', () => setTimeout(() => scan(document.documentElement), 900), { once: true });
})();

function findFields() {
  const pw = [...document.querySelectorAll('input[type="password"]')].find(el => el.offsetParent !== null);
  if (!pw) return null;
  const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent !== null);
  const idx = inputs.indexOf(pw);
  let user = null;
  for (let i = idx - 1; i >= 0; i--) {
    const type = (inputs[i].type || 'text').toLowerCase();
    if (['text', 'email', 'tel', ''].includes(type)) { user = inputs[i]; break; }
  }
  return { user, pw };
}

function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }

// Credentials only ever move on encrypted origins (https, plus localhost for
// development). Filling or reporting a password on plain http hands it to any
// network observer — and to any MITM page that merely looks like the site.
function credentialOriginAllowed() {
  try {
    if (location.protocol === 'https:') return true;
    if (location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)) return true;
  } catch (_) {}
  return false;
}

async function autofill() {
  if (!credentialOriginAllowed()) return;
  const f = findFields();
  if (!f || (f.pw.value && f.pw.value.length)) return;
  try {
    const cred = await ipcRenderer.invoke('pw-get-for-origin', location.origin);
    if (!cred || !cred.password) return;
    if (f.user && cred.username && !f.user.value) { f.user.value = cred.username; fire(f.user); }
    f.pw.value = cred.password; fire(f.pw);
  } catch (_) {}
}

function capture() {
  if (!credentialOriginAllowed()) return;
  const f = findFields();
  if (!f || !f.pw.value) return;
  ipcRenderer.send('pw-captured', { origin: location.origin, username: f.user ? f.user.value : '', password: f.pw.value });
}

window.addEventListener('DOMContentLoaded', () => setTimeout(autofill, 350));
window.addEventListener('load', () => setTimeout(autofill, 600));
document.addEventListener('submit', () => setTimeout(capture, 0), true);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type === 'password') setTimeout(capture, 0); }, true);

// --- Tieddr Wallet: credit-card autofill at checkout ----------------------
// When a card-number field is focused and the unlocked vault has saved cards,
// offer a small picker (isolated in a shadow root). The card's number/exp/CVC
// enter the page only on the user's explicit pick — never auto-filled, never
// sent to page JS.
(function () {
  function visible(el) { return el && el.offsetParent !== null; }
  function hint(el) {
    return ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || '') +
      ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.placeholder || '')).toLowerCase();
  }
  function firstByHint(hints) {
    for (const el of document.querySelectorAll('input, select')) {
      if (!visible(el)) continue;
      const h = hint(el);
      if (hints.some((x) => h.includes(x))) return el;
    }
    return null;
  }
  const HINTS = {
    number: ['cc-number', 'cardnumber', 'card-number', 'card_number', 'ccnum', 'cardnum', 'numberofcard'],
    exp: ['cc-exp', 'expiry', 'expiration', 'exp-date', 'exp_date', 'expdate'],
    month: ['cc-exp-month', 'expmonth', 'exp-month', 'exp_month', 'expirationmonth'],
    year: ['cc-exp-year', 'expyear', 'exp-year', 'exp_year', 'expirationyear'],
    cvc: ['cc-csc', 'cvc', 'cvv', 'csc', 'securitycode', 'security-code', 'card-code', 'cardcode'],
    name: ['cc-name', 'cardholder', 'card-holder', 'nameoncard', 'ccname', 'card_name'],
  };
  function set(el, val) {
    if (!el || val == null) return;
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o) => o.value == val || o.text == val || o.value.padStart(2, '0') == String(val).padStart(2, '0'));
      if (opt) el.value = opt.value;
    } else {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(el, val); else el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fillCard(card) {
    const number = String(card.number || '').replace(/\s+/g, '');
    set(firstByHint(HINTS.number), number);
    if (card.cardholder) set(firstByHint(HINTS.name), card.cardholder);
    if (card.cvv) set(firstByHint(HINTS.cvc), card.cvv);
    const mm = (card.expiry || '').replace(/[^0-9]/g, '').slice(0, 2);
    const yy = (card.expiry || '').replace(/[^0-9]/g, '').slice(-2);
    const combined = firstByHint(HINTS.exp);
    const monthEl = firstByHint(HINTS.month);
    const yearEl = firstByHint(HINTS.year);
    if (monthEl || yearEl) { if (monthEl && mm) set(monthEl, mm); if (yearEl && yy) set(yearEl, yy); }
    else if (combined && mm && yy) set(combined, `${mm}/${yy}`);
  }

  // Tiny shadow-DOM picker
  let host, shadow, panel;
  function ui() {
    if (shadow) return shadow;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0';
    shadow = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = `
      *{box-sizing:border-box;font-family:-apple-system,Segoe UI,system-ui,sans-serif}
      .p{position:fixed;min-width:230px;max-width:300px;background:#141419;color:#f5f5f7;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 50px -12px rgba(0,0,0,.7);padding:6px;font-size:13px}
      .h{display:flex;align-items:center;gap:7px;padding:8px 10px 6px;color:#9a9aa3;font-size:11px}
      .h b{color:#f5f5f7;font-weight:600}
      .r{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;border:none;background:none;width:100%;text-align:left;color:inherit}
      .r:hover{background:rgba(255,255,255,.07)}
      .tile{width:30px;height:20px;border-radius:4px;background:linear-gradient(135deg,#ff453a,#b3261e);flex:none}
      .t{font-weight:600}.s{color:#9a9aa3;font-size:11px}`;
    shadow.appendChild(st);
    (document.documentElement || document.body).appendChild(host);
    return shadow;
  }
  function close() { if (panel) { panel.remove(); panel = null; } }

  async function offer(numberEl) {
    let cards = [];
    try { cards = await ipcRenderer.invoke('wallet-cards-for-fill'); } catch (_) { return; }
    if (!cards || !cards.length) return;
    close();
    const s = ui();
    const rect = numberEl.getBoundingClientRect();
    panel = document.createElement('div');
    panel.className = 'p';
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 312)) + 'px';
    panel.style.top = Math.min(rect.bottom + 6, window.innerHeight - 20) + 'px';
    const h = document.createElement('div'); h.className = 'h';
    const b = document.createElement('b'); b.textContent = 'Tieddr Wallet';
    h.append(document.createTextNode('🍐 '), b, document.createTextNode(` · ${cards.length} card${cards.length === 1 ? '' : 's'}`));
    panel.append(h);
    for (const c of cards) {
      const row = document.createElement('button'); row.className = 'r';
      const tile = document.createElement('span'); tile.className = 'tile';
      const meta = document.createElement('span');
      const t = document.createElement('span'); t.className = 't'; t.textContent = `${c.brand} •••• ${c.last4}`;
      const sub = document.createElement('span'); sub.className = 's'; sub.textContent = c.cardholder || (c.expiry ? `Exp ${c.expiry}` : '');
      const br = document.createElement('br');
      meta.append(t, br, sub);
      row.append(tile, meta);
      row.addEventListener('click', async () => {
        try { const card = await ipcRenderer.invoke('wallet-fill', c.id); if (card) fillCard(card); } catch (_) {}
        close();
      });
      panel.append(row);
    }
    s.appendChild(panel);
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && el.tagName === 'INPUT') {
      const num = firstByHint(HINTS.number);
      if (num && (el === num || hint(el).match(/card|cc-|cvc|cvv/))) offer(num);
    }
  }, true);
  document.addEventListener('click', (e) => { if (panel && !(e.composedPath && e.composedPath().includes(panel))) close(); });
})();
