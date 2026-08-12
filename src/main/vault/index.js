const {
  PBKDF2_ITERATIONS, SALT_BYTES,
  deriveAesKey, randomBytes, toHex, verifierHash,
} = require("./crypto.js");
const V = require("./vault.js");
const store = require("./store.js");
const session = require("./session.js");
const account = require("./account.js");
const { fetchVaultMeta, pushItem, pushTombstone, syncNow } = require("./sync.js");

/**
 * The Tieddr Vault core, built into Flow's main process. Owns the derived key
 * (session.js, memory-only) and every credential operation. main.js calls these
 * from IPC handlers; the renderer and pages never see the key. Mirrors the
 * desktop app's core, adding Tieddr Wallet ops and a migration path for Flow's
 * pre-existing local passwords.
 */

function init(profileId) { store.init(profileId); }
function setJwt(jwt, exp) { account.setJwt(jwt, exp); }
/** Hand the vault Flow's current Account access token so sync can mint per-user
 *  Appwrite JWTs on demand (falls back to the API key if minting fails). */
function setAccessToken(token, exp) { account.setAccessToken(token, exp); }
function onLock(cb) { session.onLock(cb); }

async function createMeta(uid, pin) {
  const kdfSalt = randomBytes(SALT_BYTES);
  const authSalt = randomBytes(SALT_BYTES);
  const pass = V.passphrase(uid, pin);
  const key = await deriveAesKey(pass, kdfSalt, PBKDF2_ITERATIONS);
  const meta = {
    kdf: { salt: toHex(kdfSalt), iterations: PBKDF2_ITERATIONS },
    auth: { salt: toHex(authSalt), verifier: await verifierHash(pass, authSalt, PBKDF2_ITERATIONS), iterations: PBKDF2_ITERATIONS },
  };
  return { meta, key };
}

async function cacheUpsert(item, key) {
  const cache = await store.getItemsCache();
  const cipher = await V.encryptItem(item, key);
  const entry = { itemId: item.id, iv: cipher.iv, ct: cipher.ct, updatedAt: V.itemVersion(item) };
  const idx = cache.findIndex((e) => e.itemId === item.id);
  if (idx >= 0) cache[idx] = entry; else cache.push(entry);
  await store.setItemsCache(cache);
}

async function currentItems(key) { return V.decryptItems(await store.getItemsCache(), key); }

/* --------------------------------------------------------------- state */
async function state() {
  const meta = await store.getMeta();
  return { unlocked: session.isUnlocked(), hasVault: !!meta };
}

/* -------------------------------------------------------------- unlock */
async function unlock(uid, pin) {
  if (!uid) throw new Error("Sign in with Tieddr Account first");
  if (!/^\d{6}$/.test(String(pin || ""))) throw new Error("PIN must be 6 digits");

  let meta = (await fetchVaultMeta(uid)) || (await store.getMeta());
  let key, created = false;
  if (meta) {
    try {
      key = await V.deriveAndVerify(uid, pin, meta);
    } catch (e) {
      throw new Error(e.message === "wrong-pin" ? "That PIN doesn't match this account's vault" : "Couldn't unlock");
    }
  } else {
    const c = await createMeta(uid, pin); meta = c.meta; key = c.key; created = true;
  }
  await store.setMeta(meta);
  session.setSession(uid, key);

  const result = await syncNow(uid, key).catch(() => null);
  const items = (result && result.items) || (await currentItems(key));
  return { ok: true, created, count: items.length, synced: (result && result.status) || "skipped" };
}

function lock() { session.lock(); return { ok: true }; }

async function sync() {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  const r = await syncNow(s.uid, s.key);
  return { ok: true, ...r };
}

/* --------------------------------------------------- items (UI + autofill) */
async function listItems() {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  session.armAutoLock();
  return { ok: true, items: (await currentItems(s.key)).map(publicItem) };
}

// Never send raw secret values to the UI list; reveal/copy fetch them explicitly.
function publicItem(i) {
  const out = { id: i.id, type: i.type, title: i.title, username: i.username || "", url: i.url || "", tag: i.tag || "", favorite: !!i.favorite, updatedAt: i.updatedAt };
  if (i.type === V.ItemType.CREDIT_CARD && i.cardMeta) {
    out.brand = i.tag || V.detectBrand(i.cardMeta.number);
    out.last4 = V.last4(i.cardMeta.number);
    out.expiry = i.cardMeta.expiry || "";
  }
  return out;
}

async function reveal(id) {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  const item = (await currentItems(s.key)).find((i) => i.id === id);
  if (!item) return { ok: false, error: "not-found" };
  if (item.type === V.ItemType.CREDIT_CARD && item.cardMeta) return { ok: true, card: item.cardMeta, cardholder: item.username || "" };
  return { ok: true, value: item.value || "" };
}

/** Password credential for a page origin (autofill). Bumps usage + pushes. */
async function getForOrigin(origin) {
  const s = session.getSession();
  if (!s) return null;
  const host = V.hostOf(origin);
  const items = await currentItems(s.key);
  const m = V.passwordMatches(items, host)[0];
  if (!m) return null;
  m.usedCount = (m.usedCount || 0) + 1; m.lastUsedAt = Date.now(); m.updatedAt = Date.now();
  await cacheUpsert(m, s.key);
  void pushItem(s.uid, m, s.key).catch(() => {});
  return { username: m.username || "", password: m.value || "" };
}

