// Refine the vehicles model for realism: engine / trim / drivetrain now drive the
// performance specs (hp, top speed, 0-60) and a new weight spec, via factor tables
// + computeds (kept as model expressions — no bespoke JS). Re-runnable; regenerates
// the migration fixture and prints sample specs. Also sets carryOverOnPrimaryChange.
import { readFileSync, writeFileSync } from 'node:fs';
import { mergeModel, buildIR, referenceEvaluate } from '../web/assembler.mjs';

const D = 'web/models/vehicles/data-model.json';
const P = 'web/models/vehicles/presentation-model.json';
const FIX = 'test/fixtures/vehicle-combined.json';
const data = JSON.parse(readFileSync(D, 'utf8'));
const pres = JSON.parse(readFileSync(P, 'utf8'));

const field = (f) => ({ op: 'field', args: [f] });
const L1 = (t, f) => ({ op: 'lookup', args: [t, field(f)] });
const mul = (...a) => ({ op: 'mul', args: a });
const add = (...a) => ({ op: 'add', args: a });

// ---- factor tables (realistic multipliers / deltas) ----
Object.assign(data.tables, {
  specWeight: { kind: '1d', map: { hotHatch: 1450, sleekEstate: 1750, gtCoupe: 1720, ruggedOffroader: 2250, luxuryPickup: 2600, flagshipSuv: 2450, midSupercar: 1550, hypercar: 1400 } },
  engineHpFactor: { kind: '1d', map: { petrol15: 0.88, petrol20turbo: 1.0, hybrid: 1.10, electric: 1.22 } },
  trimHpFactor: { kind: '1d', map: { standard: 1.0, sport: 1.06, luxury: 1.0, offRoad: 0.97 } },
  engineWeightDelta: { kind: '1d', map: { petrol15: -60, petrol20turbo: 0, hybrid: 190, electric: 340 } },
  drivetrainWeightDelta: { kind: '1d', map: { fwd: 0, awd: 75 } },
  trimWeightDelta: { kind: '1d', map: { standard: 0, sport: 10, luxury: 55, offRoad: 90 } },
  engineTopFactor: { kind: '1d', map: { petrol15: 0.90, petrol20turbo: 1.0, hybrid: 0.98, electric: 0.93 } },
  engineAccelFactor: { kind: '1d', map: { petrol15: 1.08, petrol20turbo: 1.0, hybrid: 0.96, electric: 0.88 } },
  drivetrainAccelFactor: { kind: '1d', map: { fwd: 1.0, awd: 0.93 } },
  trimAccelFactor: { kind: '1d', map: { standard: 1.0, sport: 0.96, luxury: 1.0, offRoad: 1.05 } },
});

// ---- computeds: specs now vary with engine/trim/drivetrain (rounded for display) ----
const setComputed = (id, formula, extra = {}) => {
  const c = data.computed.find((x) => x.id === id);
  if (c) c.formula = formula; else data.computed.push({ id, formula, ...extra });
};
setComputed('hp', mul(L1('specHp', 'model'), L1('engineHpFactor', 'engine'), L1('trimHpFactor', 'trim')));
setComputed('topSpeed', mul(L1('specTopSpeed', 'model'), L1('engineTopFactor', 'engine')));
setComputed('zeroToSixty', mul(L1('specZeroTo60', 'model'), L1('engineAccelFactor', 'engine'), L1('drivetrainAccelFactor', 'drivetrain'), L1('trimAccelFactor', 'trim')));
setComputed('weight', add(L1('specWeight', 'model'), L1('engineWeightDelta', 'engine'), L1('drivetrainWeightDelta', 'drivetrain'), L1('trimWeightDelta', 'trim')), { label: 'Weight' });

// ---- presentation: add the weight output; order the spec tiles nicely ----
const outById = Object.fromEntries(pres.outputs.map((o) => [o.id, o]));
if (!outById.weight) pres.outputs.push({ id: 'weight', label: 'Weight', format: { type: 'unit', unit: 'kg', decimals: 0 }, spec: true, compare: 'low' });
// reorder: money outputs first, then the spec tiles Power/Top speed/0-60/Weight/Range
const order = ['vehiclePrice', 'otr', 'monthlyPayment', 'hp', 'topSpeed', 'zeroToSixty', 'weight', 'range'];
pres.outputs.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));

// ---- carry-over policy (comparison-friendly for cars) ----
pres.carryOverOnPrimaryChange = true;

writeFileSync(D, JSON.stringify(data, null, 2) + '\n');
writeFileSync(P, JSON.stringify(pres, null, 2) + '\n');
const merged = mergeModel(data, pres);
writeFileSync(FIX, JSON.stringify(merged, null, 2) + '\n');

// ---- sanity: sample specs across engines/trims ----
const ir = buildIR(merged);
const spec = (inp) => { const r = referenceEvaluate(ir, inp); return { hp: Math.round(r.valueById.hp), top: Math.round(r.valueById.topSpeed), zero: r.valueById.zeroToSixty.toFixed(1), kg: Math.round(r.valueById.weight) }; };
const base = { model: 'gtCoupe', trim: 'standard', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'cash' };
console.log('gtCoupe V8   :', JSON.stringify(spec({ ...base, engine: 'petrol20turbo' })));
console.log('gtCoupe hybrid:', JSON.stringify(spec({ ...base, engine: 'hybrid' })));
console.log('gtCoupe elec+sport+awd:', JSON.stringify(spec({ ...base, engine: 'electric', trim: 'sport', drivetrain: 'awd' })));
console.log('hypercar elec:', JSON.stringify(spec({ ...base, model: 'hypercar', engine: 'electric', drivetrain: 'awd' })));
console.log('hotHatch turbo4:', JSON.stringify(spec({ ...base, model: 'hotHatch', engine: 'petrol15' })));
console.log('✓ vehicles specs refined');
