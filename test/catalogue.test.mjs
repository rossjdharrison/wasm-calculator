// The taxonomy-as-catalogue, now DERIVED from the models (their data.types +
// `configures`) rather than a hand-authored registry.json. This pins the projection
// over the SHIPPED models: transitivity into the frozen core, the surfaced-models
// view, the derived row kind — engine untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isA as hIsA, leafCategoryOf } from '../web/hqdm.mjs';
import { typeMapOf, nodeOf, childrenOf, isA, modelsUnder, rowKind } from '../web/catalogue.mjs';
import { registryFromModels } from '../web/catalogue-build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => readFile(join(here, '..', 'web', p), 'utf8').then(JSON.parse);
const core = await readJson('hqdm-core.json');
const domain = await readJson('domain.json');
const catalog = await readJson('models/catalog.json');
const datas = {};
for (const m of catalog.models) datas[m.id] = await readJson(`models/${m.id}/data-model.json`);
const reg = registryFromModels(domain, catalog, datas);   // the DERIVED registry

test('the derived registry uses the models’ OWN classes (VehicleClass/ArtworkClass), not an invented tree', () => {
  assert.ok(reg.nodes.VehicleClass, 'VehicleClass node derived from the vehicles model');
  assert.equal(reg.nodes.VehicleClass.model, 'vehicles');
  assert.ok(reg.nodes.ArtworkClass, 'ArtworkClass node derived from the antiques model');
  assert.equal(reg.nodes.ArtworkClass.model, 'antiques');
  assert.equal(reg.root, 'class_of_physical_object', 'root fallback (domain declares none)');
});

test('every node.specializes parent resolves to a node OR a core type (referential integrity)', () => {
  const known = new Set([...Object.keys(reg.nodes), ...Object.keys(core.types)]);
  for (const [id, n] of Object.entries(reg.nodes))
    for (const p of n.specializes || []) assert.ok(known.has(p), `${id} specializes unknown "${p}"`);
});

test('typeMapOf projects each node to only {specializes} (a field-strip)', () => {
  const m = typeMapOf(reg);
  for (const v of Object.values(m)) assert.deepEqual(Object.keys(v), ['specializes']);
});

test('isA is a catalogue lookup: transitive up the derived nodes INTO the frozen core', () => {
  assert.equal(isA(reg, 'VehicleClass', 'class_of_physical_object'), true, 'climbs into hqdm-core');
  assert.equal(isA(reg, 'VehicleClass', 'amount_of_money'), false);
  assert.equal(isA(reg, 'VehicleClass', 'class_of_physical_object'), hIsA('VehicleClass', 'class_of_physical_object', typeMapOf(reg)), 'catalogue.isA == hqdm.isA over the projection');
});

test('childrenOf(root) are the leaf classes; modelsUnder surfaces the configurators', () => {
  assert.deepEqual(childrenOf(reg, reg.root).sort(), ['ArtworkClass', 'VehicleClass']);
  assert.deepEqual(modelsUnder(reg, reg.root).map((r) => r.model).sort(), ['antiques', 'vehicles']);
  assert.deepEqual(modelsUnder(reg, 'VehicleClass').map((r) => r.model), ['vehicles']);
});

test('rowKind is derived: a model-bearing leaf is a model, a money class is not surfaced as a group', () => {
  assert.equal(rowKind(reg, 'VehicleClass'), 'model');
  // PurchasePrice specializes amount_of_money, not the physical-object root → never a landing group
  assert.ok(!childrenOf(reg, reg.root).includes('PurchasePrice'));
});

test('a leaf class climbs to the neutral L0 render category', () => {
  assert.equal(leafCategoryOf('VehicleClass', typeMapOf(reg)), 'class_of_physical_object');
});
