// Phase 4: pure journey mutations + the macro-graph builder. journey-edit clones
// and returns a new journey (never mutates); macroGraph turns a journey doc into
// boxes (models) + typed wires (bindings solid / triggers dashed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as jedit from '../web/journey-edit.mjs';
import { macroGraph } from '../web/journey-loom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const journey = JSON.parse(await readFile(join(here, '..', 'web', 'journeys', 'vehicle-sale.json'), 'utf8'));

test('macroGraph builds boxes from models and typed wires from bindings/triggers', () => {
  const g = macroGraph(journey);
  assert.equal(g.nodes.length, 2);
  assert.deepEqual(g.nodes.map((n) => n.alias).sort(), ['financing', 'shopping']);
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].kind, 'binding');
  assert.equal(g.edges[0].from, 'shopping');
  assert.equal(g.edges[0].to, 'financing');
});

test('mutations are pure (input journey untouched)', () => {
  const snap = JSON.stringify(journey);
  jedit.setSeamMapping(journey, 'price-to-financing', [{ to: 'price', from: { op: 'field', args: ['grandTotal'] } }]);
  jedit.setSeamCondition(journey, 'price-to-financing', { op: 'gt', args: [{ op: 'field', args: ['grandTotal'] }, 0] });
  jedit.removeBinding(journey, 'price-to-financing');
  jedit.addModelRef(journey, { ref: 'x', as: 'x', phase: 'fulfilment' });
  assert.equal(JSON.stringify(journey), snap, 'input journey unchanged');
});

test('setSeamCondition adds and clears', () => {
  const withCond = jedit.setSeamCondition(journey, 'price-to-financing', { op: 'gt', args: [{ op: 'field', args: ['grandTotal'] }, 0] });
  assert.ok(withCond.bindings[0].condition, 'condition set');
  const cleared = jedit.setSeamCondition(withCond, 'price-to-financing', null);
  assert.equal('condition' in cleared.bindings[0], false, 'condition cleared');
});

test('removeModelRef cascades to bindings/triggers/process', () => {
  const next = jedit.removeModelRef(journey, 'financing');
  assert.equal(next.models.some((m) => m.as === 'financing'), false);
  assert.equal((next.bindings || []).some((b) => b.from === 'financing' || b.to === 'financing'), false);
  assert.equal((next.process.steps || []).some((s) => s.model === 'financing'), false);
});

test('referencesToModel reports the cross-model blast radius', () => {
  const refs = jedit.referencesToModel(journey, 'financing');
  assert.ok(refs.some((r) => r.kind === 'binding' && r.id === 'price-to-financing'));
});
