// Assemble a flat, deployable site into dist/.
//
// Cloudflare Pages (and any static host) serves the publish directory at the
// site root, so everything the browser needs must sit together at the top of
// that directory. This copies the authored web/ files and the compiled wasm
// into dist/:
//
//   dist/index.html
//   dist/app.js
//   dist/styles.css
//   dist/quote.wasm      (from build/quote.wasm)
//
// Run `npm run asbuild:release` first (npm run build does both).
// Cross-platform: pure Node, no shell assumptions.

import { rm, mkdir, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// [source, destination-name-in-dist]
const FILES = [
  [join(ROOT, 'web', 'index.html'), 'index.html'],
  [join(ROOT, 'web', 'app.js'), 'app.js'],
  [join(ROOT, 'web', 'styles.css'), 'styles.css'],
  [join(ROOT, 'build', 'quote.wasm'), 'quote.wasm'],
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(join(ROOT, 'build', 'quote.wasm')))) {
    console.error('✖ build/quote.wasm not found. Run "npm run asbuild:release" first.');
    process.exit(1);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const [src, name] of FILES) {
    await copyFile(src, join(DIST, name));
    console.log(`  + dist/${name}`);
  }
  console.log('✓ dist/ ready to deploy');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
