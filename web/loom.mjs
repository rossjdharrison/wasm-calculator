// =============================================================================
// loom.mjs — the Relationship Loom, wired to the REAL engine.
//
// The mock proved the interaction; this is the same canvas driven by the actual
// toolchain: the model is fetched from the store, merged, assembled, and run in
// the WASM VM. NODES come from the assembled IR, EDGES from engine.graph(1) (the
// VM's own dependency graph), VALUES from engine.evaluate(config), and output
// cards from formatOutput. Every edit is a genuine model mutation: an icon-editor
// or the create-card builds a candidate via model-edit.*, validates the formula
// with validateFormula, proves the whole model still assembles with tryAssemble,
// and only then reloads a fresh engine and repaints — otherwise the assembler's
// own error is shown inline and nothing changes. Edits persist to the same store
// the Configurator and the other editors read.
// =============================================================================
import { loadEngine, mergeModel, splitModel } from './assembler.mjs';
import { currentData, currentPres, saveData, savePres, resetModel, MODEL_ID } from './store.mjs';
import { validateFormula, tryAssemble } from './model-validate.mjs';
import * as edit from './model-edit.mjs';
import { formatOutput } from './ui.mjs';
import { parseExpr, formatExpr } from './expr.mjs';
import { edgesOf, findCycles } from './coverage.mjs';
import { buildDefaults } from './preview.mjs';
import { loadRates } from './fx.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mk = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const ICO = {
  gate: '<svg viewBox="0 0 16 16"><path d="M8 2.5 13.5 8 8 13.5 2.5 8Z"/></svg>',
  eye: '<svg viewBox="0 0 16 16"><path d="M1.5 8C3.5 4.5 12.5 4.5 14.5 8 12.5 11.5 3.5 11.5 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>',
  kfield: '<svg viewBox="0 0 16 16" style="stroke-width:1.4"><rect x="3" y="3" width="10" height="10" rx="2.5"/></svg>',
  kcomp: '<svg viewBox="0 0 16 16" style="stroke-width:1.4"><path d="M8 2.5 13.5 5.5 13.5 10.5 8 13.5 2.5 10.5 2.5 5.5Z"/></svg>',
};
const glyph = (t) => t === 'calc' ? 'ƒ' : t === 'fmtc' ? '⇄' : (ICO[t] || '');

// ---- state ------------------------------------------------------------------
const ST = {
  data: null, pres: null, ir: null, engine: null, wasmBytes: null,
  config: {}, res: null, edges: [], pos: {}, cw: 0, ch: 0,
  rates: null, baseCurrency: 'EUR', currency: 'EUR', unitSystem: 'metric',
  sel: null, cyc: new Set(),
};
const Z = { k: 1, tx: 0, ty: 0 };
const UNDO = [];
const NW = 132, NH = 52;

// ---- boot -------------------------------------------------------------------
(async function boot() {
  try {
    ST.data = await currentData();
    ST.pres = await currentPres();
    ST.baseCurrency = ST.data.currency || 'EUR';
    ST.currency = ST.baseCurrency;
    ST.wasmBytes = new Uint8Array(await (await fetch('quote.wasm')).arrayBuffer());
  } catch (e) { return fatal('Could not load the model or engine: ' + e.message); }

  const r = tryAssemble(mergeModel(ST.data, ST.pres));
  if (!r.ok) return fatal('This model does not assemble: ' + r.errors[0].message);
  try { ST.engine = await loadEngine(ST.wasmBytes, r.assembled); }
  catch (e) { return fatal('Could not start the engine: ' + e.message); }
  ST.ir = r.assembled.ir;
  ST.config = buildDefaults(ST.ir);
  ST.res = ST.engine.evaluate(ST.config);
  ST.edges = ST.engine.graph(1) || edgesOf(ST.data);

  // live FX rates (best effort — formatOutput falls back to canonical if absent)
  try { ST.rates = await loadRates({ base: ST.baseCurrency, symbols: (ST.data.currencies || []).filter((c) => c !== ST.baseCurrency) }); } catch (_) { ST.rates = null; }

  const boot = $('#boot'); if (boot) boot.remove();
  initCurrencySelect();
  wireChrome();
  layout(); render(); fit();
})();

function fatal(msg) {
  const b = $('#boot'); if (b) { b.textContent = msg; b.style.color = '#e79b8c'; }
}

// ---- lookups ----------------------------------------------------------------
const dataField = (id) => (ST.data.fields || []).find((f) => f.id === id);
const dataComputed = (id) => (ST.data.computed || []).find((c) => c.id === id);
const presField = (id) => (ST.pres.fields || []).find((f) => f.id === id);
const outputDef = (id) => (ST.pres.outputs || []).find((o) => o.id === id);
const outputRes = (id) => (ST.res.outputs || []).find((o) => o.id === id);
const labelOf = (id) => (presField(id)?.label) || (dataComputed(id)?.label) || (outputDef(id)?.label) || id;
const pair = () => ({ data: ST.data, pres: ST.pres });
const merged = (p) => mergeModel(p.data, p.pres);
const fmtOpts = () => ({ units: ST.ir.units, rates: ST.rates, unitSystem: ST.unitSystem, currency: ST.currency, fxSurcharge: ST.data.fxSurcharge || 0, locale: 'en-GB' });

// the NODES on the canvas: input fields + computed values (outputs overlay them)
function nodeList() {
  return [
    ...ST.ir.fields.map((f) => ({ id: f.id, kind: 'field' })),
    ...ST.ir.computedIR.map((c) => ({ id: c.id, kind: 'computed' })),
  ];
}

