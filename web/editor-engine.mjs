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
import { el, row, textRow, numRow, checkRow, selectRow, hint, exprRow, makeRuleUI, outlineGroup, detailTitle } from './editor-ui.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- pure dot-path helpers (exported for tests) ----------------------------
// A form spec may target a nested path ('format.type', 'brand.mark') instead of
// a flat prop; setPath auto-vivifies parent objects, delPath prunes the leaf.
export function getPath(base, path) {
  if (base == null) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), base);
}
export function setPath(base, path, v) {
  const keys = path.split('.'); const last = keys.pop();
  let o = base;
  for (const k of keys) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[last] = v;
}
export function delPath(base, path) {
  const keys = path.split('.'); const last = keys.pop();
  let o = base;
  for (const k of keys) { if (o[k] == null) return; o = o[k]; }
  delete o[last];
}

// createEditor — a generic master-detail engine. All hooks below default to the
// original single-doc array/map behaviour (data-editor.js is untouched); the
// additive capabilities (singleton + cross-doc collections, dot-path/root
// targets, source-aware visibility & selects, kind-scoped select/onSelect,
// seeded add) exist so presentation-editor can run fully on this one engine.
export function createEditor({ schema, doc, outline, detail, ctx = {}, onChange, onSelect, onItemAdded }) {
  const rules = makeRuleUI(ctx.fields || (() => []));
  let sel = { c: 0, i: 0 };
  let adding = null;   // { ci } while an inline "add" input is open for a collection
  const notify = (info) => { if (onChange) onChange(info); };
  const emitSelect = () => { if (onSelect) onSelect(col().key, selectedId()); };

  const cols = () => schema.collections;
  const col = () => cols()[sel.c];
  const idKey = (c) => c.itemId || c.itemLabel || 'id';
  // a cross-doc collection lists items from a read-only companion (ctx.docs) but
  // writes to doc[c.editIn], lazily linking the two by id.
  const docList = (c) => (ctx.docs && ctx.docs[c.docSource] ? (ctx.docs[c.docSource]() || []) : []);

  // the list the OUTLINE shows (for identity + labels)
  function itemsOf(c) {
    if (c.kind === 'singleton') return [c];
    if (c.docSource) return docList(c);
    if (c.kind === 'map') { doc[c.key] = doc[c.key] || {}; return Object.keys(doc[c.key]); }
    doc[c.key] = doc[c.key] || []; return doc[c.key];
  }
  // the read-only SOURCE record behind row i (cross-doc only; else null)
  function sourceAt(c, i) { return c.docSource ? docList(c)[i] : null; }
  // the object the FORM writes to for row i (ensuring a cross-doc edit record)
  function editAt(c, i) {
    if (c.kind === 'singleton') return doc;                 // settings edits the doc root
    if (c.docSource) {
      const src = docList(c)[i]; if (!src) return {};
      const link = c.linkBy || 'id'; const id = src[link];
      doc[c.editIn] = doc[c.editIn] || [];
      let rec = doc[c.editIn].find((r) => r[link] === id);
      if (!rec) { rec = { [link]: id }; doc[c.editIn].push(rec); }   // lazy, mirrors ensurePresField
      return rec;
    }
    if (c.kind === 'map') return doc[c.key][itemsOf(c)[i]];
    return doc[c.key][i];
  }
  // outline label — reads only the source for cross-doc (never ensures a record)
  function labelOf(c, i) {
    if (c.kind === 'singleton') return c.itemLabel || c.singular || c.title;
    if (c.kind === 'map') return itemsOf(c)[i];
    const src = sourceAt(c, i);
    const rec = c.docSource ? null : doc[c.key][i];
    const from = c.labelFrom === 'source' ? src : rec;
    const lab = from ? from[c.itemLabel] : undefined;
    if (lab != null && lab !== '') return (c.itemLabelPrefix || '') + lab;
    const idv = (rec && rec[idKey(c)]) ?? (src && src[idKey(c)]);
    return (c.itemLabelPrefix || '') + (idv ?? `#${i}`);
  }

  // ---- outline ----
  function renderOutline() {
    outline.innerHTML = '';
    cols().forEach((c, ci) => {
      const group = outlineGroup({
        title: c.title,
        items: itemsOf(c).map((_, i) => labelOf(c, i)),
        activeIndex: sel.c === ci ? sel.i : -1,
        onPick: (i) => { sel = { c: ci, i }; renderOutline(); renderDetail(); notify({ reason: 'select' }); emitSelect(); },
        onAdd: (c.add && c.kind !== 'singleton' && !c.docSource) ? () => addItem(ci) : null,
      });
      if (adding && adding.ci === ci) group.appendChild(inlineAddRow(c, ci));
      outline.appendChild(group);
    });
  }

  // a collection whose "add" must capture an id (a map key, or an array item's
  // itemLabel via add.into) — these get the inline validated input below instead of a
  // native prompt. Seeded/plain-template adds (validations/effects) capture no id.
  const needsIdInput = (c) => !!(c.add && !c.add.seed && (c.kind === 'map' || (c.kind === 'array' && typeof c.add.into === 'string' && c.add.into)));

  // the inline id input rendered under a group while adding — validates syntax +
  // uniqueness live (mirrors the option-list add), then creates + selects the item.
  // Replaces window.prompt, which is unsupported in some embedded browsers.
  function inlineAddRow(c, ci) {
    const wrap = el('div', 'de-inlineadd');
    const line = el('div', 'de-optadd');
    const input = el('input', 'qc-input de-optadd__in', { placeholder: c.add.prompt || 'new id…', 'aria-label': c.add.prompt || 'New id' });
    const btn = el('button', 'de-optadd__btn', { type: 'button', text: 'Add' }); btn.disabled = true;
    const err = el('div', 'de-optadd__err', { 'aria-live': 'polite' }); err.hidden = true;
    const existing = () => (c.kind === 'map' ? Object.keys(doc[c.key] || {}) : (doc[c.key] || []).map((it) => it && it[c.add.into]));
    const check = () => {
      const v = input.value.trim(); let msg = '';
      if (v && !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) msg = 'Letters, numbers & underscore — start with a letter.';
      else if (v && existing().includes(v)) msg = `"${v}" already exists.`;
      err.textContent = msg; err.hidden = !msg; input.classList.toggle('is-invalid', !!msg);
      btn.disabled = !v || !!msg; return !btn.disabled;
    };
    const commit = () => {
      if (!check()) return;
      const id = input.value.trim();
      if (c.kind === 'map') { doc[c.key] = doc[c.key] || {}; doc[c.key][id] = clone(c.add.template || {}); }
      else { const tpl = clone(c.add.template || {}); tpl[c.add.into] = id; doc[c.key] = doc[c.key] || []; doc[c.key].push(tpl); }
      adding = null;
      sel = { c: ci, i: (c.kind === 'map' ? Object.keys(doc[c.key]).length : doc[c.key].length) - 1 };
      if (onItemAdded) onItemAdded(c.key, id);   // let the page seed a counterpart (e.g. a presentation field/output)
      renderOutline(); renderDetail(); notify({ reason: 'edit' }); emitSelect();
    };
    const cancel = () => { adding = null; renderOutline(); };
    input.addEventListener('input', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
    btn.addEventListener('click', commit);
    line.append(input, btn); wrap.append(line, err);
    return wrap;
  }

  // ---- detail ----
  function renderDetail() {
    detail.innerHTML = '';
    const c = col(); const list = itemsOf(c);
    if (!list.length) { detail.appendChild(hint('Nothing here yet — add one on the left.')); return; }
    if (sel.i >= list.length) sel.i = list.length - 1;
    const item = editAt(c, sel.i);
    const source = sourceAt(c, sel.i);

    detail.appendChild(detailTitle(titleOf(c, sel.i), {
      sub: subOf(c, item, source),
      onRemove: (c.removable !== false && c.add && c.kind !== 'singleton' && !c.docSource) ? () => removeItem() : undefined,
    }));

    // form fields
    for (const spec of c.form || []) {
      if (spec.when && !whenVisible(spec.when, item, source)) continue;
      const api = makeApi(c, item, source, spec);
      const w = WIDGETS[spec.widget];
      if (w) detail.appendChild(w(api));
    }
  }

  function titleOf(c, i) {
    if (c.titleText) return c.titleText;                    // literal (settings)
    return `${c.singular || c.title}: ${labelOf(c, i)}`;    // same identity the original used
  }
  function subOf(c, item, source) {
    if (!c.sub) return undefined;                            // c.sub names the property
    const bag = c.subFrom === 'source' ? source : item;
    const v = bag ? bag[c.sub] : undefined;
    return v === undefined ? undefined : `${c.sub}: ${v}`;
  }
  // visibility: read item (default) or the read-only source; test eq or existence
  function whenVisible(when, item, source) {
    const bag = when.from === 'source' ? source : item;
    const v = when.path ? getPath(bag, when.path) : (bag ? bag[when.prop] : undefined);
    if ('exists' in when) return (v !== undefined && v !== null) === when.exists;
    return v === when.eq;
  }

  function makeApi(c, item, source, spec) {
    const base = spec.target === 'root' ? doc : item;       // 'root' = the doc itself (settings)
    const get = () => (spec.path ? getPath(base, spec.path) : base[spec.prop]);
    const set = (v) => {
      const clear = (v === undefined || (v === '' && spec.clearEmpty !== false));
      if (spec.path) { if (clear) delPath(base, spec.path); else setPath(base, spec.path, v); }
      else if (clear) delete base[spec.prop]; else base[spec.prop] = v;
      if (spec.prop === c.itemLabel || spec.rerenderOutline) renderOutline();
      if (spec.rerender) renderDetail();
      notify({ reason: 'edit' });
    };
    return { spec, item, source, base, label: spec.label, get, set, ctx, rules, onChange: () => notify({ reason: 'edit' }), rerenderDetail: renderDetail };
  }

  // ---- add / remove ----
  function addItem(ci) {
    const c = cols()[ci];
    if (c.kind === 'singleton' || c.docSource || !c.add) return;
    if (c.add.seed) {                                        // dynamic template via ctx.seeds (returns null to cancel)
      const seed = ctx.seeds && ctx.seeds[c.add.seed];
      const tpl = seed ? seed() : null;
      if (!tpl) return;
      doc[c.key] = doc[c.key] || []; doc[c.key].push(tpl);
      sel = { c: ci, i: doc[c.key].length - 1 };
    } else if (needsIdInput(c)) {                            // capture the id via the inline validated input (no prompt)
      adding = { ci };
      renderOutline();
      const inp = outline.querySelector('.de-inlineadd .de-optadd__in'); if (inp) inp.focus();
      return;
    } else {                                                 // a plain template add (id-less: validations/effects)
      doc[c.key] = doc[c.key] || []; doc[c.key].push(clone(c.add.template || {}));
      sel = { c: ci, i: doc[c.key].length - 1 };
    }
    renderOutline(); renderDetail(); notify({ reason: 'edit' }); emitSelect();
  }
  function removeItem() {
    if (!confirm('Remove this item?')) return;
    const c = col();
    if (c.kind === 'singleton' || c.docSource) return;
    if (c.kind === 'map') delete doc[c.key][itemsOf(c)[sel.i]];
    else doc[c.key].splice(sel.i, 1);
    sel.i = Math.max(0, sel.i - 1);
    renderOutline(); renderDetail(); notify({ reason: 'edit' }); emitSelect();
  }

  // ---- public ----
  function selectedId() {
    const c = col();
    if (c.kind === 'singleton') return null;
    const list = itemsOf(c); if (!list.length) return null;
    if (c.kind === 'map') return list[sel.i];
    const bag = c.docSource ? sourceAt(c, sel.i) : list[sel.i];
    return bag ? (bag[idKey(c)] ?? null) : null;
  }
  // legacy scan-all selection (the dependency graph relies on it)
  function selectById(id) {
    cols().forEach((c, ci) => {
      if (c.kind === 'singleton') return;
      if (c.docSource) { const i = docList(c).findIndex((s) => s[idKey(c)] === id); if (i >= 0) sel = { c: ci, i }; }
      else if (c.kind === 'map') { const i = itemsOf(c).indexOf(id); if (i >= 0) sel = { c: ci, i }; }
      else { const i = itemsOf(c).findIndex((it) => it[idKey(c)] === id); if (i >= 0) sel = { c: ci, i }; }
    });
    renderOutline(); renderDetail(); notify({ reason: 'select' }); emitSelect();
  }
  // kind-scoped selection (used by the WYSIWYG two-way link — no cross-group id clash)
  function select(key, id) {
    const ci = cols().findIndex((c) => c.key === key); if (ci < 0) return;
    const c = cols()[ci]; let i = -1;
    if (c.kind === 'singleton') i = 0;
    else if (c.docSource) i = docList(c).findIndex((s) => s[idKey(c)] === id);
    else if (c.kind === 'map') i = itemsOf(c).indexOf(id);
    else i = itemsOf(c).findIndex((it) => it[idKey(c)] === id);
    if (i < 0) return;
    sel = { c: ci, i }; renderOutline(); renderDetail(); notify({ reason: 'select' }); emitSelect();
  }
  const commit = () => { renderOutline(); renderDetail(); notify({ reason: 'edit' }); };
  const add = (key) => { const ci = cols().findIndex((c) => c.key === key); if (ci >= 0) addItem(ci); };

  renderOutline(); renderDetail(); emitSelect();
  return { renderOutline, renderDetail, selectedId, selectById, select, commit, add, selected: () => ({ key: col().key, id: selectedId() }) };
}

// ---- widget registry (dev-built palette; schema wires widget→construct) -----
const WIDGETS = {
  text: (a) => textRow(a.label, a.get() ?? '', (v) => a.set(v)),
  number: (a) => numRow(a.label, a.get(), (v) => a.set(v)),
  // toggle: spec.default sets the unchecked-when-absent baseline; spec.explicit
  // writes the boolean literally (true AND false) instead of deleting on false —
  // needed for flags whose consumer distinguishes `=== false` from absent.
  toggle: (a) => {
    const raw = a.get();
    const checked = raw === undefined ? (a.spec.default === true) : !!raw;
    return checkRow(a.label, checked, (v) => a.set(a.spec.explicit ? v : (v || undefined)));
  },
  formula: (a) => exprRow(a.label, a.get, (ast) => a.set(ast), { multiline: a.spec.multiline, required: a.spec.required }),
  rule: (a) => a.rules.ruleRow(a.label, a.get, (ast) => a.set(ast)),
  select: (a) => {
    // source functions receive (item, source) so options can depend on the row
    // (e.g. controls-for-type reads the cross-doc source field's type).
    const opts = a.spec.options || (a.spec.source ? (a.ctx.sources?.[a.spec.source]?.(a.item, a.source) || []) : []);
    const list = a.spec.allowNone ? ['(none)', ...opts] : opts;
    let cur = a.get();
    if ((cur === undefined || cur === '') && !a.spec.allowNone && opts.length) {
      cur = opts[0];
      if (!a.spec.noAutoSelect) a.set(cur);   // noAutoSelect = show a default without writing it (parity with a plain <select>)
    }
    if (cur === undefined) cur = a.spec.allowNone ? '(none)' : opts[0];
    return selectRow(a.label, list, cur, (v) => a.set(v === '(none)' ? undefined : v));
  },
  default: (a) => defaultWidget(a),
  // parents — a class's `specializes` edge. v1 single parent (a chain), stored as a
  // one-element array so the DAG shape is preserved for later multi-inheritance. Picks
  // from a source (neutral leaves ∪ the model's own classes).
  parents: (a) => {
    const opts = a.spec.options || (a.spec.source ? (a.ctx.sources?.[a.spec.source]?.(a.item, a.source) || []) : []);
    const list = ['(none)', ...opts];
    const arr = a.base[a.spec.prop];
    const cur = (Array.isArray(arr) && arr[0]) || '(none)';
    return selectRow(a.label, list, cur, (v) => {
      if (v === '(none)') delete a.base[a.spec.prop]; else a.base[a.spec.prop] = [v];
      a.onChange();
    });
  },
  // typePick — the in-studio TYPE SPINE. A GENERIC widget that delegates to ctx:
  // ctx.typeSpine() supplies { category, choices:[{id,glyph,label,hint}], ancestry }
  // and ctx.setType(id) performs the model-specific write (keep/mint a unique own leaf
  // specialising the chosen category, repoint configures). The engine holds no model
  // knowledge; the page (data-editor) provides the hooks. Absent hooks → a hint.
  typePick: (a) => typePickWidget(a),
  optionList: (a) => optionListWidget(a),
  optionRows: (a) => optionRowsWidget(a),
  note: (a) => hint(a.spec.text || ''),
  grid: (a) => gridWidget(a),
};

// The canonical set of widget names the engine can render (derived from the real
// registry above). The conformance test asserts this equals WIDGET_CONTRACTS's
// keys, so the two can never drift: add a widget above and the test fails until
// you give it a contract.
export const WIDGET_TYPES = Object.keys(WIDGETS);

// Per-widget CONTRACT — the single source of truth the schema validator
// (schema-check.mjs) checks against, co-located with WIDGETS so a new widget must
// declare one. Fields:
//   needsProp  : the widget reads/writes item[spec.prop], so `prop` is required
//                (default is listed true — it renders from the item but still
//                 WRITES back through spec.prop).
//   oneOf      : at least one of these spec keys must be present.
//   boolFlags  : spec keys that, if present, must be boolean.
//   needsFields: uses the rule-builder, so ctx.fields must yield ≥1 field.
//   item       : the doc item-shape this widget imposes, checked by
//                validateDocAgainstSchema ('fieldType' | 'optionList' | 'table').
export const WIDGET_CONTRACTS = {
  text: { needsProp: true },
  number: { needsProp: true },
  toggle: { needsProp: true },
  formula: { needsProp: true, boolFlags: ['multiline', 'required'] },
  rule: { needsProp: true, needsFields: true },
  select: { needsProp: true, oneOf: ['options', 'source'], boolFlags: ['allowNone'] },
  parents: { needsProp: true, oneOf: ['options', 'source'] },
  typePick: { needsProp: false },   // writes via ctx.setType, not a single spec.prop
  default: { needsProp: true, item: 'fieldType' },
  optionList: { needsProp: false, needsFields: true, item: 'optionList' },
  optionRows: { needsProp: false, needsAssets: true },
  note: { needsProp: false },
  grid: { needsProp: false, item: 'table' },
};

function typePickWidget(a) {
  const spine = a.ctx.typeSpine ? a.ctx.typeSpine() : null;
  if (!spine) return hint('Type picker unavailable on this page.');
  const wrap = el('div', 'de-typepick');
  const sel = el('select', 'qc-input');
  sel.setAttribute('aria-label', a.label || 'Type');
  for (const c of spine.choices || []) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = `${c.glyph || '◈'}  ${c.label}`; o.title = c.hint || '';
    if (c.id === spine.category) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { if (a.ctx.setType) a.ctx.setType(sel.value); });
  wrap.appendChild(row(a.label || 'This model is a…', sel));
  if (spine.ancestry && spine.ancestry.length) {
    const bc = el('div', 'de-typespine');
    bc.style.cssText = 'font-size:12px;color:var(--text-dim);margin-top:6px;';
    bc.textContent = spine.ancestry.map((x) => `${x.glyph ? x.glyph + ' ' : ''}${x.label}`).join('  ›  ');
    wrap.appendChild(bc);
  }
  return wrap;
}

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
    const bh = el('div', 'de-sub__head'); bh.textContent = 'Options';
    box.appendChild(bh);
    box.appendChild(hint('Labels, prices & images for options live on the Presentation page.'));
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
    // inline, immediately-validated add (replaces window.prompt)
    const addWrap = el('div', 'de-optadd');
    const input = el('input', 'qc-input de-optadd__in'); input.placeholder = 'add an option id…'; input.setAttribute('aria-label', 'New option id');
    const btn = el('button', 'de-optadd__btn'); btn.type = 'button'; btn.textContent = 'Add'; btn.disabled = true;
    const err = el('div', 'de-optadd__err'); err.setAttribute('aria-live', 'polite'); err.hidden = true;
    const check = () => {
      const v = input.value.trim();
      let msg = '';
      if (v && !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) msg = 'Letters, numbers & underscore — start with a letter.';
      else if (v && (f.options || []).some((o) => o.id === v)) msg = `"${v}" already exists.`;
      err.textContent = msg; err.hidden = !msg;
      input.classList.toggle('is-invalid', !!msg);
      btn.disabled = !v || !!msg;
      return !btn.disabled;
    };
    const commit = () => {
      if (!check()) return;
      (f.options ||= []).push({ id: input.value.trim() });
      a.onChange();
      render();
      const ni = box.querySelector('.de-optadd__in'); if (ni) ni.focus();
    };
    input.addEventListener('input', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    btn.addEventListener('click', commit);
    addWrap.append(input, btn);
    box.append(addWrap, err);
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

// optionRows — the presentation sub-table: one row per SOURCE option (a.source
// is the read-only data field), editing label + priceDelta + image on the linked
// pres record (a.item). Owns its own DOM and edits in place via a.onChange (never
// a full renderDetail) so keystrokes don't thrash. Needs ctx.assets {pick,resolve}.
function optionRowsWidget(a) {
  const f = a.source;                                   // data field (option id source)
  const pf = a.item;                                    // pres field record (edit target)
  const box = el('div', 'de-sub');
  if (!f || !Array.isArray(f.options)) return box;
  box.appendChild(el('div', 'de-sub__head', { text: 'Option labels, prices & images' }));
  const ensureOpt = (oid) => { pf.options = pf.options || []; let o = pf.options.find((x) => x.id === oid); if (!o) { o = { id: oid }; pf.options.push(o); } return o; };
  for (const o of f.options) {
    const po = ensureOpt(o.id);
    const r = el('div', 'de-opt-row');
    r.appendChild(el('code', 'de-opt__id', { text: o.id }));
    const li = el('input', 'qc-input', { placeholder: 'label', 'aria-label': `${o.id} label`, value: po.label || '' });
    li.addEventListener('input', () => { if (li.value === '') delete po.label; else po.label = li.value; a.onChange(); });
    r.appendChild(li);
    const pd = el('input', 'qc-input de-price', { type: 'number', placeholder: 'price', 'aria-label': `${o.id} price delta` });
    pd.value = po.priceDelta ?? '';
    pd.addEventListener('input', () => { if (pd.value === '') delete po.priceDelta; else po.priceDelta = Number(pd.value); a.onChange(); });
    r.appendChild(pd);
    // swatch (comma-separated CSS colours → array) + badge (boolean) — the
    // presentation affordances the showroom reads when a field renders as swatch.
    const sw = el('input', 'qc-input de-opt-swatch', { placeholder: 'swatch #a,#b', 'aria-label': `${o.id} swatch colours`, value: Array.isArray(po.swatch) ? po.swatch.join(',') : (po.swatch || '') });
    sw.addEventListener('input', () => { const parts = sw.value.split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) po.swatch = parts; else delete po.swatch; a.onChange(); });
    r.appendChild(sw);
    // a badge only renders in the showroom for multichoice options (the podium),
    // so only offer the control there — it would be silently dead on choice fields.
    if (f.type === 'multichoice') {
      const bw = el('label', 'de-opt-badge', { title: `Feature "${o.id}" with a badge` });
      const bc = el('input', null, { type: 'checkbox', 'aria-label': `${o.id} badge` }); bc.checked = !!po.badge;
      bc.addEventListener('change', () => { if (bc.checked) po.badge = true; else delete po.badge; a.onChange(); });
      bw.append(bc, document.createTextNode(' badge'));
      r.appendChild(bw);
    }
    r.appendChild(assetImageCell(po, a));
    box.appendChild(r);
  }
  return box;
}
function assetImageCell(po, a) {
  const cell = el('div', 'de-opt-img');
  const thumb = el('div', 'de-opt-thumb', { 'aria-hidden': 'true' });
  const btn = el('button', 'qc-btn-link', { type: 'button' });
  const rm = el('button', 'qc-btn-link de-opt-rm', { type: 'button', text: '✕', title: 'Remove image' });
  const paint = () => {
    thumb.innerHTML = '';
    if (po.image) { const im = el('img'); a.ctx.assets && a.ctx.assets.resolve && a.ctx.assets.resolve(po.image).then((u) => { if (u) im.src = u; }); thumb.appendChild(im); thumb.classList.add('has'); btn.textContent = 'Change'; rm.hidden = false; }
    else { thumb.classList.remove('has'); btn.textContent = 'Image…'; rm.hidden = true; }
  };
  btn.addEventListener('click', async () => { const ref = a.ctx.assets && a.ctx.assets.pick ? await a.ctx.assets.pick({ current: po.image }) : null; if (ref) { po.image = ref; a.onChange(); paint(); } });
  rm.addEventListener('click', () => { delete po.image; a.onChange(); paint(); });
  cell.append(thumb, btn, rm);
  paint();
  return cell;
}
