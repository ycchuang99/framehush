import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const source = new URL('node_modules/@jitsi/rnnoise-wasm/', root);
const destination = new URL('dist/', root);
await rm(destination, { recursive: true, force: true });
await cp(new URL('src/', root), destination, { recursive: true });
await mkdir(new URL('vendor/', destination));
await cp(new URL('dist/rnnoise-sync.js', source), new URL('vendor/rnnoise-sync.js', destination));
await cp(new URL('LICENSE', source), new URL('vendor/JITSI-LICENSE.txt', destination));
await cp(new URL('THIRD_PARTY_NOTICES.md', root), new URL('vendor/THIRD_PARTY_NOTICES.md', destination));
const bytes = await readFile(new URL('vendor/rnnoise-sync.js', destination));
await writeFile(new URL('vendor/SHA256.txt', destination), `${createHash('sha256').update(bytes).digest('hex')}  rnnoise-sync.js\n`);
console.log('Built dist/ with local RNNoise WASM.');
