// D8: the 4-D temporal projection. Pure + deterministic — timestamps are injected
// (order.mjs never reads a clock), so these fold the same way every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startOrder, apply, temporalOf } from '../web/order.mjs';

const enters = (individual, category, extra = {}) => [{ individual, category, ...extra }];

test('phaseEntries records each Entered with its injected point_in_time, in order', () => {
  let ev = startOrder('T1', 'j');
  ({ events: ev } = apply(ev, { type: 'enter', phase: 'agree_sign', at: 1000 }));
  ({ events: ev } = apply(ev, { type: 'enter', phase: 'exchange_settlement', at: 2000 }));
  assert.deepEqual(temporalOf(ev).phaseEntries, [{ phase: 'agree_sign', at: 1000 }, { phase: 'exchange_settlement', at: 2000 }]);
});

test('a legacy enter with no `at` folds to at:null (additive change is back-compatible)', () => {
  let ev = startOrder('T2', 'j');
  ({ events: ev } = apply(ev, { type: 'enter', phase: 'agree_sign' }));
  assert.deepEqual(temporalOf(ev).phaseEntries, [{ phase: 'agree_sign', at: null }]);
});

test('a completed step with `enters` opens an active state for its individual', () => {
  let ev = startOrder('T3', 'j');
  ({ events: ev } = apply(ev, { type: 'complete', step: 'settle', payload: { at: 3000, enters: enters('shopping#spec', 'Owned', { role: 'owner', label: 'Ownership' }) } }));
  const s = temporalOf(ev).statesByIndividual['shopping#spec'];
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], { state: 'Owned', category: 'Owned', role: 'owner', label: 'Ownership', begin: 3000, end: null, status: 'active' });
});

test('4-D bounding: a later state closes the prior open state (begin/end interval)', () => {
  let ev = startOrder('T4', 'j');
  ({ events: ev } = apply(ev, { type: 'complete', step: 'own', payload: { at: 3000, enters: enters('v', 'Owned') } }));
  ({ events: ev } = apply(ev, { type: 'complete', step: 'poss', payload: { at: 4000, enters: enters('v', 'Possessed') } }));
  const s = temporalOf(ev).statesByIndividual['v'];
  assert.equal(s[0].end, 4000); assert.equal(s[0].status, 'ended');
  assert.equal(s[1].begin, 4000); assert.equal(s[1].end, null); assert.equal(s[1].status, 'active');
});

test('closing a state with no `at` leaves the prior state open (no fabricated end)', () => {
  let ev = startOrder('T4b', 'j');
  ({ events: ev } = apply(ev, { type: 'complete', step: 'own', payload: { at: 3000, enters: enters('v', 'Owned') } }));
  ({ events: ev } = apply(ev, { type: 'complete', step: 'poss', payload: { enters: enters('v', 'Possessed') } })); // no at
  const s = temporalOf(ev).statesByIndividual['v'];
  assert.equal(s[0].end, null, 'prior state not fabricated-closed without a closing time');
  assert.equal(s[0].status, 'active');
  assert.equal(s[1].status, 'pending');
});

test('a state with no `at` is pending (begin null)', () => {
  let ev = startOrder('T5', 'j');
  ({ events: ev } = apply(ev, { type: 'complete', step: 's', payload: { enters: enters('v', 'Owned') } }));
  const s = temporalOf(ev).statesByIndividual['v'][0];
  assert.equal(s.begin, null); assert.equal(s.status, 'pending');
});

test('states of different individuals are independent', () => {
  let ev = startOrder('T6', 'j');
  ({ events: ev } = apply(ev, { type: 'complete', step: 'a', payload: { at: 1, enters: enters('A', 'Owned') } }));
  ({ events: ev } = apply(ev, { type: 'complete', step: 'b', payload: { at: 2, enters: enters('B', 'Owned') } }));
  const t = temporalOf(ev);
  assert.equal(t.statesByIndividual['A'][0].end, null, 'B did not close A');
  assert.equal(t.statesByIndividual['B'][0].end, null);
});

test('temporalOf is pure/deterministic', () => {
  let ev = startOrder('T7', 'j');
  ({ events: ev } = apply(ev, { type: 'enter', phase: 'agree_sign', at: 10 }));
  ({ events: ev } = apply(ev, { type: 'complete', step: 's', payload: { at: 20, enters: enters('v', 'Owned') } }));
  assert.deepEqual(temporalOf(ev), temporalOf(ev));
});
