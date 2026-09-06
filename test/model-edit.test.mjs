// model-edit mutations must be PURE and must produce models that (a) still
// assemble, (b) evaluate identically in the WASM VM and the JS oracle, and
// (c) carry the expected new/removed dependency edges from engine.graph(1).
// This is the guard that lets the Loom commit an edit as a genuine model change.
// (pretest builds build/quote.wasm.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, referenceEvaluate, loadEngine, mergeModel, splitModel } from '../web/assembler.mjs';
import { tryAssemble } from '../web/model-validate.mjs';
import * as edit from '../web/model-edit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const data = await web('models/vehicles/data-model.json');
const pres = await web('models/vehicles/presentation-model.json');
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));
const model = mergeModel(data, pres);
const clone = (x) => JSON.parse(JSON.stringify(x));

const F = (id) => ({ op: 'field', args: [id] });
const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-9);

const SAMPLE = {
  Ex1: { model: 'hotHatch', trim: 'standard', engine: 'electric', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'cash' },
  Ex3: { model: 'gtCoupe', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd', wheels: 'w19', colour: 'matte', packages: ['tech', 'performance', 'driverAssist', 'premiumAudio'], financing: 'finance', term: 't36', deposit: 12000 },
  Ex4: { model: 'hypercar', trim: 'luxury', engine: 'electric', drivetrain: 'awd', wheels: 'w20', colour: 'premium', packages: ['winter', 'tech', 'premiumAudio', 'panoramicRoof'], financing: 'lease', term: 't36', annualMileage: 15000 },
};

// build a wasm engine + oracle from a merged model, and a parity comparator
async function engineFor(merged) {
  const asm = assemble(merged);
  const engine = await loadEngine(wasm, asm);
  const compare = (label) => {
    for (const [name, inputs] of Object.entries(SAMPLE)) {
      const R = referenceEvaluate(asm.ir, inputs);
      const W = engine.evaluate(inputs);
      const diffs = [];
      if (R.status !== W.status) diffs.push(`status ${R.status}!=${W.status}`);
      for (const [id] of asm.ir.slotOf) if (!near(R.valueById[id], W.valueById[id])) diffs.push(`${id}: ${R.valueById[id]}!=${W.valueById[id]}`);
      assert.equal(diffs.length, 0, `${label}/${name} oracle!=wasm:\n  ${diffs.join('\n  ')}`);
    }
  };
  return { asm, engine, compare, edges: engine.graph(1) };
}

const base = await engineFor(model);

// ---- purity ----------------------------------------------------------------
test('every mutation is pure (input {data,pres} untouched)', () => {
  const snap = clone({ data, pres });
  edit.addComputed({ data, pres }, { id: 'markup', formula: { op: 'mul', args: [F('vehiclePrice'), 1.1] } });
  edit.setFieldPredicate({ data, pres }, 'wheels', 'visibleWhen', { op: 'not', args: [{ op: 'eq', args: [F('trim'), 'offRoad'] }] });
  edit.renameId({ data, pres }, 'vehiclePrice', 'basePrice');
  edit.deleteComputed({ data, pres }, 'range');
  assert.deepEqual({ data, pres }, snap);
});

// ---- addComputed: parity holds AND the new edge appears --------------------
test('addComputed keeps oracle==wasm and adds its dependency edge', async () => {
  const next = edit.addComputed({ data, pres }, { id: 'markup', formula: { op: 'mul', args: [F('vehiclePrice'), 1.1] } });
  const { compare, edges, engine } = await engineFor(mergeModel(next.data, next.pres));
  compare('addComputed');
  assert.ok(edges.some((e) => e.from === 'vehiclePrice' && e.to === 'markup'), 'markup should depend on vehiclePrice');
  // and its value is what the formula says
  for (const [, inputs] of Object.entries(SAMPLE)) {
    const v = engine.evaluate(inputs);
    assert.ok(near(v.valueById.markup, v.valueById.vehiclePrice * 1.1));
  }
});

// ---- setComputedFormula: value + edge set change --------------------------
test('setComputedFormula retargets value and edges', async () => {
  let next = edit.addComputed({ data, pres }, { id: 'markup', formula: { op: 'mul', args: [F('vehiclePrice'), 1.1] } });
  next = edit.setComputedFormula(next, 'markup', { op: 'add', args: [F('otr'), 500] });
  const { compare, edges } = await engineFor(mergeModel(next.data, next.pres));
  compare('setComputedFormula');
  assert.ok(edges.some((e) => e.from === 'otr' && e.to === 'markup'), 'markup now depends on otr');
  assert.ok(!edges.some((e) => e.from === 'vehiclePrice' && e.to === 'markup'), 'markup no longer depends on vehiclePrice');
});

// ---- predicate edits: parity + correct file ownership ---------------------
test('setFieldPredicate lands in presentation and keeps parity', async () => {
  const ast = { op: 'not', args: [{ op: 'eq', args: [F('trim'), 'offRoad'] }] };
  const next = edit.setFieldPredicate({ data, pres }, 'wheels', 'visibleWhen', ast);
  assert.deepEqual((next.pres.fields.find((f) => f.id === 'wheels') || {}).visibleWhen, ast);
  assert.ok(!('visibleWhen' in (next.data.fields.find((f) => f.id === 'wheels') || {})), 'must not write visibleWhen to data');
  const { compare } = await engineFor(mergeModel(next.data, next.pres));
  compare('setFieldPredicate');
});

test('setOptionPredicate lands in data and keeps parity', async () => {
  const ast = { op: 'eq', args: [F('trim'), 'sport'] };
  const next = edit.setOptionPredicate({ data, pres }, 'wheels', 'w20', ast);
  assert.deepEqual(next.data.fields.find((f) => f.id === 'wheels').options.find((o) => o.id === 'w20').availableWhen, ast);
  const { compare } = await engineFor(mergeModel(next.data, next.pres));
  compare('setOptionPredicate');
});

// ---- renameId: refs fully rewritten, values preserved ---------------------
test('renameId rewrites all refs, assembles, and preserves values', async () => {
  const next = edit.renameId({ data, pres }, 'vehiclePrice', 'basePrice');
  const merged = mergeModel(next.data, next.pres);
  const r = tryAssemble(merged);
  assert.equal(r.ok, true, r.ok ? '' : r.errors[0]?.message);
  assert.ok(!r.assembled.ir.slotOf.has('vehiclePrice') && r.assembled.ir.slotOf.has('basePrice'));
  const { engine, compare } = await engineFor(merged);
  compare('renameId');
  // grandTotal (unchanged name) must equal the original model's for the same inputs
  for (const [, inputs] of Object.entries(SAMPLE)) {
    assert.ok(near(engine.evaluate(inputs).valueById.grandTotal, base.engine.evaluate(inputs).valueById.grandTotal), 'grandTotal preserved through rename');
  }
});

// ---- delete leaves dangling refs for tryAssemble to catch (non-throwing) ---
test('deleteComputed of a still-referenced value surfaces a dangling-ref error', () => {
  const next = edit.deleteComputed({ data, pres }, 'vehiclePrice'); // otr references it
  const r = tryAssemble(mergeModel(next.data, next.pres));
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].message.toLowerCase().includes('unknown'), r.errors[0].message);
});

test('referencesTo reports the dependents (pure, no wasm)', () => {
  const refs = edit.referencesTo({ data, pres }, 'vehiclePrice').map((r) => r.owner);
  assert.ok(refs.includes('otr'), 'otr references vehiclePrice');
});

// ---- two-file round-trip: no key dropped by wrong-file ownership -----------
test('edits survive a split/merge round-trip', () => {
  const presEdit = edit.setFieldPredicate({ data, pres }, 'wheels', 'visibleWhen', { op: 'not', args: [{ op: 'eq', args: [F('trim'), 'offRoad'] }] });
  const dataEdit = edit.addComputed({ data, pres }, { id: 'markup', formula: { op: 'mul', args: [F('otr'), 1.05] } });
  for (const p of [presEdit, dataEdit]) {
    const m1 = mergeModel(p.data, p.pres);
    const sp = splitModel(m1);
    const m2 = mergeModel(sp.data, sp.presentation);
    assert.deepEqual(m2, m1);
  }
});