// value shown on a node
function nodeValue(node) {
  const v = ST.res.valueById[node.id];
  if (v == null) return '';
  const out = outputRes(node.id);
  if (out) return formatOutput(out, fmtOpts());
  // plain canonical number
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(v);
}

// the condition icons a node carries, derived from the REAL model
function condsForNode(node) {
  const cs = [];
  if (node.kind === 'computed') cs.push({ t: 'calc', on: true, title: 'Calculated', kicker: 'formula', edit: () => editFormula(node.id) });
  if (node.kind === 'field') {
    const pf = presField(node.id), df = dataField(node.id);
    if (pf?.visibleWhen) cs.push({ t: 'eye', on: ST.res.visible[node.id] !== false, title: 'Conditional visibility', kicker: 'visibleWhen', edit: () => editPredicate(node.id, 'field:visibleWhen') });
    if (pf?.enabledWhen) cs.push({ t: 'lock', on: ST.res.enabled[node.id] !== false, title: 'Conditional enable', kicker: 'enabledWhen', edit: () => editPredicate(node.id, 'field:enabledWhen') });
    const gated = (df?.options || []).filter((o) => o.availableWhen);
    if (gated.length) cs.push({ t: 'gate', on: true, title: 'Option availability', kicker: gated.length + ' gated', edit: () => editOptionGate(node.id) });
  }
  const od = outputDef(node.id);
  if (od) {
    if (od.visibleWhen) cs.push({ t: 'eye', on: (outputRes(node.id) || {}).visible !== false, title: 'Output visibility', kicker: 'output visibleWhen', edit: () => editPredicate(node.id, 'output:visibleWhen') });
    if (od.format?.type === 'currency') cs.push({ t: 'fmtc', on: ST.currency !== (od.format.currencyCode || ST.baseCurrency), title: 'Conditional format', kicker: 'currency', edit: () => infoFormat(node.id) });
  }
  return cs;
}

// ---- layout (longest-path layering; inputs right, dependents left) ----------
function layout() {
  const nodes = nodeList();
  const ids = nodes.map((n) => n.id);
  const idset = new Set(ids);
  const deps = {}; ids.forEach((id) => (deps[id] = []));
  for (const { from, to } of ST.edges) if (idset.has(from) && idset.has(to)) deps[to].push(from);
  const depth = {}, visiting = new Set();
  const d = (id) => {
    if (depth[id] != null) return depth[id];
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id); let m = 0;
    for (const p of deps[id]) m = Math.max(m, d(p) + 1);
    visiting.delete(id); return (depth[id] = m);
  };
  ids.forEach(d);
  const maxDepth = Math.max(0, ...ids.map((id) => depth[id]));
  const cols = {}; ids.forEach((id) => ((cols[depth[id]] = cols[depth[id]] || []).push(id)));
  const COLW = 216, ROWH = 92, PADX = 42, PADY = 40;
  const POS = {};
  let maxRows = 1;
  for (const k of Object.keys(cols)) {
    const col = cols[k].sort();
    maxRows = Math.max(maxRows, col.length);
    col.forEach((id, i) => { POS[id] = { x: PADX + (maxDepth - Number(k)) * COLW, y: PADY + i * ROWH }; });
  }
  ST.pos = POS;
  ST.cw = PADX * 2 + (maxDepth + 1) * COLW;
  ST.ch = PADY * 2 + maxRows * ROWH;
  ST.cyc = findCycles(ST.edges);
}

// ---- reachability (for blast-radius tinting) --------------------------------
function reach(sel, down) {
  const adj = {};
  for (const { from, to } of ST.edges) { const [a, b] = down ? [from, to] : [to, from]; (adj[a] = adj[a] || []).push(b); }
  const seen = new Set(), st = [sel];
  while (st.length) { const n = st.pop(); for (const m of adj[n] || []) if (!seen.has(m)) { seen.add(m); st.push(m); } }
  return seen;
}

// ---- render -----------------------------------------------------------------
function render() {
  const sel = ST.sel;
  const up = sel ? reach(sel, false) : new Set();
  const down = sel ? reach(sel, true) : new Set();
  const hasDependent = new Set(ST.edges.map((e) => e.from));

  // ticker = grandTotal output if present, else last output
  const gt = outputRes('grandTotal') || (ST.res.outputs || []).slice(-1)[0];
  $('#ticker').textContent = gt ? formatOutput(gt, fmtOpts()) : '—';

  drawWires(sel, up, down);
  renderNodes(sel, up, down, hasDependent);
  renderRoster(sel);
  renderConfig();
  renderQuote();
  inspector();
}

