const { APPWRITE } = require("./config.js");
const { sha256Hex, decryptString } = require("./crypto.js");
const { getAppwriteJwt } = require("./account.js");
const { AppwriteError, NetworkError, Query, listDocuments, ownerPermissions, upsertDocument } = require("./appwrite.js");
const { decryptItems, encryptItem, itemVersion } = require("./vault.js");
const { getItemsCache, setItemsCache, getMeta, getWatermark, setWatermark } = require("./store.js");

/**
 * Offline-first encrypted-mirror sync (CommonJS) — the Flow twin of the shared
 * reconcile. Full pull → last-write-wins merge by each item's updatedAt → push
 * locally-newer items. Everything on the wire is AES-GCM ciphertext. The local
 * cache is rebuilt to the merged state.
 */
const COLL = APPWRITE.itemsCollectionId;
const META_COLL = APPWRITE.metaCollectionId;

async function docId(uid, itemId) {
  return (await sha256Hex(`${uid}:${itemId}`)).slice(0, 36);
}
async function haveTransport(jwt) {
  return !!jwt || !!APPWRITE.apiKey;
}

async function syncNow(uid, key) {
  const jwt = await getAppwriteJwt();
  if (!(await haveTransport(jwt))) {
    return { status: "skipped", pulled: 0, pushed: 0, items: await decryptItems(await getItemsCache(), key) };
  }
  await pushMeta(uid, jwt).catch(() => {});

  const watermark = await getWatermark();
  const oldCache = await getItemsCache();
  const oldById = new Map(oldCache.map((e) => [e.itemId, e]));
  const byId = new Map((await decryptItems(oldCache, key)).map((i) => [i.id, i]));
  const cipherById = new Map();

  let remote;
  try {
    remote = await listDocuments(COLL, [Query.equal("userId", uid)], jwt);
  } catch (e) {
    return failure(e, byId);
  }

  const pulledIds = new Set();
  let highestVersion = watermark;

  for (const doc of remote) {
    highestVersion = Math.max(highestVersion, doc.updatedAt);
    const local = byId.get(doc.itemId);
    if (doc.deleted) {
      if (local && itemVersion(local) <= doc.updatedAt) byId.delete(doc.itemId);
      continue;
    }
    if (local && itemVersion(local) >= doc.updatedAt) continue;
    let item;
    try {
      item = JSON.parse(await decryptString({ iv: doc.iv, ct: doc.ct }, key));
    } catch (_) { continue; }
    byId.set(item.id, item);
    pulledIds.add(item.id);
    cipherById.set(item.id, { iv: doc.iv, ct: doc.ct, updatedAt: doc.updatedAt });
  }

  const toPush = [...byId.values()].filter((i) => itemVersion(i) > watermark && !pulledIds.has(i.id));
  let pushed = 0;
  let offline = false;

  for (const item of toPush) {
    const cipher = await encryptItem(item, key);
    try {
      await upsertDocument(COLL, await docId(uid, item.id),
        { userId: uid, itemId: item.id, iv: cipher.iv, ct: cipher.ct, updatedAt: itemVersion(item), deleted: false }, jwt, ownerPermissions(uid));
      pushed++;
      highestVersion = Math.max(highestVersion, itemVersion(item));
      cipherById.set(item.id, { iv: cipher.iv, ct: cipher.ct, updatedAt: itemVersion(item) });
    } catch (e) {
      if (e instanceof NetworkError) { offline = true; break; }
      if (e instanceof AppwriteError && (e.status === 401 || e.status === 403)) {
        return { status: "unauthenticated", pulled: pulledIds.size, pushed, items: [...byId.values()] };
      }
    }
  }

  const newCache = [];
  for (const item of byId.values()) {
    const fresh = cipherById.get(item.id);
    if (fresh) newCache.push({ itemId: item.id, iv: fresh.iv, ct: fresh.ct, updatedAt: fresh.updatedAt });
    else if (oldById.has(item.id)) newCache.push(oldById.get(item.id));
    else {
      const c = await encryptItem(item, key);
      newCache.push({ itemId: item.id, iv: c.iv, ct: c.ct, updatedAt: itemVersion(item) });
    }
  }
  await setItemsCache(newCache);
  if (!offline) await setWatermark(highestVersion);

  return { status: offline ? "offline" : "ok", pulled: pulledIds.size, pushed, items: [...byId.values()] };
}

async function pushItem(uid, item, key) {
  const jwt = await getAppwriteJwt();
  if (!(await haveTransport(jwt))) return false;
  const cipher = await encryptItem(item, key);
  await upsertDocument(COLL, await docId(uid, item.id),
    { userId: uid, itemId: item.id, iv: cipher.iv, ct: cipher.ct, updatedAt: itemVersion(item), deleted: false }, jwt, ownerPermissions(uid));
  return true;
}

async function pushTombstone(uid, itemId) {
  const jwt = await getAppwriteJwt();
  if (!(await haveTransport(jwt))) return;
  try {
    await upsertDocument(COLL, await docId(uid, itemId),
      { userId: uid, itemId, iv: "", ct: "", updatedAt: Date.now(), deleted: true }, jwt, ownerPermissions(uid));
  } catch (_) {}
}

async function pushMeta(uid, jwt) {
  const meta = await getMeta();
  if (!meta || !meta.auth || !meta.auth.verifier) return;
  await upsertDocument(META_COLL, await docId(uid, "meta"),
    { userId: uid, kdfSalt: meta.kdf.salt, kdfIter: meta.kdf.iterations, authSalt: meta.auth.salt, authVerifier: meta.auth.verifier, authIter: meta.auth.iterations }, jwt, ownerPermissions(uid));
}

async function fetchVaultMeta(uid) {
  const jwt = await getAppwriteJwt();
  if (!(await haveTransport(jwt))) return null;
  try {
    const docs = await listDocuments(META_COLL, [Query.equal("userId", uid)], jwt);
    const m = docs[0];
    if (!m) return null;
    return { kdf: { salt: m.kdfSalt, iterations: m.kdfIter }, auth: { salt: m.authSalt, verifier: m.authVerifier, iterations: m.authIter } };
  } catch (_) {
    return null;
  }
}

function failure(e, byId) {
  const items = [...byId.values()];
  if (e instanceof NetworkError) return { status: "offline", pulled: 0, pushed: 0, items };
  if (e instanceof AppwriteError && (e.status === 401 || e.status === 403)) return { status: "unauthenticated", pulled: 0, pushed: 0, items };
  return { status: "error", pulled: 0, pushed: 0, items, error: e && e.message };
}

module.exports = { syncNow, pushItem, pushTombstone, fetchVaultMeta };
