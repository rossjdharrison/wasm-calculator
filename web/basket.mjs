// =============================================================================
// basket.mjs — a CROSS-COLLECTION basket, persisted in this browser under one key
// (not per-model), so a configured car and a configured antique sit in the same
// basket and survive navigation between configurators (?m=) and the landing.
// (Browser-local for now; a server-side basket would follow the KV/R2 path later.)
// Data + a self-contained view (openBasketModal) built on the ui.mjs primitives.
// =============================================================================
import { el, openModal, money, placeholderSVG } from './ui.mjs';

const KEY = 'qc:basket:v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
const subs = new Set();
const notify = () => { const items = read(); for (const fn of subs) { try { fn(items); } catch (_) { /* ignore */ } } };
const write = (items) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) { /* storage blocked */ } notify(); };

export const list = () => read();
export const count = () => read().length;
export const total = () => read().reduce((s, it) => s + (Number(it.total) || 0), 0);
// subscribe to changes (this tab's writes + other tabs via the storage event)
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) notify(); });

export function add(item) {
  const items = read();
  const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  items.push({ id, at: Date.now(), ...item });   // item: {modelId, collection, title, total, currency, image}
  write(items);
  return id;
}
export function remove(id) { write(read().filter((it) => it.id !== id)); }
export function clear() { write([]); }

// group the grand total by currency (collections could differ; today all GBP)
const totalsByCurrency = (items) => {
  const by = {};
  for (const it of items) { const c = it.currency || 'GBP'; by[c] = (by[c] || 0) + (Number(it.total) || 0); }
  return by;
};

// ---- the basket view (a dialog) ----
export function openBasketModal(root, { resolveImage = async () => null, inert } = {}) {
  const m = openModal({ root, inert, overlayClass: 'bk-overlay', modalClass: 'bk-modal', label: 'Your basket' });
  render();
  function render() {
    const items = list();
    m.modal.innerHTML = '';
    const hd = el('div', 'bk-hd', { html: `<div class="bk-title"><span class="bk-eyebrow">Rowblaa</span>Your basket</div>` });
    hd.appendChild(el('button', 'bd-x', { type: 'button', text: '✕', 'aria-label': 'Close basket', on: { click: () => m.close() } }));
    m.modal.appendChild(hd);

    if (!items.length) {
      m.modal.appendChild(el('div', 'bk-empty', { html: 'Your basket is empty.<br>Configure a piece and choose <b>Add to basket</b>.' }));
      m.modal.focus(); return;
    }

    const listEl = el('div', 'bk-list');
    for (const it of items) {
      const rowEl = el('div', 'bk-item');
      const media = el('div', 'bk-thumb', { html: placeholderSVG(it.title) });
      const info = el('div', 'bk-info', {
        html: `<div class="bk-item-title">${it.title}</div><div class="bk-item-sub">${it.collection || ''}</div>`,
      });
      const price = el('div', 'bk-item-price num', { text: money(it.total, it.currency || 'GBP') });
      const rm = el('button', 'bk-rm', { type: 'button', text: '✕', 'aria-label': `Remove ${it.title}`, on: { click: () => { remove(it.id); render(); } } });
      rowEl.append(media, info, price, rm);
      listEl.appendChild(rowEl);
      if (it.image) resolveImage(it.image).then((u) => { if (!u) return; const im = new Image(); im.onload = () => { media.innerHTML = ''; media.appendChild(im); }; im.className = ''; im.src = u; im.alt = ''; }).catch(() => {});
    }
    m.modal.appendChild(listEl);

    const foot = el('div', 'bk-foot');
    const by = totalsByCurrency(items);
    const cur = Object.keys(by);
    const grand = cur.length === 1
      ? `<span>Total</span><span class="num">${money(by[cur[0]], cur[0])}</span>`
      : `<span>Total</span><span class="num">${cur.map((c) => money(by[c], c)).join(' + ')}</span>`;
    foot.appendChild(el('div', 'bk-total', { html: grand }));
    const cta = el('button', 'bd-cta', { type: 'button', text: `Request all ${items.length} ${items.length === 1 ? 'item' : 'items'} ▸` });
    cta.addEventListener('click', () => { cta.disabled = true; cta.textContent = 'Enquiry submitted ✓'; clear(); setTimeout(() => m.close(), 1500); });
    foot.appendChild(cta);
    m.modal.appendChild(foot);
    m.modal.focus();
  }
  return m;
}