function renderNodes(sel, up, down, hasDependent) {
  const host = $('#nodes'); const present = new Set();
  for (const node of nodeList()) {
    present.add(node.id);
    let dEl = $(`[data-node="${node.id}"]`, host);
    if (!dEl) {
      dEl = mk('div', 'node'); dEl.dataset.node = node.id;
      dEl.onclick = () => select(node.id);
      dEl.ondblclick = (e) => { e.stopPropagation(); startRename(node.id); };
      dEl.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); nodeMenu(node.id, e.clientX, e.clientY); };
      host.appendChild(dEl);
    }
    const p = ST.pos[node.id]; if (!p) { dEl.style.display = 'none'; continue; }
    dEl.style.display = ''; dEl.style.left = p.x + 'px'; dEl.style.top = p.y + 'px';
    const isSink = outputDef(node.id) && !hasDependent.has(node.id);
    dEl.className = 'node ' + node.kind + (isSink ? ' sink' : '');
    if (ST.cyc.has(node.id)) dEl.classList.add('cyc');
    if (node.id === sel) dEl.classList.add('lit');
    else if (sel && up.has(node.id)) dEl.classList.add('up');
    else if (sel && down.has(node.id)) dEl.classList.add('down');
    else if (sel) dEl.classList.add('faded');
    const conds = condsForNode(node);
    const icons = conds.map((c, i) => `<button class="ic${c.on ? ' on' : ''}" data-i="${i}" title="${c.title}">${glyph(c.t)}</button>`).join('');
    dEl._conds = conds;
    dEl.innerHTML = `<div class="nrow1"><span class="kico">${node.kind === 'field' ? ICO.kfield : ICO.kcomp}</span><span class="nname">${labelOf(node.id)}</span></div>`
      + `<div class="nrow2"><span class="nval">${nodeValue(node)}</span><span class="icons">${icons}</span></div>`;
    $$('.ic', dEl).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); select(node.id); dEl._conds[+b.dataset.i].edit(); }));
    if (node.id === sel) {
      const kb = mk('button', 'kebab', '⋮'); kb.title = 'Edit this value';
      kb.onclick = (e) => { e.stopPropagation(); const r = dEl.getBoundingClientRect(); nodeMenu(node.id, r.right + 4, r.top); };
      dEl.appendChild(kb);
    }
  }
  [...host.children].forEach((d) => { if (!present.has(d.dataset.node)) d.remove(); });
}

function port(id) { const p = ST.pos[id]; return p ? { cx: p.x, cy: p.y + NH / 2, rx: p.x + NW } : null; }
function drawWires(sel, up, down) {
  const svg = $('#wires'); svg.setAttribute('width', ST.cw); svg.setAttribute('height', ST.ch); svg.setAttribute('viewBox', `0 0 ${ST.cw} ${ST.ch}`);
  let e = '';
  for (const { from, to } of ST.edges) {
    const pa = port(from), pb = port(to); if (!pa || !pb) continue;
    const x1 = pa.cx, y1 = pa.cy, x2 = pb.rx, y2 = pb.cy, mx = (x1 + x2) / 2;
    let cls = 'edge';
    // from===sel → an outgoing/dependent edge (gold, down); to===sel → an
    // incoming/dependency edge (steel, up) — matching the node tinting.
    if (sel && (from === sel || to === sel)) cls += (from === sel) ? ' down' : ' up';
    e += `<path class="${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="url(#ar)"/>`;
  }
  svg.innerHTML = '<defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.4" stroke-linecap="round"/></marker></defs>' + e;
}

function renderRoster(sel) {
  const host = $('#roster'); host.innerHTML = '<div class="rhead"><span>Values</span></div>';
  for (const node of nodeList()) {
    const row = mk('div', 'rrow' + (node.id === sel ? ' lit' : '')); row.dataset.ent = node.id;
    const conds = condsForNode(node).filter((c) => ['gate', 'eye', 'lock', 'fmtc'].includes(c.t)).length;
    const warn = ST.cyc.has(node.id);
    row.innerHTML = `<span class="hd" style="background:${warn ? 'var(--frayed)' : node.kind === 'computed' ? 'var(--gold-deep)' : '#3a5b48'}"></span>`
      + `<span class="rn">${labelOf(node.id)}</span><span class="rk">${conds ? '◇' + conds : node.kind === 'computed' ? 'ƒ' : ''}</span>`;
    row.onclick = () => select(node.id);
    host.appendChild(row);
  }
}

function renderConfig() {
  const host = $('#config'); host.innerHTML = '';
  for (const f of ST.ir.fields) {
    if (ST.res.visible[f.id] === false) continue;
    const dis = ST.res.enabled[f.id] === false;
    const row = mk('div', 'frow' + (dis ? ' dis' : ''));
    row.appendChild(mk('div', 'flab', `<span>${labelOf(f.id)}</span><span class="num" style="color:var(--faint)">${fmtRaw(f)}</span>`));
    if (f.type === 'choice') {
      const sel = mk('select'); sel.disabled = dis;
      for (const o of f.options) { const on = ST.res.optionState[f.id]?.[o.id] !== false; const op = mk('option', null, (presField(f.id)?.options || []).find((x) => x.id === o.id)?.label || o.id); op.value = o.id; op.selected = ST.config[f.id] === o.id; if (!on) op.disabled = true; sel.appendChild(op); }
      sel.onchange = () => setConfig(f.id, sel.value);
      row.appendChild(sel);
    } else if (f.type === 'multichoice') {
      const wrap = mk('div', 'chips'); const cur = new Set(ST.config[f.id] || []);
      for (const o of f.options) {
        const on = ST.res.optionState[f.id]?.[o.id] !== false;
        const chip = mk('button', 'chip-opt' + (cur.has(o.id) ? ' on' : '') + (on ? '' : ' una'), (presField(f.id)?.options || []).find((x) => x.id === o.id)?.label || o.id);
        chip.disabled = dis;
        chip.onclick = () => { if (dis) return; const s = new Set(ST.config[f.id] || []); s.has(o.id) ? s.delete(o.id) : s.add(o.id); setConfig(f.id, [...s]); };
        wrap.appendChild(chip);
      }
      row.appendChild(wrap);
    } else if (f.type === 'boolean') {
      const sel = mk('select'); sel.disabled = dis;
      for (const [v, l] of [[1, 'Yes'], [0, 'No']]) { const op = mk('option', null, l); op.value = v; op.selected = !!ST.config[f.id] === !!v; sel.appendChild(op); }
      sel.onchange = () => setConfig(f.id, +sel.value === 1);
      row.appendChild(sel);
    } else {
      const inp = mk('input'); inp.type = 'number'; inp.disabled = dis; inp.value = ST.config[f.id] ?? 0;
      const lim = ST.res.limits[f.id]; if (lim) { if (lim.min != null) inp.min = lim.min; if (lim.max != null) inp.max = lim.max; if (lim.step != null) inp.step = lim.step; }
      inp.onchange = () => setConfig(f.id, Number(inp.value) || 0);
      row.appendChild(inp);
    }
    host.appendChild(row);
  }
}
function fmtRaw(f) {
  const v = ST.config[f.id];
  if (Array.isArray(v)) return v.length ? v.length + ' selected' : '—';
  return '';
}

