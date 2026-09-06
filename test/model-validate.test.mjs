// The engine-backed validation authority: validateFormula must resolve one
// expression against the real model's slots (delegating to the assembler) and
// return {ok, refs, error} WITHOUT throwing; tryAssemble must turn the
// assembler's fail-fast exception into data. (pretest builds build/quote.wasm,
// though these tests need only the JS assembler.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { validateFormula, tryAssemble } from '../web/model-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const data = await web('models/vehicles/data-model.json');
const pres = await web('models/vehicles/presentation-model.json');
const model = mergeModel(data, pres);

const F = (id) => ({ op: 'field', args: [id] });
const sorted = (a) => [...a].sort();

// ---- validateFormula: valid ------------------------------------------------
test('validateFormula OK (AST) returns refs, no error', () => {
  const r = validateFormula(model, { op: 'add', args: [F('vehiclePrice'), 1000] });
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.deepEqual(sorted(r.refs), ['vehiclePrice']);
});

test('validateFormula OK from a TEXT source (parseExpr path)', () => {
  const r = validateFormula(model, 'vehiclePrice + 1000');
  assert.equal(r.ok, true);
  assert.deepEqual(sorted(r.refs), ['vehiclePrice']);
});

test('validateFormula refs: lookup keys (not the table name) + has field', () => {
  const rl = validateFormula(model, { op: 'lookup', args: ['modelTrimPrice', F('model'), F('trim')] });
  assert.equal(rl.ok, true);
  assert.deepEqual(sorted(rl.refs), ['model', 'trim']); // table NAME excluded
  const rh = validateFormula(model, { op: 'if', args: [{ op: 'has', args: ['packages', 'tech'] }, 1, 0] });
  assert.equal(rh.ok, true);
  assert.deepEqual(sorted(rh.refs), ['packages']);
});

// ---- validateFormula: rejects (never throws) -------------------------------
const bad = (label, source, needle) => test(`validateFormula rejects: ${label}`, () => {
  const r = validateFormula(model, source);
  assert.equal(r.ok, false);
  assert.ok(r.error && typeof r.error.message === 'string', 'error carries a message');
  if (needle) assert.ok(r.error.message.toLowerCase().includes(needle), `"${r.error.message}" should include "${needle}"`);
});
bad('unknown field/computed ref', F('nope'), 'unknown');
bad('unknown op', { op: 'bogus', args: [] }, 'unknown op');
bad('bad arity', { op: 'eq', args: [F('model')] }, '2 arg');
bad('unknown option', { op: 'has', args: ['packages', 'zzz'] }, 'option');
bad('unknown table', { op: 'lookup', args: ['nope', F('model')] }, 'table');

test('validateFormula syntax error (text) is kind:syntax, not thrown', () => {
  const r = validateFormula(model, 'vehiclePrice +');
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'syntax');
});

// ---- tryAssemble -----------------------------------------------------------
test('tryAssemble OK matches assemble()', () => {
  const r = tryAssemble(model);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.assembled.ir.slotCount, assemble(model).ir.slotCount);
});

test('tryAssemble surfaces a model error as data (no throw)', () => {
  const broken = JSON.parse(JSON.stringify(model));
  broken.computed = broken.computed.concat([{ id: '__broken__', formula: F('doesNotExist') }]);
  const r = tryAssemble(broken);
  assert.equal(r.ok, false);
  assert.equal(r.assembled, null);
  assert.ok(r.errors.some((e) => e.message.toLowerCase().includes('unknown')));
});

// regression: a malformed table (missing map/rows) must be a swallowable MODEL
// error, never a raw TypeError — the assembler bakes tables lazily, so an unused
// malformed table only bites when a formula first references it.
test('tryAssemble reports a malformed referenced table as a model error', () => {
  const broken = JSON.parse(JSON.stringify(model));
  broken.tables = { ...(broken.tables || {}), stubTable: { kind: '1d' } }; // no "map"
  broken.computed = broken.computed.concat([{ id: '__usesStub__', formula: { op: 'lookup', args: ['stubTable', F('engine')] } }]);
  const r = tryAssemble(broken);
  assert.equal(r.ok, false);
  assert.ok(/table|map/i.test(r.errors[0].message), r.errors[0].message);
});

// regression: a wide variadic folds into a deep node spine that the JSON-nesting
// depth check never sees; the emitted-node-depth guard must reject it so it can't
// overflow the recursive WASM evaluator at runtime.
test('assemble rejects an over-deep expression tree from fan-out', () => {
  const broken = JSON.parse(JSON.stringify(model));
  const wide = { op: 'add', args: Array.from({ length: 300 }, () => 1) }; // 299-deep fold
  broken.computed = broken.computed.concat([{ id: '__wide__', formula: wide }]);
  const r = tryAssemble(broken);
  assert.equal(r.ok, false);
  assert.ok(/too deep/i.test(r.errors[0].message), r.errors[0].message);
});

test('validateFormula never throws when probing a malformed unused table', () => {
  const broken = JSON.parse(JSON.stringify(model));
  broken.tables = { ...(broken.tables || {}), stubTable: { kind: '1d' } }; // unused → assembles clean
  assert.equal(tryAssemble(broken).ok, true);
  let r;
  assert.doesNotThrow(() => { r = validateFormula(broken, { op: 'lookup', args: ['stubTable', F('engine')] }); });
  assert.equal(r.ok, false);
  assert.ok(typeof r.error.message === 'string' && r.error.message.length > 0);
});
