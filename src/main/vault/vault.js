const {
  PBKDF2_ITERATIONS,
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
  const candidate = await verifierHash(pass, hexToBytes(meta.auth.salt), meta.auth.iterations);
  if (!timingSafeEqual(candidate, meta.auth.verifier)) throw new Error("wrong-pin");
  return deriveAesKey(pass, hexToBytes(meta.kdf.salt), meta.kdf.iterations || PBKDF2_ITERATIONS);
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
function baseDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoLabel = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  const last2 = parts.slice(-2);
  if (twoLabel.has(last2[0]) && last2[1].length <= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
function itemMatchesHost(item, pageHost) {
  if (!pageHost) return false;
  const target = item.url ? hostOf(item.url) : "";
  if (target) return target === pageHost || baseDomain(target) === baseDomain(pageHost);
  const t = (item.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = pageHost.replace(/[^a-z0-9]/g, "");
  return !!t && (h.includes(t) || t.includes(baseDomain(pageHost).split(".")[0]));
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
