(() => {
  'use strict';

  const config = window.FLOWR_DOWNLOAD_AUTH;
  const downloads = Object.freeze({
    windows: {
      name: 'Flowr for Windows',
      url: 'https://github.com/Tiedr/flowr-browser/releases/download/v1.2.0/Flowr-Installer-1.2.0.exe'
    },
    'mac-arm64': {
      name: 'Flowr for macOS (Apple silicon)',
      url: 'https://github.com/Tiedr/flowr-browser/releases/download/v1.2.0/Flowr-1.2.0-mac-arm64.dmg'
    },
    'mac-x64': {
      name: 'Flowr for macOS (Intel)',
      url: 'https://github.com/Tiedr/flowr-browser/releases/download/v1.2.0/Flowr-1.2.0-mac-x64.dmg'
    },
    linux: {
      name: 'Flowr for Linux',
      url: 'https://github.com/Tiedr/flowr-browser/releases/download/v1.2.0/Flowr-1.2.0-linux-x86_64.AppImage'
    }
  });
  const keys = Object.freeze({
    session: 'flowr-download-session',
    intent: 'flowr-download-intent',
    resume: 'flowr-download-resume',
    state: 'flowr-oauth-state',
    verifier: 'flowr-oauth-verifier'
  });

  const status = document.querySelector('[data-download-status]');
  const accountStatus = document.querySelector('[data-download-account]');
  const signOut = document.querySelector('[data-download-sign-out]');

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function getSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(keys.session) || 'null');
      if (!session?.accessToken || Number(session.expiresAt) <= Date.now()) return null;
      return session;
    } catch {
      return null;
    }
  }

  function showAccount(session) {
    if (!accountStatus) return;
    const email = session?.profile?.email;
    accountStatus.textContent = email
      ? `Signed in as ${email}. Your downloads are ready.`
      : 'Sign in with your free Tieddr Account to download Flowr.';
    if (signOut) signOut.hidden = !email;
  }

  function clearSession() {
    for (const key of Object.values(keys)) sessionStorage.removeItem(key);
    showAccount(null);
  }

  function startDownload(key) {
    const download = downloads[key];
    if (!download) return;
    sessionStorage.removeItem(keys.intent);
    sessionStorage.removeItem(keys.resume);
    const anchor = document.createElement('a');
    anchor.href = download.url;
    anchor.download = '';
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setStatus(`${download.name} download started. You can stay on this page.`);
  }

  function randomString(bytes) {
    const values = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
  }

  function base64Url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(digest);
  }

  function authConfigured() {
    return config?.clientId && !config.clientId.startsWith('REPLACE_')
      && config.accountBase === 'https://account.tieddr.com'
      && config.apiBase === 'https://api.account.tieddr.com'
      && config.redirectUri === `${window.location.origin}/auth/callback/`;
  }

  async function userinfo(accessToken) {
    const response = await fetch(`${config.apiBase}/v1/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 401) throw new Error('Your Tieddr session expired. Please sign in again.');
    if (!response.ok) throw new Error('Tieddr Account could not verify your session. Please try again.');
    return response.json();
  }

  async function beginDownload(key) {
    if (!downloads[key]) return;
    if (!authConfigured()) {
      setStatus('Download sign-in is not configured yet. Please contact Tieddr support.', true);
      return;
    }

    sessionStorage.setItem(keys.intent, key);
    const session = getSession();
    if (session) {
      try {
        const profile = await userinfo(session.accessToken);
        sessionStorage.setItem(keys.session, JSON.stringify({ ...session, profile }));
        showAccount({ ...session, profile });
        startDownload(key);
        return;
      } catch (error) {
        clearSession();
        sessionStorage.setItem(keys.intent, key);
        if (!/expired/.test(error.message)) {
          setStatus(error.message, true);
          return;
        }
      }
    }

    try {
      setStatus('Opening Tieddr Account sign-in…');
      const verifier = randomString(48);
      const state = randomString(24);
      const challenge = await pkceChallenge(verifier);
      sessionStorage.setItem(keys.verifier, verifier);
      sessionStorage.setItem(keys.state, state);
      const url = new URL('/oauth/authorize', config.accountBase);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      });
      window.location.assign(url.href);
    } catch {
      setStatus('Secure sign-in could not start. Check your connection and try again.', true);
    }
  }

  async function handleCallback() {
    if (!authConfigured()) {
      setStatus('Download sign-in is not configured yet. Return to the Flowr website after configuration is complete.', true);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    const expectedState = sessionStorage.getItem(keys.state);
    const verifier = sessionStorage.getItem(keys.verifier);
    sessionStorage.removeItem(keys.state);
    sessionStorage.removeItem(keys.verifier);

    if (params.get('error')) {
      setStatus('Tieddr sign-in was cancelled or declined. Return to Downloads to try again.', true);
      return;
    }
    if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
      setStatus('The sign-in response could not be verified. Return to Downloads and start again.', true);
      return;
    }

    try {
      const response = await fetch(`${config.apiBase}/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          code_verifier: verifier
        })
      });
      const token = await response.json().catch(() => ({}));
      if (!response.ok || !token.access_token) {
        throw new Error(token.error_description || token.error || 'Tieddr sign-in could not be completed.');
      }
      const profile = await userinfo(token.access_token);
      if (!profile.sub) throw new Error('Tieddr Account returned an invalid profile.');
      sessionStorage.setItem(keys.session, JSON.stringify({
        accessToken: token.access_token,
        expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
        profile: { sub: profile.sub, email: profile.email || '', name: profile.name || '' }
      }));
      sessionStorage.setItem(keys.resume, 'true');
      window.location.replace('/#download');
    } catch (error) {
      clearSession();
      setStatus(error.message || 'Tieddr sign-in could not be completed. Please try again.', true);
    }
  }

  function initialiseDownloads() {
    document.querySelectorAll('[data-download]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        void beginDownload(link.dataset.download);
      });
    });
    if (signOut) {
      signOut.addEventListener('click', () => {
        clearSession();
        setStatus('Signed out of Flowr downloads on this tab. Your Tieddr Account itself remains signed in.');
      });
    }

    const session = getSession();
    showAccount(session);
    if (sessionStorage.getItem(keys.resume) === 'true') {
      const key = sessionStorage.getItem(keys.intent);
      sessionStorage.removeItem(keys.resume);
      if (session && downloads[key]) {
        setStatus(`Signed in. Starting ${downloads[key].name}…`);
        window.setTimeout(() => startDownload(key), 250);
      } else {
        sessionStorage.removeItem(keys.intent);
        setStatus('Sign-in succeeded. Choose your Flowr download below.');
      }
    }
  }

  if (window.location.pathname === '/auth/callback/') {
    void handleCallback();
  } else {
    initialiseDownloads();
  }
})();
