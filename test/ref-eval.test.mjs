// Stage 1 parity: the JS reference evaluator against the four golden vehicle
// configurations from docs/phase1-spec.md §7. This validates the model, the
// assembler's parsing, and the evaluation algorithm before the WASM VM exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIR, referenceEvaluate, mergeModel } from '../web/assembler.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const model = mergeModel(await web('data-model.json'), await web('presentation-model.json'));
const ir = buildIR(model);

const run = (inputs) => referenceEvaluate(ir, inputs);
const out = (r, id) => r.outputs.find((o) => o.id === id);
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

test('Ex1 — City/Standard, petrol1.5, FWD, 17", solid, no packages, Cash', () => {
  const r = run({
    model: 'city', trim: 'standard', engine: 'petrol15', drivetrain: 'fwd',
    wheels: 'w17', colour: 'solid', packages: [], financing: 'cash',
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 22000, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 23190, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.range, 500, 0.01), `range ${r.valueById.range}`);
  assert.equal(out(r, 'monthlyPayment').visible, false, 'monthly hidden for cash');
});

test('Ex2 — Trail/Off-road, Hybrid, (AWD forced), 18", metallic, {winter,tech,towing}, Finance t48 dep 5000', () => {
  const r = run({
    model: 'trail', trim: 'offRoad', engine: 'hybrid', drivetrain: 'fwd',
    wheels: 'w18', colour: 'metallic', packages: ['winter', 'tech', 'towing'],
    financing: 'finance', term: 't48', deposit: 5000,
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 43350, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 44500, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.monthlyPayment, 962.46, 0.02), `monthly ${r.valueById.monthlyPayment}`);
  assert.ok(near(r.valueById.range, 558.6, 0.01), `range ${r.valueById.range}`);
  // Off-road forces AWD (code 1) and locks the field
  assert.equal(r.valueById.drivetrain, 1, 'drivetrain forced to awd');
  assert.equal(r.enabled.drivetrain, false, 'drivetrain locked');
  assert.equal(r.optionState.packages.towing, true, 'towing available');
});

test('Ex3 — Cruiser/Sport, 2.0T, AWD, 19", matte, {tech,performance,driverAssist,premiumAudio}, Finance t36 dep 4429', () => {
  const r = run({
    model: 'cruiser', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'matte',
    packages: ['tech', 'performance', 'driverAssist', 'premiumAudio'],
    financing: 'finance', term: 't36', deposit: 4429,
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 43100, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 44290, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.monthlyPayment, 1247.25, 0.05), `monthly ${r.valueById.monthlyPayment}`);
  assert.ok(near(r.valueById.range, 389.88, 0.01), `range ${r.valueById.range}`);
  assert.equal(r.optionState.packages.performance, true, 'performance available');
  assert.equal(r.optionState.colour.matte, true, 'matte available on sport');
});

test('Ex4 — Cruiser/Luxury, Electric, AWD, 20", premium, {winter,tech,premiumAudio,panoramicRoof}, Lease t36 15k mi', () => {
  const r = run({
    model: 'cruiser', trim: 'luxury', engine: 'electric', drivetrain: 'awd',
    wheels: 'w20', colour: 'premium',
    packages: ['winter', 'tech', 'premiumAudio', 'panoramicRoof'],
    financing: 'lease', term: 't36', annualMileage: 15000,
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 46700, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 47700, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.monthlyPayment, 847.95, 0.05), `monthly ${r.valueById.monthlyPayment}`);
  assert.ok(near(r.valueById.range, 267.9, 0.01), `range ${r.valueById.range}`);
  assert.ok(r.messages.some((m) => m.id === 'big_wheels_info'), 'w20 info message');
  assert.equal(r.optionState.packages.panoramicRoof, true, 'panoramic available (no towing)');
});

test('Auto-deselect: removing Tech drops Driver-Assist & Premium Audio', () => {
  const r = run({
    model: 'city', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'solid',
    packages: ['tech', 'driverAssist', 'premiumAudio'], financing: 'cash',
  });
  // now the same but without tech — dependents must not be selectable/selected
  const r2 = run({
    model: 'city', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'solid',
    packages: ['driverAssist', 'premiumAudio'], financing: 'cash',
  });
  assert.equal(r.optionState.packages.driverAssist, true, 'driverAssist available with tech');
  assert.equal(r2.optionState.packages.driverAssist, false, 'driverAssist unavailable without tech');
  // engine cleared them: the packages mask must not contain driverAssist/premiumAudio bits
  const pkgField = ir.fields.find((f) => f.id === 'packages');
  const bit = (id) => 1 << pkgField.options.find((o) => o.id === id).code;
  assert.equal((r2.valueById.packages | 0) & bit('driverAssist'), 0, 'driverAssist auto-cleared');
  assert.equal((r2.valueById.packages | 0) & bit('premiumAudio'), 0, 'premiumAudio auto-cleared');
});

test('Towing / Panoramic mutual exclusion (each disables the other)', () => {
  const base = {
    model: 'trail', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'solid', financing: 'cash',
  };
  const withTowing = run({ ...base, packages: ['towing'] });
  const withPano = run({ ...base, packages: ['panoramicRoof'] });
  assert.equal(withTowing.optionState.packages.towing, true, 'towing valid alone');
  assert.equal(withTowing.optionState.packages.panoramicRoof, false, 'panoramic disabled when towing selected');
  assert.equal(withPano.optionState.packages.panoramicRoof, true, 'panoramic valid alone');
  assert.equal(withPano.optionState.packages.towing, false, 'towing disabled when panoramic selected');
});
