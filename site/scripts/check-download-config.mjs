import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filename = path.resolve(here, '..', 'public', 'auth-config.js');
const config = await readFile(filename, 'utf8');
const clientId = config.match(/clientId:\s*'([^']+)'/)?.[1] || '';
if (!/^client_[A-Za-z0-9_-]+$/.test(clientId)) {
  throw new Error('Register the Flowr website in Tieddr Account and set its public clientId in site/public/auth-config.js before deployment.');
}
if (!config.includes("redirectUri: 'https://flowr.tieddr.com/auth/callback/'")) {
  throw new Error('The production OAuth redirect URI must be https://flowr.tieddr.com/auth/callback/.');
}
console.log('Flowr download OAuth configuration is ready for deployment.');
