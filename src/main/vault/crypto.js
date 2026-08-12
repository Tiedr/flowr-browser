/**
 * WebCrypto layer for the Tieddr Vault, built into Flow Browser's main process.
 * A CommonJS port of the mobile/desktop/extension crypto — IDENTICAL parameters,
 * so items sync byte-for-byte across every client:
 *
 *   • PBKDF2-HMAC-SHA256, 210k iterations → 256-bit key
 *   • AES-256-GCM, 12-byte IV, 128-bit tag APPENDED to the ciphertext
 *   • standard base64 envelope { iv, ct }
 *
 * Electron's main process is Node. We bind Web Crypto explicitly via
 * require('crypto').webcrypto (available since Node 15) rather than the global
 * `crypto`, because that global wasn't unflagged until Node 20 — Electron 28
 * runs Node 18. Base64 uses Buffer (always present in Node) for the same reason.
 */
const crypto = require("crypto").webcrypto;

const PBKDF2_ITERATIONS = 210_000;
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
  return new Uint8Array(Buffer.from(String(str).replace(/[^A-Za-z0-9+/=]/g, ""), "base64"));
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
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---------------------------------------------------- key derivation */
async function deriveAesKey(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}
async function verifierHash(input, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", enc.encode(input), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    base,
    KEY_BYTES * 8,
  );
  return toHex(new Uint8Array(bits));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  PBKDF2_ITERATIONS, KEY_BYTES, SALT_BYTES, IV_BYTES,
  randomBytes, toBase64, fromBase64, base64Url, toHex, hexToBytes,
  deriveAesKey, verifierHash, timingSafeEqual,
  encryptString, decryptString, sha256Hex, sha256Base64Url,
};
