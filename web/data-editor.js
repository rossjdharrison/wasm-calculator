// =============================================================================
// data-editor.js — the DATA design page (Phase B: schema-driven).
//
// The outline + detail are rendered by the generic editor-engine from
// data.schema.json (a dev-owned editor schema). This page just loads the model,
// mounts the engine, and owns the domain right-panel: depends-on/used-by, the
// dependency graph, and the live preview from the wasm engine.
// =============================================================================
import { assemble, loadEngine, mergeModel } from './assembler.mjs';
import { currentData, currentPres, saveData, savePres, loadDefaultData } from './store.mjs';
import { createEditor } from './editor-engine.mjs';
import { DATA_SOURCES } from './schema-check.mjs';
import { analyzeCoverage, applyFix } from './coverage.mjs';
import { el, hint } from './editor-ui.mjs';

const WASM_URL = 'quote.wasm';
const $ = (id) => document.getElementById(id);
const clone = (x) => JSON.parse(JSON.stringify(x));

let data = null, pres = null, wasmBytes = null, schema = null, editor = null, assembledOk = null, presDirty = false;

boot();
async function boot() {
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
  mountEditor();
}

// Each DATA_SOURCES name maps to a live reader over the current doc.
const SOURCE_FNS = { fields: () => (data.fields || []).map((f) => f.id) };

function mountEditor() {
  editor = createEditor({
    schema, doc: data, outline: $('outline'), detail: $('detail'),
    ctx: {
      fields: () => (data.fields || []).map((f) => ({ id: f.id, type: f.type, options: f.options || [] })),
      // Built from DATA_SOURCES (shared with the schema validator) so a schema
      // can never reference a source name the page forgets to wire.
      sources: Object.fromEntries(DATA_SOURCES.map((name) => [name, SOURCE_FNS[name]])),
    },
    onChange: refresh,
  });
  refresh();
}

// ---- right panel: coverage + depends-on/used-by + live preview -------------
function refresh() {
  const cov = analyzeCoverage(data, pres);
  renderCoverage(cov); renderInlineChecklist(cov);
  renderRelationships(); recompute(); if (!$('graph').hidden) renderGraph();
}

// ---- coverage advisor (Slice 1: surface gaps + one-click connect) ----------
function plainLabel(f) {
  switch (f.kind) {
    case 'missing-table-key': return `Needs a price for “${f.option}” in ${f.table}`;
    case 'undefined-table': return `Table “${f.table}” is missing`;
    case 'missing-label': return f.option ? `“${f.option}” has no customer-facing label` : `“${f.field}” has no label`;
    case 'dead-option': return `“${f.option}” isn’t used by any price yet`;
    case 'orphan-field': return `“${f.field}” isn’t connected to anything`;
    default: return f.message;
  }
}
function doFix(list) {
  let changed = false;
  for (const f of list) if (f.fix && applyFix(data, pres, f.fix)) { changed = true; if (f.fix.type === 'add-label') presDirty = true; }
  if (changed) { editor.renderOutline(); editor.renderDetail(); }
  refresh();
}
function covItem(f) {
  const row = el('div', 'cov-item');
  row.appendChild(el('span', `cov-dot cov-dot--${f.severity}`));
  const msg = el('button', 'cov-msg'); msg.type = 'button'; msg.textContent = plainLabel(f);
  msg.title = 'Go to this item';
  msg.addEventListener('click', () => { const id = f.field || f.table; if (id) editor.selectById(id); });
  row.appendChild(msg);
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

function refsOf(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.op === 'field') out.add(ast.args[0]);
  else if (ast.op === 'has' || ast.op === 'notHas') out.add(ast.args[0]);
  else if (ast.op === 'lookup') ast.args.slice(1).forEach((a) => refsOf(a, out));
  else (ast.args || []).forEach((a) => refsOf(a, out));
  return out;
}
function allExprs() {
  const list = [];
  for (const f of data.fields || []) {
    [f.min, f.max, f.step].forEach((e) => list.push([f.id, e]));
    for (const o of f.options || []) list.push([f.id, o.availableWhen]);
  }
  for (const c of data.computed || []) list.push([c.id, c.formula]);
  for (const v of data.validations || []) list.push([v.field, v.when]);
  for (const e of data.effects || []) list.push([e.setField, e.when]);
  return list.filter(([, e]) => e && typeof e === 'object');
}
function renderRelationships() {
  const host = $('deps'); host.innerHTML = '';
  const id = editor && editor.selectedId();
  const knownIds = new Set([...(data.fields || []).map((f) => f.id), ...(data.computed || []).map((c) => c.id)]);
  if (!id || !knownIds.has(id)) { host.appendChild(hint('Select a field or computed value to see relationships.')); return; }
  const dep = new Set();
  for (const [owner, e] of allExprs()) if (owner === id) refsOf(e, dep);
  dep.delete(id);
  const used = new Set();
  for (const [owner, e] of allExprs()) if (owner && owner !== id && refsOf(e).has(id)) used.add(owner);
  host.appendChild(depList('Depends on', [...dep].filter((x) => knownIds.has(x))));
  host.appendChild(depList('Used by', [...used]));
}
function depList(label, ids) {
  const box = el('div', 'de-deps');
  const h = el('div', 'de-deps__label'); h.textContent = label; box.appendChild(h);
  if (!ids.length) { box.appendChild(hint('—')); return box; }
  for (const id of ids) { const c = el('code', 'de-chip'); c.textContent = id; box.appendChild(c); }
  return box;
}

