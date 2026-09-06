// =============================================================================
// journey-loom.mjs — the MACRO authoring altitude: the sale-hqdm picture, live
// and editable. Boxes = models (tinted by phase), solid wires = structural
// bindings, dashed = behavioural triggers. Click a box → drill into its value-
// graph Loom (loom.html?m=…). Click a wire → edit its mapping/condition, live-
// validated by validateSeam (the assembler's own error, inline). A lattice-lint
// rail shows analyzeJourney findings. Domain-agnostic: it edits the journey doc
// + reads the models generically — no sale concept in this code.
// =============================================================================
import { assemble, mergeModel } from './assembler.mjs';
import { JOURNEY_ID, currentJourney, saveJourney, resetJourney, loadModelFiles, loadDomain } from './store.mjs';
import { EngineHost, evaluateJourney } from './compose.mjs';
import { analyzeJourney, validateSeam, validateTrigger } from './journey-validate.mjs';
import * as jedit from './journey-edit.mjs';
import { parseExpr, formatExpr } from './expr.mjs';
import { buildDefaults } from './preview.mjs';
import { phasesOf } from './hqdm.mjs';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const money0 = (v, cur) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(v);
const clone = (x) => JSON.parse(JSON.stringify(x));

// pure: a journey doc → the macro graph (boxes + typed wires). Exported for tests.
export function macroGraph(journey) {
  const nodes = (journey.models || []).map((m) => ({ alias: m.as, ref: m.ref, phase: m.phase || null, role: m.role || null }));
  const edges = [];
  for (const b of journey.bindings || []) edges.push({ id: b.id, kind: 'binding', from: b.from, to: b.to, label: (b.contract && b.contract.provides && b.contract.provides[0] && b.contract.provides[0].as) || b.id });
  for (const t of journey.triggers || []) edges.push({ id: t.id, kind: 'trigger', from: t.on, to: t.activates, label: t.id });
  return { nodes, edges };
}

const JID = JOURNEY_ID || 'vehicle-sale';
let jrn, host, live = null, domainDoc = null; const models = {}; const undo = [];
// phases: the journey's own, else its domain's (data, never a baked-in constant).
const resolvePhases = () => { const p = phasesOf(jrn); return p.length ? p : phasesOf(domainDoc || {}); };

if (typeof document !== 'undefined') (async function boot() {
  try {
    jrn = await currentJourney(JID);
    domainDoc = await loadDomain();
    const wasmBytes = new Uint8Array(await (await fetch('quote.wasm')).arrayBuffer());
    host = new EngineHost(wasmBytes);
    for (const m of jrn.models || []) { const { data, presentation } = await loadModelFiles(m.ref); const merged = mergeModel(data, presentation); models[m.as] = { merged, assembled: assemble(merged) }; }
  } catch (e) { const b = $('#jboot'); if (b) { b.textContent = 'Could not load the journey: ' + e.message; b.style.color = '#e79b8c'; } return; }
  $('#jboot')?.remove();
  $('#jundo').onclick = () => { if (undo.length) { jrn = undo.pop(); persist(); recompute(); } };
  $('#jreset').onclick = () => { resetJourney(JID); location.reload(); };
  const addTrig = $('#jaddtrig'); if (addTrig) addTrig.onclick = (ev) => openTrigger(newTrigger(), ev);
  const struct = $('#jstruct'); if (struct) struct.href = `journey-create.html?j=${encodeURIComponent(JID)}`;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  window.addEventListener('mousedown', (e) => { if (!e.target.closest('.jpop')) closePop(); }, true);
  await recompute();
})();

function persist() { saveJourney(JID, jrn); }
function pushUndo() { undo.push(clone(jrn)); if (undo.length > 50) undo.shift(); }

async function recompute() {
  const cfg = {}; for (const a in models) cfg[a] = buildDefaults(models[a].assembled.ir);
  try { live = await evaluateJourney(jrn, models, host, cfg); } catch (_) { live = null; }
  render();
}

