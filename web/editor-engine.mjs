// =============================================================================
// editor-engine.mjs — a generic, schema-driven editor (Phase B).
//
// Given an editor SCHEMA (dev-owned, describes a document's collections and each
// item's form) + a document + a widget registry, it renders the master-detail
// outline & detail. Both design pages are produced by this one engine, so the
// editor UI is itself data-driven (changing a schema changes a page).
//
// Schema shape:
//   { collections: [ {
//       key, kind:'array'|'map', title, singular, itemLabel, itemLabelPrefix?,
//       sub?,                         // property shown under the header
//       removable?:true,
//       add: { prompt?, into?, template },
//       form: [ { prop, label, widget, when?:{prop,eq}, ...widgetOpts } ]
//   } ] }
// Widgets receive an `api` and return an element the engine appends. See WIDGETS.
// =============================================================================
import { el, row, textRow, numRow, checkRow, selectRow, hint, exprRow, addBtn, makeRuleUI } from './editor-ui.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

export function createEditor({ schema, doc, outline, detail, ctx, onChange }) {
  const rules = makeRuleUI(ctx.fields || (() => []));
  let sel = { c: 0, i: 0 };
  const notify = () => { if (onChange) onChange(); };

  const cols = () => schema.collections;
  const col = () => cols()[sel.c];
  function itemsOf(c) {
    if (c.kind === 'map') { doc[c.key] = doc[c.key] || {}; return Object.keys(doc[c.key]); }
    doc[c.key] = doc[c.key] || []; return doc[c.key];
  }
  function itemAt(c, i) { return c.kind === 'map' ? doc[c.key][itemsOf(c)[i]] : itemsOf(c)[i]; }
  function labelOf(c, i) {
    if (c.kind === 'map') return itemsOf(c)[i];
    const it = itemsOf(c)[i];
    return (c.itemLabelPrefix || '') + (it[c.itemLabel] ?? `#${i}`);
  }

  // ---- outline ----
  function renderOutline() {
    outline.innerHTML = '';
    cols().forEach((c, ci) => {
      const sec = el('div', 'de-group');
      const head = el('div', 'de-group__head');
      const h = el('span'); h.textContent = c.title; head.appendChild(h);
      if (c.add) head.appendChild(addBtn('+ add', () => addItem(ci)));
      sec.appendChild(head);
      itemsOf(c).forEach((_, i) => {
        const b = el('button', 'de-item'); b.type = 'button'; b.textContent = labelOf(c, i);
        if (sel.c === ci && sel.i === i) b.classList.add('is-active');
        b.addEventListener('click', () => { sel = { c: ci, i }; renderOutline(); renderDetail(); notify(); });
        sec.appendChild(b);
      });
      outline.appendChild(sec);
    });
  }

  // ---- detail ----
  function renderDetail() {
    detail.innerHTML = '';
    const c = col(); const list = itemsOf(c);
    if (!list.length) { detail.appendChild(hint('Nothing here yet — add one on the left.')); return; }
    if (sel.i >= list.length) sel.i = list.length - 1;
    const item = itemAt(c, sel.i);

    // header
    const head = el('div', 'de-title'); const left = el('div');
    const t = el('h3'); t.textContent = `${c.singular || c.title}: ${labelOf(c, sel.i)}`; left.appendChild(t);
    if (c.sub && item[c.sub] !== undefined) { const s = el('div', 'de-title__sub'); s.textContent = `${c.sub}: ${item[c.sub]}`; left.appendChild(s); }
    head.appendChild(left);
    if (c.removable !== false && c.add) { const b = el('button', 'qc-btn-link'); b.type = 'button'; b.textContent = 'Remove'; b.addEventListener('click', () => removeItem()); head.appendChild(b); }
    detail.appendChild(head);

    // form fields
    for (const spec of c.form || []) {
      if (spec.when && item[spec.when.prop] !== spec.when.eq) continue;
      const api = makeApi(c, item, spec);
      const w = WIDGETS[spec.widget];
      if (w) detail.appendChild(w(api));
    }
  }

  function makeApi(c, item, spec) {
    const get = () => item[spec.prop];
    const set = (v) => {
      if (v === undefined || (v === '' && spec.clearEmpty !== false)) delete item[spec.prop];
      else item[spec.prop] = v;
      if (spec.prop === c.itemLabel) renderOutline();
      notify();
    };
    return { spec, item, label: spec.label, get, set, ctx, rules, onChange: notify, rerenderDetail: renderDetail };
  }

  // ---- add / remove ----
  function addItem(ci) {
    const c = cols()[ci];
    const tpl = clone(c.add.template || {});
    if (c.kind === 'map') {
      const name = prompt(c.add.prompt || 'Name:'); if (!name) return;
      doc[c.key] = doc[c.key] || {}; doc[c.key][name] = tpl;
      sel = { c: ci, i: Object.keys(doc[c.key]).length - 1 };
    } else {
      if (c.add.prompt) { const v = prompt(c.add.prompt); if (!v) return; if (c.add.into) tpl[c.add.into] = v; }
      doc[c.key] = doc[c.key] || []; doc[c.key].push(tpl);
      sel = { c: ci, i: doc[c.key].length - 1 };
    }
    renderOutline(); renderDetail(); notify();
  }
  function removeItem() {
    if (!confirm('Remove this item?')) return;
    const c = col();
    if (c.kind === 'map') delete doc[c.key][itemsOf(c)[sel.i]];
    else doc[c.key].splice(sel.i, 1);
    sel.i = Math.max(0, sel.i - 1);
    renderOutline(); renderDetail(); notify();
  }

  // ---- public ----
  function selectedId() {
    const c = col(); const list = itemsOf(c); if (!list.length) return null;
    if (c.kind === 'map') return list[sel.i];
    const it = itemAt(c, sel.i); return it[c.itemLabel] ?? null;
  }
  function selectById(id) {
    cols().forEach((c, ci) => {
      if (c.kind === 'map') { const i = itemsOf(c).indexOf(id); if (i >= 0) sel = { c: ci, i }; }
      else { const i = itemsOf(c).findIndex((it) => it[c.itemLabel] === id); if (i >= 0) sel = { c: ci, i }; }
    });
    renderOutline(); renderDetail(); notify();
  }

  renderOutline(); renderDetail();
  return { renderOutline, renderDetail, selectedId, selectById };
}

