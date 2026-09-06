// =============================================================================
// data-editor.js — the DATA design page (Phase B: schema-driven).
//
// The outline + detail are rendered by the generic editor-engine from
// data.schema.json (a dev-owned editor schema). This page just loads the model,
// mounts the engine, and owns the domain right-panel: depends-on/used-by, the
// dependency graph, and the live preview from the wasm engine.
// =============================================================================
import { currentData, currentPres, saveData, savePres, loadDefaultData, MODEL_ID } from './store.mjs';
import { publishModel } from './publish.mjs';
import { createEditor } from './editor-engine.mjs';
import { DATA_SOURCES } from './schema-check.mjs';
import { authorCategories, authorCategoryChoices, renderOf, supertypesOf } from './hqdm.mjs';
import { ensureOwnLeaf, DEFAULT_CATEGORY } from './model-create-core.mjs';
import { analyzeCoverage, applyFix, edgesOf } from './coverage.mjs';
import { renameId } from './model-edit.mjs';
import { el, hint } from './editor-ui.mjs';
import { $, clone, setStatus, assembleLive } from './studio-dom.mjs';
import { buildDefaults, renderStaticPreview } from './preview.mjs';
import { mountStudioShell } from './studio-shell.mjs';

const WASM_URL = 'quote.wasm';

let data = null, pres = null, wasmBytes = null, schema = null, editor = null, assembledOk = null, presDirty = false;
let lastCov = null;   // most recent coverage result, reused by the graph overlay
let lastEngine = null; // most recent loaded engine, for its authoritative graph()

boot();
async function boot() {
  mountStudioShell($('studio-head'), { active: 'data', modelId: MODEL_ID, title: 'Data model', blurb: 'How the quote is calculated and how fields depend on each other. Edit fields, options &amp; availability, computed formulas, tables, validations and effects. <strong>Save</strong> applies it (this browser) and reopens the Configurator. Presentation (labels, layout, controls) lives on its own page.' });
  try {
    [data, pres, wasmBytes, schema] = await Promise.all([
      currentData().then(clone),
      currentPres().then(clone),
      fetch(WASM_URL).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      fetch('data.schema.json').then((r) => r.json()),
    ]);
  } catch (e) { $('status').textContent = `Load failed: ${e.message}`; return; }
  $('btn-save').addEventListener('click', save);
  $('btn-revert').addEventListener('click', () => location.reload());
  $('btn-default').addEventListener('click', async () => { data = clone(await loadDefaultData()); mountEditor(); });
  $('btn-graph').addEventListener('click', toggleGraph);
  $('btn-publish').addEventListener('click', publish);
  mountEditor();
}

// Each DATA_SOURCES name maps to a live reader over the current doc.
// `categories` = the neutral HQDM leaves + this model's own declared data.types,
// plus the row's current value so a category whose type was removed stays visible.
const SOURCE_FNS = {
  fields: () => (data.fields || []).map((f) => f.id),
  categories: (item) => [...new Set([...authorCategories(data.types), ...(item && item.category ? [item.category] : [])])],
  typeIds: () => Object.keys(data.types || {}),   // the model's OWN declared classes (for `configures`)
};

