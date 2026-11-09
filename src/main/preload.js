const { contextBridge, ipcRenderer } = require('electron');

// Allow-lists bound the blast radius if the renderer is ever compromised
// (XSS in app chrome). Only channels the UI actually uses are exposed.
const INVOKE_ALLOW = new Set([
  'pw-encryption-available', 'get-view-preload', 'get-top-sites',
  'get-incognito', 'get-window-flags', 'get-clipboard-text',
  'get-last-session', 'tear-out-tab',
  'pw-get-for-origin', 'pw-save', 'pw-list', 'pw-reveal', 'pw-copy', 'pw-delete',
  'vault-state', 'vault-unlock', 'vault-lock', 'vault-list', 'vault-reveal',
  'vault-add', 'vault-delete', 'vault-sync', 'vault-copy', 'change-vault-pin',
  'check-biometric-available', 'wallet-cards-for-fill', 'wallet-fill',
  'get-account', 'check-for-updates', 'download-update', 'install-update',
  'get-update-status', 'set-update-channel', 'apply-dev-emulation',
  'open-external', 'create-print-preview', 'capture-webview-preview',
  'print-page', 'mavis-chat', 'get-tieddr-news',
  'open-site-app', 'get-site-permissions', 'set-site-permission',
  'import-browser-data', 'import-installed-browser-bookmarks', 'detect-importable-browsers',
  'should-block-url', 'tieddr-sign-in', 'tieddr-sign-out',
  'sync-tieddr-bookmarks', 'get-notes', 'get-note-folders',
  'clear-browsing-data', 'clear-cache', 'get-storage-sizes',
  'set-default-browser', 'choose-download-path', 'reset-settings',
  'get-settings', 'update-settings',
  'install-flowr-theme', 'install-flowr-extension',
  'get-bookmarks', 'add-bookmark', 'remove-bookmark',
  'get-bookmark-folders', 'create-bookmark-folder', 'move-bookmark',
  'get-history', 'clear-history',
  'get-downloads', 'clear-downloads', 'pause-download', 'resume-download',
  'cancel-download', 'show-in-folder',
  'get-profiles', 'get-active-profile', 'create-profile', 'switch-profile',
  'get-extensions', 'install-unpacked-extension', 'inspect-extension-folder', 'install-store-extension',
  'remove-extension', 'get-extension-actions', 'pin-extension', 'toggle-extension',
  'flowr-package-info', 'uninstall-flowr-theme'
]);

const SEND_ALLOW = new Set([
  'add-history', 'register-webview', 'set-webview-active', 'view-command',
  'new-window', 'save-session', 'window-control',
  'open-extension-options', 'open-extension-popup',
  'open-extension-side-panel', 'close-side-panel',
  'cancel-clipboard-clear'
]);

const ON_ALLOW = new Set([
  'shortcut', 'update-status', 'show-context-menu', 'open-url-in-new-tab',
  'open-start-url', 'open-mavis-sidebar', 'request-new-tab',
  'history-changed', 'downloads-changed', 'bookmarks-changed',
  'bookmark-folders-changed', 'notes-changed', 'note-folders-changed',
  'account-changed', 'profile-changed', 'vault-locked', 'vault-require-unlock',
  'pw-save-prompt', 'safebrowsing-blocked', 'ad-navigation-blocked',
  'memory-pressure', 'side-panel-opened', 'side-panel-closed', 'extension-loaded',
  'adblock-status', 'site-permissions-changed'
]);

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, ...args) => {
      if (!SEND_ALLOW.has(channel)) throw new Error(`Blocked IPC send: ${channel}`);
      return ipcRenderer.send(channel, ...args);
    },
    on: (channel, func) => {
      if (!ON_ALLOW.has(channel)) throw new Error(`Blocked IPC subscribe: ${channel}`);
      const listener = (event, ...args) => func(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    invoke: (channel, ...args) => {
      if (!INVOKE_ALLOW.has(channel)) return Promise.reject(new Error(`Blocked IPC invoke: ${channel}`));
      return ipcRenderer.invoke(channel, ...args);
    },
  },
});

