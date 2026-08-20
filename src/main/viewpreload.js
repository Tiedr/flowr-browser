// Runs inside every web page (isolated from page JS). Handles password autofill
// on load and capture on submit, talking to the main process over IPC. It never
// exposes anything to the page — no contextBridge, just DOM + ipc.
const { ipcRenderer } = require('electron');

// Chromium can surface conditional passkey UI before a user explicitly asks
// for it. Flowr blocks WebAuthn credential requests by default; the user can
// opt back in from Privacy settings.
try {
  const privacy = ipcRenderer.sendSync('privacy-web-preferences') || {};
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
} catch (_) {}

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

async function autofill() {
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
