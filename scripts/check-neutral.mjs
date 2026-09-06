// =============================================================================
// check-neutral.mjs — the framework CONTRACT enforcer (pure Node, DOM-free).
// Re-derives melody-kernel R2/R6 discipline WITHOUT importing it, turning three
// framework invariants from claims into build-gated properties:
//   (A) NEUTRALITY — the neutral machinery contains no DOMAIN vocabulary (model ids
//       + their data.types class ids + journey ids). A lower-only ratchet, so the
//       boundary can only tighten (known bootstrap defaults are carried, not blocked).
//   (B) DRIFT — the schemas' snapshot enums equal the live hqdm-core vocabulary, and
//       every registry symbol resolves (stepKinds, category renderers, widgets).
//   (C) COVERAGE — every shipped model round-trips split→merge losslessly, so no
//       authored top-level key can silently vanish.
// Wired into `npm run build` before validate:model; test/contract.test.mjs runs the
// same functions so `npm test` catches the same drift.
// =============================================================================
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { splitModel, mergeModel } from '../web/assembler.mjs';
import { STEP_KINDS } from '../web/hqdm.mjs';
import { WIDGET_TYPES, WIDGET_CONTRACTS } from '../web/editor-engine.mjs';
import { CATEGORY_RENDERERS } from '../web/category-render.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const readJson = (p) => readFile(join(WEB, p), 'utf8').then(JSON.parse);
const readText = (p) => readFile(join(WEB, p), 'utf8');

// the neutral machinery: modules that interpret DATA and must carry no domain vocab.
const NEUTRAL_MODULES = [
  'hqdm.mjs', 'catalogue.mjs', 'catalogue-build.mjs', 'compose.mjs', 'individuals.mjs',
  'order.mjs', 'order-store.mjs', 'order-picker.mjs', 'journey-view.mjs', 'category-render.mjs',
  'journey-validate.mjs', 'journey-schema.mjs', 'phase-stepper.mjs', 'store.mjs',
  'showroom-view.mjs', 'journey-loom.mjs', 'journey-create.mjs', 'journey-edit.mjs',
  'landing.js', 'app.js',
];

// The neutrality RATCHET. Known, hard-to-remove bootstrap literals (store.mjs's
// ?m= default 'vehicles', journey-loom's ?j= default 'vehicle-sale', a few showroom
// labels) are CARRIED here — the count may only fall. Lower it when a leak is fixed;
// CI/`npm run build` go red if it rises. This is the wall made checkable.
export const MAX_DOMAIN_LEAKS = 2;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const wordRe = (tok) => new RegExp('(?<![A-Za-z0-9_])' + tok.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(?![A-Za-z0-9_])', 'g');

// the domain vocabulary the neutral machinery must not name: model dir ids, their
// declared data.types class ids, and journey ids — all read from DATA, so this
// self-updates as the domain changes.
async function domainTokens() {
  const tokens = new Set();
  const cat = await readJson('models/catalog.json').catch(() => ({ models: [] }));
  for (const m of cat.models || []) {
    tokens.add(m.id);
    const data = await readJson(`models/${m.id}/data-model.json`).catch(() => ({}));
    for (const cls of Object.keys(data.types || {})) tokens.add(cls);
  }
  const jcat = await readJson('journeys/catalog.json').catch(() => ({ journeys: [] }));
  for (const j of jcat.journeys || []) tokens.add(j.id);
  const dom = await readJson('domain.json').catch(() => ({}));
  for (const t of Object.keys((dom && dom.taxonomy) || {})) tokens.add(t);
  // drop trivially-short/generic tokens that would false-positive; keep distinctive ids
  return [...tokens].filter((t) => t && t.length >= 4);
}

export async function checkNeutrality() {
  const tokens = await domainTokens();
  const hits = [];
  for (const mod of NEUTRAL_MODULES) {
    let src; try { src = stripComments(await readText(mod)); } catch { continue; }
    for (const tok of tokens) {
      const re = wordRe(tok); let m;
      while ((m = re.exec(src))) { const line = src.slice(0, m.index).split('\n').length; hits.push({ mod, tok, line }); }
    }
  }
  const errors = [];
  if (hits.length > MAX_DOMAIN_LEAKS) errors.push(`neutrality: ${hits.length} domain-vocab leaks in neutral modules exceeds the ratchet ${MAX_DOMAIN_LEAKS} — ` + hits.map((h) => `${h.mod}:${h.line} "${h.tok}"`).join(', '));
  return { errors, warnings: hits.length < MAX_DOMAIN_LEAKS ? [`neutrality ratchet is loose: ${hits.length} < ${MAX_DOMAIN_LEAKS} — lower MAX_DOMAIN_LEAKS to ${hits.length}`] : [], count: hits.length, hits };
}

export async function checkDrift() {
  const errors = [];
  // (1) journey.schema.json step.kind enum is a static snapshot of hqdm-core stepKinds
  const js = await readJson('journey.schema.json');
  const enumKinds = js.properties.process.properties.steps.items.properties.kind.enum;
  if (JSON.stringify([...enumKinds].sort()) !== JSON.stringify([...STEP_KINDS].sort()))
    errors.push(`drift: journey.schema step.kind enum [${enumKinds}] != hqdm-core stepKinds [${STEP_KINDS}]`);
  // (2) every category renderer keys off a REAL hqdm type (renderHint leaf) or a known composite
  const core = await readJson('hqdm-core.json');
  const known = new Set([...Object.keys(core.renderHints || {}), ...Object.keys(core.types || {}), 'period_of_time']);
  for (const k of Object.keys(CATEGORY_RENDERERS)) if (!known.has(k)) errors.push(`drift: category renderer "${k}" is not a known hqdm type`);
  // (3) the widget registry and its contracts cannot diverge
  if (JSON.stringify([...WIDGET_TYPES].sort()) !== JSON.stringify(Object.keys(WIDGET_CONTRACTS).sort()))
    errors.push('drift: WIDGET_TYPES != keys(WIDGET_CONTRACTS)');
  return { errors, warnings: [] };
}

export async function checkCoverage() {
  const errors = [];
  const cat = await readJson('models/catalog.json').catch(() => ({ models: [] }));
  for (const m of cat.models || []) {
    let data, pres;
    try { data = await readJson(`models/${m.id}/data-model.json`); pres = await readJson(`models/${m.id}/presentation-model.json`); } catch { continue; }
    const merged = mergeModel(data, pres);
    const round = mergeModel(...(({ data, presentation }) => [data, presentation])(splitModel(merged)));
    try { assert.deepEqual(round, merged); } catch { errors.push(`coverage: model "${m.id}" loses a top-level key on split→merge (an author key not in the ownership whitelist)`); }
  }
  return { errors, warnings: [] };
}

export async function runAll() {
  const parts = await Promise.all([checkNeutrality(), checkDrift(), checkCoverage()]);
  return { errors: parts.flatMap((p) => p.errors), warnings: parts.flatMap((p) => p.warnings || []) };
}

// CLI: `node scripts/check-neutral.mjs` — green or exit 1.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-neutral.mjs')) {
  const r = await runAll();
  for (const w of r.warnings) console.warn(`  ⚠ ${w}`);
  if (r.errors.length) { for (const e of r.errors) console.error(`✖ ${e}`); process.exit(1); }
  console.log('✓ framework contract: neutrality + vocab-drift + coverage all hold.');
}
