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

module.exports = { init, getMeta, setMeta, getItemsCache, setItemsCache, getWatermark, setWatermark, clearAll };
