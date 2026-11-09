const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// Stub `electron` (vault Store needs app.getPath) before any vault/index load.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'flowr-vault-pin-test-'));
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tmpUserData } };
  return _origLoad.call(this, request, parent, isMain);
};

const vaultDir = path.join(__dirname, '..', 'src', 'main', 'vault');
const read = (f) => fs.readFileSync(path.join(vaultDir, f), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

const indexSrc = read('index.js');
const syncSrc = read('sync.js');
const appwriteSrc = read('appwrite.js');
const configSrc = read('config.js');
const accountSrc = read('account.js');
const cryptoSrc = read('crypto.js');
const vaultSrc = read('vault.js');
const sessionSrc = read('session.js');

(async () => {
  // --- Protocol: PIN rotation must re-encrypt, not drop the cache ------------
  const V = require('../src/main/vault/vault.js');
  const crypto = require('../src/main/vault/crypto.js');
  const { deriveAesKey, verifierHash, toHex, randomBytes } = crypto;
  const uid = 'pin-test';
  const passOf = (pin) => `${uid}:${pin}`;
  const kdfSalt = randomBytes(16);
  const authSalt = randomBytes(16);

  const oldKey = await deriveAesKey(passOf('111111'), kdfSalt, 210000);
  const verifier = await verifierHash(passOf('111111'), authSalt, 210000);
  const meta = { kdf: { salt: toHex(kdfSalt), iterations: 210000 }, auth: { salt: toHex(authSalt), verifier, iterations: 210000 } };

  // Old PIN verifies, wrong PIN does not.
  await V.deriveAndVerify(uid, '111111', meta);
  await assert.rejects(() => V.deriveAndVerify(uid, '000000', meta), /wrong-pin/);

  // Encrypt under old key, rotate to new key, decrypt under new key.
  const item = V.newPasswordItem({ title: 'example', username: 'alice', password: 's3cret!', url: 'https://example.com' });
  const cipher = await V.encryptItem(item, oldKey);
  const newKey = await deriveAesKey(passOf('222222'), randomBytes(16), 210000);
  const roundTrip = JSON.parse(await crypto.decryptString(cipher, oldKey));
  assert.equal(roundTrip.value, 's3cret!');
  const reCipher = await V.encryptItem({ ...roundTrip, updatedAt: Date.now() }, newKey);
  const back = JSON.parse(await crypto.decryptString(reCipher, newKey));
  assert.equal(back.value, 's3cret!');
  await assert.rejects(() => crypto.decryptString(cipher, newKey), /./, 'old ciphertext must not decrypt under the new key');

  // --- KDF target + crypto hygiene -------------------------------------------
  assert.equal(crypto.PBKDF2_ITERATIONS, 600000, 'new vaults target 600k PBKDF2 iterations');
  const freshKey = await deriveAesKey('probe', randomBytes(16), 600000);
  assert.equal(freshKey.extractable, false, 'derived keys must be non-extractable');
  assert.throws(() => crypto.hexToBytes('zz'), /bad-hex/, 'hexToBytes rejects non-hex');
  assert.throws(() => crypto.hexToBytes('abc'), /bad-hex/, 'hexToBytes rejects odd length');
  assert.throws(() => crypto.fromBase64(''), /bad-base64/, 'fromBase64 rejects empty input');
  assert.ok(crypto.timingSafeEqual('abc', 'abc') && !crypto.timingSafeEqual('abc', 'abd'));
  await assert.rejects(() => deriveAesKey('x', randomBytes(16), 10), /unsupported-kdf/, 'tiny iteration counts rejected');
  await assert.rejects(() => deriveAesKey('x', randomBytes(16), 100_000_000), /unsupported-kdf/, 'absurd iteration counts rejected (mirror DoS bound)');
  // Stored-meta bounds: hostile/broken mirror rows must not dictate work.
  const badIterMeta = { kdf: { salt: toHex(randomBytes(16)), iterations: 100_000_000 }, auth: { salt: toHex(randomBytes(16)), verifier: '00'.repeat(32), iterations: 100_000_000 } };
  await assert.rejects(() => V.deriveAndVerify(uid, '111111', badIterMeta), /unsupported-kdf/);
  const badSaltMeta = { kdf: { salt: 'not-hex!!', iterations: 210000 }, auth: { salt: toHex(randomBytes(16)), verifier: '00'.repeat(32), iterations: 210000 } };
  await assert.rejects(() => V.deriveAndVerify(uid, '111111', badSaltMeta), /unsupported-kdf/);
  // Old 210k vaults still verify (versioned iterations).
  await V.deriveAndVerify(uid, '111111', meta);

  // --- changePin must verify current PIN and re-encrypt before swapping -------
  const changeStart = indexSrc.indexOf('async function changePin(');
  assert.ok(changeStart >= 0, 'changePin must exist in vault/index.js');
  const changeSrc = indexSrc.slice(changeStart, indexSrc.indexOf('\n}\n', changeStart) + 3);
  assert.match(changeSrc, /function changePin\(uid,\s*currentPin,\s*newPin\)/, 'changePin takes (uid, currentPin, newPin)');
  assert.match(changeSrc, /deriveAndVerify\(uid,\s*String\(currentPin\)/, 'changePin verifies the CURRENT pin');
  assert.match(changeSrc, /decryptItems|currentItems\(oldKey\)/, 'changePin decrypts with the old key first');
  assert.match(changeSrc, /createMeta\(uid,\s*String\(newPin\)\)/, 'changePin derives a fresh key from the new pin');
  assert.match(changeSrc, /encryptItem/, 'changePin re-encrypts items with the new key');
  assert.match(changeSrc, /setItemsCache\(newCache\)/, 'changePin writes the re-encrypted cache');
  assert.match(changeSrc, /setMeta\(c\.meta\)/, 'changePin stores the new meta');
  assert.match(changeSrc, /setSession\(uid,\s*c\.key\)/, 'changePin sessions the new key');
  assert.match(changeSrc, /checkLockout/, 'changePin honors the persisted lockout (no oracle bypass)');
  assert.match(changeSrc, /resetPinFailures/, 'changePin resets throttling on success');
  assert.doesNotMatch(changeSrc, /deriveAndVerify\(s\.uid,\s*newPin/, 'must not verify the new pin against the old verifier (old data-loss bug)');

  // --- Throttling: persisted attempts + escalating lockout --------------------
  assert.match(indexSrc, /MAX_PIN_ATTEMPTS\s*=\s*5/, 'five free attempts');
  assert.match(indexSrc, /LOCKOUT_BASE_MS/, 'escalating lockout base');
  assert.match(indexSrc, /LOCKOUT_MAX_MS/, 'capped lockout');
  assert.match(indexSrc, /getLockState|setLockState/, 'throttling persists across restarts');
  assert.match(indexSrc, /kdfUpgradeAvailable/, 'state() surfaces KDF upgrade availability');
  assert.match(sessionSrc, /setFailedAttempts/, 'session counter hydrates from persisted state');
  assert.doesNotMatch(sessionSrc, /key\.zeroization\s*=/, 'zeroization theater removed from lock()');

  // --- JWT-only transport: no API-key fallback anywhere -----------------------
  assert.doesNotMatch(syncSrc, /apiKey/, 'sync.js must not reference an API key');
  assert.match(syncSrc, /return !!jwt;/, 'haveTransport is JWT-only');
  assert.match(syncSrc, /pushMeta/, 'sync.js exports pushMeta for post-rotation pushes');
  assert.doesNotMatch(appwriteSrc, /X-Appwrite-Key/, 'appwrite.js must never send X-Appwrite-Key');
  assert.doesNotMatch(appwriteSrc, /apiKey/, 'appwrite.js must not reference an API key');
  assert.doesNotMatch(configSrc, /apiKey|config\.local/, 'config.js must not load or expose an API key');
  assert.match(accountSrc, /_minting/, 'account.js dedupes concurrent JWT mints');
  assert.match(accountSrc, /AbortController/, 'account.js bounds the mint with a timeout');
  assert.doesNotMatch(accountSrc, /sync uses the key/, 'stale key-fallback comment must be gone');

  // --- main.js handlers: safe PIN change + lockout mapping --------------------
  const handlerStart = mainSource.indexOf("ipcMain.handle('change-vault-pin'");
  assert.ok(handlerStart >= 0, 'change-vault-pin handler must exist');
  const handlerEnd = mainSource.indexOf('});', handlerStart) + 3;
  const handlerSrc = mainSource.slice(handlerStart, handlerEnd);
  assert.match(handlerSrc, /vault\.changePin\(acc\.uid,\s*currentPin,\s*newPin\)/, 'handler passes (uid, currentPin, newPin)');
  assert.doesNotMatch(handlerSrc, /vault\.unlock\(acc\.uid,\s*currentPin\)/, 'handler must not pre-unlock (avoids double sync/migration)');
  assert.match(handlerSrc, /wrong-pin/, 'handler maps wrong-pin to "Current PIN is incorrect"');
  const unlockStart = mainSource.indexOf("ipcMain.handle('vault-unlock'");
  assert.ok(unlockStart >= 0, 'vault-unlock handler must exist');
  const unlockSrc = mainSource.slice(unlockStart, mainSource.indexOf('});', unlockStart) + 3);
  assert.match(unlockSrc, /Too many attempts/, 'unlock maps lockouts to a retry message');
  assert.match(unlockSrc, /retryAfterMs/, 'unlock surfaces retryAfterMs');

  // --- Functional: lockout persists, blocks oracles, resets on success --------
  const vault = require('../src/main/vault/index.js');
  vault.init('pin-lockout-profile');
  const lockUid = 'lockout-uid';
  const created = await vault.unlock(lockUid, '123456');
  assert.ok(created.ok, 'setup unlock creates vault');
  await vault.saveLogin({ origin: 'https://example.com', url: 'https://example.com', username: 'bob', password: 'pw' });
  vault.lock();

  for (let i = 1; i <= 4; i++) {
    await assert.rejects(() => vault.unlock(lockUid, '000000'), /doesn't match/, `attempt ${i} reports wrong PIN`);
  }
  const st4 = await vault.state();
  assert.equal(st4.failedAttempts, 4, 'failures persist across calls');
  await assert.rejects(() => vault.unlock(lockUid, '000000'), /locked/, '5th consecutive failure locks out');
  const stLocked = await vault.state();
  assert.ok(stLocked.lockoutUntil > Date.now(), 'lockout deadline is in the future');
  await assert.rejects(() => vault.unlock(lockUid, '123456'), /locked/, 'correct PIN is blocked while locked');
  await assert.rejects(() => vault.changePin(lockUid, '123456', '654321'), /locked/, 'changePin is blocked while locked (no bypass)');
  // Simulate expiry without waiting: clear the persisted deadline, then succeed.
  const vstore = require('../src/main/vault/store.js');
  await vstore.setLockState({ attempts: 0, lockoutUntil: 0 });
  const okAgain = await vault.unlock(lockUid, '123456');
  assert.ok(okAgain.ok, 'unlock succeeds after lockout clears');
  const stReset = await vault.state();
  assert.equal(stReset.failedAttempts, 0, 'success resets the counter');
  assert.ok(stReset.kdfUpgradeAvailable === false, 'fresh 600k meta needs no upgrade');
  vault.lock();

  console.log('Flowr vault PIN rotation + JWT-only regression checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
