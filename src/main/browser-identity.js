function requiresCompatibleBrowserIdentity(candidate) {
  try {
    const host = new URL(String(candidate || '')).hostname.toLowerCase();
    return /^accounts\.google\.(?:com|[a-z]{2}|(?:com|co|net|org|ac|gov)\.[a-z]{2})$/.test(host)
      || /^accounts\.youtube\.com$/.test(host)
      || /^myaccount\.google\.com$/.test(host)
      || /^login\.microsoftonline\.com$/.test(host)
      || /^login\.live\.com$/.test(host)
      || /^appleid\.apple\.com$/.test(host);
  } catch (_) { return false; }
}

function chromiumUserAgent(platform = process.platform, chromeVersion = process.versions.chrome) {
  const platforms = {
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
    linux: 'X11; Linux x86_64',
    win32: 'Windows NT 10.0; Win64; x64'
  };
  const version = /^\d+\.\d+\.\d+\.\d+$/.test(String(chromeVersion || '')) ? chromeVersion : '142.0.0.0';
  return `Mozilla/5.0 (${platforms[platform] || platforms.linux}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function browserPlatform(platform = process.platform) {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
}

module.exports = { requiresCompatibleBrowserIdentity, chromiumUserAgent, browserPlatform };