function lintSets() {
  const a = analyzeJourney(jrn, models); const edges = new Set(), nodes = new Set();
  const ids = (jrn.bindings || []).map((b) => b.id).concat((jrn.triggers || []).map((t) => t.id));
  const aliases = (jrn.models || []).map((m) => m.as);
  for (const f of a.findings) { if (f.severity !== 'error') continue; for (const id of ids) if (f.message.includes(`"${id}"`)) edges.add(id); for (const al of aliases) if (f.message.includes(`"${al}"`)) nodes.add(al); }
  return { edges, nodes, findings: a.findings };
}

function render() { const lint = lintSets(); renderCanvas(lint); renderLint(lint); }

function emphasisFig(alias) { const b = live && live.byAlias[alias]; const price = b && b.individuals && b.individuals.price; return price && price.amount != null ? money0(price.amount, models[alias].merged.currency) : ''; }

function renderCanvas(lint) {
  const stage = $('#jstage'); stage.innerHTML = '';
  const { nodes, edges } = macroGraph(jrn);
  const phases = resolvePhases();
  // apply each phase's tint from data as a --p-<id> custom property (no CSS hardcode)
  for (const p of phases) if (p.tint) stage.style.setProperty(`--p-${p.id}`, p.tint);
  const phasesUsed = phases.filter((p) => nodes.some((n) => n.phase === p.id));
  const nCol = Math.max(1, phasesUsed.length);
  const COLW = Math.max(250, Math.floor((stage.clientWidth || 1000) / nCol));

  const bands = el('div', 'jbands');
  phasesUsed.forEach((p) => bands.appendChild(el('div', 'jband', `<div class="jband-l">${p.label}</div>`)));

  const pos = {}; const perCol = {};
  nodes.forEach((n) => { const col = Math.max(0, phasesUsed.findIndex((p) => p.id === n.phase)); const row = (perCol[col] = perCol[col] || 0); perCol[col]++; pos[n.alias] = { x: col * COLW + (COLW - 190) / 2, y: 70 + row * 140 }; });
  const W = nCol * COLW, H = Math.max(420, ...Object.values(perCol).map((c) => 90 + c * 140));

  const canvas = el('div', 'jcanvas'); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'jwires'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let paths = '';
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to]; if (!a || !b) continue;
    const x1 = a.x + 190, y1 = a.y + 34, x2 = b.x, y2 = b.y + 34, mx = (x1 + x2) / 2;
    const d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    paths += `<path class="jhit" d="${d}" data-edge="${e.id}"/><path class="jedge ${e.kind}${lint.edges.has(e.id) ? ' lit' : ''}" d="${d}"/><text class="jelabel" x="${mx}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle">${e.label}</text>`;
  }
  svg.innerHTML = paths; canvas.appendChild(svg);

  for (const n of nodes) {
    const p = pos[n.alias]; const box = el('div', 'jnode' + (lint.nodes.has(n.alias) ? ' bad' : ''));
    box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; box.style.setProperty('--nc', `var(--p-${n.phase || (phases[0] && phases[0].id) || 'default'}, var(--p-default))`);
    const fig = emphasisFig(n.alias);
    box.innerHTML = `<div class="jn-role">${n.role || n.phase || ''}</div><div class="jn-name">${(models[n.alias] && models[n.alias].merged.name) || n.alias}</div>${fig ? `<div class="jn-fig num">${fig}</div>` : ''}<div class="jn-drill">↳ open value graph</div>`;
    box.onclick = () => { location.href = `loom.html?m=${encodeURIComponent(n.ref)}`; };
    canvas.appendChild(box);
  }
  stage.append(bands, canvas);
  svg.querySelectorAll('[data-edge]').forEach((h) => h.addEventListener('click', (ev) => { ev.stopPropagation(); openSeam(h.dataset.edge, ev); }));
}

