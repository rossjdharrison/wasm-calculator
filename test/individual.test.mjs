// Phase 1: a model's seam surface. individualsOf enumerates the typed HQDM
// individuals it produces (the Purchase Price + the Configured Specification) with
// stable cross-model ids; projectIndividuals yields the runtime payload a
// downstream context would receive; the coverage advisor flags bad category tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel, referenceEvaluate } from '../web/assembler.mjs';
import { individualsOf, purchasePriceOf, projectIndividuals, categoryOf, refOf, unknownCategories, configuredClassOf } from '../web/individuals.mjs';
import { analyzeCoverage } from '../web/coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = async (id) => ({
  data: JSON.parse(await readFile(join(here, '..', 'web', 'models', id, 'data-model.json'), 'utf8')),
  pres: JSON.parse(await readFile(join(here, '..', 'web', 'models', id, 'presentation-model.json'), 'utf8')),
});
const V = await load('vehicles');
const A = await load('antiques');
const cfgFor = (ir) => { const c = {}; for (const f of ir.fields) c[f.id] = f.type === 'multichoice' ? [] : f.type === 'boolean' ? !!f.defaultRaw : f.type === 'number' ? (f.defaultRaw ?? 0) : (f.defaultRaw ?? f.options[0].id); return c; };

test('individualsOf enumerates a Purchase Price scalar + a spec composite (vehicles)', () => {
  const inds = individualsOf(V.data, V.pres);
  const price = inds.find((i) => i.leaf === 'amount_of_money' && i.emphasis);
  assert.ok(price, 'a surfaced, emphasised amount_of_money individual exists');
  assert.equal(price.ref, `${V.data.id}#${price.localId}`);
  const spec = inds.find((i) => i.kind === 'composite');
  assert.ok(spec, 'a composite spec individual exists');
  assert.equal(spec.ref, `${V.data.id}#spec`);
  // the spec's category is the class the model declares it CONFIGURES (or the neutral
  // fallback), and it always climbs to the physical-object leaf.
  assert.equal(spec.category, configuredClassOf(V.data));
  assert.equal(spec.leaf, 'class_of_physical_object');
  assert.ok(spec.parts.includes('model'), 'spec parts include the class-tagged field');
});

test('configuredClassOf reads the `configures` tag; falls back to the neutral class', () => {
  assert.equal(configuredClassOf({ configures: 'VehicleClass' }), 'VehicleClass');
  assert.equal(configuredClassOf({}), 'class_of_physical_object');
  // a tagged model surfaces its declared class on the spec composite (climbs to the leaf)
  const tagged = { ...V.data, configures: 'VehicleClass' };
  const spec = individualsOf(tagged, V.pres).find((i) => i.kind === 'composite');
  assert.equal(spec.category, 'VehicleClass');
  assert.equal(spec.leaf, 'class_of_physical_object');
});

test('purchasePriceOf picks the emphasised amount_of_money — both models', () => {
  assert.equal(purchasePriceOf(V.data, V.pres).localId, 'grandTotal');
  assert.ok(purchasePriceOf(A.data, A.pres), 'antiques surfaces an amount_of_money too');
});

test('projectIndividuals yields a priced spec payload from an evaluation', () => {
  const merged = mergeModel(V.data, V.pres);
  const { ir } = assemble(merged);
  const cfg = cfgFor(ir);
  const res = referenceEvaluate(ir, cfg);
  const p = projectIndividuals(merged, res.valueById, cfg);
  assert.equal(p.model, V.data.id);
  assert.ok(p.price && typeof p.price.amount === 'number' && p.price.amount > 0, 'price carries a numeric amount');
  assert.equal(p.price.localId, 'grandTotal');
  assert.ok(p.spec && p.spec.parts && ('model' in p.spec.parts), 'spec carries its part values from the config');
  assert.equal(refOf('x', 'y'), 'x#y');
});

test('categoryOf reads field & computed tags; shipped models have no unknown categories', () => {
  assert.equal(categoryOf(V.data, 'model'), 'VehicleClass');
  assert.equal(categoryOf(V.data, 'grandTotal'), 'PurchasePrice');
  assert.deepEqual(unknownCategories(V.data), []);
  assert.deepEqual(unknownCategories(A.data), []);
});

test('coverage flags an unknown category as a build error', () => {
  const bad = JSON.parse(JSON.stringify(V.data));
  bad.fields.find((f) => f.id === 'trim').category = 'NotARealType';
  const cov = analyzeCoverage(bad, V.pres);
  assert.ok(cov.findings.some((f) => f.kind === 'unknown-category' && f.severity === 'error'), 'unknown-category error raised');
});
