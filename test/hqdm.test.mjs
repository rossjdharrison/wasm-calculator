// The L0 vocabulary is data (web/hqdm-core.json); hqdm.mjs only traverses it.
// These pin the specialization inference — the mechanism by which a domain type
// resolves to its neutral HQDM category by climbing the lattice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supertypesOf, isA, leafCategoryOf, renderOf, NEUTRAL_CATEGORIES, phasesOf, STEP_KINDS, authorCategories, authorCategoryChoices } from '../web/hqdm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => readFile(join(here, '..', 'web', p), 'utf8').then(JSON.parse);

test('the neutral core loads and exposes leaves; phases are NOT in the core (they are domain data)', async () => {
  assert.ok(NEUTRAL_CATEGORIES.includes('amount_of_money'));
  const core = await readJson('hqdm-core.json');
  assert.equal('phases' in core, false, 'the neutral upper lattice holds no domain lifecycle');
  // phases come from a domain/journey doc, read via phasesOf, order-sorted.
  const domain = await readJson('domain.json');
  const ph = phasesOf(domain);
  assert.equal(ph.length, 4);
  assert.deepEqual(ph.map((p) => p.order), [1, 2, 3, 4], 'order-sorted');
  assert.deepEqual(phasesOf({}), [], 'no phases → empty, never throws');
});

test('the transfer L0 categories resolve to their own render leaf (D4 outcomes)', () => {
  assert.equal(leafCategoryOf('transfer_of_ownership'), 'transfer_of_ownership');
  assert.equal(leafCategoryOf('transfer_of_possession'), 'transfer_of_possession');
  assert.equal(isA('transfer_of_ownership', 'activity'), true);
});

test('core specialization climbs to the root', () => {
  const up = supertypesOf('amount_of_money');
  assert.deepEqual(up, ['physical_quantity', 'abstract_object', 'thing']);
  assert.equal(isA('amount_of_money', 'physical_quantity'), true);
  assert.equal(isA('amount_of_money', 'thing'), true);
  assert.equal(isA('amount_of_money', 'activity'), false);
  assert.equal(leafCategoryOf('amount_of_money'), 'amount_of_money');
});

test('a domain type is inferred to its neutral category via `specializes`', () => {
  const extra = {
    PurchasePrice: { specializes: ['amount_of_money'] },
    Vehicle: { specializes: ['ordinary_physical_object'] },
  };
  assert.equal(isA('PurchasePrice', 'amount_of_money', extra), true);
  assert.equal(isA('PurchasePrice', 'physical_quantity', extra), true); // transitive
  assert.equal(leafCategoryOf('PurchasePrice', extra), 'amount_of_money');
  assert.equal(isA('Vehicle', 'physical_object', extra), true);
  assert.equal(leafCategoryOf('Vehicle', extra), 'ordinary_physical_object');
  assert.equal(renderOf('PurchasePrice', extra).render, 'money');
});

test('a multi-level domain chain still resolves', () => {
  const extra = { A: { specializes: ['B'] }, B: { specializes: ['amount_of_money'] } };
  assert.equal(isA('A', 'amount_of_money', extra), true);
  assert.equal(leafCategoryOf('A', extra), 'amount_of_money');
});

test('an unknown type resolves to null, never throws', () => {
  assert.equal(leafCategoryOf('Nonexistent'), null);
  assert.equal(renderOf('Nonexistent'), null);
  assert.deepEqual(supertypesOf('Nonexistent'), []);
  assert.equal(isA('Nonexistent', 'thing'), false);
});

test('STEP_KINDS is the neutral step-kind vocabulary from the data core', () => {
  assert.ok(STEP_KINDS.includes('capture'));
  assert.ok(STEP_KINDS.includes('ceremony'));
  assert.ok(STEP_KINDS.includes('preview'));
});

test('authorCategories = neutral leaves ∪ a model’s own types, deduped & deterministic', () => {
  const base = authorCategories();
  assert.deepEqual(base, NEUTRAL_CATEGORIES, 'no types → just the neutral leaves');
  assert.deepEqual(authorCategories({}), NEUTRAL_CATEGORIES, 'empty types → just the neutral leaves');
  const withTypes = authorCategories({ VehicleClass: { specializes: ['class_of_physical_object'] }, PurchasePrice: { specializes: ['amount_of_money'] } });
  assert.ok(withTypes.includes('VehicleClass') && withTypes.includes('PurchasePrice'), 'unions in domain types');
  assert.ok(withTypes.includes('amount_of_money'), 'keeps the neutral leaves');
  assert.equal(new Set(withTypes).size, withTypes.length, 'de-duped');
  assert.deepEqual(authorCategories({ X: {} }), authorCategories({ X: {} }), 'deterministic');
});

test('authorCategoryChoices surfaces the authorable render-hint leaves, ranked, with plain-language labels', () => {
  const choices = authorCategoryChoices();
  assert.ok(choices.length >= 5, 'several authorable categories');
  assert.equal(choices[0].id, 'class_of_physical_object', 'a physical thing ranks first (authorable: 1)');
  for (const c of choices) {
    assert.ok(c.id && c.glyph && c.label, 'each choice carries id + glyph + label');
    assert.ok('hint' in c, 'each choice carries a hint field');
  }
  const ids = choices.map((c) => c.id);
  assert.ok(!ids.includes('person') && !ids.includes('sign') && !ids.includes('state'), 'non-authorable hints are excluded');
  // ranked by the data-driven `authorable` order (physical thing → money → … → activity)
  assert.ok(ids.indexOf('class_of_physical_object') < ids.indexOf('amount_of_money'), 'physical thing before money');
  assert.ok(ids.indexOf('amount_of_money') < ids.indexOf('activity'), 'money before activity');
});
