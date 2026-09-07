// =============================================================================
// order-picker.mjs — a small neutral chooser shown when a journey has saved
// orders and the URL names none: resume one, start a fresh order, or delete a
// draft. Domain-agnostic — it renders order ids + progress (seq) + a phase label
// from the phase list passed in by the caller, never a sale-specific string. Molecule in
// the shell tier (not hoisted into ui.mjs).
// =============================================================================
import { el } from './ui.mjs';
import { fold } from './order.mjs';
import { loadEvents } from './order-store.mjs';

export function mountOrderPicker(root, { journeyName, orders, onResume, onStartNew, onDelete, onReprice, phases, verdicts }) {
  const phaseLabel = (id) => ((phases || []).find((p) => p.id === id) || {}).label || (id || 'not started');
  root.innerHTML = '';
  const wrap = el('div', 'order-picker');
  wrap.appendChild(el('h2', 'op-h', { text: journeyName || 'Your orders' }));
  wrap.appendChild(el('p', 'op-sub', { text: 'Resume a saved order, or start a new one.' }));
  const list = el('div', 'op-list');
  for (const o of orders) {
    const row = el('div', 'op-row');
    let phase = null; try { phase = fold(loadEvents(o.id)).phase; } catch (_) { /* ignore */ }
    // an offer that no longer holds against the current models is badged + relabelled: the
    // saved build stays viewable (View), and a Re-price action starts a fresh order.
    const expired = !!(verdicts && verdicts[o.id] && verdicts[o.id].status === 'expired');
    if (expired) row.classList.add('op-expired');
    const badge = expired ? ' <span class="op-badge">Offer expired</span>' : '';
    row.appendChild(el('div', 'op-meta', { html: `<b>${o.id}</b><span>${phaseLabel(phase)} · ${o.seq || 0} steps${badge}</span>` }));
    const resume = el('button', 'op-btn', { type: 'button', text: expired ? 'View ▸' : 'Resume ▸' });
    resume.addEventListener('click', () => onResume(o.id));
    row.appendChild(resume);
    if (expired && onReprice) {
      const rep = el('button', 'op-btn', { type: 'button', text: 'Re-price ▸' });
      rep.addEventListener('click', () => onReprice(o.id));
      row.appendChild(rep);
    }
    const del = el('button', 'op-del', { type: 'button', text: '✕', title: 'Delete this order' });
    del.addEventListener('click', () => { if (confirm(`Delete order ${o.id}?`)) onDelete(o.id); });
    row.appendChild(del); list.appendChild(row);
  }
  wrap.appendChild(list);
  const fresh = el('button', 'op-new', { type: 'button', text: 'Start a new order ▸' });
  fresh.addEventListener('click', () => onStartNew());
  wrap.appendChild(fresh);
  root.appendChild(wrap);
}
