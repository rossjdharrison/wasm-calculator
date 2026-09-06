// The seam mapping is evaluated by referenceEvaluate in compose.mjs (not a per-seam
// WASM instance). This extends the parity guarantee to seams: the synthetic seam
// model must evaluate identically in the WASM VM and the JS oracle — so using the
// oracle for seams is safe. (pretest builds build/quote.wasm.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, loadEngine, referenceEvaluate } from '../web/assembler.mjs';
import { buildSeamModel } from '../web/compose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));

// a binding whose mapping does real arithmetic + a condition (not a passthrough)
const binding = {
  id: 't', from: 'a', to: 'b',
  contract: {
    provides: [{ as: 'price', l0: 'amount_of_money', source: 'output:price' }, { as: 'rate', l0: 'physical_quantity', source: 'field:rate' }],
    requires: [{ name: 'monthly', target: 'field:monthly' }],
  },
  mapping: [{ to: 'monthly', from: { op: 'div', args: [{ op: 'mul', args: [{ op: 'field', args: ['price'] }, { op: 'field', args: ['rate'] }] }, 12] } }],
  condition: { op: 'gt', args: [{ op: 'field', args: ['price'] }, 0] },
};
const seam = assemble(buildSeamModel(binding));
const engine = await loadEngine(wasm, seam);
const near = (a, b) => Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-9;

test('seam model: WASM VM == referenceEvaluate over 200 fuzzed inputs', () => {
  let s = 123457;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let n = 0; n < 200; n++) {
    const inp = { price: Math.floor(rnd() * 200000), rate: +(rnd() * 0.2).toFixed(4) };
    const R = referenceEvaluate(seam.ir, inp), W = engine.evaluate(inp);
    for (const [id] of seam.ir.slotOf) assert.ok(near(R.valueById[id], W.valueById[id]), `${id}: ref=${R.valueById[id]} wasm=${W.valueById[id]} @ ${JSON.stringify(inp)}`);
  }
});