function renderQuote() {
  const host = $('#quote'); host.innerHTML = '';
  (ST.ir.outputs || []).forEach((o, i) => {
    const r = ST.res.outputs[i]; if (!r || !r.visible) return;
    const big = o.id === 'grandTotal';
    const row = mk('div', 'qrow' + (big ? ' big' : ''));
    row.innerHTML = `<span>${o.label}</span><b>${formatOutput(r, fmtOpts())}</b>`;
    row.onclick = () => select(o.id);
    host.appendChild(row);
  });
}

function inspector() {
  const box = $('#insp'), id = ST.sel;
  if (!id) { box.innerHTML = '<div class="ib empty">Select a value to trace it across the graph. Click a condition icon (ƒ formula, ◇ availability, 👁 visibility, ⇄ format) to <b>edit the rule</b>. Right-click a value — or use its <b>⋮</b> — to change its formula, add a condition, rename or delete. Right-click the canvas to add a value. Every change is a real model edit, validated by the engine, and undoable (↺ / Ctrl-Z).</div>'; return; }
  const isComp = !!dataComputed(id), isField = !!dataField(id);
  const own = isField ? (presField(id)?.visibleWhen || presField(id)?.enabledWhen ? 'split' : 'data') : 'data';
  const val = ST.res.valueById[id];
  let b = `<code>${id}</code>`;
  if (val != null) b += ` = <b>${nodeValue({ id, kind: isComp ? 'computed' : 'field' })}</b>`;
  if (isComp) b += ` &nbsp;·&nbsp; <code>${escapeHtml(formatExpr(dataComputed(id).formula))}</code>`;
  const refs = edit.referencesTo(pair(), id).map((r) => r.owner);
  if (refs.length) b += ` &nbsp;·&nbsp; feeds ${[...new Set(refs)].slice(0, 6).join(', ')}`;
  box.innerHTML = `<div><div class="it">${labelOf(id)}</div></div><span class="own ${own === 'split' ? 'pres' : 'data'}">${isComp ? 'computed · data' : own === 'split' ? 'data + presentation' : 'input · data'}</span><div class="ib">${b}</div>`;
}
const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---- interactions -----------------------------------------------------------
function select(id) { ST.sel = id; closePop(); closeMenu(); render(); }
function setConfig(id, val) { ST.config[id] = val; ST.res = ST.engine.evaluate(ST.config); render(); }

function status(kind, msg) { const s = $('#status'); s.className = 'status ' + (kind || ''); s.textContent = msg || ''; }

// ---- the commit path: validate → tryAssemble → reload engine → repaint ------
async function commit(next, label) {
  const r = tryAssemble(merged(next));
  if (!r.ok) { status('err', r.errors[0].message); toast(r.errors[0].message, false, true); return { ok: false, error: r.errors[0].message }; }
  // build the fresh engine BEFORE touching state, so a reload failure leaves
  // everything (ir/engine/edges/config/undo) consistent — the commit is atomic.
  let engine;
  try { engine = await loadEngine(ST.wasmBytes, r.assembled); }
  catch (e) { status('err', 'engine: ' + e.message); return { ok: false, error: e.message }; }
  pushUndo();
  ST.data = next.data; ST.pres = next.pres; ST.ir = r.assembled.ir; ST.engine = engine;
  pruneConfig();
  ST.res = ST.engine.evaluate(ST.config);
  ST.edges = ST.engine.graph(1) || edgesOf(ST.data);
  saveData(ST.data); savePres(ST.pres);
  layout(); render(); status('ok', label || 'Saved'); toast(label || 'Saved', true);
  return { ok: true };
}
function pruneConfig() {
  const ids = new Set(ST.ir.fields.map((f) => f.id)); const def = buildDefaults(ST.ir);
  for (const k of Object.keys(ST.config)) if (!ids.has(k)) delete ST.config[k];
  for (const f of ST.ir.fields) if (!(f.id in ST.config)) ST.config[f.id] = def[f.id];
}
function pushUndo() { UNDO.push({ data: clone(ST.data), pres: clone(ST.pres), config: clone(ST.config) }); if (UNDO.length > 50) UNDO.shift(); }
async function undo() {
  if (!UNDO.length) { toast('Nothing to undo'); return; }
  const s = UNDO.pop(); ST.data = s.data; ST.pres = s.pres; ST.config = s.config;
  const r = tryAssemble(merged(pair())); if (!r.ok) { status('err', r.errors[0].message); return; }
  ST.ir = r.assembled.ir; ST.engine = await loadEngine(ST.wasmBytes, r.assembled);
  ST.res = ST.engine.evaluate(ST.config); ST.edges = ST.engine.graph(1) || edgesOf(ST.data);
  saveData(ST.data); savePres(ST.pres); layout(); render(); toast('Reverted');
}

