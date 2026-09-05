// Reflection parity: the engine's own graph() (the value-dependency graph it
// derives from the loaded image) must equal a JS mirror that walks the SAME
// assembled node arrays. This is the guard that lets JS stop re-deriving the
// graph — it pins the WASM authority to a test-only oracle (not to the shipped
// edgesOf, which is data-only and will be retired). (pretest builds the wasm.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, loadEngine, mergeModel } from '../web/assembler.mjs';
import { edgesOf } from '../web/coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const data = await web('models/vehicles/data-model.json');
const pres = await web('models/vehicles/presentation-model.json');
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));

const assembled = assemble(mergeModel(data, pres));
const ir = assembled.ir;
const engine = await loadEngine(wasm, assembled);

// ---- the test-only JS mirror, over ir.nodes (same arrays the image encodes) --
const LOAD = 1; // OP.LOAD (assembly/quote.ts)
function nodeRefs(nodes, idx, out) {
  if (idx < 0) return out;
  const n = nodes[idx];
  if (n.op === LOAD) { out.push(n.aux); return out; }
  for (const k of n.kids) nodeRefs(nodes, k, out);
  return out;
}
function mirror(scope) {
  const idOfSlot = [];
  for (const [id, slot] of ir.slotOf) idOfSlot[slot] = id;
  const set = new Set();
  const root = (idx, owner) => {
    if (idx < 0) return;
    for (const r of nodeRefs(ir.nodes, idx, [])) {
      if (r === owner) continue;
      const f = idOfSlot[r], t = idOfSlot[owner];
      if (f !== undefined && t !== undefined) set.add(f + ' ' + t);
    }
  };
  for (const c of ir.computedIR) root(c.node, c.slot);
  if (scope !== 0) {
    for (const f of ir.fields) {
      for (const key of ['visibleWhenNode', 'enabledWhenNode', 'minNode', 'maxNode', 'stepNode', 'computedValueNode']) root(f[key], f.slot);
      for (const o of f.options) root(o.availableWhenNode, f.slot);
    }
    for (const e of ir.effects) { root(e.condNode, e.targetSlot); root(e.valueNode, e.targetSlot); }
    for (const v of ir.validations) { if (v.targetSlot >= 0) root(v.condNode, v.targetSlot); }
    for (const o of ir.outputs) root(o.visibleWhenNode, o.slot);
  }
  return set;
}
const graphSet = (scope) => new Set(engine.graph(scope).map((e) => e.from + ' ' + e.to));
const sorted = (s) => [...s].sort();

test('engine.graph(1) equals the IR mirror (all value roots)', () => {
  assert.deepEqual(sorted(graphSet(1)), sorted(mirror(1)));
});

test('engine.graph(0) equals the IR mirror (computed owners only)', () => {
  assert.deepEqual(sorted(graphSet(0)), sorted(mirror(0)));
});

test('graph(1) is a superset of graph(0)', () => {
  const all = graphSet(1);
  for (const e of graphSet(0)) assert.ok(all.has(e), `graph(0) edge missing from graph(1): ${e}`);
});

test('graph(1) contains every data-model edge edgesOf() finds', () => {
  const all = graphSet(1);
  for (const e of edgesOf(data)) assert.ok(all.has(`${e.from} ${e.to}`), `merged graph is missing data edge ${e.from} -> ${e.to}`);
});

test('graph edges are deduped and self-free', () => {
  const edges = engine.graph(1);
  const keys = new Set(edges.map((e) => e.from + ' ' + e.to));
  assert.equal(keys.size, edges.length, 'duplicate edges returned');
  assert.ok(edges.every((e) => e.from !== e.to), 'a self-edge slipped through');
});
