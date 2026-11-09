const {
  PBKDF2_ITERATIONS,
  PBKDF2_MIN_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  decryptString,
  deriveAesKey,
  encryptString,
  hexToBytes,
  timingSafeEqual,
  verifierHash,
} = require("./crypto.js");

/**
 * Vault domain logic (CommonJS) shared by Flow's main-process core. Mirrors the
 * mobile item model so items round-trip across phone/extension/desktop/browser,
 * and adds Tieddr Wallet (credit-card) helpers used by the checkout autofill.
 */

const ItemType = {
  PASSWORD: "PASSWORD",
  TOTP: "TOTP",
  SECRET: "SECRET",
  KEY_PHRASE: "KEY_PHRASE",
  CREDIT_CARD: "CREDIT_CARD", // Tieddr Wallet
};

/** Key material = Tieddr Account id + PIN, exactly as every other client derives it. */
function passphrase(uid, pin) {
  return `${uid}:${pin}`;
}

async function deriveAndVerify(uid, pin, meta) {
  const pass = passphrase(uid, pin);
  if (!meta || !meta.auth || !meta.auth.verifier) throw new Error("no-verifier");
  // Bound stored KDF parameters: the meta can arrive from the network mirror,
  // so a corrupt or hostile row must never dictate unbounded work. hexToBytes
  // additionally rejects malformed salts.
  const authIterations = Number(meta.auth.iterations) || PBKDF2_ITERATIONS;
  const kdfIterations = Number(meta.kdf && meta.kdf.iterations) || PBKDF2_ITERATIONS;
  for (const n of [authIterations, kdfIterations]) {
    if (!Number.isInteger(n) || n < PBKDF2_MIN_ITERATIONS || n > PBKDF2_MAX_ITERATIONS) throw new Error("unsupported-kdf");
  }
  let kdfSalt, authSalt;
  try {
    authSalt = hexToBytes(meta.auth.salt);
    kdfSalt = hexToBytes(meta.kdf.salt);
  } catch (_) {
    throw new Error("unsupported-kdf");
  }
  const candidate = await verifierHash(pass, authSalt, authIterations);
  if (!timingSafeEqual(candidate, meta.auth.verifier)) throw new Error("wrong-pin");
  return deriveAesKey(pass, kdfSalt, kdfIterations);
}

async function decryptItems(cacheEntries, key) {
  const items = [];
  for (const e of cacheEntries) {
    if (e.deleted) continue;
    try {
      items.push(JSON.parse(await decryptString({ iv: e.iv, ct: e.ct }, key)));
    } catch (_) { /* different key / corrupt — skip */ }
  }
  return items;
}
async function encryptItem(item, key) {
  return encryptString(JSON.stringify(item), key);
}
function itemVersion(i) {
  return i.updatedAt || i.createdAt || 0;
}

/* ------------------------------------------------------- origin matching */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}
function itemMatchesHost(item, pageHost) {
  // Fail closed against phishing: a saved login matches only its exact host
  // or a SUBDOMAIN of it (pageHost === target or pageHost ends with
  // "." + target). Never the reverse (a login saved on login.example.com must
  // not fill on example.com or evil-login.example.com), and never fuzzy
  // title matching — attacker pages pick their own titles. Items without a
  // stored URL never match.
  if (!pageHost) return false;
  const target = item.url ? hostOf(item.url) : "";
  if (!target) return false;
  return pageHost === target || pageHost.endsWith(`.${target}`);
}
function passwordMatches(items, pageHost) {
  return items
    .filter((i) => i.type === ItemType.PASSWORD && itemMatchesHost(i, pageHost))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (b.usedCount || 0) - (a.usedCount || 0));
}

/* ---------------------------------------------------------- item builders */
function newId() {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}
function newPasswordItem({ title, username, password, url }) {
  const now = Date.now();
  return { id: newId(), type: ItemType.PASSWORD, title: title || hostOf(url) || "Login", username: username || "", value: password || "", url: url || "", createdAt: now, updatedAt: now, source: "extension" };
}
function newSecretItem({ title, value, tag, type }) {
  const now = Date.now();
  return { id: newId(), type: type === ItemType.KEY_PHRASE ? ItemType.KEY_PHRASE : ItemType.SECRET, title: title || "Secret", value: value || "", tag: tag || "", createdAt: now, updatedAt: now, source: "extension" };
}

/* --------------------------------------------------------- Tieddr Wallet */
const CARD_BRANDS = [
  [/^4/, "Visa"],
  [/^(5[1-5]|2[2-7])/, "Mastercard"],
  [/^3[47]/, "Amex"],
  [/^6(011|5|4[4-9])/, "Discover"],
  [/^(50|5[6-9]|6[0-9])/, "Verve"],
];
function detectBrand(number) {
  const n = String(number || "").replace(/\D/g, "");
  for (const [re, brand] of CARD_BRANDS) if (re.test(n)) return brand;
  return "Card";
}
function last4(number) {
  return String(number || "").replace(/\D/g, "").slice(-4);
}
/** Build a Tieddr Wallet card item. Stored like the mobile CREDIT_CARD type. */
function newCardItem({ title, cardholder, number, expiry, cvv, brand }) {
  const now = Date.now();
  const b = brand || detectBrand(number);
  return {
    id: newId(),
    type: ItemType.CREDIT_CARD,
    title: title || `${b} •••• ${last4(number)}`,
    username: cardholder || "",
    value: "",
    tag: b,
    cardMeta: { number: String(number || "").replace(/\s+/g, ""), expiry: expiry || "", cvv: cvv || "" },
    createdAt: now,
    updatedAt: now,
    source: "extension",
  };
}
function cardItems(items) {
  return items
    .filter((i) => i.type === ItemType.CREDIT_CARD && i.cardMeta)
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (b.usedCount || 0) - (a.usedCount || 0));
}

module.exports = {
  ItemType, passphrase, deriveAndVerify, decryptItems, encryptItem, itemVersion,
  hostOf, itemMatchesHost, passwordMatches,
  newPasswordItem, newSecretItem, newCardItem, cardItems, detectBrand, last4,
};