// ---- popover editors --------------------------------------------------------
function closePop() { $('#poplayer').innerHTML = ''; }
function placePop(p, rect) {
  const pr = p.getBoundingClientRect(); let L = rect.left - 8, T = rect.bottom + 8;
  if (L + pr.width > innerWidth - 10) L = innerWidth - pr.width - 10;
  if (T + pr.height > innerHeight - 10) T = rect.top - pr.height - 8;
  p.style.left = Math.max(10, L) + 'px'; p.style.top = Math.max(10, T) + 'px';
}
function nodeRect(id) { const d = $(`[data-node="${id}"]`); return d ? d.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: 160, bottom: 190 }; }

// A live formula/predicate editor. onSave(ast) commits; onRemove (optional) clears it.
function exprEditor(id, { kicker, title, glyphT, ast, onSave, onRemove }) {
  closePop(); closeMenu(); ST.sel = id; render();
  const p = mk('div', 'pop');
  const ids = [...ST.ir.fields.map((f) => f.id), ...ST.ir.computedIR.map((c) => c.id)].filter((x) => x !== id);
  const pal = ids.map((x) => `<button type="button" data-ins="${x}" title="insert ${x}">${x}</button>`).join('');
  p.innerHTML = `<button class="close">✕</button><div class="kicker">${labelOf(id)}</div>`
    + `<h4><span class="ic on" style="width:18px;height:18px">${glyph(glyphT)}</span>${title}</h4>`
    + `<div class="edl">Expression</div><textarea class="fx" spellcheck="false" rows="3" placeholder="e.g. vehiclePrice + fulfilmentTotal">${ast != null ? escapeHtml(formatExpr(ast)) : ''}</textarea>`
    + `<div class="vmsg"></div>`
    + `<div class="edl">Insert a value</div><div class="palette">${pal}</div>`
    + `<div class="prow">${onRemove ? '<button class="del">Remove</button>' : ''}<button class="save">Save</button></div>`
    + `<div class="hint">⌘/Ctrl↵ to save</div>`;
  $('#poplayer').appendChild(p); placePop(p, nodeRect(id));
  const fx = $('.fx', p), vmsg = $('.vmsg', p), save = $('.save', p);
  const autosize = () => { fx.style.height = 'auto'; fx.style.height = Math.min(200, fx.scrollHeight + 2) + 'px'; };
  const check = () => {
    const text = fx.value.trim();
    if (!text) { vmsg.className = 'vmsg'; vmsg.textContent = onRemove ? 'Empty — use Remove to clear.' : 'Enter an expression.'; save.disabled = true; fx.classList.remove('bad'); return; }
    const r = validateFormula(merged(pair()), text);
    if (r.ok) { vmsg.className = 'vmsg ok'; vmsg.textContent = r.refs.length ? 'references ' + r.refs.join(', ') : 'valid'; save.disabled = false; fx.classList.remove('bad'); }
    else { vmsg.className = 'vmsg bad'; vmsg.textContent = r.error.message; save.disabled = true; fx.classList.add('bad'); }
  };
  const insert = (t) => {
    const s = fx.selectionStart, e = fx.selectionEnd, v = fx.value, pre = v.slice(0, s), post = v.slice(e);
    const need = pre && !/\s$/.test(pre) ? ' ' : '';
    fx.value = pre + need + t + post; const pos = (pre + need + t).length;
    fx.focus(); fx.setSelectionRange(pos, pos); check(); autosize();
  };
  $$('[data-ins]', p).forEach((b) => (b.onclick = () => insert(b.dataset.ins)));
  fx.oninput = () => { check(); autosize(); }; check(); autosize();
  setTimeout(() => { fx.focus(); const n = fx.value.length; fx.setSelectionRange(n, n); }, 0);
  $('.close', p).onclick = closePop;
  save.onclick = async () => { let a; try { a = parseExpr(fx.value.trim()); } catch (e) { vmsg.className = 'vmsg bad'; vmsg.textContent = e.message; return; } closePop(); await onSave(a); };
  if (onRemove) $('.del', p).onclick = async () => { closePop(); await onRemove(); };
  fx.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !save.disabled) { e.preventDefault(); save.onclick(); } };
}

