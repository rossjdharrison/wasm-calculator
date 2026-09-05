// A2.2: the visual rule-builder's AST<->rule transform must be behavior-
// preserving. Rewrite every condition in the model through ruleToAst(astToRule…)
// and assert the wasm engine yields identical results on the golden scenarios.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, loadEngine, mergeModel } from '../web/assembler.mjs';
import { astToRule, astToRuleTop, ruleToAst } from '../web/rule.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const model = mergeModel(await web('models/vehicles/data-model.json'), await web('models/vehicles/presentation-model.json'));
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));

// rewrite every condition slot through the rule builder's round-trip
const rw = (c) => (c === undefined ? undefined : ruleToAst(astToRuleTop(c)));
const rewritten = JSON.parse(JSON.stringify(model));
for (const f of rewritten.fields) {
  f.visibleWhen = rw(f.visibleWhen);
  f.enabledWhen = rw(f.enabledWhen);
  for (const o of f.options || []) o.availableWhen = rw(o.availableWhen);
  // drop keys that became undefined so JSON stays clean
  for (const k of ['visibleWhen', 'enabledWhen']) if (f[k] === undefined) delete f[k];
  for (const o of f.options || []) if (o.availableWhen === undefined) delete o.availableWhen;
}
for (const v of rewritten.validations || []) v.when = rw(v.when);
for (const e of rewritten.effects || []) e.when = rw(e.when);

const engOrig = await loadEngine(wasm, assemble(model));
const engRw = await loadEngine(wasm, assemble(rewritten));

const scenarios = [
  { model: 'city', trim: 'standard', engine: 'petrol15', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'cash' },
  { model: 'trail', trim: 'offRoad', engine: 'hybrid', drivetrain: 'fwd', wheels: 'w18', colour: 'metallic', packages: ['winter', 'tech', 'towing'], financing: 'finance', term: 't48', deposit: 5000 },
  { model: 'cruiser', trim: 'sport', engine: 'petrol20turbo', drivetrain: 'awd', wheels: 'w19', colour: 'matte', packages: ['tech', 'performance', 'driverAssist', 'premiumAudio'], financing: 'finance', term: 't36', deposit: 4429 },
  { model: 'cruiser', trim: 'luxury', engine: 'electric', drivetrain: 'awd', wheels: 'w20', colour: 'premium', packages: ['winter', 'tech', 'premiumAudio', 'panoramicRoof'], financing: 'lease', term: 't36', annualMileage: 15000 },
];

test('rule-builder round-trip preserves engine behavior on golden scenarios', () => {
  for (const inputs of scenarios) {
    assert.deepStrictEqual(engRw.evaluate(inputs), engOrig.evaluate(inputs),
      `mismatch for ${JSON.stringify(inputs)}`);
  }
});

test('astToRule -> ruleToAst is idempotent', () => {
  const conds = [];
  for (const f of model.fields) { for (const o of f.options || []) if (o.availableWhen) conds.push(o.availableWhen); }
  for (const v of model.validations) conds.push(v.when);
  for (const e of model.effects) conds.push(e.when);
  for (const c of conds) {
    const once = ruleToAst(astToRuleTop(c));
    const twice = ruleToAst(astToRuleTop(once));
    assert.deepStrictEqual(twice, once, `not idempotent: ${JSON.stringify(c)}`);
  }
});
