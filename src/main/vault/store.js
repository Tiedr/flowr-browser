const Store = require("../store.js");

/**
 * Local persistence for Flow's vault, per profile, via Flow's own Store (JSON in
 * userData). Holds NON-secret meta (KDF/verifier) + the CIPHERTEXT item cache +
 * the sync watermark only. The AES key and decrypted items never touch disk
 * (see session.js). Same accessor names the shared sync.js expects.
 */
let s = null;

function init(profileId) {
  s = new Store(`profiles/${profileId || "default"}/vault`, { meta: null, itemsCache: [], watermark: 0 });
}
function ensure() {
  if (!s) init("default");
  return s;
}

async function getMeta() { return ensure().get("meta"); }
async function setMeta(m) { ensure().set("meta", m); }
async function getItemsCache() { const c = ensure().get("itemsCache"); return Array.isArray(c) ? c : []; }
async function setItemsCache(a) { ensure().set("itemsCache", a); }
async function getWatermark() { const n = Number(ensure().get("watermark")); return Number.isFinite(n) ? n : 0; }
async function setWatermark(n) { ensure().set("watermark", n); }
async function clearAll() { ensure().set("meta", null); ensure().set("itemsCache", []); ensure().set("watermark", 0); }

/* --------------------------------------- PIN throttling (persisted) */
// Consecutive-failure counter + lockout deadline survive restarts, so an
// attacker can't reset the backoff by relaunching the app. (This throttles
// the local unlock oracle — it cannot stop an offline copy of the file being
// brute-forced elsewhere; the KDF cost is the defense there.)
async function getLockState() {
  const s = ensure();
  const a = Math.floor(Number(s.get("lockAttempts")) || 0);
  const u = Number(s.get("lockoutUntil")) || 0;
  return { attempts: a > 0 ? a : 0, lockoutUntil: u > 0 ? u : 0 };
}
async function setLockState(next) {
  const s = ensure();
  s.set("lockAttempts", Math.max(0, Math.floor(Number(next && next.attempts) || 0)));
  s.set("lockoutUntil", Math.max(0, Number(next && next.lockoutUntil) || 0));
}

module.exports = { init, getMeta, setMeta, getItemsCache, setItemsCache, getWatermark, setWatermark, clearAll, getLockState, setLockState };