/** True if this origin already has a login with this username (save de-dupe). */
async function hasLogin(origin, username) {
  const s = session.getSession();
  if (!s) return { unlocked: false, exists: false };
  const exists = V.passwordMatches(await currentItems(s.key), V.hostOf(origin))
    .some((i) => (i.username || "").toLowerCase() === (username || "").toLowerCase());
  return { unlocked: true, exists };
}

/** Save/replace a login captured on submit or added in the UI. */
async function saveLogin({ origin, url, username, password, title }) {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  const site = url || origin || "";
  const host = V.hostOf(site);
  const items = await currentItems(s.key);
  const existing = V.passwordMatches(items, host).find((i) => (i.username || "").toLowerCase() === (username || "").toLowerCase());
  let item;
  if (existing) { item = { ...existing, value: password, updatedAt: Date.now() }; }
  else { item = V.newPasswordItem({ title: title || host, username, password, url: site }); }
  await cacheUpsert(item, s.key);
  await pushItem(s.uid, item, s.key).catch(() => {});
  return { ok: true, id: item.id };
}

async function addItem(payload) {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  let item;
  if (payload.type === V.ItemType.PASSWORD) item = V.newPasswordItem(payload);
  else if (payload.type === V.ItemType.CREDIT_CARD) item = V.newCardItem(payload);
  else item = V.newSecretItem(payload);
  await cacheUpsert(item, s.key);
  await pushItem(s.uid, item, s.key).catch(() => {});
  return { ok: true, id: item.id };
}

async function deleteItem(id) {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  await store.setItemsCache((await store.getItemsCache()).filter((e) => e.itemId !== id));
  await pushTombstone(s.uid, id).catch(() => {});
  return { ok: true };
}

/* ------------------------------------------------------- Tieddr Wallet */
/** Cards for the checkout autofill picker — metadata only (no PAN/CVC). */
async function cardsForFill() {
  const s = session.getSession();
  if (!s) return [];
  return V.cardItems(await currentItems(s.key)).map((c) => ({
    id: c.id, title: c.title, brand: c.tag || V.detectBrand(c.cardMeta.number),
    last4: V.last4(c.cardMeta.number), cardholder: c.username || "", expiry: c.cardMeta.expiry || "",
  }));
}

/** The chosen card's fields — sent only on an explicit user pick, to fill. */
async function fillCard(id) {
  const s = session.getSession();
  if (!s) return null;
  const c = (await currentItems(s.key)).find((i) => i.id === id && i.type === V.ItemType.CREDIT_CARD);
  if (!c || !c.cardMeta) return null;
  c.usedCount = (c.usedCount || 0) + 1; c.lastUsedAt = Date.now(); c.updatedAt = Date.now();
  await cacheUpsert(c, s.key);
  void pushItem(s.uid, c, s.key).catch(() => {});
  return { cardholder: c.username || "", number: c.cardMeta.number, expiry: c.cardMeta.expiry || "", cvv: c.cardMeta.cvv || "" };
}

/* --------------------------------------------- migrate Flow's local logins */
/** One-time import of Flow's pre-vault local passwords. Skips dupes. */
async function migrateLocalPasswords(list) {
  const s = session.getSession();
  if (!s || !Array.isArray(list) || !list.length) return { ok: true, imported: 0 };
  const items = await currentItems(s.key);
  let imported = 0;
  for (const p of list) {
    if (!p || !p.password) continue;
    const host = V.hostOf(p.origin || "");
    const dupe = V.passwordMatches(items, host).some((i) => (i.username || "").toLowerCase() === (p.username || "").toLowerCase());
    if (dupe) continue;
    const item = V.newPasswordItem({ title: host, username: p.username, password: p.password, url: p.origin });
    item.source = "flow-migrated";
    await cacheUpsert(item, s.key);
    items.push(item);
    await pushItem(s.uid, item, s.key).catch(() => {});
    imported++;
  }
  return { ok: true, imported };
}

async function changePin(newPin) {
  const s = session.getSession();
  if (!s) return { ok: false, error: "locked" };
  if (!/^\d{6}$/.test(String(newPin || ""))) throw new Error("PIN must be 6 digits");
  
  // Create new meta with the new PIN
  const meta = await store.getMeta();
  if (!meta) return { ok: false, error: "no-vault" };
  
  // Re-derive key with new PIN
  const newKey = await V.deriveAndVerify(s.uid, newPin, meta).catch(() => null);
  if (!newKey) {
    // If verification fails, we need to re-create meta with new PIN
    const c = await createMeta(s.uid, newPin);
    await store.setMeta(c.meta);
    session.setSession(s.uid, c.key);
  } else {
    session.setSession(s.uid, newKey);
  }
  
  return { ok: true };
}

module.exports = {
  init, setJwt, setAccessToken, onLock, state, unlock, lock, sync,
  listItems, reveal, getForOrigin, hasLogin, saveLogin, addItem, deleteItem,
  cardsForFill, fillCard, migrateLocalPasswords, changePin,
  isUnlocked: () => session.isUnlocked(),
  getFailedAttempts: () => session.getFailedAttempts(),
  incrementFailedAttempts: () => session.incrementFailedAttempts(),
};
