const { APPWRITE } = require("./config.js");

/**
 * Dependency-free Appwrite REST client (CommonJS) — the Flow twin of the mobile/
 * desktop client. Same four Database operations, same headers, same document
 * schema, so Flow drives the SAME encrypted mirror. Uses global fetch (Node 18+/
 * Electron). JWT rides in X-Appwrite-JWT when present, else the server key in
 * X-Appwrite-Key.
 */

class AppwriteError extends Error {
  constructor(message, status, type) {
    super(message);
    this.name = "AppwriteError";
    this.status = status;
    this.type = type;
  }
}
class NetworkError extends Error {
  constructor(message = "Network unreachable") {
    super(message);
    this.name = "NetworkError";
  }
}

const REQUEST_TIMEOUT_MS = 8000;

const Query = {
  equal: (attribute, value) => JSON.stringify({ method: "equal", attribute, values: [value] }),
  greaterThan: (attribute, value) => JSON.stringify({ method: "greaterThan", attribute, values: [value] }),
  limit: (n) => JSON.stringify({ method: "limit", values: [n] }),
  offset: (n) => JSON.stringify({ method: "offset", values: [n] }),
  orderAsc: (attribute) => JSON.stringify({ method: "orderAsc", attribute }),
};

function docBase(collectionId) {
  return `${APPWRITE.endpoint}/databases/${APPWRITE.databaseId}/collections/${collectionId}/documents`;
}
function headers(jwt) {
  const h = { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE.projectId };
  if (jwt) h["X-Appwrite-JWT"] = jwt;
  else if (APPWRITE.apiKey) h["X-Appwrite-Key"] = APPWRITE.apiKey;
  return h;
}

async function request(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new NetworkError(e && e.message ? e.message : "Network request failed");
  } finally {
    clearTimeout(timer);
  }
}
async function ensureOk(res) {
  if (res.ok) return;
  let message = res.statusText;
  let type;
  try {
    const body = await res.json();
    if (body.message) message = body.message;
    type = body.type;
  } catch (_) {}
  throw new AppwriteError(message, res.status, type);
}

async function listDocuments(collectionId, queries, jwt) {
  const pageSize = 100;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const qs = [...queries, Query.limit(pageSize), Query.offset(offset)]
      .map((q) => `queries[]=${encodeURIComponent(q)}`)
      .join("&");
    const res = await request(`${docBase(collectionId)}?${qs}`, { method: "GET", headers: headers(jwt) });
    await ensureOk(res);
    const body = await res.json();
    all.push(...body.documents);
    if (body.documents.length < pageSize) break;
  }
  return all;
}

/** Per-document owner permissions — the row is readable/writable only by `uid`. */
function ownerPermissions(uid) {
  return [`read("user:${uid}")`, `update("user:${uid}")`, `delete("user:${uid}")`];
}

/**
 * Create-or-update at a deterministic id: POST, fall back to PATCH on 409.
 * `permissions` (owner grants) are set ONLY on create — the collections use
 * document security, so a new row must name its owner or nobody (not even the
 * JWT creator) could read it back. Honored under the API-key fallback too.
 */
async function upsertDocument(collectionId, documentId, data, jwt, permissions) {
  const createBody = { documentId, data };
  if (permissions) createBody.permissions = permissions;
  const createRes = await request(docBase(collectionId), {
    method: "POST",
    headers: headers(jwt),
    body: JSON.stringify(createBody),
  });
  if (createRes.ok) return;
  if (createRes.status !== 409) {
    await ensureOk(createRes);
    return;
  }
  const patchRes = await request(`${docBase(collectionId)}/${documentId}`, {
    method: "PATCH",
    headers: headers(jwt),
    body: JSON.stringify({ data }),
  });
  await ensureOk(patchRes);
}

module.exports = { AppwriteError, NetworkError, Query, listDocuments, ownerPermissions, upsertDocument };
