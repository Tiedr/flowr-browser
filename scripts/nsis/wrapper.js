// NSIS entry point used through ELECTRON_BUILDER_NSIS_DIR.
//
// electron-builder pipes the generated installer script into makensis on
// stdin and passes the output path with -XOutFile. NSIS drops those /X script
// commands when the script arrives over stdin, which leaves the installer
// with no output file and the slow default compressor. The real work happens
// in wrapper.js, which converts the piped script into a file with the output
// path and compressor injected as ordinary commands.
//
// ELECTRON_BUILDER_NSIS_DIR also expects this directory to contain the NSIS
// helper binaries (elevate.exe and the Plugins folder), so they are copied
// here from the electron-builder tool cache on first use.
//
// See scripts/nsis/wrapper.js for the full explanation.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const here = __dirname;
const ELECTRON_BUILDER_CACHE = process.env.ELECTRON_BUILDER_CACHE
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');

// The NSIS toolset electron-builder downloaded, if there is one.
function findToolsetDir() {
  const roots = [
    path.join(ELECTRON_BUILDER_CACHE, 'nsis@1.2.1'),
    path.join(ELECTRON_BUILDER_CACHE, 'nsis-3.0.4.1')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const candidate of [
        path.join(root, entry, 'windows'),
        path.join(root, entry)
      ]) {
        if (fs.existsSync(path.join(candidate, 'Bin', 'makensis.exe'))) return candidate;
      }
    }
  }
  return null;
}

function findMakensis() {
  if (process.env.FLOWR_NSIS_PATH && fs.existsSync(process.env.FLOWR_NSIS_PATH)) {
    return process.env.FLOWR_NSIS_PATH;
  }
  const candidates = [];
  // The legacy toolset (NSIS 3.0.4.1) is preferred: its compiler runs
  // correctly when spawned by Node, while the 3.12 bundle's binaries can fault
  // with an access violation on some hosts.
  const legacyRoot = path.join(ELECTRON_BUILDER_CACHE, 'nsis-3.0.4.1');
  if (fs.existsSync(legacyRoot)) {
    for (const entry of fs.readdirSync(legacyRoot)) {
      candidates.push(path.join(legacyRoot, entry, 'Bin', 'makensis.exe'));
    }
  }
  const bundleRoot = path.join(ELECTRON_BUILDER_CACHE, 'nsis@1.2.1');
  if (fs.existsSync(bundleRoot)) {
    for (const entry of fs.readdirSync(bundleRoot)) {
      candidates.push(path.join(bundleRoot, entry, 'windows', 'Bin', 'makensis.exe'));
      candidates.push(path.join(bundleRoot, entry, 'windows', 'makensis.exe'));
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// electron-builder builds makensis' argument list like this:
//
//   -WX -INPUTCHARSET UTF8 -DAPP_ID=... "-XOutFile "C:\...\Flowr.exe"" \
//   "-XVIProductVersion 1.2.0.0" "-XUnicode true" "-XSetCompressor zlib" -
//
// Note the shape: each `/X...` script command and its value are pushed as ONE
// argument, and the trailing lone "-" is what tells NSIS to read the script
// from stdin.
//
// NSIS only applies those `/X` script commands when the script arrives as a
// file. Over stdin they are dropped, which leaves the installer with no
// output file at all ("Can't open output file") and with the default LZMA
// compressor instead of the requested zlib — on a ~90 MB payload that turns a
// two-minute build into a twenty-minute one.
//
// So this wrapper rewrites the whole thing into a plain script: every `/X`
// command becomes an ordinary NSIS command at the top of the file, the lone
// "-" is dropped, and the script is handed to the compiler as a file.
function extractScriptCommands(argv) {
  const rest = [];
  const commands = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // The lone "-" means "read the script from stdin".
    if (arg === '-') continue;

    // "-XName value" as a single argument.
    const combined = /^[-/]X([A-Za-z]+)\s+(.+)$/.exec(arg);
    if (combined) {
      commands.push([combined[1], combined[2]]);
      continue;
    }

    // "-XName" followed by its value as the next argument.
    const split = /^[-/]X([A-Za-z]+)$/.exec(arg);
    if (split) {
      const value = argv[i + 1];
      if (value !== undefined) { commands.push([split[1], value]); i++; }
      continue;
    }

    rest.push(arg);
  }
  return { rest, commands };
}

// NSIS requires "Unicode" to be the first command in a script, and the output
// file has to be set before the first section.
function orderCommands(commands) {
  const byName = new Map();
  for (const [name, value] of commands) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(value);
  }
  const ordered = [];
  const take = name => {
    for (const value of byName.get(name) || []) ordered.push([name, value]);
    byName.delete(name);
  };
  take('Unicode');
  take('OutFile');
  take('SetCompressor');
  for (const [name, value] of commands) {
    if (byName.has(name)) take(name);
  }
  return ordered;
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
    console.error('nsis-wrapper: could not find makensis.exe. Set FLOWR_NSIS_PATH to its location.');
    process.exit(1);
  }

  const { rest, commands } = extractScriptCommands(process.argv.slice(2));
  const script = await readStdin();

  if (process.env.FLOWR_NSIS_DEBUG) {
    const debug = [
      `makensis: ${makensis}`,
      `args: ${JSON.stringify(process.argv.slice(2))}`,
      `rest: ${JSON.stringify(rest)}`,
      `commands: ${JSON.stringify(commands)}`
    ].join('\n');
    console.log(debug);
  }
  if (process.env.FLOWR_NSIS_ARGS_OUT) {
    try {
      fs.writeFileSync(process.env.FLOWR_NSIS_ARGS_OUT, JSON.stringify(process.argv.slice(2)), 'utf8');
    } catch (_) {}
  }

  // The /X script commands become ordinary commands at the top of the file.
  const header = orderCommands(commands).map(([name, value]) => {
    // OutFile and friends take a quoted path; the value already carries its
    // quotes, so pass it through untouched.
    return `${name} ${value}`;
  });

  // Keep the temporary script next to the templates so relative !include
  // paths (common.nsh, multiUser.nsh, ...) still resolve.
  const tmp = path.join(process.cwd(), `.flowr-nsis-${process.pid}-${Date.now()}.nsi`);
  fs.writeFileSync(tmp, `${header.join('\n')}\n${script}`, 'utf8');

  const child = spawn(makensis, [...rest, tmp], {
    // stdin must be a real pipe: NSIS's compiler faults on an invalid stdin
    // handle, so it is opened and closed immediately rather than ignored.
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, NSISDIR: path.dirname(path.dirname(makensis)) }
  });
  if (child.stdin) child.stdin.end();
  child.on('close', code => {
    if (process.env.FLOWR_NSIS_KEEP) {
      console.log(`nsis-wrapper: kept ${tmp}`);
    } else {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
    process.exit(code === null ? 1 : code);
  });
  child.on('error', error => {
    console.error('nsis-wrapper: failed to run makensis:', error.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
    process.exit(1);
  });
})();
