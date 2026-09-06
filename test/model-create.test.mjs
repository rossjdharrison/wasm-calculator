// D-C: the pure heart of "add a configurator" — id minting + a seed model that
// assembles out of the box, and its derived taxonomy placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueModelId, newModelData, newModelPres, ensureOwnLeaf, ownLeafId, forkModelData, forkModelPres } from '../web/model-create-core.mjs';
import { mergeModel } from '../web/assembler.mjs';
import { tryAssemble } from '../web/model-validate.mjs';
import { registryFromModels } from '../web/catalogue-build.mjs';
import { modelsUnder } from '../web/catalogue.mjs';

test('uniqueModelId slugs the title and disambiguates against existing ids', () => {
  assert.equal(uniqueModelId('Yacht Charters!', []), 'yacht-charters');
  assert.equal(uniqueModelId('Vehicles', new Set(['vehicles'])), 'vehicles-2');
  assert.equal(uniqueModelId('', []), 'model', 'empty title falls back to "model", not "journey"');
});

test('the seed model assembles cleanly out of the box', () => {
  const merged = mergeModel(newModelData('demo', { currency: 'EUR' }), newModelPres('demo', { title: 'Demo' }));
  const r = tryAssemble(merged);
  assert.equal(r.ok, true, `seed model should assemble: ${r.errors.map((e) => e.message).join('; ')}`);
});

test('an explicit `configures` (e.g. a fork target) is honoured as-is, no own leaf minted', () => {
  const data = newModelData('yachts', { configures: 'YachtClass' });
  assert.equal(data.configures, 'YachtClass');
  assert.equal(data.types, undefined, 'a supplied configures does not mint a competing own leaf');
  const withClass = registryFromModels({}, { models: [{ id: 'yachts', title: 'Yachts' }] },
    { yachts: { ...data, types: { YachtClass: { specializes: ['class_of_physical_object'] } } } });
  assert.equal(withClass.nodes.YachtClass.model, 'yachts');
});

test('a fresh model is BORN TYPED: a unique own leaf specialising the default category', () => {
  const data = newModelData('yachts');
  const leaf = ownLeafId('yachts');
  assert.equal(data.configures, leaf, 'configures points at the model-own leaf');
  assert.ok(data.types && data.types[leaf], 'the own leaf exists in data.types');
  assert.deepEqual(data.types[leaf].specializes, ['class_of_physical_object']);
  assert.ok(!/#spec$/.test(data.configures), 'not a synthetic #spec orphan');
  // and it places into the taxonomy as a real leaf carrying the model
  const reg = registryFromModels({}, { models: [{ id: 'yachts', title: 'Yachts' }] }, { yachts: data });
  assert.equal(reg.nodes[leaf].model, 'yachts');
  assert.deepEqual(modelsUnder(reg, 'class_of_physical_object').map((r) => r.model), ['yachts']);
});

test('born-typed leaves are model-UNIQUE (two models never collapse onto one node)', () => {
  const a = newModelData('yachts');
  const b = newModelData('jets');
  assert.notEqual(a.configures, b.configures, 'distinct models get distinct leaves');
  const reg = registryFromModels({}, { models: [{ id: 'yachts', title: 'Yachts' }, { id: 'jets', title: 'Jets' }] }, { yachts: a, jets: b });
  assert.equal(reg.nodes[a.configures].model, 'yachts');
  assert.equal(reg.nodes[b.configures].model, 'jets');
  assert.deepEqual(modelsUnder(reg, 'class_of_physical_object').map((r) => r.model).sort(), ['jets', 'yachts']);
});

test('a chosen category places the born-typed leaf under it (with a title)', () => {
  const data = newModelData('deposit', { category: 'amount_of_money', title: 'Deposit' });
  assert.deepEqual(data.types[ownLeafId('deposit')].specializes, ['amount_of_money']);
  assert.equal(data.types[ownLeafId('deposit')].title, 'Deposit');
});

test('ensureOwnLeaf re-points an existing leaf to a new category (change-type)', () => {
  const data = newModelData('thing');            // born under class_of_physical_object
  ensureOwnLeaf(data, 'activity');               // author changes the type
  assert.deepEqual(data.types[ownLeafId('thing')].specializes, ['activity']);
  assert.equal(data.configures, ownLeafId('thing'), 'configures still points at the same own leaf');
});

test('forkModelData deep-clones, re-ids, and mints a UNIQUE SIBLING leaf (no node collapse)', () => {
  const src = newModelData('yachts', { category: 'class_of_physical_object', title: 'Yachts' });
  src.fields.push({ id: 'length', type: 'number', default: 10 });   // a distinctive field to prove deep clone
  const fork = forkModelData(src, 'yachts-2', { title: 'Yachts II' });
  assert.equal(fork.id, 'yachts-2');
  assert.equal(fork.configures, ownLeafId('yachts-2'), 'fork gets its OWN unique leaf');
  assert.notEqual(fork.configures, src.configures);
  assert.deepEqual(fork.types[fork.configures].specializes, src.types[src.configures].specializes, 'sibling: same parent as the source leaf');
  assert.ok(!fork.types[src.configures], "the source's own leaf is not carried into the fork");
  // deep clone: mutating the fork does not touch the source
  fork.fields.push({ id: 'beam', type: 'number' });
  assert.notEqual(fork.fields.length, src.fields.length);
  // both coexist in the catalogue under the shared parent — no collapse
  const reg = registryFromModels({}, { models: [{ id: 'yachts', title: 'Yachts' }, { id: 'yachts-2', title: 'Yachts II' }] }, { yachts: src, 'yachts-2': fork });
  assert.equal(reg.nodes[src.configures].model, 'yachts');
  assert.equal(reg.nodes[fork.configures].model, 'yachts-2');
  assert.deepEqual(modelsUnder(reg, 'class_of_physical_object').map((r) => r.model).sort(), ['yachts', 'yachts-2']);
});

test('a fork assembles cleanly + forkModelPres retitles the presentation', () => {
  const src = newModelData('base', { title: 'Base' });
  const fork = forkModelData(src, 'base-2', { title: 'Base II' });
  const pres = forkModelPres(newModelPres('base', { title: 'Base' }), { title: 'Base II' });
  assert.equal(pres.name, 'Base II');
  assert.equal(pres.brand.mark, 'Base II');
  const r = tryAssemble(mergeModel(fork, pres));
  assert.equal(r.ok, true, `fork should assemble: ${r.errors.map((e) => e.message).join('; ')}`);
});
