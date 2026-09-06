// D3: behavioural triggers are validated by a real authority (validateTrigger),
// delegating the guard to the assembler via validateFormula so it cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { validateTrigger, analyzeJourney } from '../web/journey-validate.mjs';
import * as jedit from '../web/journey-edit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => readFile(join(here, '..', p), 'utf8').then(JSON.parse);
const loadModel = async (id) => { const merged = mergeModel(await readJson(`web/models/${id}/data-model.json`), await readJson(`web/models/${id}/presentation-model.json`)); return { merged, assembled: assemble(merged) }; };

const models = { shopping: await loadModel('vehicles'), financing: await loadModel('financing') };
const base = await readJson('web/journeys/vehicle-sale.json');
const guard = { op: 'gt', args: [{ op: 'field', args: ['grandTotal'] }, 50000] };

test('a well-formed trigger with a guard over the on-model scope is valid', () => {
  const j = jedit.setTrigger(base, { id: 't1', on: 'shopping', activates: 'financing', guard });
  const r = validateTrigger(j, j.triggers.find((t) => t.id === 't1'), models);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('a trigger with no guard is valid (fires unconditionally)', () => {
  const j = jedit.setTrigger(base, { id: 't1', on: 'shopping', activates: 'financing' });
  assert.equal(validateTrigger(j, j.triggers.find((t) => t.id === 't1'), models).ok, true);
});

test('unknown on/activates aliases are errors', () => {
  const j = jedit.setTrigger(base, { id: 't1', on: 'ghost', activates: 'phantom' });
  const r = validateTrigger(j, j.triggers.find((t) => t.id === 't1'), models);
  assert.ok(r.errors.some((e) => e.includes('on-model alias "ghost"')));
  assert.ok(r.errors.some((e) => e.includes('activates-model alias "phantom"')));
});

test('a guard that does not assemble against the on-model is an error (delegated to the assembler)', () => {
  const bad = { op: 'gt', args: [{ op: 'field', args: ['noSuchField'] }, 1] };
  const j = jedit.setTrigger(base, { id: 't1', on: 'shopping', activates: 'financing', guard: bad });
  const r = validateTrigger(j, j.triggers.find((t) => t.id === 't1'), models);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('guard does not assemble'));
});

test('analyzeJourney reports a bad-guard trigger as an error and a guardless one as info', () => {
  const bad = { op: 'gt', args: [{ op: 'field', args: ['noSuchField'] }, 1] };
  let j = jedit.setTrigger(base, { id: 'tbad', on: 'shopping', activates: 'financing', guard: bad });
  j = jedit.setTrigger(j, { id: 'tinfo', on: 'shopping', activates: 'financing' });
  const a = analyzeJourney(j, models);
  assert.ok(a.findings.some((f) => f.kind === 'trigger' && f.severity === 'error' && f.message.includes('tbad')));
  assert.ok(a.findings.some((f) => f.kind === 'unguarded-trigger' && f.severity === 'info' && f.message.includes('tinfo')));
});