// ---- widget registry (dev-built palette; schema wires widget→construct) -----
const WIDGETS = {
  text: (a) => textRow(a.label, a.get() ?? '', (v) => a.set(v)),
  number: (a) => numRow(a.label, a.get(), (v) => a.set(v)),
  toggle: (a) => checkRow(a.label, a.get(), (v) => a.set(v || undefined)),
  formula: (a) => exprRow(a.label, a.get, (ast) => a.set(ast), { multiline: a.spec.multiline, required: a.spec.required }),
  rule: (a) => a.rules.ruleRow(a.label, a.get, (ast) => a.set(ast)),
  select: (a) => {
    const opts = a.spec.options || (a.spec.source ? (a.ctx.sources?.[a.spec.source]?.() || []) : []);
    const list = a.spec.allowNone ? ['(none)', ...opts] : opts;
    let cur = a.get();
    if ((cur === undefined || cur === '') && !a.spec.allowNone && opts.length) { cur = opts[0]; a.set(cur); }
    if (cur === undefined) cur = a.spec.allowNone ? '(none)' : opts[0];
    return selectRow(a.label, list, cur, (v) => a.set(v === '(none)' ? undefined : v));
  },
  default: (a) => defaultWidget(a),
  optionList: (a) => optionListWidget(a),
  grid: (a) => gridWidget(a),
};

function defaultWidget(a) {
  const f = a.item;
  if (f.type === 'choice') return selectRow('Default', (f.options || []).map((o) => o.id), f.default ?? f.options?.[0]?.id, (v) => a.set(v));
  if (f.type === 'boolean') { const c = el('input'); c.type = 'checkbox'; c.setAttribute('aria-label', 'Default'); c.checked = !!f.default; c.addEventListener('change', () => a.set(c.checked)); return row('Default', c); }
  if (f.type === 'multichoice') return row('Default', hint('empty by default'));
  const i = el('input', 'qc-input'); i.type = 'number'; i.setAttribute('aria-label', 'Default'); i.value = f.default ?? '';
  i.addEventListener('input', () => a.set(i.value === '' ? undefined : Number(i.value)));
  return row('Default', i);
}

function optionListWidget(a) {
  const f = a.item;
  const box = el('div', 'de-sub');
  const render = () => {
    box.innerHTML = '';
    const bh = el('div', 'de-sub__head'); bh.textContent = 'Options (availability)';
    bh.appendChild(addBtn('+ option', () => { const id = prompt('New option id:'); if (id) { (f.options ||= []).push({ id }); render(); a.onChange(); } }));
    box.appendChild(bh);
    box.appendChild(hint('Labels & prices for options live on the Presentation page.'));
    (f.options || []).forEach((o, oi) => {
      const r = el('div', 'de-opt');
      const hdr = el('div', 'de-opt__hdr');
      const name = el('code', 'de-opt__id'); name.textContent = o.id; hdr.appendChild(name);
      const lbl = el('span', 'de-hint'); lbl.textContent = 'available when'; hdr.appendChild(lbl);
      const del = el('button', 'qc-btn-link'); del.type = 'button'; del.textContent = 'remove';
      del.addEventListener('click', () => { f.options.splice(oi, 1); render(); a.onChange(); });
      hdr.appendChild(del); r.appendChild(hdr);
      r.appendChild(a.rules.ruleBlock(() => o.availableWhen, (ast) => { if (ast === undefined) delete o.availableWhen; else o.availableWhen = ast; a.onChange(); }));
      box.appendChild(r);
    });
  };
  render();
  return box;
}

function gridWidget(a) {
  const def = a.item; // table object { kind, map | rows }
  const wrap = el('div');
  if (def.kind === '1d') {
    const grid = el('div', 'de-grid de-grid--1d');
    for (const [k, v] of Object.entries(def.map || {})) {
      grid.appendChild(cellLabel(k));
      grid.appendChild(numCell(v, (n) => { def.map[k] = n; a.onChange(); }));
    }
    wrap.appendChild(grid);
  } else if (def.kind === '2d') {
    const rows = Object.keys(def.rows || {});
    const colsK = Object.keys(def.rows[rows[0]] || {});
    const grid = el('div', 'de-grid'); grid.style.gridTemplateColumns = `auto repeat(${colsK.length}, 1fr)`;
    grid.appendChild(cellLabel(''));
    colsK.forEach((c) => grid.appendChild(cellLabel(c)));
    rows.forEach((r) => {
      grid.appendChild(cellLabel(r));
      colsK.forEach((c) => grid.appendChild(numCell(def.rows[r][c], (n) => { def.rows[r][c] = n; a.onChange(); })));
    });
    wrap.appendChild(grid);
  }
  return wrap;
}
function numCell(v, onChange) { const i = el('input', 'qc-input de-cell'); i.type = 'number'; i.setAttribute('aria-label', 'value'); i.value = v; i.addEventListener('input', () => onChange(Number(i.value))); return i; }
function cellLabel(t) { const d = el('div', 'de-cell-label'); d.textContent = t; return d; }
