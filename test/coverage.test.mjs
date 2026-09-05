// Coverage/orphan analyzer tests (Area 1). Proves the analyzer infers table
// indexing from lookups, detects the obligation cascade when an option is added,
// and that applyFix() connects the orphans back up (round-trip to clean).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeCoverage, applyFix, inferIndexing, edgesOf, findCycles } from '../web/coverage.mjs';

const readJson = (p) => readFile(new URL(p, import.meta.url)).then((b) => JSON.parse(b));
const DATA = await readJson('../web/models/vehicles/data-model.json');
const PRES = await readJson('../web/models/vehicles/presentation-model.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

test('the shipped model is fully connected (no coverage findings)', () => {
  const r = analyzeCoverage(clone(DATA), clone(PRES));
  assert.deepEqual(r.counts, { error: 0, warn: 0, info: 0 }, r.findings.map((f) => `${f.severity}:${f.message}`).join(' | '));
});

test('the shipped model has no dependency cycles', () => {
  assert.equal(findCycles(edgesOf(DATA)).size, 0);
});

test('a dependency cycle is detected and flagged as an error on every member', () => {
  const fld = (id) => ({ op: 'field', args: [id] });
  const data = { fields: [], computed: [
    { id: 'a', formula: fld('b') },   // a depends on b
    { id: 'b', formula: fld('c') },   // b depends on c
    { id: 'c', formula: fld('a') },   // c depends on a  → cycle a→b→c→a
    { id: 'd', formula: fld('a') },   // d depends on a but is not itself in the cycle
  ] };
  const cyc = findCycles(edgesOf(data));
  assert.deepEqual([...cyc].sort(), ['a', 'b', 'c']);
  assert.ok(!cyc.has('d'), 'a dependent outside the cycle is not flagged');
  const r = analyzeCoverage(data, {});
  const cycleFindings = r.findings.filter((f) => f.kind === 'cycle');
  assert.equal(cycleFindings.length, 3);
  assert.ok(cycleFindings.every((f) => f.severity === 'error'));
});

test('edgesOf orients edges dependency→dependent', () => {
  const data = { computed: [{ id: 'total', formula: { op: 'add', args: [{ op: 'field', args: ['base'] }, 5] } }], fields: [{ id: 'base', type: 'number' }] };
  assert.deepEqual(edgesOf(data), [{ from: 'base', to: 'total' }]);
});

test('indexing is inferred from lookup() ASTs', () => {
  const idx = inferIndexing(DATA, PRES);
  assert.deepEqual(idx.modelTrimPrice, ['model', 'trim']);
  assert.deepEqual(idx.engineDelta, ['engine']);
  assert.deepEqual(idx.roadTax, ['engine']);
});

test('adding a model option flags the missing table rows/keys + the label', () => {
  const d = clone(DATA);
  d.fields.find((f) => f.id === 'model').options.push({ id: 'roadster' });
  const r = analyzeCoverage(d, clone(PRES));
  assert.ok(r.counts.error >= 1, 'a new model leaves table gaps');
  assert.ok(r.findings.some((f) => f.kind === 'missing-table-key' && f.table === 'modelTrimPrice' && f.row === 'roadster'), 'modelTrimPrice 2d row flagged');
  assert.ok(r.findings.some((f) => f.kind === 'missing-label' && f.field === 'model' && f.option === 'roadster'), 'missing label flagged');
});

test('adding an engine option flags every table the field indexes (the cascade)', () => {
  const d = clone(DATA);
  d.fields.find((f) => f.id === 'engine').options.push({ id: 'phev' });
  const r = analyzeCoverage(d, clone(PRES));
  const tables = r.findings.filter((f) => f.kind === 'missing-table-key' && f.option === 'phev').map((f) => f.table).sort();
  // every engine-indexed table must be flagged (price, tax, range + the realism factors)
  assert.deepEqual(tables, ['engineAccelFactor', 'engineDelta', 'engineHpFactor', 'engineRange', 'engineTopFactor', 'engineWeightDelta', 'roadTax']);
});

test('applyFix connects every orphan back to a clean model', () => {
  const d = clone(DATA);
  const p = clone(PRES);
  d.fields.find((f) => f.id === 'model').options.push({ id: 'roadster' });
  d.fields.find((f) => f.id === 'engine').options.push({ id: 'phev' });
  const first = analyzeCoverage(d, p);
  assert.ok(first.counts.error > 0);
  for (const f of first.findings) if (f.fix) applyFix(d, p, f.fix);
  const after = analyzeCoverage(d, p);
  assert.deepEqual(after.counts, { error: 0, warn: 0, info: 0 }, after.findings.map((f) => f.message).join(' | '));
  // the 2d row was seeded across all trims at 0
  const anotherRow = Object.keys(d.tables.modelTrimPrice.rows).find((k) => k !== 'roadster');
  assert.deepEqual(Object.keys(d.tables.modelTrimPrice.rows.roadster).sort(), Object.keys(d.tables.modelTrimPrice.rows[anotherRow]).sort());
  assert.ok(Object.values(d.tables.modelTrimPrice.rows.roadster).every((v) => v === 0));
});

test('a field wired to nothing is reported as an orphan', () => {
  const d = clone(DATA);
  d.fields.push({ id: 'gadget', type: 'choice', options: [{ id: 'a' }, { id: 'b' }] });
  const r = analyzeCoverage(d, clone(PRES));
  assert.ok(r.findings.some((f) => f.kind === 'orphan-field' && f.field === 'gadget'));
});

test('an unreferenced multi-select option is reported as dead', () => {
  const d = clone(DATA);
  d.fields.find((f) => f.id === 'packages').options.push({ id: 'ambientLight' });
  const r = analyzeCoverage(d, clone(PRES));
  assert.ok(r.findings.some((f) => f.kind === 'dead-option' && f.field === 'packages' && f.option === 'ambientLight'));
});
