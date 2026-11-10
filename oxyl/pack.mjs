// Packs the packages this fork changes as `<version>` tarballs in oxyl/dist.
// Versions are set only for the duration of the build, so the tree keeps
// upstream's versions and upstream's version bumps never conflict.
//
//   node oxyl/pack.mjs 8.47.0-oxyl.1
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHANGED = ['core', 'query', 'orval'];

const version = process.argv[2];
if (!version) {
  throw new Error('Usage: node oxyl/pack.mjs <version>');
}

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'oxyl', 'dist');
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' });

const manifests = CHANGED.map((name) => {
  const file = path.join(root, 'packages', name, 'package.json');
  return { name, file, original: readFileSync(file, 'utf8') };
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

try {
  for (const { file, original } of manifests) {
    writeFileSync(
      file,
      original.replace(/"version": "[^"]+"/, `"version": "${version}"`),
    );
  }
  run('vp', ['run', 'build:release']);
  for (const { name } of manifests) {
    run(
      'bun',
      ['pm', 'pack', '--destination', out],
      path.join(root, 'packages', name),
    );
  }
} finally {
  for (const { file, original } of manifests) {
    writeFileSync(file, original);
  }
}
