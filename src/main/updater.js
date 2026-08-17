function cleanError(error) {
  return String(error?.message || error || 'Update failed').replace(/^Error:\s*/i, '');
}

function releaseNotes(info) {
  if (!info) return '';
  if (typeof info.releaseNotes === 'string') return info.releaseNotes;
  if (Array.isArray(info.releaseNotes)) return info.releaseNotes.map(note => note?.note || '').filter(Boolean).join('\n\n');
  return '';
}

function createUpdateController({ app, autoUpdater, dialog, send, getWindow }) {
  let state = { phase: 'idle', currentVersion: app.getVersion(), available: false };
  let offeredVersion = '';
  let promptOnAvailable = false;
  let backgroundDownload = false;
  let initialized = false;

  const publish = patch => {
    state = { ...state, ...patch, currentVersion: app.getVersion() };
    send('update-status', state);
    return state;
  };

  const showMessage = options => {
    const window = getWindow();
    return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };

  const offerDownload = async () => {
    if (!state.available || state.phase === 'downloading' || state.phase === 'downloaded') return state;
    const result = await showMessage({
      type: 'info',
      title: `Flowr ${state.latestVersion} is available`,
      message: `Update Flowr to ${state.latestVersion}?`,
      detail: 'Flowr will download the update securely. You can install it immediately or when you close the browser.',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return publish({ phase: 'available' });
    publish({ phase: 'downloading', percent: 0 });
    await autoUpdater.downloadUpdate();
    return state;
  };

  const offerInstall = async () => {
    if (state.phase !== 'downloaded') return state;
    const result = await showMessage({
      type: 'info',
      title: 'Flowr update is ready',
      message: `Flowr ${state.latestVersion} has been downloaded.`,
      detail: 'Restart Flowr now to finish installing the update, or install it automatically when you close the browser.',
      buttons: ['Restart and install', 'Install when I close Flowr', 'Later'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (result.response === 0) {
      publish({ phase: 'installing' });
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    } else if (result.response === 1) {
      autoUpdater.autoInstallOnAppQuit = true;
      publish({ phase: 'downloaded', installOnQuit: true });
    }
    return state;
  };

  const initialize = () => {
    if (initialized || !app.isPackaged) return;
    initialized = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', error: '' }));
    autoUpdater.on('update-not-available', info => publish({
      phase: 'current', available: false, latestVersion: info?.version || app.getVersion(), percent: 0
    }));
    autoUpdater.on('update-available', info => {
      const latestVersion = info?.version || '';
      publish({
        phase: 'available',
        available: true,
        latestVersion,
        notes: releaseNotes(info),
        publishedAt: info?.releaseDate || '',
        percent: 0
      });
      if (backgroundDownload) {
        publish({ phase: 'downloading', percent: 0 });
        void autoUpdater.downloadUpdate().catch(error => publish({ phase: 'error', error: cleanError(error) }));
      } else if (promptOnAvailable && offeredVersion !== latestVersion) {
        offeredVersion = latestVersion;
        void offerDownload().catch(error => publish({ phase: 'error', error: cleanError(error) }));
      }
    });
    autoUpdater.on('download-progress', progress => publish({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, Number(progress?.percent || 0))),
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
      bytesPerSecond: progress?.bytesPerSecond || 0
    }));
    autoUpdater.on('update-downloaded', info => {
      publish({ phase: 'downloaded', available: true, latestVersion: info?.version || state.latestVersion, percent: 100 });
      void offerInstall().catch(error => publish({ phase: 'error', error: cleanError(error) }));
    });
    autoUpdater.on('error', error => publish({ phase: 'error', error: cleanError(error) }));
  };

  const check = async (options = {}) => {
    if (!app.isPackaged) {
      return publish({ phase: 'development', available: false, error: 'Update checks run in packaged Flowr builds.' });
    }
    initialize();
    promptOnAvailable = options.promptOnAvailable === true;
    backgroundDownload = options.backgroundDownload === true;
    try {
      publish({ phase: 'checking', error: '' });
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (info?.version && info.version === app.getVersion()) {
        publish({ phase: 'current', available: false, latestVersion: info.version });
      }
      return state;
    } catch (error) {
      return publish({ phase: 'error', available: false, error: cleanError(error) });
    }
  };

  return {
    initialize,
    check,
    download: offerDownload,
    install: offerInstall,
    status: () => state
  };
}

module.exports = { createUpdateController, cleanError, releaseNotes };
