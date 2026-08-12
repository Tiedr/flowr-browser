const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const yauzl = require('yauzl');

// Chrome extension IDs are 32 characters, each in the range a-p (a base-16
// alphabet). This lets us pull the ID out of a full Web Store URL, a bare ID,
// or anything the user pastes in between.
function parseExtensionId(input) {
  if (!input) return null;
  const match = String(input).trim().match(/[a-p]{32}/);
  return match ? match[0] : null;
}

// Download a URL to a Buffer using Electron's net module. net.request honours
// the app's proxy config and follows 3xx redirects by default, which the CRX
// endpoint relies on (it 302s to the real file host).
function download(url) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`Download failed (HTTP ${response.statusCode}). The extension may be unavailable.`));
        response.resume();
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

// A .crx file is a signed wrapper around a plain ZIP. To read the contents we
// have to skip the CRX header and hand the trailing ZIP bytes to yauzl.
//   CRX3:  "Cr24" | version(4) | headerLen(4) | header | ZIP
//   CRX2:  "Cr24" | version(4) | pubKeyLen(4) | sigLen(4) | pubKey | sig | ZIP
function crxToZip(buffer) {
  // "Cr24" magic number. If it's absent, assume we already have a raw ZIP.
  if (buffer.length < 16 || buffer.readUInt32BE(0) !== 0x43723234) {
    return buffer;
  }
  const version = buffer.readUInt32LE(4);
  if (version === 2) {
    const publicKeyLength = buffer.readUInt32LE(8);
    const signatureLength = buffer.readUInt32LE(12);
    return buffer.subarray(16 + publicKeyLength + signatureLength);
  }
  if (version === 3) {
    const headerLength = buffer.readUInt32LE(8);
    return buffer.subarray(12 + headerLength);
  }
  throw new Error(`Unsupported CRX format (version ${version}).`);
}

// Extract every entry of an in-memory ZIP buffer into destDir. Entries are read
// one at a time (lazyEntries) so we never hold the whole tree in memory, and we
// reject any path that tries to escape destDir (zip-slip protection).
function unzipBuffer(buffer, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);

      zip.on('error', reject);
      zip.on('end', resolve);
      zip.readEntry();

      zip.on('entry', (entry) => {
        const relative = entry.fileName.replace(/\\/g, '/');
        const target = path.join(destDir, relative);

        // Reject anything resolving outside the destination directory.
        if (!target.startsWith(destDir + path.sep) && target !== destDir) {
          zip.readEntry();
          return;
        }

        if (/\/$/.test(relative)) {
          fs.mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(streamErr);
          const writeStream = fs.createWriteStream(target);
          writeStream.on('error', reject);
          readStream.on('error', reject);
          readStream.on('end', () => zip.readEntry());
          readStream.pipe(writeStream);
        });
      });
    });
  });
}

// Full flow: resolve an ID, pull the CRX straight from Google's update service,
// strip the header, unpack it into userData/Extensions/<id>, and load it.
async function installStoreExtension(idOrUrl, ses, userDataPath) {
  const id = parseExtensionId(idOrUrl);
  if (!id) {
    throw new Error("That doesn't look like a Chrome Web Store link or extension ID.");
  }

  // Google's update service returns "204 No Content" when the request doesn't
  // look enough like Chrome, or when prodversion is older than the extension's
  // minimum. We send the full Chrome parameter set and a very high prodversion
  // so the server always hands back the latest published CRX. (Verified: the
  // real Chromium 120 version gets a 204 for recent MV3 extensions.)
  const crxUrl =
    'https://clients2.google.com/service/update2/crx' +
    '?response=redirect&os=win&arch=x86-64&os_arch=x86-64&nacl_arch=x86-64' +
    '&prod=chromiumcrx&prodchannel=unknown&lang=en-US&acceptformat=crx2,crx3' +
    '&prodversion=9999.0.0.0' +
    `&x=id%3D${id}%26installsource%3Dondemand%26uc`;

  const crxBuffer = await download(crxUrl);
  const zipBuffer = crxToZip(crxBuffer);

  const destDir = path.join(userDataPath, 'Extensions', id);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  await unzipBuffer(zipBuffer, destDir);

  const loaded = await ses.loadExtension(destDir, { allowFileAccess: true });
  return {
    dir: destDir,
    storeId: id,
    id: loaded.id,
    name: loaded.name || id,
    version: loaded.version || ''
  };
}

module.exports = { parseExtensionId, installStoreExtension };
