// =============================================================================
// order-store.mjs — browser persistence for the event-sourced order, mirroring
// basket.mjs. The append-only event log lives at qc:events:<orderId>:v1; a small
// index of orders at qc:orders:v1. Resume = load the log and fold it.
//
// WRITES ARE COMPARE-AND-SET (commit): every write re-reads the FRESH stored log,
// re-validates the command against it (so single-authority holds across tabs), then
// appends only if no concurrent writer advanced the log — so two open tabs on the
// same order can never clobber each other's events (the old blind saveEvents did).
// A cross-tab `storage` listener re-notifies subscribers so a second tab re-syncs.
// =============================================================================
import { apply as applyCmd } from './order.mjs';

const EVKEY = (id) => `qc:events:${id}:v1`;
const ORDERS = 'qc:orders:v1';
const get = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };

const subs = new Set();
const notify = () => subs.forEach((f) => { try { f(); } catch (_) { /* ignore */ } });
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

// cross-tab subscribers: fired ONLY by another tab's write (the `storage` event never
// fires in the tab that made the change), so a runner can adopt the fresh log and
// re-render without double-handling its own same-tab saves (use onChange for those).
const externalSubs = new Set();
export const onExternalChange = (fn) => { externalSubs.add(fn); return () => externalSubs.delete(fn); };

export const loadEvents = (id) => get(EVKEY(id)) || [];
export function saveEvents(id, events) { set(EVKEY(id), events); index(id, events); notify(); }

// compare-and-set the stored log: persist `next` ONLY if the current stored log is
// still `expectedSeq` events long (no other writer appended since the caller read it).
// Returns { ok, events } — `events` is the authoritative stored log after the attempt
// (the caller's `next` on success, or the concurrently-advanced log on a miss).
export function compareAndSet(id, expectedSeq, next) {
  const current = loadEvents(id);
  if (current.length !== expectedSeq) return { ok: false, events: current };
  set(EVKEY(id), next); index(id, next); notify();
  return { ok: true, events: next };
}

// commit a command with optimistic concurrency — the substrate's single write path.
// Reads the FRESH stored log, validates `cmd` against it via order.apply (so a
// concurrent tab's committed alias is honoured, not overwritten), then CAS-appends.
// If a writer advanced the log between the read and the write, it re-folds and
// re-validates against the new tip and retries. Returns { events, error, rebased }:
// `events` is the authoritative post-commit log the caller MUST adopt (it may carry
// another tab's events); `error` is order.apply's rejection (log left unchanged);
// `rebased` is true when a concurrent write forced a re-validation.
export function commit(id, cmd) {
  let rebased = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    const base = loadEvents(id);
    const r = applyCmd(base, cmd);
    if (r.error) return { events: base, error: r.error, rebased };
    if (r.events.length === base.length) return { events: base, error: null, rebased }; // no-op
    const cas = compareAndSet(id, base.length, r.events);
    if (cas.ok) return { events: cas.events, error: null, rebased };
    rebased = true; // another tab appended between our read and write — re-validate against the tip
  }
  return { events: loadEvents(id), error: 'concurrent modification: retry limit reached', rebased };
}

export const listOrders = () => get(ORDERS) || [];
function index(id, events) {
  const list = get(ORDERS) || [];
  const i = list.findIndex((o) => o.id === id);
  const meta = { id, journeyId: (events[0] && events[0].journeyId) || null, seq: events.length };
  if (i < 0) list.push(meta); else list[i] = meta;
  set(ORDERS, list);
}
// remove a saved order (the app clearing its own draft): drop the event log +
// the index row, then notify. Not a hard-delete of user data elsewhere.
export function deleteOrder(id) {
  try { localStorage.removeItem(EVKEY(id)); } catch (_) { /* ignore */ }
  set(ORDERS, (get(ORDERS) || []).filter((o) => o.id !== id));
  notify();
}

// a URL-safe id; Math.random is fine in the browser (this module is browser-only).
export const newOrderId = (prefix) => `${prefix || 'ORD'}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

// cross-tab propagation: the `storage` event fires in OTHER tabs of this origin when
// our localStorage changes (never in the writer's own tab). When an order log (or the
// index) changes elsewhere, wake external subscribers so an open runner re-reads the
// fresh log and re-renders — the CAS above already guarantees no write was lost; this
// just keeps a second open tab visually in sync. Guarded for non-browser (tests/SSR).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (!e || !e.key) return;
    if (e.key.indexOf('qc:events:') === 0 || e.key === ORDERS) {
      externalSubs.forEach((f) => { try { f(e.key); } catch (_) { /* ignore */ } });
    }
  });
}