function editFormula(id) {
  exprEditor(id, { kicker: 'formula', title: 'Calculated', glyphT: 'calc', ast: dataComputed(id)?.formula,
    onSave: (ast) => commit(edit.setComputedFormula(pair(), id, ast), 'Edited formula') });
}
function editPredicate(id, kind) {
  const [scope, which] = kind.split(':');
  const get = scope === 'field' ? presField(id)?.[which] : outputDef(id)?.visibleWhen;
  const title = which === 'visibleWhen' ? 'Conditional visibility' : which === 'enabledWhen' ? 'Conditional enable' : 'Output visibility';
  exprEditor(id, { kicker: which, title, glyphT: which === 'enabledWhen' ? 'lock' : 'eye', ast: get,
    onSave: (ast) => scope === 'field' ? commit(edit.setFieldPredicate(pair(), id, which, ast), 'Edited ' + which) : commit(edit.setOutputPredicate(pair(), id, ast), 'Edited output rule'),
    onRemove: () => commit(removeKey(scope === 'field' ? 'field' : 'output', id, which), 'Removed ' + which) });
}
// clear a predicate key (delete, so it round-trips clean through the store)
function removeKey(scope, id, which) {
  const next = { data: clone(ST.data), pres: clone(ST.pres) };
  if (scope === 'field') { const pf = (next.pres.fields || []).find((f) => f.id === id); if (pf) delete pf[which]; }
  else { const o = (next.pres.outputs || []).find((x) => x.id === id); if (o) delete o.visibleWhen; }
  return next;
}
function editOptionGate(id) {
  const f = dataField(id); if (!f) return;
  closePop(); closeMenu(); ST.sel = id; render();
  const p = mk('div', 'pop');
  const opts = f.options.map((o) => `<option value="${o.id}">${o.id}${o.availableWhen ? ' ✓' : ''}</option>`).join('');
  p.innerHTML = `<button class="close">✕</button><div class="kicker">${labelOf(id)}</div>`
    + `<h4><span class="ic on" style="width:18px;height:18px">${glyph('gate')}</span>Option availability</h4>`
    + `<div class="edl">Option</div><select class="opt">${opts}</select>`
    + `<div class="edl">Available when</div><textarea class="fx" spellcheck="false" rows="2" placeholder="e.g. model == 'gtCoupe'"></textarea>`
    + `<div class="vmsg"></div><div class="prow"><button class="del">Remove</button><button class="save">Save</button></div>`;
  $('#poplayer').appendChild(p); placePop(p, nodeRect(id));
  const optSel = $('.opt', p), fx = $('.fx', p), vmsg = $('.vmsg', p), save = $('.save', p);
  const load = () => { const o = f.options.find((x) => x.id === optSel.value); fx.value = o?.availableWhen ? formatExpr(o.availableWhen) : ''; check(); };
  const check = () => { const t = fx.value.trim(); if (!t) { vmsg.className = 'vmsg'; vmsg.textContent = 'Empty — always available (or Remove).'; save.disabled = true; return; } const r = validateFormula(merged(pair()), t); if (r.ok) { vmsg.className = 'vmsg ok'; vmsg.textContent = r.refs.length ? 'references ' + r.refs.join(', ') : 'valid'; save.disabled = false; fx.classList.remove('bad'); } else { vmsg.className = 'vmsg bad'; vmsg.textContent = r.error.message; save.disabled = true; fx.classList.add('bad'); } };
  optSel.onchange = load; fx.oninput = check; load(); setTimeout(() => fx.focus(), 0);
  $('.close', p).onclick = closePop;
  save.onclick = async () => { let a; try { a = parseExpr(fx.value.trim()); } catch (e) { vmsg.className = 'vmsg bad'; vmsg.textContent = e.message; return; } closePop(); await commit(edit.setOptionPredicate(pair(), id, optSel.value, a), 'Edited availability'); };
  $('.del', p).onclick = async () => { const next = { data: clone(ST.data), pres: clone(ST.pres) }; const df = next.data.fields.find((x) => x.id === id); const o = df.options.find((x) => x.id === optSel.value); if (o) delete o.availableWhen; closePop(); await commit(next, 'Removed availability'); };
}
function infoFormat(id) {
  closePop(); const p = mk('div', 'pop');
  const od = outputDef(id);
  p.innerHTML = `<button class="close">✕</button><div class="kicker">${labelOf(id)}</div>`
    + `<h4><span class="ic on" style="width:18px;height:18px">⇄</span>Conditional format</h4>`
    + `<p>Displayed as <code>${od.format.type}</code> in <code>${od.format.currencyCode || ST.baseCurrency}</code>. When the display currency differs it converts at the ECB rate${ST.data.fxSurcharge ? ` then a +${Math.round(ST.data.fxSurcharge * 100)}% surcharge` : ''}. Change the display currency in the top bar.</p>`;
  $('#poplayer').appendChild(p); placePop(p, nodeRect(id)); $('.close', p).onclick = closePop;
}

// ---- context menu -----------------------------------------------------------
function closeMenu() { $$('.cmenu').forEach((m) => m.remove()); }
function menuAt(x, y, items) {
  closeMenu(); closePop(); const m = mk('div', 'cmenu');
  for (const it of items) {
    if (it === 'hr') { m.appendChild(mk('hr')); continue; }
    if (it.sub) { m.appendChild(mk('div', 'sub', it.sub)); continue; }
    const b = mk('button', it.danger ? 'danger' : ''); b.innerHTML = `<span class="mi">${it.ic || ''}</span>${it.label}${it.meta ? `<span class="mmeta">${it.meta}</span>` : ''}`;
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.act(); }; m.appendChild(b);
  }
  document.body.appendChild(m); const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function nodeMenu(id, x, y) {
  select(id);
  const isComp = !!dataComputed(id), isField = !!dataField(id);
  const conds = condsForNode({ id, kind: isComp ? 'computed' : 'field' });
  const b = deleteBlockers(id);
  const items = [];
  if (conds.length) items.push({ label: 'Edit ' + (isComp ? 'formula' : 'first rule'), ic: 'ƒ', act: () => conds[0].edit() });
  items.push({ sub: 'Add condition' });
  if (isField) {
    items.push({ label: 'Visibility condition', ic: ICO.eye, act: () => editPredicate(id, 'field:visibleWhen') });
    items.push({ label: 'Enable condition', ic: ICO.lock, act: () => editPredicate(id, 'field:enabledWhen') });
  }
  if (isComp && !outputDef(id)) items.push({ label: 'Surface as output', ic: '★', act: () => surfaceOutput(id) });
  if (outputDef(id)) items.push({ label: 'Output visibility', ic: ICO.eye, act: () => editPredicate(id, 'output:visibleWhen') });
  items.push('hr');
  items.push({ label: 'Rename', ic: 'A', act: () => startRename(id) });
  if (isComp) items.push({ label: 'Duplicate', ic: '⧉', act: () => duplicate(id) });
  items.push('hr');
  items.push({ label: 'Delete', ic: '✕', danger: true, meta: b.blocked ? (b.feeds.length ? 'feeds ' + b.feeds.length : b.selfTargets.join('/')) : '', act: () => del(id) });
  menuAt(x, y, items);
}
function canvasMenu(x, y) { menuAt(x, y, [{ label: 'Add value here…', ic: '+', act: () => showCreate(x, y) }]); }

