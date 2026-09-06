// order-store CAS — the two-tab data-loss fix. The substrate owns the log; every
// write is compare-and-set, so two open tabs on the same order can never clobber
// each other. (The old saveEvents blind whole-array overwrite lost the update.)
//
// order-store is browser-only, so we shim a minimal localStorage + window before
// importing it, and capture the storage handler to exercise the cross-tab wake path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startOrder, fold } from '../web/order.mjs';

class MemStore {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
let storageHandler = null;
globalThis.localStorage = new MemStore();
globalThis.window = { addEventListener: (type, fn) => { if (type === 'storage') storageHandler = fn; } };

const { commit, compareAndSet, loadEvents, saveEvents, onExternalChange } = await import('../web/order-store.mjs');

test('compareAndSet refuses a stale write (protecting a concurrent append)', () => {
  const id = 'CAS-1';
  saveEvents(id, startOrder(id, 'j'));                 // seq 1
  const base = loadEvents(id);                         // both "tabs" read seq 1
  // tab A appends -> seq 2
  const a = compareAndSet(id, base.length, [...base, { type: 'Set', alias: 'x', field: 'a', value: 1 }]);
  assert.equal(a.ok, true);
  // tab B, still holding the stale seq-1 base, tries to write ITS array (missing A's event)
  const b = compareAndSet(id, base.length, [...base, { type: 'Set', alias: 'x', field: 'b', value: 2 }]);
  assert.equal(b.ok, false, 'stale write refused');
  assert.equal(b.events.length, 2, 'refusal returns the concurrently-advanced log');
  assert.deepEqual(fold(loadEvents(id)).configByAlias.x, { a: 1 }, "A's event is intact, B did not clobber");
});

test('commit is the safe write path: two stale tabs both land, no lost update', () => {
  const id = 'CAS-2';
  saveEvents(id, startOrder(id, 'j'));
  // both tabs commit against the same starting point; commit re-reads fresh each time,
  // so tab B validates against tab A's already-persisted event and appends after it.
  const a = commit(id, { type: 'set', alias: 'shopping', field: 'trim', value: 'sport' });
  const b = commit(id, { type: 'set', alias: 'shopping', field: 'wheels', value: 'w20' });
  assert.equal(a.error, null);
  assert.equal(b.error, null);
  assert.deepEqual(fold(loadEvents(id)).configByAlias.shopping, { trim: 'sport', wheels: 'w20' }, 'both writes survived');
});

test('commit re-validates against the fresh log (single-authority holds across tabs)', () => {
  const id = 'CAS-3';
  saveEvents(id, startOrder(id, 'j'));
  commit(id, { type: 'set', alias: 'a', field: 'f', value: 1 });
  commit(id, { type: 'commit', alias: 'a', hash: 'h' });                    // tab 1 freezes alias a
  const r = commit(id, { type: 'set', alias: 'a', field: 'f', value: 2 });  // tab 2, stale, tries to set
  assert.ok(r.error && /single-authority/.test(r.error), 'set-after-commit rejected against fresh state');
  assert.equal(fold(loadEvents(id)).configByAlias.a.f, 1, 'committed value preserved');
});

test('a rejected commit leaves the log unchanged', () => {
  const id = 'CAS-4';
  saveEvents(id, startOrder(id, 'j'));
  commit(id, { type: 'complete', step: 's', payload: {} });
  const before = loadEvents(id).length;
  const r = commit(id, { type: 'complete', step: 's', payload: {} });      // same step twice
  assert.ok(r.error && /already done/.test(r.error));
  assert.equal(loadEvents(id).length, before, 'log unchanged on rejection');
});

test('cross-tab storage event wakes external subscribers (events + index keys only)', () => {
  assert.equal(typeof storageHandler, 'function', 'a storage listener was registered at import');
  let woke = 0;
  const off = onExternalChange(() => { woke++; });
  storageHandler({ key: 'qc:events:SOME-ORDER:v1' });
  storageHandler({ key: 'qc:orders:v1' });
  storageHandler({ key: 'unrelated:key' });   // ignored — not an order key
  assert.equal(woke, 2, 'fired for events + index keys, ignored the unrelated one');
  off();
  storageHandler({ key: 'qc:events:SOME-ORDER:v1' });
  assert.equal(woke, 2, 'unsubscribed handler no longer fires');
});
