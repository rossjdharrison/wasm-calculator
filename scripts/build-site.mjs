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

import { rm, mkdir, copyFile, access, readdir, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// [source, destination-name-in-dist]
const FILES = [
  [join(ROOT, 'web', 'index.html'), 'index.html'],
  [join(ROOT, 'web', 'landing.js'), 'landing.js'],
  [join(ROOT, 'web', 'configure.html'), 'configure.html'],
  [join(ROOT, 'web', 'app.js'), 'app.js'],
  [join(ROOT, 'web', 'render-form.mjs'), 'render-form.mjs'],
  [join(ROOT, 'web', 'showroom-view.mjs'), 'showroom-view.mjs'],
  [join(ROOT, 'web', 'ui.mjs'), 'ui.mjs'],
  [join(ROOT, 'web', 'showroom.css'), 'showroom.css'],
  [join(ROOT, 'web', 'editor.html'), 'editor.html'],
  [join(ROOT, 'web', 'editor.js'), 'editor.js'],
  [join(ROOT, 'web', 'data-editor.html'), 'data-editor.html'],
  [join(ROOT, 'web', 'data-editor.js'), 'data-editor.js'],
  [join(ROOT, 'web', 'presentation-editor.html'), 'presentation-editor.html'],
  [join(ROOT, 'web', 'presentation-editor.js'), 'presentation-editor.js'],
  [join(ROOT, 'web', 'assembler.mjs'), 'assembler.mjs'],
  [join(ROOT, 'web', 'store.mjs'), 'store.mjs'],
  [join(ROOT, 'web', 'expr.mjs'), 'expr.mjs'],
  [join(ROOT, 'web', 'rule.mjs'), 'rule.mjs'],
  [join(ROOT, 'web', 'editor-ui.mjs'), 'editor-ui.mjs'],
  [join(ROOT, 'web', 'assets.mjs'), 'assets.mjs'],
  [join(ROOT, 'web', 'asset-picker.mjs'), 'asset-picker.mjs'],
  [join(ROOT, 'web', 'editor-engine.mjs'), 'editor-engine.mjs'],
  [join(ROOT, 'web', 'schema-check.mjs'), 'schema-check.mjs'],
  [join(ROOT, 'web', 'coverage.mjs'), 'coverage.mjs'],
  [join(ROOT, 'web', 'binding.mjs'), 'binding.mjs'],
  [join(ROOT, 'web', 'data.schema.json'), 'data.schema.json'],
  [join(ROOT, 'web', 'model.schema.json'), 'model.schema.json'],
  [join(ROOT, 'web', 'qc-base.css'), 'qc-base.css'],
  [join(ROOT, 'web', 'theme.css'), 'theme.css'],
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

  // Copy every model (web/models/<id>/*.json) + the catalogue that drives the
  // landing page. Each configurator loads its own pair of files from here.
  const modelsSrc = join(ROOT, 'web', 'models');
  if (await exists(modelsSrc)) {
    await cp(modelsSrc, join(DIST, 'models'), { recursive: true });
    console.log('  + dist/models/** (all models + catalog)');
  }

  // Copy the car image folder (web/cars/*) if present — the model references
  // these by relative path (option.image = "cars/<name>.jpg").
  const carsSrc = join(ROOT, 'web', 'cars');
  if (await exists(carsSrc)) {
    const imgs = (await readdir(carsSrc)).filter((n) => /\.(jpe?g|png|webp|avif|svg)$/i.test(n));
    if (imgs.length) {
      await mkdir(join(DIST, 'cars'), { recursive: true });
      for (const n of imgs) { await copyFile(join(carsSrc, n), join(DIST, 'cars', n)); console.log(`  + dist/cars/${n}`); }
    }
  }
  console.log('✓ dist/ ready to deploy');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
