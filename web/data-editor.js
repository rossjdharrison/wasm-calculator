// =============================================================================
// data-editor.js — the DATA design page (Phase B: schema-driven).
//
// The outline + detail are rendered by the generic editor-engine from
// data.schema.json (a dev-owned editor schema). This page just loads the model,
// mounts the engine, and owns the domain right-panel: depends-on/used-by, the
// dependency graph, and the live preview from the wasm engine.
// =============================================================================
import { currentData, currentPres, saveData, savePres, loadDefaultData } from './store.mjs';
import { createEditor } from './editor-engine.mjs';
import { DATA_SOURCES } from './schema-check.mjs';
import { analyzeCoverage, applyFix, edgesOf } from './coverage.mjs';
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
  mountStudioShell($('studio-head'), { active: 'data', title: 'Data model', blurb: 'How the quote is calculated and how fields depend on each other. Edit fields, options &amp; availability, computed formulas, tables, validations and effects. <strong>Save</strong> applies it (this browser) and reopens the Configurator. Presentation (labels, layout, controls) lives on its own page.' });
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
  const cov = analyzeCoverage(data, pres); lastCov = cov;
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
  location.href = './';
}
