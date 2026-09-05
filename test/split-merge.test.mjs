// Phase A1: the data/presentation split must be lossless and merge/split must be
// exact inverses — this is what lets the engine + parity suite stay unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitModel, mergeModel } from '../web/assembler.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(join(here, p), 'utf8').then(JSON.parse);

const fixture = await read('fixtures/vehicle-combined.json'); // the pre-split combined model
const data = await read('../web/models/vehicles/data-model.json');
const presentation = await read('../web/models/vehicles/presentation-model.json');

test('merge(split(model)) === model (lossless split)', () => {
  const s = splitModel(fixture);
  assert.deepStrictEqual(mergeModel(s.data, s.presentation), fixture);
});

test('the shipped two files split the fixture exactly', () => {
  assert.deepStrictEqual(splitModel(fixture), { data, presentation });
});

test('the shipped two files merge back to the fixture (faithful migration)', () => {
  assert.deepStrictEqual(mergeModel(data, presentation), fixture);
});

test('split then merge round-trips the shipped files', () => {
  const combined = mergeModel(data, presentation);
  const s = splitModel(combined);
  assert.deepStrictEqual(mergeModel(s.data, s.presentation), combined);
});
