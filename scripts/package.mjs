import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const packageInfo = JSON.parse(await readFile(new URL('package.json', root)));
const manifest = JSON.parse(await readFile(new URL('dist/manifest.json', root)));
const { version } = packageInfo;
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a three-part release version');
assert(version.split('.').every(part => Number(part) <= 65535), 'Chrome version components must be at most 65535');
assert.equal(manifest.version, version, 'package.json and manifest.json versions must match');
const tag = process.argv[2];
if (tag) assert.equal(tag, `v${version}`, 'Release tag must match the package version');

const archive = new URL(`framehush-${version}.zip`, root);
await rm(archive, { force: true });
execFileSync('zip', ['-qr', fileURLToPath(archive), '.'], {
  cwd: fileURLToPath(new URL('dist/', root)),
  stdio: 'inherit',
});
console.log(`Packaged ${fileURLToPath(archive)}`);
