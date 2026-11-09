const {
  PBKDF2_ITERATIONS, SALT_BYTES,
  deriveAesKey, randomBytes, toHex, verifierHash,
} = require("./crypto.js");
const V = require("./vault.js");
const store = require("./store.js");
const session = require("./session.js");
const account = require("./account.js");
const { fetchVaultMeta, pushItem, pushTombstone, pushMeta, syncNow } = require("./sync.js");

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
 *  Appwrite JWTs on demand. No JWT → local-only (no fallback transport). */
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
  const lockSt = await store.getLockState().catch(() => ({ attempts: 0, lockoutUntil: 0 }));
  return {
    unlocked: session.isUnlocked(),
    hasVault: !!meta,
    // True when the stored KDF predates the current target — the UI can nudge
    // a PIN rotation (which re-encrypts at the new target). Old counts keep
    // verifying via their stored iterations.
    kdfUpgradeAvailable: !!(meta && Number(meta.kdf && meta.kdf.iterations) < PBKDF2_ITERATIONS),
    failedAttempts: lockSt.attempts,
    lockoutUntil: lockSt.lockoutUntil,
  };
}

/* --------------------------------------------- PIN throttling (persisted) */
// 5 free attempts, then escalating lockouts: 30s, 60s, 120s … capped at 15min.
// Counter + deadline live in the vault store so relaunching won't reset them.
// This throttles the LOCAL unlock oracle only — it cannot stop an offline file
// copy being attacked elsewhere; the PBKDF2 cost is the defense there.
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 15 * 60_000;
function lockoutDelayMs(attempts) {
  if (attempts < MAX_PIN_ATTEMPTS) return 0;
  return Math.min(LOCKOUT_BASE_MS * 2 ** Math.min(attempts - MAX_PIN_ATTEMPTS, 5), LOCKOUT_MAX_MS);
}
async function checkLockout() {
  const st = await store.getLockState();
  session.setFailedAttempts(st.attempts);
  if (st.lockoutUntil > Date.now()) {
    const err = new Error("locked");
    err.retryAfterMs = st.lockoutUntil - Date.now();
    err.attempts = st.attempts;
    throw err;
  }
  return st;
}
async function notePinFailure() {
  const st = await store.getLockState();
  const attempts = st.attempts + 1;
  const delay = lockoutDelayMs(attempts);
  await store.setLockState({ attempts, lockoutUntil: delay > 0 ? Date.now() + delay : 0 });
  session.setFailedAttempts(attempts);
  session.incrementFailedAttempts(); // keeps the legacy in-memory counter in sync
  if (delay > 0) {
    const err = new Error("locked");
    err.retryAfterMs = delay;
    err.attempts = attempts;
    throw err;
  }
  const err = new Error("wrong-pin");
  err.attempts = attempts;
  throw err;
}
async function resetPinFailures() {
  await store.setLockState({ attempts: 0, lockoutUntil: 0 });
  session.setFailedAttempts(0);
}