function recompute() {
  let model, assembled;
  try { model = mergeModel(data, pres); assembled = assemble(model); }
  catch (e) { assembledOk = null; setStatus('error', `Model error: ${e.message}`); $('preview').innerHTML = ''; return; }
  loadEngine(wasmBytes, assembled)
    .then((engine) => {
      const res = engine.evaluate(buildDefaults(assembled.ir));
      assembledOk = assembled;
      setStatus('ok', `Valid — ${assembled.ir.fields.length} fields, ${assembled.ir.computedIR.length} computed, ${assembled.ir.outputs.length} outputs.`);
      renderPreview(assembled.ir, res);
    })
    .catch((e) => { assembledOk = null; setStatus('error', `Engine: ${e.message}`); });
}
function renderPreview(ir, res) {
  const host = $('preview'); host.innerHTML = '';
  const h = el('div', 'qc-preview__title'); h.textContent = 'Default quote (live)'; host.appendChild(h);
  ir.outputs.forEach((o, i) => {
    const r = res.outputs[i]; if (!r.visible) return;
    const rowEl = el('div', 'qc-preview__row');
    const l = el('span'); l.textContent = o.label; const v = el('span'); v.textContent = fmt(r);
    rowEl.append(l, v); host.appendChild(rowEl);
  });
}
function buildDefaults(ir) {
  const inp = {};
  for (const f of ir.fields) {
    if (f.type === 'choice') inp[f.id] = f.defaultRaw ?? f.options[0]?.id;
    else if (f.type === 'multichoice') inp[f.id] = f.defaultRaw ?? [];
    else if (f.type === 'boolean') inp[f.id] = !!f.defaultRaw;
    else inp[f.id] = f.defaultRaw ?? 0;
  }
  return inp;
}
function fmt(o) {
  const v = o.value; const nf = (opt) => new Intl.NumberFormat(undefined, opt).format(v);
  if (o.format === 'currency') return nf({ style: 'currency', currency: o.currencyCode, minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals });
  if (o.format === 'percent') return nf({ style: 'percent', minimumFractionDigits: o.decimals });
  if (o.format === 'unit') { const n = nf({ maximumFractionDigits: o.decimals, minimumFractionDigits: o.decimals }); return o.unit ? `${n} ${o.unit}` : n; }
  return nf({ maximumFractionDigits: o.decimals ?? 2 });
}
function setStatus(kind, msg) { const s = $('status'); s.className = `qc-status qc-status--${kind}`; s.textContent = msg; }

// ---- dependency graph (SVG) ------------------------------------------------
function toggleGraph() {
  const g = $('graph');
  const show = g.hidden; g.hidden = !show;
  $('btn-graph').textContent = show ? 'Hide graph' : 'Dependency graph';
  if (show) renderGraph();
}
function renderGraph() {
  const host = $('graph'); host.innerHTML = '';
  const nodes = [...(data.fields || []).map((f) => ({ id: f.id, kind: 'field' })), ...(data.computed || []).map((c) => ({ id: c.id, kind: 'computed' }))];
  const ids = new Set(nodes.map((n) => n.id));
  const edgeSet = new Set();
  for (const [owner, e] of allExprs()) {
    if (!owner || !ids.has(owner)) continue;
    for (const ref of refsOf(e)) if (ids.has(ref) && ref !== owner) edgeSet.add(ref + ' ' + owner);
  }
  const edges = [...edgeSet].map((s) => { const [from, to] = s.split(' '); return { from, to }; });
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
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.classList.add('dg-svg');
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    p.setAttribute('class', 'dg-edge' + (selId && (e.from === selId || e.to === selId) ? ' is-hot' : ''));
    svg.appendChild(p);
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', `dg-node dg-node--${n.kind}${n.id === selId ? ' is-sel' : ''}`); g.style.cursor = 'pointer';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', p.x); rect.setAttribute('y', p.y); rect.setAttribute('width', NW); rect.setAttribute('height', NH); rect.setAttribute('rx', 7);
    const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', p.x + NW / 2); tx.setAttribute('y', p.y + NH / 2 + 4); tx.setAttribute('text-anchor', 'middle'); tx.textContent = n.id;
    g.append(rect, tx);
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', `Select ${n.id}`);
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
  location.href = './';
}
