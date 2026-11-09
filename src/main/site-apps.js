function webUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed : null;
  } catch (_) { return null; }
}

function cleanWebUrl(value) {
  return webUrl(value)?.href || '';
}

function normalizeSiteApp(input) {
  const url = webUrl(input?.url || input?.startUrl);
  if (!url) return null;
  const manifest = cleanWebUrl(input.manifest);
  const scope = cleanWebUrl(input.scope);
  return {
    id: String(input.id || '').replace(/[^a-z0-9-]/gi, '-').slice(0, 120),
    name: String(input.name || url.hostname).trim().slice(0, 120) || url.hostname,
    url: url.href,
    icon: cleanWebUrl(input.icon),
    manifest,
    scope,
    display: ['browser', 'minimal-ui', 'standalone', 'fullscreen', 'window-controls-overlay'].includes(input.display) ? input.display : 'browser',
    standalone: input.standalone !== false
  };
}

function siteAppScope(item) {
  const start = webUrl(item?.url || item?.startUrl);
  if (!start) return null;
  const scope = webUrl(item.scope);
  if (scope && scope.origin === start.origin) return scope;
  const fallback = new URL(start.href);
  fallback.pathname = fallback.pathname.endsWith('/') ? fallback.pathname : `${fallback.pathname.split('/').slice(0, -1).join('/')}/`;
  fallback.search = '';
  fallback.hash = '';
  return fallback;
}

function isUrlInSiteAppScope(candidate, item) {
  const url = webUrl(candidate);
  const scope = siteAppScope(item);
  if (!url || !scope || url.origin !== scope.origin) return false;
  const scopePath = scope.pathname.endsWith('/') ? scope.pathname : `${scope.pathname}/`;
  return url.pathname === scope.pathname || url.pathname.startsWith(scopePath);
}

function siteAppId(candidate) {
  const url = webUrl(candidate);
  if (!url) return '';
  const slug = `${url.hostname}${url.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `site-${slug}`.slice(0, 120);
}

module.exports = { normalizeSiteApp, siteAppScope, isUrlInSiteAppScope, siteAppId };
