// =============================================================================
// order-store.mjs — browser persistence for the event-sourced order, mirroring
// basket.mjs. The append-only event log lives at qc:events:<orderId>:v1; a small
// index of orders at qc:orders:v1. Resume = load the log and fold it.
// =============================================================================
const EVKEY = (id) => `qc:events:${id}:v1`;
const ORDERS = 'qc:orders:v1';
const get = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };

const subs = new Set();
const notify = () => subs.forEach((f) => { try { f(); } catch (_) { /* ignore */ } });
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export const loadEvents = (id) => get(EVKEY(id)) || [];
export function saveEvents(id, events) { set(EVKEY(id), events); index(id, events); notify(); }
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