function renderLint(lint) {
  const host2 = $('#jlint'); host2.innerHTML = '<h5>Lattice lint</h5>';
  if (!lint.findings.length) { host2.appendChild(el('div', 'jclean', '✓ No issues — the journey composes.')); return; }
  for (const f of lint.findings) { const d = el('div', 'jfind ' + f.severity, `<div class="jf-k">${f.kind}</div>${f.message}`); host2.appendChild(d); }
}

// ---- seam editor popover ----
function closePop() { const l = $('#jpoplayer'); if (l) l.innerHTML = ''; }
function place(p, ev) { const r = p.getBoundingClientRect(); let x = (ev.clientX || 200) + 8, y = (ev.clientY || 200) + 8; if (x + r.width > innerWidth - 10) x = innerWidth - r.width - 10; if (y + r.height > innerHeight - 10) y = innerHeight - r.height - 10; p.style.left = Math.max(10, x) + 'px'; p.style.top = Math.max(10, y) + 'px'; }
function toast(msg, isErr) { const old = $('.jtoast'); if (old) old.remove(); const t = el('div', 'jtoast' + (isErr ? ' err' : ''), `<b>${msg}</b>`); document.body.appendChild(t); setTimeout(() => { try { t.remove(); } catch (_) { } }, 3000); }

// a fresh domain-neutral trigger with a unique id (deterministic counter).
function newTrigger() {
  const al = (jrn.models || []).map((m) => m.as);
  let n = 1; while ((jrn.triggers || []).some((t) => t.id === 'trigger' + n)) n++;
  return { id: 'trigger' + n, on: al[0] || '', activates: al[1] || al[0] || '', guard: undefined };
}

// the editable trigger popover (behavioural seam): on / activates / guard, live-
// validated by validateTrigger. `trigger` may be an existing one (edit) or a fresh
// newTrigger() (add) — Save upserts via jedit.setTrigger, so one code path serves both.
function openTrigger(trigger, ev) {
  closePop();
  const exists = (jrn.triggers || []).some((t) => t.id === trigger.id);
  const p = el('div', 'jpop');
  const opts = (jrn.models || []).map((m) => `<option value="${m.as}"${m.as === trigger.on ? ' selected' : ''}>${m.as}</option>`).join('');
  const optsAct = (jrn.models || []).map((m) => `<option value="${m.as}"${m.as === trigger.activates ? ' selected' : ''}>${m.as}</option>`).join('');
  p.innerHTML = `<button class="close">✕</button><div class="jp-k">trigger</div><h4>${trigger.id}</h4>`
    + `<div class="jlab">On (model reaches guard)</div><select class="jsel" id="jton">${opts}</select>`
    + `<div class="jlab">Activates</div><select class="jsel" id="jtact">${optsAct}</select>`
    + `<div class="jlab">Guard (blank = fires unconditionally)</div><textarea class="jfx" id="jtguard" spellcheck="false">${trigger.guard ? formatExpr(trigger.guard) : ''}</textarea>`
    + `<div class="jvmsg" id="jtvm"></div><div class="jrow">${exists ? '<button class="del">Delete</button>' : ''}<button class="cancel">Cancel</button><button class="save">Save</button></div>`;
  $('#jpoplayer').appendChild(p); place(p, ev);
  const on = $('#jton', p), act = $('#jtact', p), guard = $('#jtguard', p), vm = $('#jtvm', p), save = $('.save', p);
  const candidate = () => {
    const g = guard.value.trim();
    const guardAst = g ? parseExpr(g) : undefined;
    return jedit.setTrigger(jrn, { id: trigger.id, on: on.value, activates: act.value, ...(guardAst !== undefined ? { guard: guardAst } : {}) });
  };
  const check = () => {
    let cand; try { cand = candidate(); } catch (e) { vm.className = 'jvmsg bad'; vm.textContent = e.message; guard.classList.add('bad'); save.disabled = true; return null; }
    guard.classList.remove('bad');
    const r = validateTrigger(cand, cand.triggers.find((x) => x.id === trigger.id), models);
    if (r.ok) { vm.className = 'jvmsg ok'; vm.textContent = 'valid'; save.disabled = false; } else { vm.className = 'jvmsg bad'; vm.textContent = r.errors[0]; save.disabled = true; }
    return cand;
  };
  on.onchange = check; act.onchange = check; guard.oninput = check; check();
  $('.close', p).onclick = closePop; $('.cancel', p).onclick = closePop;
  save.onclick = () => { const cand = check(); if (!cand || save.disabled) return; pushUndo(); jrn = cand; persist(); closePop(); recompute(); toast('Trigger saved'); };
  const del = $('.del', p); if (del) del.onclick = () => { pushUndo(); jrn = jedit.removeTrigger(jrn, trigger.id); persist(); closePop(); recompute(); toast('Trigger removed'); };
}

