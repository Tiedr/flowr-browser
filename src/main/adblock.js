// Advertising hosts — gated by the "Ad blocker" setting.
const AD_HOSTS = new Set([
  '2mdn.net', 'adform.net', 'adnxs.com', 'adsrvr.org', 'advertising.com',
  'amazon-adsystem.com', 'atdmt.com', 'bidswitch.net', 'casalemedia.com',
  'criteo.com', 'criteo.net', 'doubleclick.net', 'everesttech.net',
  'googleadservices.com', 'googlesyndication.com', 'googletagservices.com',
  'mediaplex.com', 'moatads.com', 'openx.net', 'outbrain.com',
  'pubmatic.com', 'revjet.com', 'rubiconproject.com', 'serving-sys.com',
  'sharethrough.com', 'smartadserver.com', 'spotxchange.com', 'taboola.com',
  'teads.tv', 'turn.com', 'yieldmo.com',
  // Cryptominers ride along with the ad blocker.
  'coin-hive.com', 'coinhive.com', 'crypto-loot.com', 'jsecoin.com', 'webminepool.com',
  'adsterra.com', 'clickadu.com', 'clickaine.com', 'evadav.com', 'exoclick.com',
  'hilltopads.net', 'juicyads.com', 'mgid.com', 'monetag.com', 'onclickads.net',
  'popads.net', 'popcash.net', 'propellerads.com', 'pushground.com', 'richads.com',
  'trafficjunky.net', 'zeropark.com', 'adtrafficquality.google'
]);

// Tracking / analytics hosts — gated by the "Block common trackers" setting.
const TRACKER_HOSTS = new Set([
  'app-measurement.com', 'chartbeat.com', 'clicktale.net', 'demdex.net',
  'exelator.com', 'fullstory.com', 'google-analytics.com', 'googletagmanager.com',
  'hotjar.com', 'imrworldwide.com', 'krxd.net', 'luckyorange.com', 'mathtag.com',
  'mixpanel.com', 'mouseflow.com', 'newrelic.com', 'omtrdc.net', 'optimizely.com',
  'parsely.com', 'quantserve.com', 'scorecardresearch.com', 'segment.com', 'segment.io'
]);

const BLOCKED_HOSTS = new Set([...AD_HOSTS, ...TRACKER_HOSTS]);

// Tieddr is Flowr's first-party account and product family. Its OAuth return
// URLs legitimately contain redirect-style query parameters, and its apps use
// analytics-looking paths for product data. Never classify those first-party
// requests as advertisements. Safe Browsing is evaluated separately, so this
// does not bypass malicious-host protection.
const FIRST_PARTY_ALLOWED_HOSTS = new Set(['tieddr.com']);

// Known-dangerous hosts used by Flowr's local Safe Browsing protection
// (phishing kits, fake update pages, brand-abuse lookalikes).
const DANGEROUS_HOSTS = new Set([
  'paypal-security-check.com', 'secure-login-paypal.com', 'appleid-support.com',
  'appleid-verify.com', 'icloud-find-my.info', 'netflix-billing-update.com',
  'steamcommunlty.com', 'd1scord-app.com', 'discord-nitro-gen.xyz',
  'telegram-verify.top', 'whatsapp-web-login.com', 'binance-secure-login.com',
  'coinbase-wallet-auth.com', 'facebook-help-center.info', 'instagram-verify.net',
  'microsoft-teamss.com', 'office365-activate.com', 'drive-microsoft-secure.top',
  'gmail-secure-alerts.net', 'amazon-account-locked.com', 'update-flash-player.com',
  'java-update-needed.com', 'accounts-google-secure.top', 'roblox-free-robux.link'
]);

