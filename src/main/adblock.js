const BLOCKED_HOSTS = new Set([
  '2mdn.net', 'adform.net', 'adnxs.com', 'adsrvr.org', 'advertising.com',
  'amazon-adsystem.com', 'app-measurement.com', 'atdmt.com', 'bidswitch.net',
  'casalemedia.com', 'chartbeat.com', 'clicktale.net', 'coin-hive.com',
  'coinhive.com', 'criteo.com', 'criteo.net', 'crypto-loot.com',
  'demdex.net', 'doubleclick.net', 'everesttech.net', 'exelator.com',
  'fullstory.com', 'google-analytics.com', 'googleadservices.com',
  'googlesyndication.com', 'googletagmanager.com', 'googletagservices.com',
  'hotjar.com', 'imrworldwide.com', 'jsecoin.com', 'krxd.net',
  'luckyorange.com', 'mathtag.com', 'mediaplex.com', 'mixpanel.com',
  'moatads.com', 'mouseflow.com', 'newrelic.com', 'omtrdc.net',
  'openx.net', 'optimizely.com', 'outbrain.com', 'parsely.com',
  'pubmatic.com', 'quantserve.com', 'revjet.com', 'rubiconproject.com',
  'scorecardresearch.com', 'segment.com', 'segment.io', 'serving-sys.com',
  'sharethrough.com', 'smartadserver.com', 'spotxchange.com', 'taboola.com',
  'teads.tv', 'turn.com', 'webminepool.com', 'yieldmo.com'
]);

const TRACKING_PATH = /(?:^|[\/_-])(?:ads?|adserver|advert|analytics|beacon|collect|conversion|pixel|sponsor|telemetry|track(?:er|ing)?)(?:[\/_?.-]|$)/i;
const MAIN_FRAME_TRACKING_PATH = /(?:^|[\/_-])(?:ad(s|vert|server|service)|sponsor|promo|promotion|banner|tracking|analytics|telemetry)(?:[\/_?.-]|$)/i;
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

function isBlockedHost(hostname) {
  const host = normaliseHost(hostname);
  if (!host) return false;
  if (BLOCKED_HOSTS.has(host)) return true;
  const labels = host.split('.');
  for (let index = 1; index < labels.length - 1; index += 1) {
    if (BLOCKED_HOSTS.has(labels.slice(index).join('.'))) return true;
  }
  return false;
}

function requestOrigin(details) {
  const source = details.initiator || details.referrer || '';
  try { return normaliseHost(new URL(source).hostname); } catch { return ''; }
}

function shouldBlockRequest(details, enabled = true) {
  if (!enabled || !details || !details.url) return false;
  let target;
  try { target = new URL(details.url); } catch { return false; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (isBlockedHost(target.hostname)) return true;

  const type = details.resourceType || '';
  if (!FILTERED_TYPES.has(type)) return false;
  const sourceHost = requestOrigin(details);
  const targetHost = normaliseHost(target.hostname);
  const thirdParty = sourceHost && targetHost !== sourceHost && !targetHost.endsWith(`.${sourceHost}`);
  const combinedPath = `${target.pathname}${target.search}`;
  if (type === 'mainFrame' && (!sourceHost || thirdParty) && MAIN_FRAME_TRACKING_PATH.test(combinedPath)) return true;
  return Boolean(thirdParty && TRACKING_PATH.test(`${target.pathname}${target.search}`));
}

module.exports = { BLOCKED_HOSTS, isBlockedHost, shouldBlockRequest };
