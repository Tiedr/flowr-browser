const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController, cleanError, releaseNotes } = require('../src/main/updater');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.downloadCalls = 0;
    this.installCalls = 0;
  }

  async checkForUpdates() {
    const updateInfo = { version: '1.1.5', releaseDate: '2026-08-17', releaseNotes: 'Faster and calmer.' };
    this.emit('update-available', updateInfo);
    return { updateInfo };
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
    return [];
  }

  quitAndInstall() {
    this.installCalls += 1;
  }
}

(async () => {
  const updater = new FakeUpdater();
  const dialogResponses = [0, 2, 0];
  const sent = [];
  const controller = createUpdateController({
    app: { isPackaged: true, getVersion: () => '1.1.4' },
    autoUpdater: updater,
    dialog: { showMessageBox: async () => ({ response: dialogResponses.shift() }) },
    send: (channel, state) => sent.push({ channel, state }),
    getWindow: () => ({ isDestroyed: () => false })
  });

  const available = await controller.check({ promptOnAvailable: false });
  assert.equal(available.phase, 'available');
  assert.equal(available.latestVersion, '1.1.5');
  assert.equal(available.available, true);

  await controller.download();
  assert.equal(updater.downloadCalls, 1);
  updater.emit('download-progress', { percent: 42.4, transferred: 42, total: 100, bytesPerSecond: 10 });
  assert.equal(controller.status().phase, 'downloading');
  assert.equal(controller.status().percent, 42.4);

  updater.emit('update-downloaded', { version: '1.1.5' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.status().phase, 'downloaded');

  await controller.install();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updater.installCalls, 1);
  assert.ok(sent.every(event => event.channel === 'update-status'));
  assert.equal(cleanError(new Error('network unavailable')), 'network unavailable');
  assert.equal(releaseNotes({ releaseNotes: [{ note: 'One' }, { note: 'Two' }] }), 'One\n\nTwo');
  console.log('Flowr updater regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
