// Phase 2: the seam authority. analyzeJourney must accept a legal journey and flag
// dangling refs, double-authority (two writers of one fact), l0 mismatches and a
// target that isn't a plain input — the author-time errors the macro Loom surfaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { analyzeJourney, tryComposeJourney } from '../web/journey-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => readFile(join(here, '..', p), 'utf8').then(JSON.parse);
const loadModel = async (id) => { const merged = mergeModel(await readJson(`web/models/${id}/data-model.json`), await readJson(`web/models/${id}/presentation-model.json`)); return { merged, assembled: assemble(merged) }; };

const baseJourney = await readJson('web/journeys/vehicle-sale.json');
const models = { shopping: await loadModel('vehicles'), financing: await loadModel('financing') };
const clone = (x) => JSON.parse(JSON.stringify(x));
const kinds = (j) => analyzeJourney(j, models).findings.map((f) => f.kind);

test('the shipped journey composes with zero errors', () => {
  const r = tryComposeJourney(baseJourney, models);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.equal(r.counts.error, 0);
});

test('a dangling provide source is a seam error', () => {
  const j = clone(baseJourney);
  j.bindings[0].contract.provides[0].source = 'output:doesNotExist';
  assert.equal(analyzeJourney(j, models).counts.error > 0, true);
  assert.ok(analyzeJourney(j, models).findings.some((f) => /not found/.test(f.message)));
});

test('a target that is not a plain input is rejected', () => {
  const j = clone(baseJourney);
  j.bindings[0].contract.requires[0].target = 'field:monthly'; // monthly is a computed
  j.bindings[0].mapping[0].to = 'monthly';
  assert.ok(analyzeJourney(j, models).findings.some((f) => /not an input|computed/.test(f.message)));
});

test('double-authority: two bindings writing the same target', () => {
  const j = clone(baseJourney);
  j.bindings.push({ id: 'rival', from: 'shopping', to: 'financing',
    contract: { provides: [{ as: 'grandTotal', l0: 'amount_of_money', source: 'output:grandTotal' }], requires: [{ name: 'price', l0: 'amount_of_money', target: 'field:price' }] },
    mapping: [{ to: 'price', from: { op: 'field', args: ['grandTotal'] } }] });
  assert.ok(analyzeJourney(j, models).findings.some((f) => /double-authority/.test(f.message)));
});

test('an l0 mismatch is flagged', () => {
  const j = clone(baseJourney);
  j.bindings[0].contract.requires[0].l0 = 'party'; // provided is amount_of_money, not a party
  assert.ok(analyzeJourney(j, models).findings.some((f) => /l0-mismatch/.test(f.message)));
});

test('a cross-model cycle is an error finding', () => {
  const j = clone(baseJourney);
  j.bindings.push({ id: 'back', from: 'financing', to: 'shopping',
    contract: { provides: [{ as: 'monthly', l0: 'amount_of_money', source: 'output:monthly' }], requires: [{ name: 'deposit', l0: 'amount_of_money', target: 'field:deposit' }] },
    mapping: [{ to: 'deposit', from: { op: 'field', args: ['monthly'] } }] });
  assert.ok(analyzeJourney(j, models).findings.some((f) => f.kind === 'cross-model-cycle'));
});
