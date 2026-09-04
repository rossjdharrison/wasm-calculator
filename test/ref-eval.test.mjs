// Stage 1 parity: the JS reference evaluator against golden vehicle configs from
// the 8-archetype lineup. Validates the model, the assembler's parsing, and the
// evaluation algorithm. (Values regenerated when the model was rebuilt.)

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

test('Ex1 — Hot Hatchback/Standard, electric, FWD, 17", solid, no packages, Cash', () => {
  const r = run({
    model: 'hotHatch', trim: 'standard', engine: 'electric', drivetrain: 'fwd',
    wheels: 'w17', colour: 'solid', packages: [], financing: 'cash',
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 42000, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 43000, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.range, 300, 0.01), `range ${r.valueById.range}`);
  assert.equal(out(r, 'monthlyPayment').visible, false, 'monthly hidden for cash');
});

test('Ex2 — Rugged Off-roader/Off-road, Hybrid, (AWD forced+locked), 18", metallic, {winter,tech,towing}, Finance t48 dep 9000', () => {
  const r = run({
    model: 'ruggedOffroader', trim: 'offRoad', engine: 'hybrid', drivetrain: 'fwd',
    wheels: 'w18', colour: 'metallic', packages: ['winter', 'tech', 'towing'],
    financing: 'finance', term: 't48', deposit: 9000,
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 87850, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 89000, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.monthlyPayment, 1949.28, 0.05), `monthly ${r.valueById.monthlyPayment}`);
  assert.ok(near(r.valueById.range, 558.6, 0.01), `range ${r.valueById.range}`);
  assert.equal(r.valueById.drivetrain, 1, 'drivetrain forced to awd');
  assert.equal(r.enabled.drivetrain, false, 'drivetrain locked on off-road');
  assert.equal(r.optionState.packages.towing, true, 'towing available');
});

test('Ex3 — GT Coupe/Sport, V8, AWD, 19", matte, {tech,performance,driverAssist,premiumAudio}, Finance t36 dep 12000', () => {
  const r = run({
    model: 'gtCoupe', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'matte',
    packages: ['tech', 'performance', 'driverAssist', 'premiumAudio'],
    financing: 'finance', term: 't36', deposit: 12000,
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 97600, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 98790, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.monthlyPayment, 2715.68, 0.05), `monthly ${r.valueById.monthlyPayment}`);
  assert.ok(near(r.valueById.range, 389.88, 0.01), `range ${r.valueById.range}`);
  assert.equal(r.optionState.packages.performance, true, 'performance available');
  assert.equal(r.optionState.colour.matte, true, 'matte available on sport');
});

test('Ex4 — Hyper-car/Luxury, electric, AWD, 20", premium, {winter,tech,premiumAudio,panoramicRoof}, Lease t36 15k mi', () => {
  const r = run({
    model: 'hypercar', trim: 'luxury', engine: 'electric', drivetrain: 'awd',
    wheels: 'w20', colour: 'premium',
    packages: ['winter', 'tech', 'premiumAudio', 'panoramicRoof'],
    financing: 'lease', term: 't36', annualMileage: 15000,
  });
  assert.equal(r.status, 0, `status ${r.status}`);
  assert.ok(near(r.valueById.vehiclePrice, 1869700, 0.01), `vehiclePrice ${r.valueById.vehiclePrice}`);
  assert.ok(near(r.valueById.otr, 1870700, 0.01), `otr ${r.valueById.otr}`);
  assert.ok(near(r.valueById.monthlyPayment, 32936.55, 0.1), `monthly ${r.valueById.monthlyPayment}`);
  assert.ok(near(r.valueById.range, 267.9, 0.01), `range ${r.valueById.range}`);
  assert.ok(r.messages.some((m) => m.id === 'big_wheels_info'), 'w20 info message');
  assert.equal(r.optionState.packages.panoramicRoof, true, 'panoramic available (no towing)');
});

test('Auto-deselect: removing Tech drops Driver-Assist & Premium Audio', () => {
  const base = {
    model: 'gtCoupe', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'solid', financing: 'cash',
  };
  const r = run({ ...base, packages: ['tech', 'driverAssist', 'premiumAudio'] });
  const r2 = run({ ...base, packages: ['driverAssist', 'premiumAudio'] });
  assert.equal(r.optionState.packages.driverAssist, true, 'driverAssist available with tech');
  assert.equal(r2.optionState.packages.driverAssist, false, 'driverAssist unavailable without tech');
  const pkgField = ir.fields.find((f) => f.id === 'packages');
  const bit = (id) => 1 << pkgField.options.find((o) => o.id === id).code;
  assert.equal((r2.valueById.packages | 0) & bit('driverAssist'), 0, 'driverAssist auto-cleared');
  assert.equal((r2.valueById.packages | 0) & bit('premiumAudio'), 0, 'premiumAudio auto-cleared');
});

test('Towing / Panoramic mutual exclusion (each disables the other)', () => {
  const base = {
    model: 'flagshipSuv', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd',
    wheels: 'w19', colour: 'solid', financing: 'cash',
  };
  const withTowing = run({ ...base, packages: ['towing'] });
  const withPano = run({ ...base, packages: ['panoramicRoof'] });
  assert.equal(withTowing.optionState.packages.towing, true, 'towing valid alone');
  assert.equal(withTowing.optionState.packages.panoramicRoof, false, 'panoramic disabled when towing selected');
  assert.equal(withPano.optionState.packages.panoramicRoof, true, 'panoramic valid alone');
  assert.equal(withPano.optionState.packages.towing, false, 'towing disabled when panoramic selected');
});