/* -------------------------------------------------------------- unlock */
async function unlock(uid, pin) {
  if (!uid) throw new Error("Sign in with Tieddr Account first");
  if (!/^\d{6}$/.test(String(pin || ""))) throw new Error("PIN must be 6 digits");
  await checkLockout();

  let meta = (await fetchVaultMeta(uid)) || (await store.getMeta());
  let key, created = false;
  if (meta) {
    try {
      key = await V.deriveAndVerify(uid, pin, meta);
    } catch (e) {
      if (e.message === "wrong-pin") {
        try { await notePinFailure(); } catch (throttle) {
          if (throttle && throttle.message === "locked") throw throttle;
        }
        throw new Error("That PIN doesn't match this account's vault");
      }
      throw new Error(e.message === "unsupported-kdf" ? "This vault needs a newer Flowr to open" : "Couldn't unlock");
    }
  } else {
    const c = await createMeta(uid, pin); meta = c.meta; key = c.key; created = true;
  }
  await store.setMeta(meta);
  await resetPinFailures();
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

/**
 * Rotate the vault to a new PIN without data loss.
 *
 * The old code derived a key from the NEW pin against the OLD verifier
 * (always "wrong-pin") then stored a fresh meta + fresh key while leaving the
 * old ciphertext cache in place — permanently undecryptable. This instead:
 *   1. verifies the current PIN against the stored meta (throws "wrong-pin"),
 *   2. decrypts every item with the OLD key (read-only — nothing is clobbered),
 *   3. creates a fresh meta/key from the NEW pin,
 *   4. re-encrypts everything into a NEW cache in memory, bumping updatedAt so
 *      the encrypted mirror accepts the re-encrypted rows as newer,
 *   5. only then swaps meta + cache + session, and best-effort pushes the new
 *      meta and every item (offline → stays local, pushed on the next sync).
 */
async function changePin(uid, currentPin, newPin) {
  if (!uid) throw new Error("Sign in with Tieddr Account first");
  if (!/^\d{6}$/.test(String(currentPin || ""))) throw new Error("wrong-pin");
  if (!/^\d{6}$/.test(String(newPin || ""))) throw new Error("PIN must be 6 digits");
  if (String(currentPin) === String(newPin)) return { ok: true, unchanged: true };
  await checkLockout();

  const meta = await store.getMeta();
  if (!meta) throw new Error("no-vault");

  // 1+2. Verify current PIN and decrypt with the OLD key. Throws "wrong-pin"
  // on mismatch — local meta/cache are untouched on failure. Failures count
  // toward the persisted throttling (a wrong current PIN here is the same
  // oracle as a wrong unlock PIN); lockouts propagate as "locked".
  let oldKey;
  try {
    oldKey = await V.deriveAndVerify(uid, String(currentPin), meta);
  } catch (e) {
    if (e.message === "wrong-pin") {
      try { await notePinFailure(); } catch (throttle) {
        if (throttle && throttle.message === "locked") throw throttle;
      }
      throw new Error("wrong-pin");
    }
    throw new Error("Couldn't verify PIN");
  }
  const items = await currentItems(oldKey);

  // 3. Fresh salts + fresh key from the NEW pin.
  const c = await createMeta(uid, String(newPin));
  const now = Date.now();

  // 4. Re-encrypt everything in memory first — no writes until this succeeds.
  const newCache = [];
  for (const item of items) {
    const rotated = { ...item, updatedAt: Math.max(Number(item.updatedAt) || 0, now) };
    const cipher = await V.encryptItem(rotated, c.key);
    newCache.push({ itemId: rotated.id, iv: cipher.iv, ct: cipher.ct, updatedAt: rotated.updatedAt });
  }

  // 5. Swap local state. Single Store file — both sets land in one flush.
  await store.setItemsCache(newCache);
  await store.setMeta(c.meta);
  await resetPinFailures();
  session.setSession(uid, c.key);

  // 6. Best-effort mirror push. Offline/mint failure → local rotation still
  // holds; the bumped updatedAt makes the next online sync push everything.
  try {
    const jwt = await account.getAppwriteJwt().catch(() => null);
    if (jwt) {
      await pushMeta(uid, jwt).catch(() => {});
      for (const item of items) {
        const rotated = { ...item, updatedAt: Math.max(Number(item.updatedAt) || 0, now) };
        await pushItem(uid, rotated, c.key).catch(() => {});
      }
    } else {
      for (const item of items) {
        const rotated = { ...item, updatedAt: Math.max(Number(item.updatedAt) || 0, now) };
        await pushItem(uid, rotated, c.key).catch(() => {});
      }
    }
  } catch (_) {}

  return { ok: true, count: items.length };
}

module.exports = {
  init, setJwt, setAccessToken, onLock, state, unlock, lock, sync,
  listItems, reveal, getForOrigin, hasLogin, saveLogin, addItem, deleteItem,
  cardsForFill, fillCard, migrateLocalPasswords, changePin,
  isUnlocked: () => session.isUnlocked(),
  getFailedAttempts: () => session.getFailedAttempts(),
  incrementFailedAttempts: () => session.incrementFailedAttempts(),
};
