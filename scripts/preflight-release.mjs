// Release preflight.
//
// electron-builder only verifies a downloaded Windows update's Authenticode
// signature when the publishing build was itself signed. Flipping
// `verifyUpdateCodeSignature` on without a certificate makes every auto-update
// fail at the user's machine instead of at build time, so catch the missing
// certificate here where the message can still be acted on.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pkg = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')));

const problems = [];
const notes = [];
const isWindows = process.platform === 'win32';

// Anything electron-builder reads to sign a build.
const hasWindowsCert = Boolean(process.env.CSC_LINK) || Boolean(process.env.WIN_CSC_LINK);
const hasMacCert = Boolean(process.env.CSC_LINK) || Boolean(process.env.APPLE_IDENTITY)
  || (process.env.CSC_NAME && existsSync(path.join(repoRoot, process.env.CSC_NAME)));
const appleIdNotarization = Boolean(process.env.APPLE_ID) && Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD)
  && Boolean(process.env.APPLE_TEAM_ID);
const apiKeyNotarization = Boolean(process.env.APPLE_API_KEY) && Boolean(process.env.APPLE_API_KEY_ID)
  && Boolean(process.env.APPLE_API_ISSUER);
const notarization = appleIdNotarization || apiKeyNotarization;

const target = process.argv[2] || 'current';
const wantsWindows = target === 'all' || target === 'windows' || target === 'current';
const wantsMac = target === 'all' || target === 'mac' || target === 'current';

if (wantsWindows) {
  if (!hasWindowsCert) {
    problems.push(
      'No Windows code-signing certificate is configured.\n' +
      '  Set CSC_LINK to a .pfx file (or its base64 contents) and CSC_KEY_PASSWORD to its password.\n' +
      '  Publishing unsigned builds means users install an unverified binary and Windows SmartScreen warns them.'
    );
  } else {
    notes.push('Windows signing certificate detected.');
  }
}

if (wantsMac) {
  if (!hasMacCert) {
    problems.push(
      'No macOS signing identity is configured.\n' +
      '  Set CSC_LINK (Developer ID Application) plus APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID,\n' +
      '  or sign the .app manually before packaging. package.json requires notarization, which needs an identity.'
    );
  } else if (pkg.build?.mac?.notarize && !notarization) {
    problems.push('mac notarization is enabled in package.json but the Apple credentials are incomplete.');
  } else {
    notes.push('macOS signing identity detected.');
  }
}

if (target === 'all' && !isWindows) {
  notes.push('Building macOS targets from a non-macOS host produces unsigned bundles; build them on macOS or in CI.');
}

// Update feeds must stay on the first-party GitHub release; a redirected feed
// would let an attacker choose which "update" a user installs.
const providers = pkg.build?.publish || [];
if (!providers.length) {
  problems.push('No publish provider is configured, so electron-updater has no feed.');
} else {
  for (const provider of providers) {
    if (provider.provider === 'generic' || provider.provider === 'custom') {
      problems.push('A custom publish provider bypasses GitHub release integrity. Use the github provider.');
    }
  }
}

for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length) {
  console.error('\nRelease preflight failed:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log('Release preflight passed.');