function openSeam(edgeId, ev) {
  closePop();
  const b = (jrn.bindings || []).find((x) => x.id === edgeId);
  if (!b) { // a trigger edge → the editable trigger popover
    const t = (jrn.triggers || []).find((x) => x.id === edgeId); if (!t) return;
    return openTrigger(t, ev);
  }
  const p = el('div', 'jpop');
  const provs = (b.contract.provides || []).map((x) => `${x.as}:${x.l0}`).join(', ');
  const reqs = (b.contract.requires || []).map((x) => `${x.target} (${x.l0})`).join(', ');
  const targetField = ((b.contract.requires[0] || {}).target || '').split(':')[1] || '';
  p.innerHTML = `<button class="close">✕</button><div class="jp-k">${b.from} → ${b.to}</div><h4>${b.id}</h4>`
    + `<div class="jp-contract">provides <code>${provs}</code><br>requires <code>${reqs}</code></div>`
    + `<div class="jlab">Mapping → ${targetField}</div><textarea class="jfx" id="jmap" spellcheck="false">${b.mapping && b.mapping[0] ? formatExpr(b.mapping[0].from) : ''}</textarea>`
    + `<div class="jlab">Condition (optional)</div><textarea class="jfx" id="jcond" spellcheck="false">${b.condition ? formatExpr(b.condition) : ''}</textarea>`
    + `<div class="jvmsg" id="jvm"></div><div class="jrow"><button class="cancel">Cancel</button><button class="save">Save</button></div>`;
  $('#jpoplayer').appendChild(p); place(p, ev);
  const map = $('#jmap', p), cond = $('#jcond', p), vm = $('#jvm', p), save = $('.save', p);
  const candidate = () => {
    const mAst = parseExpr(map.value.trim());
    let c = jedit.setSeamMapping(jrn, b.id, [{ to: targetField, from: mAst }]);
    c = cond.value.trim() ? jedit.setSeamCondition(c, b.id, parseExpr(cond.value.trim())) : jedit.setSeamCondition(c, b.id, null);
    return c;
  };
  const check = () => {
    let cand; try { cand = candidate(); } catch (e) { vm.className = 'jvmsg bad'; vm.textContent = e.message; map.classList.add('bad'); save.disabled = true; return null; }
    map.classList.remove('bad');
    const r = validateSeam(cand, cand.bindings.find((x) => x.id === b.id), models);
    if (r.ok) { vm.className = 'jvmsg ok'; vm.textContent = 'valid'; save.disabled = false; } else { vm.className = 'jvmsg bad'; vm.textContent = r.errors[0]; save.disabled = true; }
    return cand;
  };
  map.oninput = check; cond.oninput = check; check();
  $('.close', p).onclick = closePop; $('.cancel', p).onclick = closePop;
  save.onclick = () => { const cand = check(); if (!cand || save.disabled) return; pushUndo(); jrn = cand; persist(); closePop(); recompute(); toast('Seam saved'); };
}
