// Stage 2 parity: the AssemblyScript WASM VM must match the JS reference
// evaluator exactly, for the named golden scenarios AND many random configs.
// (pretest builds build/quote.wasm first.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, referenceEvaluate, loadEngine, mergeModel } from '../web/assembler.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const model = mergeModel(await web('models/vehicles/data-model.json'), await web('models/vehicles/presentation-model.json'));
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));

const assembled = assemble(model);
const ir = assembled.ir;
const engine = await loadEngine(wasm, assembled);

const near = (a, b, eps = 1e-6) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps + Math.abs(b) * 1e-9;
};

function compare(label, inputs) {
  const R = referenceEvaluate(ir, inputs);
  const W = engine.evaluate(inputs);
  const diffs = [];

  if (R.status !== W.status) diffs.push(`status ref=${R.status} wasm=${W.status}`);

  for (const [id] of ir.slotOf) {
    if (!near(R.valueById[id], W.valueById[id])) diffs.push(`value ${id}: ref=${R.valueById[id]} wasm=${W.valueById[id]}`);
  }
  R.outputs.forEach((o, i) => {
    const w = W.outputs[i];
    if (!near(o.value, w.value)) diffs.push(`output ${o.id}: ref=${o.value} wasm=${w.value}`);
    if (o.visible !== w.visible) diffs.push(`output ${o.id} visible: ref=${o.visible} wasm=${w.visible}`);
  });
  for (const f of ir.fields) {
    if (R.visible[f.id] !== W.visible[f.id]) diffs.push(`visible ${f.id}: ref=${R.visible[f.id]} wasm=${W.visible[f.id]}`);
    if (R.enabled[f.id] !== W.enabled[f.id]) diffs.push(`enabled ${f.id}: ref=${R.enabled[f.id]} wasm=${W.enabled[f.id]}`);
    for (const k of ['min', 'max', 'step']) {
      if (!near(R.limits[f.id][k], W.limits[f.id][k])) diffs.push(`limit ${f.id}.${k}: ref=${R.limits[f.id][k]} wasm=${W.limits[f.id][k]}`);
    }
    if (R.optionState[f.id]) {
      for (const oid of Object.keys(R.optionState[f.id])) {
        if (R.optionState[f.id][oid] !== W.optionState[f.id][oid]) diffs.push(`option ${f.id}.${oid}: ref=${R.optionState[f.id][oid]} wasm=${W.optionState[f.id][oid]}`);
      }
    }
  }
  const key = (m) => `${m.id}|${m.severity}|${m.targetSlot}`;
  const rm = R.messages.map(key).sort().join(',');
  const wm = W.messages.map(key).sort().join(',');
  if (rm !== wm) diffs.push(`messages: ref=[${rm}] wasm=[${wm}]`);

  assert.equal(diffs.length, 0, `${label} mismatch:\n  ${diffs.join('\n  ')}`);
}

// ---- named golden scenarios (same as ref-eval) ----
const scenarios = {
  Ex1: { model: 'hotHatch', trim: 'standard', engine: 'electric', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'cash' },
  Ex2: { model: 'ruggedOffroader', trim: 'offRoad', engine: 'hybrid', drivetrain: 'fwd', wheels: 'w18', colour: 'metallic', packages: ['winter', 'tech', 'towing'], financing: 'finance', term: 't48', deposit: 9000 },
  Ex3: { model: 'gtCoupe', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd', wheels: 'w19', colour: 'matte', packages: ['tech', 'performance', 'driverAssist', 'premiumAudio'], financing: 'finance', term: 't36', deposit: 12000 },
  Ex4: { model: 'hypercar', trim: 'luxury', engine: 'electric', drivetrain: 'awd', wheels: 'w20', colour: 'premium', packages: ['winter', 'tech', 'premiumAudio', 'panoramicRoof'], financing: 'lease', term: 't36', annualMileage: 15000 },
};
for (const [name, inputs] of Object.entries(scenarios)) {
  test(`parity — ${name}`, () => compare(name, inputs));
}

// ---- deterministic fuzz: random (often invalid) configs must settle identically ----
test('parity — 500 random configs', () => {
  // seeded LCG for reproducibility (Math.random avoided for determinism)
  let seed = 0x2545f491;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const opts = (id) => ir.fields.find((f) => f.id === id).options.map((o) => o.id);
  const pkgOpts = opts('packages');

  for (let n = 0; n < 500; n++) {
    const packages = pkgOpts.filter(() => rnd() < 0.5);
    const inputs = {
      model: pick(opts('model')), trim: pick(opts('trim')), engine: pick(opts('engine')),
      drivetrain: pick(opts('drivetrain')), wheels: pick(opts('wheels')), colour: pick(opts('colour')),
      packages, financing: pick(opts('financing')), term: pick(opts('term')),
      deposit: Math.floor(rnd() * 60000), annualMileage: 5000 + Math.floor(rnd() * 25000),
    };
    compare(`fuzz#${n} ${JSON.stringify(inputs)}`, inputs);
  }
});
