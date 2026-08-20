function parseSiteRules(value) {
  return String(value || '').split(/[\n,]+/).map(rule => rule.trim().toLowerCase()).filter(Boolean);
}

function matchesSiteRule(url, rules) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return rules.some(raw => {
      const rule = raw.replace(/^\*\./, '');
      return host === rule || host.endsWith(`.${rule}`);
    });
  } catch (_) { return false; }
}

function retentionCutoff(value, now = Date.now()) {
  const durations = { '1h': 36e5, '1d': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
  return durations[value] ? now - durations[value] : 0;
}

function filterHistory(items, { rules = [], retention = 'forever', now = Date.now() } = {}) {
  if (retention === 'session') return [];
  const cutoff = retentionCutoff(retention, now);
  return (items || []).filter(item => (!cutoff || Date.parse(item.date || 0) >= cutoff) && !matchesSiteRule(item.url, rules));
}

module.exports = { parseSiteRules, matchesSiteRule, retentionCutoff, filterHistory };
