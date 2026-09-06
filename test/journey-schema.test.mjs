// D1: the structural shape gate for journey documents. Pure + deterministic;
// checks SHAPE only (analyzeJourney owns the semantic seam checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateJourneyShape } from '../web/journey-schema.mjs';
import { STEP_KINDS } from '../web/hqdm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p) => readFile(join(here, '..', 'web', p), 'utf8').then(JSON.parse);
const shipped = await load('journeys/vehicle-sale.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

test('the shipped vehicle-sale journey passes the shape gate with zero errors and zero warnings', () => {
  const r = validateJourneyShape(shipped);
  assert.deepEqual(r.errors, [], 'no shape errors');
  assert.deepEqual(r.warnings, [], 'no shape warnings');
});

test('STEP_KINDS is sourced from hqdm-core.json data, not a hardcode', () => {
  assert.ok(STEP_KINDS.includes('capture'));
  assert.ok(STEP_KINDS.includes('ceremony'));
  assert.ok(STEP_KINDS.includes('preview'));
  assert.ok(STEP_KINDS.includes('capture-downstream'));
});

test('missing required top-level fields each produce an error', () => {
  for (const k of ['id', 'version', 'title']) {
    const j = clone(shipped); delete j[k];
    assert.ok(validateJourneyShape(j).errors.some((e) => e.includes(`"${k}"`)), `missing ${k} errors`);
  }
  const noModels = clone(shipped); delete noModels.models;
  assert.ok(validateJourneyShape(noModels).errors.some((e) => e.includes('"models"')));
  const noProc = clone(shipped); delete noProc.process;
  assert.ok(validateJourneyShape(noProc).errors.some((e) => e.includes('"process"')));
});

test('a duplicate model alias and an unknown phase are errors', () => {
  const dup = clone(shipped); dup.models.push({ ref: 'x', as: dup.models[0].as, phase: 'configure' });
  assert.ok(validateJourneyShape(dup).errors.some((e) => e.includes('duplicate model alias')));
  const badPhase = clone(shipped); badPhase.models[0].phase = 'nonsense';
  assert.ok(validateJourneyShape(badPhase).errors.some((e) => e.includes('is not a known phase')));
});

test('binding referencing an undeclared alias, and a duplicate binding id, are errors', () => {
  const badFrom = clone(shipped); badFrom.bindings[0].from = 'ghost';
  assert.ok(validateJourneyShape(badFrom).errors.some((e) => e.includes('"from" alias "ghost"')));
  const dup = clone(shipped); dup.bindings.push(clone(dup.bindings[0]));
  assert.ok(validateJourneyShape(dup).errors.some((e) => e.includes('duplicate binding id')));
});

test('process step with an unknown kind, unknown phase, duplicate id, or bad model alias errors', () => {
  const badKind = clone(shipped); badKind.process.steps[0].kind = 'sign';
  const e1 = validateJourneyShape(badKind).errors;
  assert.ok(e1.some((e) => e.includes('is not a known step kind')), 'unknown kind mentions the known list');

  const badPhase = clone(shipped); badPhase.process.steps[0].phase = 'zzz';
  assert.ok(validateJourneyShape(badPhase).errors.some((e) => e.includes('is not a known phase')));

  const dup = clone(shipped); dup.process.steps.push(clone(dup.process.steps[0]));
  assert.ok(validateJourneyShape(dup).errors.some((e) => e.includes('duplicate step id')));

  const badModel = clone(shipped); badModel.process.steps[0].model = 'ghost';
  assert.ok(validateJourneyShape(badModel).errors.some((e) => e.includes('is not a declared model alias')));
});

test('a non-category produces/activity/outcome is a WARNING, not an error (domain-type tolerance)', () => {
  const j = clone(shipped);
  const step = j.process.steps.find((s) => s.activity) || j.process.steps[0];
  step.activity = 'MyDomainActivity';
  const r = validateJourneyShape(j);
  assert.ok(r.warnings.some((w) => w.includes('MyDomainActivity')), 'warns');
  assert.ok(!r.errors.some((e) => e.includes('MyDomainActivity')), 'does not error');
});

test('a binding with condition:null is accepted (matches the trigger-guard null tolerance)', () => {
  const j = clone(shipped); j.bindings[0].condition = null;
  assert.ok(!validateJourneyShape(j).errors.some((e) => e.includes('condition')), 'condition:null is not an error');
});

test('the kind list is injected data, not a closed hardcode (D4-forward extensibility)', () => {
  const j = clone(shipped); j.process.steps[0].kind = 'transfer';
  assert.ok(validateJourneyShape(j).errors.some((e) => e.includes('not a known step kind')), 'rejected with shipped list');
  assert.deepEqual(validateJourneyShape(j, { kinds: [...STEP_KINDS, 'transfer'] }).errors, [], 'accepted when the kind is added to the vocabulary');
});
