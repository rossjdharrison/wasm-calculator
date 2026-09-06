// D-C: the pure heart of "add a configurator" — id minting + a seed model that
// assembles out of the box, and its derived taxonomy placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueModelId, newModelData, newModelPres } from '../web/model-create-core.mjs';
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

test('an optional `configures` tag flows through and places the model in the taxonomy', () => {
  const data = newModelData('yachts', { configures: 'YachtClass' });
  assert.equal(data.configures, 'YachtClass');
  // with a declared class it becomes that leaf; without one it still appears via #spec
  const withClass = registryFromModels({}, { models: [{ id: 'yachts', title: 'Yachts' }] },
    { yachts: { ...data, types: { YachtClass: { specializes: ['class_of_physical_object'] } } } });
  assert.equal(withClass.nodes.YachtClass.model, 'yachts');
  const bare = registryFromModels({}, { models: [{ id: 'yachts', title: 'Yachts' }] }, { yachts: newModelData('yachts') });
  assert.deepEqual(modelsUnder(bare, 'class_of_physical_object').map((r) => r.model), ['yachts']);
});
