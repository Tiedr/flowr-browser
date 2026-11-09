// Stage the NSIS helper files electron-builder expects to find next to the
// makensis entry point (scripts/nsis).
//
// electron-builder copies elevate.exe out of the NSIS directory and loads the
// Plugins/Include folders from there while it builds — before makensis ever
// runs — so these have to be in place before the build starts, not inside the
// wrapper.
//
// The staged files come from the electron-builder tool cache and are not
// committed; .gitignore keeps this directory clean.

const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname;
const ELECTRON_BUILDER_CACHE = process.env.ELECTRON_BUILDER_CACHE
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');

function findToolsetDirs() {
  const roots = [
    path.join(ELECTRON_BUILDER_CACHE, 'nsis@1.2.1'),
    path.join(ELECTRON_BUILDER_CACHE, 'nsis-3.0.4.1')
  ];
  const platformDirs = [];
  const rootsWithElevate = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const candidate = path.join(root, entry);
      for (const dir of [path.join(candidate, 'windows'), candidate]) {
        if (fs.existsSync(path.join(dir, 'Bin', 'makensis.exe'))) platformDirs.push(dir);
      }
      if (fs.existsSync(path.join(candidate, 'elevate.exe'))) rootsWithElevate.push(candidate);
    }
  }
  return { platformDirs, rootsWithElevate };
}

function copyFile(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  try { fs.copyFileSync(source, target); return true; } catch (_) { return false; }
}

function copyDir(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  try { fs.cpSync(source, target, { recursive: true }); return true; } catch (_) { return false; }
}

const { platformDirs, rootsWithElevate } = findToolsetDirs();
if (!platformDirs.length) {
  console.error('nsis-stage: no NSIS toolset found in the electron-builder cache.');
  console.error('            Run an electron-builder build once to download it.');
  process.exit(1);
}

let staged = 0;
for (const root of rootsWithElevate) {
  if (copyFile(path.join(root, 'elevate.exe'), path.join(here, 'elevate.exe'))) staged++;
}
for (const dir of platformDirs) {
  if (copyDir(path.join(dir, 'Plugins'), path.join(here, 'Plugins'))) staged++;
  if (copyDir(path.join(dir, 'Include'), path.join(here, 'Include'))) staged++;
}

console.log(`nsis-stage: staged ${staged} NSIS helper file(s) into ${here}`);