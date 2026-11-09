/**
 * WebCrypto layer for the Tieddr Vault, built into Flow Browser's main process.
 * A CommonJS port of the mobile/desktop/extension crypto:
 *
 *   • PBKDF2-HMAC-SHA256 → 256-bit key (AES-256-GCM, 12-byte IV, 128-bit tag)
 *   • Iteration count is VERSIONED per vault (stored in meta.kdf/auth.iterations
 *     and honored on verify), so old vaults keep opening while new vaults and
 *     PIN rotations use the current target below.
 *
 * Electron's main process is Node. We bind Web Crypto explicitly via
 * require('crypto').webcrypto (available since Node 15) rather than the global
 * `crypto`, because that global wasn't unflagged until Node 20 — Electron 28
 * runs Node 18. Base64 uses Buffer (always present in Node) for the same reason.
 */
const crypto = require("crypto").webcrypto;
const nodeCrypto = require("crypto");

const PBKDF2_ITERATIONS = 600_000; // target for NEW vaults/PIN rotations (OWASP SHA-256 guidance)
const PBKDF2_MIN_ITERATIONS = 50_000; // lowest stored count we will honor (DoS bound below)
const PBKDF2_MAX_ITERATIONS = 2_000_000; // highest stored count we will honor (DoS bound above)
const KEY_BYTES = 32; // AES-256
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM nonce

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/* --------------------------------------------------------------- base64 */
function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function fromBase64(str) {
  const s = String(str || "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!s || s.length % 4 !== 0) throw new Error("bad-base64");
  return new Uint8Array(Buffer.from(s, "base64"));
}
function base64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ------------------------------------------------------------------ hex */
function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(hex) {
  const s = String(hex || "");
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0 || s.length > 256) throw new Error("bad-hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---------------------------------------------------- key derivation */
async function assertKdfIterations(iterations) {
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
    throw new Error("unsupported-kdf");
  }
}
async function deriveAesKey(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
  await assertKdfIterations(iterations);
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: the key is usable, never exportable
    ["encrypt", "decrypt"],
  );
}
async function verifierHash(input, saltBytes, iterations = PBKDF2_ITERATIONS) {
  await assertKdfIterations(iterations);
  const base = await crypto.subtle.importKey("raw", enc.encode(input), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    base,
    KEY_BYTES * 8,
  );
  return toHex(new Uint8Array(bits));
}
function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return nodeCrypto.timingSafeEqual(ab, bb);
  } catch (_) {
    let diff = 0;
    for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
    return diff === 0;
  }
}

/* ----------------------------------------------------- AES-256-GCM */
async function encryptString(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  return { iv: toBase64(iv), ct: toBase64(ct) };
}
async function decryptString(cipher, key) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(cipher.iv) }, key, fromBase64(cipher.ct));
  return dec.decode(pt);
}

/* ------------------------------------------------------------- SHA-256 */
async function sha256Hex(input) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return toHex(new Uint8Array(d));
}
async function sha256Base64Url(input) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return base64Url(new Uint8Array(d));
}

module.exports = {
  PBKDF2_ITERATIONS, PBKDF2_MIN_ITERATIONS, PBKDF2_MAX_ITERATIONS, KEY_BYTES, SALT_BYTES, IV_BYTES,
  randomBytes, toBase64, fromBase64, base64Url, toHex, hexToBytes,
  deriveAesKey, verifierHash, timingSafeEqual,
  encryptString, decryptString, sha256Hex, sha256Base64Url,
};