const TRACKING_PATH = /(?:^|[\/_-])(?:analytics|beacon|collect|telemetry|track(?:er|ing)?)(?:[\/_?.-]|$)/i;
const MAIN_FRAME_TRACKING_PATH = /(?:^|[\/_-])(?:tracking|analytics|telemetry)(?:[\/_?.-]|$)/i;
const MAIN_FRAME_AD_PATH = /(?:^|[\/_-])(?:ads?|advert(?:isement)?|adserver|adservice|sponsor|promo|promotion|banner)(?:[\/_?.-]|$)/i;
const REDIRECT_TRAP = /(?:^|[?&#\/_-])(?:adurl|clickid|click_id|clickurl|popunder|popup|redirect(?:_url)?|sponsor|subid|zoneid)(?:=|[\/_-]|$)/i;
const FILTERED_TYPES = new Set([
  'mainFrame',
  'image',
  'script',
  'stylesheet',
  'xhr',
  'fetch',
  'media',
  'subFrame',
  'ping'
]);

function normaliseHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function isHostInList(hostname, list) {
  const host = normaliseHost(hostname);
  if (!host) return false;
  if (list.has(host)) return true;
  const labels = host.split('.');
  for (let index = 1; index < labels.length - 1; index += 1) {
    if (list.has(labels.slice(index).join('.'))) return true;
  }
  return false;
}

function isBlockedHost(hostname) {
  return isHostInList(hostname, BLOCKED_HOSTS);
}

function requestOrigin(details) {
  const source = details.initiator || details.referrer || '';
  try { return normaliseHost(new URL(source).hostname); } catch { return ''; }
}

/**
 * Decide whether a request should be cancelled.
 * @param {object} details webRequest details
 * @param {boolean|object} [ads=true] ad blocker enabled (or `{ads, trackers}` options object)
 * @param {boolean} [trackers=true] tracker blocking enabled
 */
function shouldBlockRequest(details, ads = true, trackers = true) {
  if (ads && typeof ads === 'object') {
    trackers = ads.trackers !== false;
    ads = ads.ads !== false;
  } else if (typeof trackers === 'object' && trackers !== null) {
    trackers = trackers.trackers !== false;
  }
  if ((!ads && !trackers) || !details || !details.url) return false;
  let target;
  try { target = new URL(details.url); } catch { return false; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  const sourceHost = requestOrigin(details);
  const targetHost = normaliseHost(target.hostname);
  if (isHostInList(targetHost, FIRST_PARTY_ALLOWED_HOSTS)) return false;

  if (ads && isHostInList(target.hostname, AD_HOSTS)) return true;
  if (trackers && isHostInList(target.hostname, TRACKER_HOSTS)) return true;

  const type = details.resourceType || '';
  if (!FILTERED_TYPES.has(type)) return false;
  const thirdParty = sourceHost && targetHost !== sourceHost && !targetHost.endsWith(`.${sourceHost}`);
  const combinedPath = `${target.pathname}${target.search}`;
  if (type === 'mainFrame') {
    // Main-frame checks also fire when we simply don't know the origin
    // (direct navigation), matching historical Flowr behavior.
    if (!sourceHost || thirdParty) {
      if (ads && REDIRECT_TRAP.test(combinedPath)) return true;
      if (ads && MAIN_FRAME_AD_PATH.test(combinedPath)) return true;
      if (trackers && MAIN_FRAME_TRACKING_PATH.test(combinedPath)) return true;
    }
    return false;
  }
  return Boolean(trackers && TRACKING_PATH.test(`${target.pathname}${target.search}`));
}

/**
 * Local Safe Browsing check: does this URL point at a known-dangerous host?
 * @param {string} url
 * @param {'enhanced'|'standard'|'off'} [level]
 */
function isDangerousUrl(url, level = 'standard') {
  if (!level || level === 'off') return false;
  let target;
  try { target = new URL(url); } catch { return false; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  const host = normaliseHost(target.hostname);
  if (!host) return false;
  if (DANGEROUS_HOSTS.has(host)) return true;
  const labels = host.split('.');
  for (let index = 1; index < labels.length - 1; index += 1) {
    if (DANGEROUS_HOSTS.has(labels.slice(index).join('.'))) return true;
  }
  if (level === 'enhanced') {
    // Punycode homoglyphs in the registrable domain are almost always abuse.
    if (/\.xn--/.test(host) || host.startsWith('xn--')) return true;
    // Well-known brands on odd TLDs ("paypal-security.foo").
    const tld = labels[labels.length - 1];
    const commonTld = ['com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'dev', 'app'].includes(tld);
    if (!commonTld && BRAND_TOKENS.some(brand => host.includes(brand))) return true;
  }
  return false;
}

const BRAND_TOKENS = [
  'paypal', 'appleid', 'icloud', 'netflix', 'steamcommunity', 'discord',
  'telegram', 'whatsapp', 'binance', 'coinbase', 'facebook', 'instagram',
  'microsoft', 'office365', 'gmail', 'amazon', 'roblox'
];

module.exports = { AD_HOSTS, TRACKER_HOSTS, BLOCKED_HOSTS, FIRST_PARTY_ALLOWED_HOSTS, DANGEROUS_HOSTS, isBlockedHost, shouldBlockRequest, isDangerousUrl };
