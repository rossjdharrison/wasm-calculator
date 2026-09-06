// Phase 3: the generic event-sourced order. It is domain-neutral — the specific
// steps (build/sign/…) come from the journey model. fold builds config only from
// Set; Committed makes an alias single-authority; replay gives undo; a step
// completes once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startOrder, fold, apply, replay, contractOf, ordersForJourney } from '../web/order.mjs';

test('fold builds config only from Set events', () => {
  let ev = startOrder('O1', 'vehicle-sale');
  ({ events: ev } = apply(ev, { type: 'set', alias: 'shopping', field: 'trim', value: 'sport' }));
  ({ events: ev } = apply(ev, { type: 'set', alias: 'shopping', field: 'wheels', value: 'w20' }));
  const o = fold(ev);
  assert.equal(o.orderId, 'O1');
  assert.equal(o.journeyId, 'vehicle-sale');
  assert.deepEqual(o.configByAlias.shopping, { trim: 'sport', wheels: 'w20' });
  assert.equal(o.phase, null);
});

test('commit makes an alias single-authority — later sets rejected AND ignored', () => {
  let ev = startOrder('O2', 'j');
  ({ events: ev } = apply(ev, { type: 'set', alias: 'shopping', field: 'trim', value: 'sport' }));
  ({ events: ev } = apply(ev, { type: 'commit', alias: 'shopping', hash: 'abc' }));
  const r = apply(ev, { type: 'set', alias: 'shopping', field: 'trim', value: 'luxury' });
  assert.ok(r.error && /single-authority/.test(r.error), 'set-after-commit rejected');
  assert.equal(r.events.length, ev.length, 'log unchanged on rejection');
  const stray = [...ev, { type: 'Set', alias: 'shopping', field: 'trim', value: 'luxury' }];
  assert.equal(fold(stray).configByAlias.shopping.trim, 'sport', 'fold ignores a post-commit Set');
});

test('phase transitions + a completed step accrue; replay gives undo', () => {
  let ev = startOrder('O3', 'j');
  ({ events: ev } = apply(ev, { type: 'set', alias: 'shopping', field: 'trim', value: 'sport' }));
  const beforeCommit = ev.length;
  ({ events: ev } = apply(ev, { type: 'commit', alias: 'shopping', hash: 'h' }));
  ({ events: ev } = apply(ev, { type: 'enter', phase: 'agree_sign' }));
  ({ events: ev } = apply(ev, { type: 'complete', step: 'sign', payload: { by: 'A. Khan', outcome: 'sign' } }));
  const o = fold(ev);
  assert.equal(o.phase, 'agree_sign');
  assert.equal(o.steps.sign.done, true);
  assert.equal(o.steps.sign.by, 'A. Khan');
  const past = replay(ev, beforeCommit);
  assert.equal(!!past.committed.shopping, false);
  assert.equal(!!(past.steps.sign && past.steps.sign.done), false);
});

test('D4: the settle sequence records free inputs, commits, and records the transfer outcome', () => {
  let ev = startOrder('O-settle', 'vehicle-sale');
  // downstream capture: only FREE fields are Set (never the bound `price`)
  ({ events: ev } = apply(ev, { type: 'set', alias: 'financing', field: 'deposit', value: 8000 }));
  ({ events: ev } = apply(ev, { type: 'set', alias: 'financing', field: 'termMonths', value: 36 }));
  ({ events: ev } = apply(ev, { type: 'commit', alias: 'financing', hash: 'h' }));
  ({ events: ev } = apply(ev, { type: 'complete', step: 'settle', payload: { outcome: 'transfer_of_ownership', label: 'Settlement' } }));
  ({ events: ev } = apply(ev, { type: 'enter', phase: 'fulfilment' }));
  const o = fold(ev);
  assert.deepEqual(o.configByAlias.financing, { deposit: 8000, termMonths: 36 }, 'only free fields captured (no price)');
  assert.ok(o.committed.financing, 'financing committed (single-authority after settle)');
  assert.equal(o.steps.settle.outcome, 'transfer_of_ownership');
  // a post-commit set on the downstream free field is rejected + ignored
  const r = apply(ev, { type: 'set', alias: 'financing', field: 'deposit', value: 1 });
  assert.ok(r.error && /single-authority/.test(r.error));
  assert.equal(fold([...ev, { type: 'Set', alias: 'financing', field: 'deposit', value: 1 }]).configByAlias.financing.deposit, 8000);
});

test('contractOf exposes the committed config as the single-authority source', () => {
  let ev = startOrder('O4', 'j');
  ({ events: ev } = apply(ev, { type: 'set', alias: 'shopping', field: 'model', value: 'gtCoupe' }));
  ({ events: ev } = apply(ev, { type: 'commit', alias: 'shopping', hash: 'h' }));
  const c = contractOf(fold(ev));
  assert.equal(c.committed.shopping, 'h');
  assert.deepEqual(c.configByAlias.shopping, { model: 'gtCoupe' });
});

test('D6: startOrder stamps the journey version for stale-snapshot detection (back-compatible)', () => {
  assert.equal(fold(startOrder('O', 'j', '2.0.0')).journeyVersion, '2.0.0');
  assert.equal(fold(startOrder('O', 'j')).journeyVersion, null, 'omitted version folds to null');
});

test('D6: ordersForJourney filters the index by journeyId and tolerates junk', () => {
  const list = [{ id: 'A', journeyId: 'vehicle-sale', seq: 3 }, { id: 'B', journeyId: 'art-sale', seq: 1 }, null, { id: 'C', journeyId: 'vehicle-sale', seq: 5 }];
  assert.deepEqual(ordersForJourney(list, 'vehicle-sale').map((o) => o.id), ['A', 'C']);
  assert.deepEqual(ordersForJourney([], 'vehicle-sale'), []);
  assert.deepEqual(ordersForJourney(undefined, 'x'), []);
});

test('completing the same step twice is rejected', () => {
  let ev = startOrder('O5', 'j');
  ({ events: ev } = apply(ev, { type: 'complete', step: 'sign', payload: {} }));
  const r = apply(ev, { type: 'complete', step: 'sign', payload: {} });
  assert.ok(r.error && /already done/.test(r.error));
});
