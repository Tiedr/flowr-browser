/**
 * Appwrite-JWT provider for sync. Flow owns Tieddr Account sign-in in main.js
 * (it captures the access token + the account `uid` via userinfo). main.js hands
 * the access token here via setAccessToken(); getAppwriteJwt() then mints a
 * per-user Appwrite JWT on demand through the vault-sso bridge and caches it,
 * re-minting when it lapses. No JWT and no key (config.js) → local-only.
 *
 * The mint is a KEYLESS Appwrite sync execution (project header only — the
 * vault-sso function has execute:["any"]); the function validates the bearer
 * against Account's userinfo and mints a JWT for that identity, so no admin
 * credential ever lives in Flow.
 */
const { APPWRITE } = require("./config.js");

const EXPIRY_SKEW_MS = 30_000;

let _jwt = null;
let _exp = 0;
let _accessToken = null;
let _accessTokenExp = 0; // 0 = unknown; we then just try the token and fall back.

function stillValid(expUnixSeconds) {
  return !!expUnixSeconds && expUnixSeconds * 1000 > Date.now() + EXPIRY_SKEW_MS;
}

/** Legacy direct setter (kept for callers that already hold a minted JWT). */
function setJwt(jwt, exp) { _jwt = jwt || null; _exp = exp || 0; }

/** main.js calls this on sign-in / unlock with the current Account access token. */
function setAccessToken(token, exp) {
  _accessToken = token || null;
  _accessTokenExp = exp || 0;
  // A new token invalidates any JWT minted from an older one.
  _jwt = null;
  _exp = 0;
}

async function mintAppwriteJwt(accessToken) {
  try {
    const res = await fetch(`${APPWRITE.endpoint}/functions/${APPWRITE.vaultSsoFn}/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE.projectId },
      body: JSON.stringify({
        path: "/jwt",
        method: "POST",
        // The token rides in the function's request BODY: Appwrite strips custom
        // Authorization headers from executions, so a header wouldn't arrive.
        body: JSON.stringify({ access_token: accessToken }),
        async: false,
      }),
    });
    if (!res.ok) return null;
    const exec = await res.json();
    if (exec.responseStatusCode !== 200 || !exec.responseBody) return null;
    const body = JSON.parse(exec.responseBody);
    if (!body.jwt) return null;
    return { jwt: body.jwt, exp: body.exp || Math.floor(Date.now() / 1000) + 840 };
  } catch (_) {
    return null;
  }
}

async function getAppwriteJwt() {
  if (_jwt && stillValid(_exp)) return _jwt;

  // Mint from the access token. If its expiry is known, respect it; if unknown
  // (0), attempt anyway — a dead token just yields null and sync uses the key.
  if (_accessToken && (_accessTokenExp === 0 || stillValid(_accessTokenExp))) {
    const minted = await mintAppwriteJwt(_accessToken);
    if (minted) {
      _jwt = minted.jwt;
      _exp = minted.exp;
      return _jwt;
    }
  }
  return null;
}

module.exports = { setJwt, setAccessToken, getAppwriteJwt };
