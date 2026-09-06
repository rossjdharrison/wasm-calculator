// The pure taxonomy builder: registryFromModels projects { root, nodes } from the
// models' data.types + `configures` + an optional domain grouping seed. Deterministic,
// DOM-free; the derived registry is what catalogue.mjs/isA/landing consume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registryFromModels } from '../web/catalogue-build.mjs';
import { childrenOf, modelsUnder } from '../web/catalogue.mjs';

const catalog = { models: [{ id: 'vehicles', title: 'Vehicles' }, { id: 'antiques', title: 'Art & Antiques' }] };
const datas = {
  vehicles: { configures: 'VehicleClass', types: { VehicleClass: { specializes: ['class_of_physical_object'] } } },
  antiques: { configures: 'ArtworkClass', types: { ArtworkClass: { specializes: ['class_of_physical_object'] } } },
};

test('a model becomes a leaf node keyed by its `configures` class, tagged with the model + a title', () => {
  const reg = registryFromModels({}, catalog, datas);
  assert.equal(reg.nodes.VehicleClass.model, 'vehicles');
  assert.equal(reg.nodes.VehicleClass.title, 'Vehicles', 'title falls back to the card title');
  assert.deepEqual(reg.nodes.VehicleClass.specializes, ['class_of_physical_object']);
});

test('root falls back to class_of_physical_object; the domain may override + seed grouping classes', () => {
  assert.equal(registryFromModels({}, catalog, datas).root, 'class_of_physical_object');
  const seeded = registryFromModels(
    { rootCatalogue: 'TransferableProperty', taxonomy: { TransferableProperty: { specializes: ['class_of_physical_object'], title: 'Transferable Property' } } },
    { models: [{ id: 'vehicles', title: 'Vehicles' }] },
    { vehicles: { configures: 'VehicleClass', types: { VehicleClass: { specializes: ['TransferableProperty'] } } } },
  );
  assert.equal(seeded.root, 'TransferableProperty');
  assert.equal(seeded.nodes.TransferableProperty.title, 'Transferable Property');
  assert.deepEqual(childrenOf(seeded, 'TransferableProperty'), ['VehicleClass']);
  assert.deepEqual(modelsUnder(seeded, 'TransferableProperty').map((r) => r.model), ['vehicles']);
});

test('a shared ancestor declared by two models collapses to one node (union, single-sourced)', () => {
  const two = {
    vehicles: { configures: 'VehicleClass', types: { VehicleClass: { specializes: ['TransferableProperty'] }, TransferableProperty: { specializes: ['class_of_physical_object'], title: 'Transferable Property' } } },
    antiques: { configures: 'ArtworkClass', types: { ArtworkClass: { specializes: ['TransferableProperty'] }, TransferableProperty: { specializes: ['class_of_physical_object'] } } },
  };
  const reg = registryFromModels({ rootCatalogue: 'TransferableProperty' }, catalog, two);
  assert.equal(Object.values(reg.nodes).filter((_, i) => Object.keys(reg.nodes)[i] === 'TransferableProperty').length, 1);
  assert.deepEqual(childrenOf(reg, 'TransferableProperty').sort(), ['ArtworkClass', 'VehicleClass']);
});

test('an untagged model (no `configures`) still contributes a synthetic #spec leaf (back-compat)', () => {
  const reg = registryFromModels({}, { models: [{ id: 'legacy', title: 'Legacy' }] }, { legacy: { types: {} } });
  assert.ok(reg.nodes['legacy#spec'], 'synthetic leaf minted');
  assert.equal(reg.nodes['legacy#spec'].model, 'legacy');
  assert.deepEqual(modelsUnder(reg, 'class_of_physical_object').map((r) => r.model), ['legacy']);
});

test('an unloadable model is skipped (landing degrades gracefully)', () => {
  const reg = registryFromModels({}, { models: [{ id: 'vehicles', title: 'Vehicles' }, { id: 'broken' }] }, { vehicles: datas.vehicles, broken: null });
  assert.ok(reg.nodes.VehicleClass);
  assert.ok(!Object.values(reg.nodes).some((n) => n.model === 'broken'));
});
