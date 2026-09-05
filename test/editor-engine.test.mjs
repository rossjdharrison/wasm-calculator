// Unit tests for the pure, DOM-free helpers the createEditor engine exposes.
// createEditor itself needs a DOM (outline/detail elements) so it is verified in
// the browser; these lock the path resolver the new nested/root widgets rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPath, setPath, delPath } from '../web/editor-engine.mjs';

test('getPath reads flat and nested keys, undefined on missing', () => {
  const o = { a: 1, brand: { mark: 'ROWBLAA', nest: { deep: 7 } }, format: { type: 'unit' } };
  assert.equal(getPath(o, 'a'), 1);
  assert.equal(getPath(o, 'brand.mark'), 'ROWBLAA');
  assert.equal(getPath(o, 'brand.nest.deep'), 7);
  assert.equal(getPath(o, 'format.type'), 'unit');
  assert.equal(getPath(o, 'brand.missing'), undefined);
  assert.equal(getPath(o, 'nope.deeper'), undefined);
  assert.equal(getPath(null, 'a'), undefined);
});

test('setPath writes flat and auto-vivifies nested parents', () => {
  const o = {};
  setPath(o, 'name', 'Vehicles');
  assert.deepEqual(o, { name: 'Vehicles' });
  setPath(o, 'brand.mark', 'ROWBLAA');
  setPath(o, 'brand.rest', 'LUXURY');
  assert.deepEqual(o.brand, { mark: 'ROWBLAA', rest: 'LUXURY' });
  setPath(o, 'format.type', 'unit');
  assert.equal(o.format.type, 'unit');
});

test('setPath does not clobber a non-object on the way down (replaces it)', () => {
  const o = { brand: 'oops' };           // brand is a string, not an object
  setPath(o, 'brand.mark', 'X');
  assert.deepEqual(o.brand, { mark: 'X' });
});

test('delPath removes only the leaf and is a no-op on missing parents', () => {
  const o = { brand: { mark: 'X', rest: 'Y' } };
  delPath(o, 'brand.mark');
  assert.deepEqual(o.brand, { rest: 'Y' });
  delPath(o, 'brand.missing');           // no throw
  delPath(o, 'nope.deeper');             // no throw
  assert.deepEqual(o.brand, { rest: 'Y' });
});

test('a value written by setPath round-trips through getPath and clears via delPath', () => {
  const o = {};
  setPath(o, 'a.b.c', 42);
  assert.equal(getPath(o, 'a.b.c'), 42);
  delPath(o, 'a.b.c');
  assert.equal(getPath(o, 'a.b.c'), undefined);
  assert.deepEqual(o, { a: { b: {} } });  // parents remain (matches delete semantics)
});