const humanizeType = (id) => String(id || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const glyphOfType = (id) => (renderOf(id, data.types) || {}).glyph || '◈';
const labelOfType = (id) => (data.types && data.types[id] && data.types[id].title) || (renderOf(id, data.types) || {}).label || humanizeType(id);

// the TYPE SPINE the typePick widget renders: the model's current category, the
// plain-language choices it may pick (neutral authorable leaves ∪ this model's OWN
// classes — never other models' classes, which would create a cross-model dependency),
// and the ancestry breadcrumb (hint-bearing supertypes + own categories, root-last).
function typeSpine() {
  const leaf = data.configures;
  const def = (data.types && leaf && data.types[leaf]) || {};
  const category = (def.specializes && def.specializes[0]) || DEFAULT_CATEGORY;
  const neutral = authorCategoryChoices();                                  // [{id,glyph,label,hint}]
  const seen = new Set(neutral.map((c) => c.id));
  const own = Object.keys(data.types || {})
    .filter((id) => id !== leaf && !seen.has(id))                           // same-model categories, not the leaf itself
    .map((id) => ({ id, glyph: glyphOfType(id), label: labelOfType(id), hint: 'This model’s own class' }));
  const choices = [...neutral, ...own];
  if (category && !choices.some((c) => c.id === category)) choices.unshift({ id: category, glyph: glyphOfType(category), label: labelOfType(category), hint: '' });
  const ancestry = supertypesOf(leaf, data.types)
    .filter((id) => (data.types && data.types[id]) || renderOf(id, data.types))   // meaningful nodes only (skip bare structural types)
    .map((id) => ({ id, glyph: glyphOfType(id), label: labelOfType(id) }));
  return { category, choices, ancestry };
}

// change the model's type: re-point its existing configured leaf to the chosen category
// (preserving that leaf's id + title), or mint the born-typed own leaf if there is none.
function setType(categoryId) {
  const leaf = data.configures;
  if (leaf && data.types && data.types[leaf]) data.types[leaf] = { ...data.types[leaf], specializes: [categoryId] };
  else ensureOwnLeaf(data, categoryId);
  editor.commit();   // re-render outline + detail so the spine + Classes reflect the change
  refresh();
}

function mountEditor() {
  editor = createEditor({
    schema, doc: data, outline: $('outline'), detail: $('detail'),
    ctx: {
      fields: () => (data.fields || []).map((f) => ({ id: f.id, type: f.type, options: f.options || [] })),
      // Built from DATA_SOURCES (shared with the schema validator) so a schema
      // can never reference a source name the page forgets to wire.
      sources: Object.fromEntries(DATA_SOURCES.map((name) => [name, SOURCE_FNS[name]])),
      // the typePick type-spine hooks (the model-specific read + write the generic
      // widget delegates to — keeps editor-engine free of model knowledge).
      typeSpine, setType,
    },
    onChange: refresh,
    // seed a presentation counterpart when a data item is added, so a new field shows
    // with a label + section (and a computed value surfaces as an output) instead of
    // rendering blank — the presentation half of "what it contains".
    onItemAdded: seedPresFor,
  });
  refresh();
}

function seedPresFor(key, id) {
  if (!id) return;
  if (key === 'fields') {
    pres.fields = pres.fields || [];
    if (!pres.fields.some((f) => f.id === id)) { pres.fields.push({ id, label: humanizeType(id), section: (pres.sections && pres.sections[0] && pres.sections[0].id) || 'main' }); presDirty = true; }
  } else if (key === 'computed') {
    pres.outputs = pres.outputs || [];
    if (!pres.outputs.some((o) => o.id === id)) { pres.outputs.push({ id, label: humanizeType(id) }); presDirty = true; }
  }
}

// ---- right panel: coverage + depends-on/used-by + live preview -------------
function refresh() {
  const cov = analyzeCoverage(data, pres); lastCov = cov;
  renderCoverage(cov); renderInlineChecklist(cov); renderRenameControl();
  renderRelationships(); recompute(); if (!$('graph').hidden) renderGraph();
}

// rename-after-create: change a field/computed id and rewrite EVERY reference across
// both files (renameId is pure + parity-tested). The op clones, so we adopt the new
// docs and rebuild the engine, then reselect the renamed item.
function renameSelected(oldId, newId) {
  const r = renameId({ data, pres }, oldId, newId);
  data = r.data; pres = r.pres; presDirty = true;
  mountEditor();
  editor.selectById(newId);
}
function renderRenameControl() {
  const detail = $('detail'); if (!detail) return;
  const old = detail.querySelector('.de-rename'); if (old) old.remove();
  const selId = editor && editor.selectedId(); if (!selId) return;
  const isField = (data.fields || []).some((f) => f.id === selId);
  const isComputed = (data.computed || []).some((c) => c.id === selId);
  if (!isField && !isComputed) return;   // renameId rewrites field/computed references; other ids aren't wired
  const taken = new Set([...(data.fields || []).map((f) => f.id), ...(data.computed || []).map((c) => c.id)]);
  const box = el('div', 'de-rename');
  box.appendChild(el('div', 'de-rename__lab', { text: 'Rename id — updates every reference' }));
  const line = el('div', 'de-optadd');
  const input = el('input', 'qc-input de-optadd__in', { value: selId, 'aria-label': 'New id' });
  const btn = el('button', 'de-optadd__btn', { type: 'button', text: 'Rename' }); btn.disabled = true;
  const err = el('div', 'de-optadd__err', { 'aria-live': 'polite' }); err.hidden = true;
  const check = () => {
    const v = input.value.trim(); let msg = '';
    if (v && !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) msg = 'Letters, numbers & underscore — start with a letter.';
    else if (v && v !== selId && taken.has(v)) msg = `"${v}" already exists.`;
    err.textContent = msg; err.hidden = !msg; input.classList.toggle('is-invalid', !!msg);
    btn.disabled = !v || v === selId || !!msg; return !btn.disabled;
  };
  const commit = () => { if (check()) renameSelected(selId, input.value.trim()); };
  input.addEventListener('input', check);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  btn.addEventListener('click', commit);
  line.append(input, btn); box.append(line, err);
  detail.appendChild(box);
}

// ---- coverage advisor (Slice 1: surface gaps + one-click connect) ----------
function plainLabel(f) {
  switch (f.kind) {
    case 'missing-table-key': return `Needs a price for “${f.option}” in ${f.table}`;
    case 'undefined-table': return `Table “${f.table}” is missing`;
    case 'missing-label': return f.option ? `“${f.option}” has no customer-facing label` : `“${f.field}” has no label`;
    case 'dead-option': return `“${f.option}” isn’t used by any price yet`;
    case 'orphan-field': return `“${f.field}” isn’t connected to anything`;
    case 'cycle': return `“${f.field}” is in a dependency cycle`;
    default: return f.message;
  }
}
function doFix(list) {
  let changed = false;
  for (const f of list) if (f.fix && applyFix(data, pres, f.fix)) { changed = true; if (f.fix.type === 'add-label') presDirty = true; }
  if (changed) { editor.renderOutline(); editor.renderDetail(); }
  refresh();
}
// how to RESOLVE a finding (the "what next", not just the "what's wrong"). Findings that
// carry a one-click `fix` show the button instead; these guide the ones the author must
// resolve by hand, so no warning is a dead-end.
function fixHint(f) {
  switch (f.kind) {
    case 'orphan-field': return `Use “${f.field}” in a computed value’s formula (e.g. a price), or remove the field if it isn’t needed.`;
    case 'dead-option': return `Reference “${f.option}” in a price or rule (e.g. give it a value in a table), or remove the option.`;
    case 'cycle': return `Break the loop — remove the reference that makes “${f.field}” depend on itself.`;
    case 'undefined-table': return `Create a table named “${f.table}” (Tables → + add), or fix the lookup() that names it.`;
    case 'unknown-category': return `Choose a known category for “${f.field}”, or declare it as a class under Classes (HQDM).`;
    case 'no-purchase-price': return `Add a computed value, set its Category to a money type (amount_of_money), then emphasise its output on the Presentation page — that becomes the price handed downstream.`;
    default: return '';
  }
}
function covItem(f) {
  const row = el('div', 'cov-item');
  row.appendChild(el('span', `cov-dot cov-dot--${f.severity}`));
  const mid = el('div', 'cov-mid');
  const msg = el('button', 'cov-msg'); msg.type = 'button'; msg.textContent = plainLabel(f);
  msg.title = 'Go to this item';
  msg.addEventListener('click', () => { const id = f.field || f.table; if (id) editor.selectById(id); });
  mid.appendChild(msg);
  // a one-click fix IS the resolution; otherwise show how to resolve it by hand.
  if (!f.fix) { const h = fixHint(f); if (h) mid.appendChild(el('div', 'cov-hint', { text: h })); }
  row.appendChild(mid);
  if (f.fix) { const b = el('button', 'cov-fix'); b.type = 'button'; b.textContent = f.fix.type === 'add-label' ? 'Add label' : 'Add'; b.addEventListener('click', () => doFix([f])); row.appendChild(b); }
  return row;
}
function fixAllBtn(list, label) {
  const fixable = list.filter((f) => f.fix);
  if (fixable.length < 2) return null;
  const b = el('button', 'cov-fixall'); b.type = 'button'; b.textContent = `${label} (${fixable.length})`;
  b.addEventListener('click', () => doFix(fixable)); return b;
}
function renderCoverage(cov) {
  const host = $('coverage'); if (!host) return;
  host.innerHTML = '';
  const head = el('div', 'cov-head');
  const t = el('span', 'cov-title'); t.textContent = 'Coverage'; head.appendChild(t);
  const counts = el('span', 'cov-counts');
  if (!cov.findings.length) { const ok = el('span', 'cov-ok'); ok.textContent = 'All connected ✓'; counts.appendChild(ok); }
  else {
    for (const [sev, n] of [['error', cov.counts.error], ['warn', cov.counts.warn], ['info', cov.counts.info]]) {
      if (!n) continue;
      const s = el('span', 'cov-count'); s.appendChild(el('span', `cov-dot cov-dot--${sev}`));
      const num = document.createElement('span'); num.textContent = sev === 'error' ? `${n} to fix` : String(n); s.appendChild(num);
      counts.appendChild(s);
    }
  }
  head.appendChild(counts); host.appendChild(head);
  if (!cov.findings.length) return;
  const all = fixAllBtn(cov.findings, 'Connect all'); if (all) host.appendChild(all);
  const list = el('div', 'cov-list');
  const groups = {};
  for (const f of cov.findings) { const k = f.field || f.table || '—'; (groups[k] ||= []).push(f); }
  for (const [k, fs] of Object.entries(groups)) {
    const g = el('div', 'cov-group');
    const gh = el('div', 'cov-group__h'); gh.textContent = k; g.appendChild(gh);
    for (const f of fs) g.appendChild(covItem(f));
    list.appendChild(g);
  }
  host.appendChild(list);
}
function renderInlineChecklist(cov) {
  const detail = $('detail'); if (!detail) return;
  const old = detail.querySelector('.cov-inline'); if (old) old.remove();
  const selId = editor && editor.selectedId(); if (!selId) return;
  const mine = cov.findings.filter((f) => f.field === selId || f.table === selId);
  if (!mine.length) return;
  const box = el('div', 'cov-inline');
  const h = el('div', 'cov-inline__h'); h.textContent = 'To finish this'; box.appendChild(h);
  for (const f of mine) box.appendChild(covItem(f));
  const all = fixAllBtn(mine, 'Finish all'); if (all) box.appendChild(all);
  detail.appendChild(box);
}

// the value-dependency edges — from the engine's authoritative graph() when an
// engine is loaded, else the JS derivation (coverage.edgesOf) as a fallback.
// edge {from: dependency, to: dependent}. The single edge source for this page.
function currentEdges() {
  return (lastEngine && lastEngine.graph && lastEngine.graph(1)) || edgesOf(data);
}
function renderRelationships() {
  const host = $('deps'); host.innerHTML = '';
  const id = editor && editor.selectedId();
  const knownIds = new Set([...(data.fields || []).map((f) => f.id), ...(data.computed || []).map((c) => c.id)]);
  if (!id || !knownIds.has(id)) { host.appendChild(hint('Select a field or computed value to see relationships.')); return; }
  const edges = currentEdges();
  const dep = [...new Set(edges.filter((e) => e.to === id).map((e) => e.from))].filter((x) => x !== id && knownIds.has(x));
  const used = [...new Set(edges.filter((e) => e.from === id).map((e) => e.to))].filter((x) => x !== id);
  host.appendChild(depList('Depends on', dep));
  host.appendChild(depList('Used by', used));
}
function depList(label, ids) {
  const box = el('div', 'de-deps');
  const h = el('div', 'de-deps__label'); h.textContent = label; box.appendChild(h);
  if (!ids.length) { box.appendChild(hint('—')); return box; }
  for (const id of ids) { const c = el('code', 'de-chip'); c.textContent = id; box.appendChild(c); }
  return box;
}

function recompute() {
  assembleLive(data, pres, wasmBytes)
    .then(({ assembled, engine }) => {
      const res = engine.evaluate(buildDefaults(assembled.ir));
      assembledOk = assembled; lastEngine = engine;
      setStatus('ok', `Valid — ${assembled.ir.fields.length} fields, ${assembled.ir.computedIR.length} computed, ${assembled.ir.outputs.length} outputs.`);
      renderStaticPreview($('preview'), assembled.ir, res);
      renderRelationships();                    // now the engine is loaded, use its authoritative edges
      if (!$('graph').hidden) renderGraph();
    })
    .catch((e) => {
      assembledOk = null;
      if (e.phase === 'assemble') { setStatus('error', `Model error: ${e.message}`); $('preview').innerHTML = ''; }
      else setStatus('error', `Engine: ${e.message}`);
    });
}

// ---- dependency graph (SVG) ------------------------------------------------
function toggleGraph() {
  const g = $('graph');
  const show = g.hidden; g.hidden = !show;
  $('btn-graph').textContent = show ? 'Hide graph' : 'Dependency graph';
  if (show) renderGraph();
}
// field-level worst severity per node, for the overlay (cycle=error, orphan=warn)
function nodeSeverity(cov) {
  const rank = { error: 3, warn: 2, info: 1 }; const sev = new Map();
  for (const f of (cov && cov.findings) || []) {
    if (!f.field || f.option) continue;              // field-level findings only
    const r = rank[f.severity] || 0; if (r > (sev.get(f.field) || 0)) sev.set(f.field, r);
  }
  return sev;
}
// nodes reachable from `start` (forward = dependents/impact; else = dependencies)
function reachable(edges, start, forward) {
  const adj = new Map();
  for (const { from, to } of edges) { const [a, b] = forward ? [from, to] : [to, from]; if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
  const seen = new Set(); const q = [start];
  while (q.length) { const u = q.shift(); for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); q.push(v); } }
  seen.delete(start); return seen;
}
function renderGraph() {
  const host = $('graph'); host.innerHTML = '';
  const nodes = [...(data.fields || []).map((f) => ({ id: f.id, kind: 'field' })), ...(data.computed || []).map((c) => ({ id: c.id, kind: 'computed' }))];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = currentEdges().filter((e) => ids.has(e.from) && ids.has(e.to));
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0, changed = true; changed && pass < 200; pass++) {
    changed = false;
    for (const e of edges) { const nl = layer.get(e.from) + 1; if (nl > layer.get(e.to)) { layer.set(e.to, nl); changed = true; } }
  }
  const byLayer = {};
  nodes.forEach((n) => { (byLayer[layer.get(n.id)] ||= []).push(n); });
  const layerKeys = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
  const COLW = 165, ROWH = 46, NW = 132, NH = 30, PX = 16, PY = 16;
  const pos = new Map();
  layerKeys.forEach((L) => byLayer[L].forEach((n, i) => pos.set(n.id, { x: PX + L * COLW, y: PY + i * ROWH })));
  const maxRows = Math.max(...layerKeys.map((L) => byLayer[L].length));
  const W = PX * 2 + Math.max(...layerKeys) * COLW + NW;
  const H = PY * 2 + Math.max(1, maxRows) * ROWH;
  const selId = editor && editor.selectedId();
  // blast radius: dependencies (upstream) + dependents/impact (downstream)
  const up = selId ? reachable(edges, selId, false) : new Set();
  const down = selId ? reachable(edges, selId, true) : new Set();
  const related = new Set(selId ? [selId, ...up, ...down] : []);
  const sev = nodeSeverity(lastCov);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.classList.add('dg-svg');
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    const onPath = selId && related.has(e.from) && related.has(e.to);
    const direct = selId && (e.from === selId || e.to === selId);
    p.setAttribute('class', 'dg-edge' + (onPath ? ' is-path' : '') + (direct ? ' is-hot' : ''));
    svg.appendChild(p);
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    const cls = ['dg-node', `dg-node--${n.kind}`];
    if (n.id === selId) cls.push('is-sel');
    else if (up.has(n.id)) cls.push('is-upstream');
    else if (down.has(n.id)) cls.push('is-downstream');
    else if (selId) cls.push('is-dim');
    const s = sev.get(n.id); if (s === 3) cls.push('has-error'); else if (s === 2) cls.push('has-warn');
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', cls.join(' ')); g.style.cursor = 'pointer';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', p.x); rect.setAttribute('y', p.y); rect.setAttribute('width', NW); rect.setAttribute('height', NH); rect.setAttribute('rx', 7);
    const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', p.x + NW / 2); tx.setAttribute('y', p.y + NH / 2 + 4); tx.setAttribute('text-anchor', 'middle'); tx.textContent = n.id;
    g.append(rect, tx);
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
    const note = s === 3 ? 'in a dependency cycle' : s === 2 ? 'disconnected' : '';
    g.setAttribute('aria-label', `Select ${n.id}${note ? ` — ${note}` : ''}`);
    if (note) { const t = document.createElementNS(NS, 'title'); t.textContent = note; g.appendChild(t); }
    g.addEventListener('click', () => { editor.selectById(n.id); if (!$('graph').hidden) renderGraph(); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); editor.selectById(n.id); if (!$('graph').hidden) renderGraph(); } });
    svg.appendChild(g);
  }
  host.appendChild(svg);
}

// ---- save ------------------------------------------------------------------
function save() {
  if (!assembledOk) { setStatus('error', 'Fix the errors before saving.'); return; }
  if (!saveData(data)) { setStatus('error', 'Could not save (storage blocked).'); return; }
  if (presDirty) savePres(pres); // labels added via the coverage advisor live in the presentation model
  location.href = `configure.html?m=${encodeURIComponent(MODEL_ID)}`; // reopen THIS model's configurator, not the catalogue
}

// publish the current model to the edge (KV) — validated server-side by the real
// assembler; served everywhere with no redeploy. Needs the PUBLISH_TOKEN (prompted once).
async function publish() {
  if (!assembledOk) { setStatus('error', 'Fix the errors before publishing.'); return; }
  setStatus('ok', 'Publishing to the edge…');
  const res = await publishModel(MODEL_ID, { data, presentation: pres, card: { title: pres.name || MODEL_ID } });
  setStatus(res.ok ? 'ok' : 'error', res.ok ? `Published “${MODEL_ID}” to the edge — served everywhere, no redeploy.` : `Publish failed: ${res.error}`);
}
