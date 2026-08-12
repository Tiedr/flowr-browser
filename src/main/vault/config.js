let APPWRITE_API_KEY = "";
try { APPWRITE_API_KEY = require("./config.local.js").APPWRITE_API_KEY || ""; } catch (_) { /* no local key → local-only */ }

/**
 * Tieddr ecosystem endpoints for the Tieddr Vault built into Flow Browser.
 * Same Appwrite project + `vault` database + collections as the mobile app,
 * Chrome extension, and desktop app, so Flow reads/writes the SAME encrypted
 * mirror — a password saved in Flow shows up on the phone, and vice-versa.
 */
const TIEDDR = {
  accountBase: "https://account.tieddr.com",
  accountApiBase: "https://api.account.tieddr.com",
  scope: "email profile",
};

/**
 * Appwrite — the Vault's own `vault` database, used ONLY as an opaque encrypted
 * mirror (every synced document holds AES-256-GCM ciphertext).
 *
 * SECURITY: `apiKey` is the sync transport until a per-user Tieddr-Account →
 * Appwrite JWT is available. It lives in `config.local.js` (gitignored), is NOT
 * committed, and Flow additionally holds only ciphertext on disk. Replace with a
 * scoped key / token-exchange before public release. Null → Flow's vault is
 * local-only (no sync).
 */
const APPWRITE = {
  endpoint: "https://appwriteone.ughoron.cloud/v1",
  projectId: "6a2736880012b5460a01",
  databaseId: "vault",
  itemsCollectionId: "vault_items",
  metaCollectionId: "vault_meta",
  // Account→Appwrite JWT bridge (Appwrite Function, execute:["any"]). Flow posts
  // its Tieddr Account access token to this function's /jwt route via a keyless
  // sync execution to mint a per-user Appwrite JWT — no admin key on the client.
  // See account.js `mintAppwriteJwt`.
  vaultSsoFn: "vault-sso",
  apiKey: APPWRITE_API_KEY || null,
};

const AUTO_LOCK_MINUTES = 15;

module.exports = { TIEDDR, APPWRITE, AUTO_LOCK_MINUTES };