function surfaceOutput(id) {
  const currency = ST.baseCurrency;
  const next = edit.addOutput(pair(), { id, label: labelOf(id), format: { type: 'currency', decimals: 0, currencyCode: currency } });
  commit(next, 'Surfaced ' + id);
}
function duplicate(id) {
  const c = dataComputed(id); if (!c) return;
  let nid = id + 'Copy', n = 2; while (dataComputed(nid) || dataField(nid)) nid = id + 'Copy' + (n++);
  commit(edit.addComputed(pair(), { id: nid, label: (c.label || id) + ' copy', formula: clone(c.formula) }), 'Duplicated ' + id);
}
// what would break if `id` were deleted: other owners that reference it (feeds),
// plus effect/validation entries that TARGET it (owner===id) — deleteField does
// not clean those up, so they must block too or commit fails with a raw error.
function deleteBlockers(id) {
  const refs = edit.referencesTo(pair(), id);
  const feeds = [...new Set(refs.filter((r) => r.owner !== id).map((r) => r.owner))];
  const selfTargets = [...new Set(refs.filter((r) => r.owner === id && /target$/.test(r.where)).map((r) => r.where.replace(' target', '')))];
  return { feeds, selfTargets, blocked: feeds.length > 0 || selfTargets.length > 0 };
}
async function del(id) {
  const b = deleteBlockers(id);
  if (b.blocked) {
    const reason = b.feeds.length ? `feeds ${b.feeds.join(', ')}` : `is an ${b.selfTargets.join('/')} target`;
    status('err', `"${id}" ${reason} — retarget those first.`);
    toast(`Can't delete: ${id} is still referenced`, false, true); return;
  }
  const next = dataComputed(id) ? edit.deleteComputed(pair(), id) : edit.deleteField(pair(), id);
  if (ST.sel === id) ST.sel = null;
  await commit(next, 'Deleted ' + id);
}

function startRename(id) {
  const d = $(`[data-node="${id}"]`); if (!d) return; const nn = $('.nname', d); if (!nn) return;
  const inp = mk('input', 'renin'); inp.value = labelOf(id); nn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const commitName = async () => {
    if (done) return; done = true;
    const v = inp.value.trim(); if (!v || v === labelOf(id)) { render(); return; }
    await commit(labelEdit(id, v), 'Renamed');
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } else if (e.key === 'Escape') { done = true; render(); } };
  inp.onblur = commitName;
}
// rename = set a presentation/computed LABEL (keeps the id + all refs stable)
function labelEdit(id, label) {
  const next = { data: clone(ST.data), pres: clone(ST.pres) };
  if (dataComputed(id)) { const c = next.data.computed.find((x) => x.id === id); c.label = label; }
  else { next.pres.fields = next.pres.fields || []; let pf = next.pres.fields.find((f) => f.id === id); if (!pf) { pf = { id }; next.pres.fields.push(pf); } pf.label = label; }
  // keep any surfacing output label in sync
  const o = (next.pres.outputs || []).find((x) => x.id === id); if (o) o.label = label;
  return next;
}

