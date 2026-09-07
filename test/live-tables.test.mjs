// Live reference-data overlay: a model's `tables.<name>.source` values are overlaid from an
// edge rate card BEFORE assemble. This must be SAFE BY CONSTRUCTION — only existing keys,
// only finite in-bounds numbers, on a clone — and PARITY-PRESERVING: the overlaid image
// evaluates identically in the WASM VM and the JS reference oracle (no gate exercises this
// browser-only path otherwise). (pretest builds build/quote.wasm.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel, loadEngine, referenceEvaluate } from '../web/assembler.mjs';
import { overlayTables, liveSourcesOf } from '../web/live-tables.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => readFile(join(root, '..', p), 'utf8').then(JSON.parse);
const wasm = await readFile(join(root, '..', 'build', 'quote.wasm'));
const data = await readJson('web/models/shipping/data-model.json');
const pres = await readJson('web/models/shipping/presentation-model.json');
const near = (a, b) => Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-9;
const cfg = { method: 'roro', destination: 'uk', vehicleWeight: 1800, vehicleValue: 50000 };

test('liveSourcesOf lists the datasets a model references', () => {
  assert.deepEqual(liveSourcesOf(data), ['roro-shipping']);
  assert.deepEqual(liveSourcesOf({ tables: { x: { kind: '1d', map: {} } } }), [], 'no source → nothing');
});

test('overlayTables overlays only existing keys, finite + in-bounds, on a clone', () => {
  const doc = { tables: { destBase: { map: { uk: 999, zzz: 500 } }, dutyRate: { map: { uk: 5 } }, vatRate: { map: { uk: 'x' } } } };
  const out = overlayTables(data, { 'roro-shipping': doc });
  assert.equal(out.tables.destBase.map.uk, 999, 'existing key overlaid');
  assert.equal('zzz' in out.tables.destBase.map, false, 'unknown key never added (would break codeOf)');
  assert.equal(out.tables.destBase.map.usa, 1750, 'untouched key keeps baked value');
  assert.equal(out.tables.dutyRate.map.uk, 0.10, 'out-of-bounds (5 > max 1) rejected → baked 0.10');
  assert.equal(out.tables.vatRate.map.uk, 0.20, 'non-numeric rejected → baked 0.20');
  assert.equal(data.tables.destBase.map.uk, 375, 'input not mutated (worked on a clone)');
});

test('a missing/absent dataset degrades to the baked tables', () => {
  assert.equal(overlayTables(data, {}).tables.destBase.map.uk, 375, 'no doc → baked');
  assert.equal(overlayTables(data, { 'roro-shipping': null }).tables.destBase.map.uk, 375, 'null doc → baked');
  assert.equal(overlayTables(data, { 'roro-shipping': { tables: {} } }).tables.destBase.map.uk, 375, 'doc without the table → baked');
});

test('parity: the overlaid image evaluates identically in the WASM VM and the JS oracle', async () => {
  const overlaid = overlayTables(data, { 'roro-shipping': { tables: { destBase: { map: { uk: 900 } } } } });
  const asm = assemble(mergeModel(overlaid, pres));
  const engine = await loadEngine(wasm, asm);
  const R = referenceEvaluate(asm.ir, cfg), W = engine.evaluate(cfg);
  for (const [id] of asm.ir.slotOf) assert.ok(near(R.valueById[id], W.valueById[id]), `${id}: ref=${R.valueById[id]} wasm=${W.valueById[id]}`);
  // the live freight (900 base, roro factor 1, 1800kg → no surcharge) actually flows through
  assert.ok(near(W.valueById.freight, 900), `overlaid freight ${W.valueById.freight} should be 900 (baked would be 375)`);
});

test('the baked model still assembles + evaluates unchanged when no overlay is applied', async () => {
  const asm = assemble(mergeModel(data, pres));
  const engine = await loadEngine(wasm, asm);
  assert.ok(near(engine.evaluate(cfg).valueById.freight, 375), 'baked uk freight = 375 (destBase 375 × roro 1)');
});
