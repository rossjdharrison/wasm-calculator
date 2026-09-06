// The wire format is load-bearing: every renderer turns the engine's numeric slot
// value back to a raw input via decodeValue, the inverse of encodeInput. These
// were copy-pasted in two renderers and unpinned; now shared and asserted here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeInput, decodeValue, assemble } from '../web/assembler.mjs';

const choice = { type: 'choice', defaultRaw: 'b', options: [{ id: 'a', code: 0 }, { id: 'b', code: 1 }, { id: 'c', code: 2 }] };
const multi = { type: 'multichoice', options: [{ id: 'x', code: 0 }, { id: 'y', code: 1 }, { id: 'z', code: 2 }] };
const bool = { type: 'boolean' };
const num = { type: 'number' };

test('decode(encode(x)) === x for every field type', () => {
  for (const v of ['a', 'b', 'c']) assert.equal(decodeValue(choice, encodeInput(choice, v)), v);
  for (const arr of [[], ['x'], ['x', 'z'], ['x', 'y', 'z']]) {
    assert.deepEqual(decodeValue(multi, encodeInput(multi, arr)).sort(), [...arr].sort());
  }
  for (const b of [true, false]) assert.equal(decodeValue(bool, encodeInput(bool, b)), b);
  for (const n of [0, 42, -7, 1250.5]) assert.equal(decodeValue(num, encodeInput(num, n)), n);
});

test('encode falls back to the default; decode of an unknown code is the first option', () => {
  assert.equal(encodeInput(choice, undefined), 1);  // defaultRaw 'b' -> code 1
  assert.equal(decodeValue(choice, 99), 'a');       // out-of-range code -> options[0]
});

test('D5: an output role rides in ir.outputs but never enters the binary image (parity-safe)', () => {
  const base = { id: 't', version: '1', currency: 'EUR', fields: [{ id: 'p', type: 'number', default: 10 }], outputs: [{ id: 'p', label: 'P' }] };
  const tagged = { ...base, outputs: [{ id: 'p', label: 'P', role: 'total' }] };
  const a = assemble(base), b = assemble(tagged);
  assert.equal(a.ir.outputs[0].role, null, 'untagged → null');
  assert.equal(b.ir.outputs[0].role, 'total', 'tagged role reaches the IR');
  assert.deepEqual([...a.modelBytes], [...b.modelBytes], 'the binary MODEL image is byte-identical with or without the role tag');
});
