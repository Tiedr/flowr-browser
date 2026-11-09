// NSIS wrapper for electron-builder.
//
// electron-builder drives makensis by piping the generated installer script in
// on stdin and telling it where to write the result with the `-XOutFile`
// command-line option. NSIS only applies those `/X...` script commands when
// the script arrives as a file: over stdin they are silently dropped, which
// leaves makensis with no output file at all ("Can't open output file") and
// with the default LZMA compressor instead of the requested zlib — which on a
// ~90 MB payload means an installer build that runs for tens of minutes.
//
// This wrapper takes the script on stdin exactly as electron-builder sends it,
// writes it to a temporary file with the output path and compressor injected
// as ordinary script commands, and runs the real compiler against that file.
//
// Set FLOWR_NSIS_PATH to point at a specific makensis.exe; otherwise the
// electron-builder tool cache is searched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ELECTRON_BUILDER_CACHE = process.env.ELECTRON_BUILDER_CACHE
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');

function findMakensis() {
  if (process.env.FLOWR_NSIS_PATH && fs.existsSync(process.env.FLOWR_NSIS_PATH)) {
    return process.env.FLOWR_NSIS_PATH;
  }
  const candidates = [];
  // The newer bundled toolset (NSIS 3.12) is the fastest and handles a
  // file-based script correctly.
  const bundleRoot = path.join(ELECTRON_BUILDER_CACHE, 'nsis@1.2.1');
  if (fs.existsSync(bundleRoot)) {
    for (const entry of fs.readdirSync(bundleRoot)) {
      candidates.push(path.join(bundleRoot, entry, 'windows', 'Bin', 'makensis.exe'));
      candidates.push(path.join(bundleRoot, entry, 'windows', 'makensis.exe'));
    }
  }
  // The legacy toolset (NSIS 3.0.4.1).
  const legacyRoot = path.join(ELECTRON_BUILDER_CACHE, 'nsis-3.0.4.1');
  if (fs.existsSync(legacyRoot)) {
    for (const entry of fs.readdirSync(legacyRoot)) {
      candidates.push(path.join(legacyRoot, entry, 'Bin', 'makensis.exe'));
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Pull `-XOutFile "<path>"` and `-XSetCompressor <name>` out of the argument
// list. Both are accepted with either a dash or a slash prefix.
function extractScriptCommands(argv) {
  const rest = [];
  const commands = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^[-/]X([A-Za-z]+)$/.exec(arg);
    if (!match) { rest.push(arg); continue; }
    const name = match[1].toLowerCase();
    if (name === 'outfile' || name === 'setcompressor') {
      const value = argv[i + 1];
      if (value !== undefined) { commands.push([name, value]); i++; }
      continue;
    }
    rest.push(arg);
  }
  return { rest, commands };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

(async () => {
  const makensis = findMakensis();
  if (!makensis) {
    console.error('nsis-wrapper: could not find makensis.exe. Set FLOWR_NSIS_PATH.');
    process.exit(1);
  }

  const { rest, commands } = extractScriptCommands(process.argv.slice(2));
  const script = await readStdin();

  const outFile = commands.find(([name]) => name === 'outfile');
  const compressor = commands.find(([name]) => name === 'setcompressor');

  // The injected commands must come before any section in the script.
  const header = [];
  if (outFile) header.push(`OutFile "${outFile[1].replace(/"/g, '')}"`);
  if (compressor) header.push(`SetCompressor ${compressor[1]}`);

  const tmp = path.join(os.tmpdir(), `flowr-nsis-${process.pid}-${Date.now()}.nsi`);
  fs.writeFileSync(tmp, `${header.join('\n')}\n${script}`, 'utf8');

  const child = spawn(makensis, [...rest, tmp], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NSISDIR: path.dirname(path.dirname(makensis)) }
  });
  child.on('close', code => {
    try { fs.unlinkSync(tmp); } catch (_) {}
    process.exit(code === null ? 1 : code);
  });
  child.on('error', error => {
    console.error('nsis-wrapper: failed to run makensis:', error.message);
    process.exit(1);
  });
})();
