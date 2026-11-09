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
 * SECURITY: sync transport is JWT-only. Flow mints a per-user Appwrite JWT
 * from the Tieddr Account access token via the vault-sso bridge (see
 * account.js). No API key is read, embedded, or sent — a key shipped inside
 * the packaged app would be extractable from the asar. No JWT → the vault
 * stays local-only (no sync).
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
};

const AUTO_LOCK_MINUTES = 15;

module.exports = { TIEDDR, APPWRITE, AUTO_LOCK_MINUTES };
