// =============================================================================
// saved.mjs — named, saved CONFIGURATIONS, persisted cross-collection in this
// browser (one key for all models). Unlike the basket (things to enquire on), a
// saved build is a keepsake to revisit, re-open (restore into its configurator),
// compare against other saved builds, or drop into the basket. Each snapshot
// carries its full config (to re-open) + a specs snapshot (to compare) so the
// list/compare need no engine. Data + a view built on the ui.mjs primitives.
// =============================================================================
import { el, openModal, money, placeholderSVG } from './ui.mjs';

const KEY = 'qc:saved:v1';
const RKEY = 'qc:restore:v1';                 // transient hand-off for "open"
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
const subs = new Set();
const notify = () => { const items = read(); for (const fn of subs) { try { fn(items); } catch (_) { /* ignore */ } } };
const write = (items) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) { /* blocked */ } notify(); };

export const list = () => read();
export const count = () => read().length;
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) notify(); });

export function save(item) {
  const items = read();
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  items.push({ id, at: Date.now(), ...item });
  write(items);
  return id;
}
export function remove(id) { write(read().filter((it) => it.id !== id)); }
export function rename(id, name) { const items = read(); const it = items.find((x) => x.id === id); if (it) { it.name = name; write(items); } }
export function clear() { write([]); }

// "open" hand-off: stash the config, then the target configurator restores it on load
export function stashRestore(modelId, config) { try { localStorage.setItem(RKEY, JSON.stringify({ modelId, config })); } catch (_) { /* ignore */ } }
export function takeRestore(modelId) {
  try { const r = JSON.parse(localStorage.getItem(RKEY) || 'null'); if (r && r.modelId === modelId) { localStorage.removeItem(RKEY); return r.config; } } catch (_) { /* ignore */ }
  return null;
}

// ---- the saved-builds view (list + inline rename + open + compare + basket) ----
export function openSavedModal(root, { resolveImage = async () => null, inert, onAddToBasket } = {}) {
  const selected = new Set();
  const m = openModal({ root, inert, overlayClass: 'sv-overlay', modalClass: 'sv-modal', label: 'Saved builds' });
  render();
  function render() {
    const items = list();
    for (const s of [...selected]) if (!items.some((it) => it.id === s)) selected.delete(s);
    m.modal.innerHTML = '';
    const hd = el('div', 'bk-hd', { html: `<div class="bk-title"><span class="bk-eyebrow">Rowblaa</span>Saved builds</div>` });
    hd.appendChild(el('button', 'bd-x', { type: 'button', text: '✕', 'aria-label': 'Close', on: { click: () => m.close() } }));
    m.modal.appendChild(hd);
    if (!items.length) { m.modal.appendChild(el('div', 'bk-empty', { html: 'No saved builds yet.<br>Configure something and choose <b>Save build</b>.' })); m.modal.focus(); return; }

    const listEl = el('div', 'sv-list');
    for (const it of items) {
      const row = el('div', 'sv-item' + (selected.has(it.id) ? ' is-sel' : ''));
      const chk = el('input', 'sv-chk', { type: 'checkbox', 'aria-label': `Select ${it.name} to compare` }); chk.checked = selected.has(it.id);
      chk.addEventListener('change', () => { chk.checked ? selected.add(it.id) : selected.delete(it.id); render(); });
      const media = el('div', 'sv-thumb', { html: placeholderSVG(it.title) });
      const info = el('div', 'sv-info');
      const name = el('input', 'sv-name', { value: it.name || it.title, 'aria-label': 'Build name' });
      name.addEventListener('change', () => rename(it.id, name.value.trim() || it.title));
      info.append(name, el('div', 'sv-sub', { html: `${it.collection || ''} · <span class="num">${money(it.total, it.currency || 'GBP')}</span>` }));
      const open = el('button', 'sv-open', { type: 'button', text: 'Open ▸', on: { click: () => { stashRestore(it.modelId, it.config); location.href = `configure.html?m=${encodeURIComponent(it.modelId)}`; } } });
      const rm = el('button', 'bk-rm', { type: 'button', text: '✕', 'aria-label': `Delete ${it.name}`, on: { click: () => { remove(it.id); render(); } } });
      row.append(chk, media, info, open, rm);
      listEl.appendChild(row);
      if (it.image) resolveImage(it.image).then((u) => { if (!u) return; const im = new Image(); im.onload = () => { media.innerHTML = ''; media.appendChild(im); }; im.src = u; im.alt = ''; }).catch(() => {});
    }
    m.modal.appendChild(listEl);

    const foot = el('div', 'bk-foot');
    const chosen = items.filter((it) => selected.has(it.id));
    const cmp = el('button', 'bd-cta', { type: 'button', text: chosen.length >= 2 ? `Compare ${chosen.length} builds ▸` : 'Select 2+ to compare' });
    cmp.disabled = chosen.length < 2;
    cmp.addEventListener('click', () => renderCompare(chosen));
    foot.appendChild(cmp);
    m.modal.appendChild(foot);
    m.modal.focus();
  }

  // compare selected saved builds from their stored specs snapshots (no engine needed)
  function renderCompare(chosen) {
    m.modal.innerHTML = '';
    const hd = el('div', 'bk-hd', { html: `<div class="bk-title"><span class="bk-eyebrow">Rowblaa</span>Compare saved</div>` });
    hd.appendChild(el('button', 'bd-x', { type: 'button', text: '✕', 'aria-label': 'Close', on: { click: () => m.close() } }));
    m.modal.appendChild(hd);
    const back = el('button', 'sv-back', { type: 'button', text: '‹ Back to saved', on: { click: () => render() } });
    m.modal.appendChild(back);

    // union of spec rows (by label), preserving first-seen order + direction
    const rowDefs = [];
    for (const it of chosen) for (const s of (it.specs || [])) if (!rowDefs.some((r) => r.label === s.label)) rowDefs.push({ label: s.label, dir: s.dir });
    const wrap = el('div', 'cmp-scroll');
    const grid = el('div', 'cmp-grid'); grid.style.gridTemplateColumns = `96px repeat(${chosen.length}, minmax(110px, 1fr))`;
    const cell = (cls, html) => el('div', cls, html == null ? {} : { html });
    grid.appendChild(cell('cmp-lbl', ''));
    for (const it of chosen) grid.appendChild(cell('cmp-name', it.name || it.title));
    for (const def of rowDefs) {
      const vals = chosen.map((it) => (it.specs || []).find((s) => s.label === def.label));
      const nums = vals.filter(Boolean).map((s) => s.value);
      let best = null;
      if (def.dir && nums.length > 1) best = def.dir === 'low' ? Math.min(...nums) : Math.max(...nums);
      grid.appendChild(cell('cmp-lbl', def.label));
      vals.forEach((s) => grid.appendChild(cell('cmp-val' + (best != null && s && s.value === best ? ' is-best' : ''), s ? s.fmt : '—')));
    }
    wrap.appendChild(grid);
    m.modal.appendChild(wrap);
    m.modal.focus();
  }
  return m;
}