// ---- create-card (formula-first) --------------------------------------------
function showCreate(sx, sy) {
  $$('.createcard').forEach((c) => c.remove());
  const s = $('#stage').getBoundingClientRect();
  const cx = (sx - s.left - Z.tx) / Z.k, cy = (sy - s.top - Z.ty) / Z.k;
  const card = mk('div', 'createcard'); card.style.left = cx + 'px'; card.style.top = cy + 'px';
  card.innerHTML = '<input id="cn" placeholder="new value id (e.g. margin)"/><input id="cf" placeholder="formula · e.g. otr - vehiclePrice"/>'
    + '<div class="ch">Reference values by id. It becomes a computed value and a quote output.</div>'
    + '<div class="vmsg"></div><div class="cbtns"><button id="cc">Cancel</button><button class="go" id="cg">Create</button></div>';
  $('#canvas').appendChild(card); setTimeout(() => $('#cn', card).focus(), 0);
  const cn = $('#cn', card), cf = $('#cf', card), vmsg = $('.vmsg', card), go = $('#cg', card);
  const check = () => {
    const t = cf.value.trim(); if (!t) { vmsg.className = 'vmsg'; vmsg.textContent = ''; return true; }
    const r = validateFormula(merged(pair()), t);
    if (r.ok) { vmsg.className = 'vmsg ok'; vmsg.textContent = r.refs.length ? 'references ' + r.refs.join(', ') : 'valid'; return true; }
    vmsg.className = 'vmsg bad'; vmsg.textContent = r.error.message; return false;
  };
  cf.oninput = check;
  $('#cc', card).onclick = () => card.remove();
  go.onclick = async () => {
    const id = (cn.value.trim() || '').replace(/[^\w]/g, '');
    const text = cf.value.trim();
    if (!id) { vmsg.className = 'vmsg bad'; vmsg.textContent = 'Give it an id.'; return; }
    if (dataComputed(id) || dataField(id)) { vmsg.className = 'vmsg bad'; vmsg.textContent = 'That id already exists.'; return; }
    let ast; try { ast = parseExpr(text || '0'); } catch (e) { vmsg.className = 'vmsg bad'; vmsg.textContent = e.message; return; }
    const v = validateFormula(merged(pair()), ast);
    if (!v.ok) { vmsg.className = 'vmsg bad'; vmsg.textContent = v.error.message; return; }
    card.remove();
    let next = edit.addComputed(pair(), { id, label: cn.value.trim(), formula: ast });
    next = edit.addOutput(next, { id, label: cn.value.trim(), format: { type: 'currency', decimals: 0, currencyCode: ST.baseCurrency } });
    await commit(next, 'Added ' + id);
  };
  cf.onkeydown = (e) => { if (e.key === 'Enter') go.onclick(); };
}

// ---- toast ------------------------------------------------------------------
let toastT = null;
function toast(msg, undoable, isErr) {
  const old = $('.toast'); if (old) old.remove();
  const t = mk('div', 'toast' + (isErr ? ' err' : ''), `<b>${escapeHtml(msg)}</b>` + (undoable ? '<button id="tu">Undo</button>' : ''));
  document.body.appendChild(t);
  if (undoable) $('#tu', t).onclick = () => { t.remove(); undo(); };
  clearTimeout(toastT); toastT = setTimeout(() => { try { t.remove(); } catch (_) { } }, isErr ? 6000 : 4000);
}

// ---- pan / zoom / fit -------------------------------------------------------
function applyZoom() {
  const cv = $('#canvas'); cv.style.transform = `translate(${Z.tx}px,${Z.ty}px) scale(${Z.k})`;
  cv.classList.toggle('zfar', Z.k < 0.62); cv.classList.toggle('zvfar', Z.k < 0.42);
  $('#zpct').textContent = Math.round(Z.k * 100) + '%';
}
function fit() {
  const st = $('#stage').getBoundingClientRect();
  const k = Math.max(0.3, Math.min(1.3, Math.min((st.width - 60) / ST.cw, (st.height - 90) / ST.ch)));
  Z.k = k; Z.tx = (st.width - ST.cw * k) / 2; Z.ty = 24; applyZoom();
}
function wireChrome() {
  const stage = $('#stage');
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const s = stage.getBoundingClientRect(); const mx = e.clientX - s.left, my = e.clientY - s.top; const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; const nk = Math.max(0.3, Math.min(1.6, Z.k * f)); const r = nk / Z.k; Z.tx = mx - (mx - Z.tx) * r; Z.ty = my - (my - Z.ty) * r; Z.k = nk; $('#canvas').classList.add('panning'); applyZoom(); clearTimeout(stage._wt); stage._wt = setTimeout(() => $('#canvas').classList.remove('panning'), 140); }, { passive: false });
  let drag = null;
  stage.addEventListener('mousedown', (e) => { if (e.target.closest('.node,.createcard,.kebab,.insp')) return; drag = { x: e.clientX, y: e.clientY, tx: Z.tx, ty: Z.ty }; stage.classList.add('grabbing'); $('#canvas').classList.add('panning'); closePop(); closeMenu(); $$('.createcard').forEach((c) => c.remove()); });
  window.addEventListener('mousemove', (e) => { if (!drag) return; Z.tx = drag.tx + (e.clientX - drag.x); Z.ty = drag.ty + (e.clientY - drag.y); applyZoom(); });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; stage.classList.remove('grabbing'); $('#canvas').classList.remove('panning'); } });
  stage.addEventListener('contextmenu', (e) => { if (e.target.closest('.node,.ic,.kebab')) return; e.preventDefault(); canvasMenu(e.clientX, e.clientY); });
  $('#zin').onclick = () => { Z.k = Math.min(1.6, Z.k * 1.15); applyZoom(); };
  $('#zout').onclick = () => { Z.k = Math.max(0.3, Z.k / 1.15); applyZoom(); };
  $('#zfit').onclick = fit;
  $('#undoBtn').onclick = () => undo();
  $('#units').onchange = (e) => { ST.unitSystem = e.target.value; render(); };
  $('#cur').onchange = (e) => { ST.currency = e.target.value; render(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); closeMenu(); $$('.createcard').forEach((c) => c.remove()); } if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); } });
  window.addEventListener('mousedown', (e) => { if (!e.target.closest('.cmenu')) closeMenu(); }, true);
  window.addEventListener('resize', fit);
}
function initCurrencySelect() {
  const sel = $('#cur'); const list = ST.data.currencies && ST.data.currencies.length ? ST.data.currencies : [ST.baseCurrency];
  sel.innerHTML = list.map((c) => `<option${c === ST.currency ? ' selected' : ''}>${c}</option>`).join('');
}
