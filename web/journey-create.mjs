// =============================================================================
// journey-create.mjs — the form-based journey CREATE/EDIT surface (a companion to
// the macro canvas journey.html). It mints new journeys and edits models[],
// bindings[], triggers[], and the process steps through FORMS, every write going
// through the pure ops in journey-edit.mjs + journey-create-core.mjs, live-checked
// by journey-validate.mjs, and persisted via store.saveJourney (+ a local catalog
// overlay for created journeys). Domain-agnostic: it reads models + the neutral
// hqdm vocabulary generically — no sale concept in this code.
//   ?j=<id>  → EDIT that journey.   (absent) → CREATE + list existing journeys.
// =============================================================================
import { assemble, mergeModel } from './assembler.mjs';
import { JOURNEY_ID, currentJourney, saveJourney, resetJourney, getStoredJourney,
  loadCatalog, loadJourneyCatalog, loadModelFiles, mergedJourneyCatalog, loadDomain,
  getLocalJourneyCatalog, saveLocalJourneyEntry, removeLocalJourneyEntry } from './store.mjs';
import * as jedit from './journey-edit.mjs';
import { analyzeJourney, validateSeam } from './journey-validate.mjs';
import { newJourney, uniqueJourneyId } from './journey-create-core.mjs';
import { phasesOf, STEP_KINDS, NEUTRAL_CATEGORIES } from './hqdm.mjs';
import { categoryOf } from './individuals.mjs';
import { parseExpr } from './expr.mjs';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const opt = (v, sel, label) => `<option value="${v}"${v === sel ? ' selected' : ''}>${label ?? v}</option>`;

let JID = JOURNEY_ID;
let jrn = null; const models = {}; const undo = []; let created = false;
let allModels = []; let domainDoc = null;

// the phase lifecycle: the journey's own, else its domain's (data, never hardcoded).
const resolvePhases = () => { const p = phasesOf(jrn); return p.length ? p : phasesOf(domainDoc || {}); };

(async function boot() {
  try {
    domainDoc = await loadDomain();
    allModels = ((await loadCatalog().catch(() => ({ models: [] }))).models) || [];
    if (JID) { jrn = await currentJourney(JID); await loadModels(); }
  } catch (e) { $('#jc-boot').textContent = 'Load failed: ' + e.message; return; }
  $('#jc-undo').onclick = () => { if (undo.length) { jrn = undo.pop(); persist(); render(); } };
  $('#jc-reset').onclick = onReset;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const p = $('.jc-pop'); if (p) p.remove(); } });
  render();
})();

async function loadModels() {
  for (const m of jrn.models || []) {
    if (models[m.as]) continue;
    try { const { data, presentation } = await loadModelFiles(m.ref); const merged = mergeModel(data, presentation); models[m.as] = { merged, assembled: assemble(merged) }; }
    catch (_) { /* leave unloaded; analyzeJourney flags an unknown-model */ }
  }
}

function persist() { if (JID && jrn) { saveJourney(JID, jrn); if (created) saveLocalJourneyEntry({ id: JID, title: jrn.title || JID, blurb: jrn.title || '', local: true }); } }
function pushUndo() { undo.push(clone(jrn)); if (undo.length > 50) undo.shift(); }
async function mut(fn) { pushUndo(); jrn = fn(jrn); await loadModels(); persist(); render(); }
function toast(msg, isErr) { const old = $('.toast'); if (old) old.remove(); const t = el('div', 'toast' + (isErr ? ' err' : ''), `<b>${msg}</b>`); document.body.appendChild(t); setTimeout(() => { try { t.remove(); } catch (_) {} }, 2600); }

function onReset() {
  if (!JID) return;
  if (created) { if (confirm('Delete this created journey?')) { resetJourney(JID); removeLocalJourneyEntry(JID); location.href = 'journey-create.html'; } }
  else if (confirm('Reset this journey to the shipped version?')) { resetJourney(JID); location.reload(); }
}

// ---------------------------------------------------------------------------
function render() { JID && jrn ? renderEditor() : renderCreateList(); }

// ---- create + list mode ----------------------------------------------------
async function renderCreateList() {
  $('#jc-canvas').style.display = 'none'; $('#jc-run').style.display = 'none'; $('#jc-undo').style.display = 'none'; $('#jc-reset').style.display = 'none';
  const main = $('#jc-main'); main.innerHTML = '';
  main.appendChild(el('h1', null, 'Journey Studio'));
  main.appendChild(el('p', 'sub', 'Compose models into a sale journey — the typed seams and process between them. Create a new one, or edit an existing journey.'));
  main.appendChild(el('h2', null, 'New journey'));
  const box = el('div');
  box.appendChild(el('div', 'lab', 'Title'));
  const title = el('input', 'f', ''); title.placeholder = 'e.g. Art acquisition'; box.appendChild(title);
  box.appendChild(el('div', 'lab', 'Correlation prefix (order ids)'));
  const pfx = el('input', 'f', ''); pfx.placeholder = 'e.g. ART'; box.appendChild(pfx);
  const err = el('div', 'vmsg'); box.appendChild(err);
  const btn = el('button', 'jbtn primary', 'Create journey ▸'); btn.style.marginTop = '8px';
  btn.onclick = async () => {
    const t = title.value.trim(); if (!t) { err.className = 'vmsg bad'; err.textContent = 'A title is required.'; return; }
    const existing = new Set(((await mergedJourneyCatalog()).journeys || []).map((e) => e.id));
    const id = uniqueJourneyId(t, existing);
    const doc = newJourney(id, t, pfx.value.trim());
    if (domainDoc && Array.isArray(domainDoc.phases)) doc.phases = domainDoc.phases;   // inherit the domain lifecycle
    saveJourney(id, doc); saveLocalJourneyEntry({ id, title: t, blurb: t, local: true });
    location.href = `journey-create.html?j=${encodeURIComponent(id)}`;
  };
  box.appendChild(btn); main.appendChild(box);

  const side = $('#jc-side'); side.innerHTML = '';
  side.appendChild(el('h5', null, 'Journeys'));
  const cat = await mergedJourneyCatalog();
  const localIds = new Set((getLocalJourneyCatalog().journeys || []).map((e) => e.id));
  for (const e of cat.journeys || []) {
    const row = el('div', 'jrow');
    row.appendChild(el('div', 'jname', `${e.title || e.id}<small>${e.id}${localIds.has(e.id) ? ' · draft' : ''}</small>`));
    row.appendChild(el('a', null, 'Edit')).href = `journey-create.html?j=${encodeURIComponent(e.id)}`;
    row.appendChild(el('a', null, 'Run')).href = `configure.html?j=${encodeURIComponent(e.id)}`;
    side.appendChild(row);
  }
  if (!(cat.journeys || []).length) side.appendChild(el('div', 'find', 'No journeys yet — create one.'));
}

// ---- edit mode -------------------------------------------------------------
function renderEditor() {
  created = !!(getStoredJourney(JID) && !isShipped(JID));
  $('#jc-canvas').style.display = ''; $('#jc-run').style.display = ''; $('#jc-undo').style.display = ''; $('#jc-reset').style.display = '';
  $('#jc-canvas').href = `journey.html?j=${encodeURIComponent(JID)}`;
  $('#jc-run').href = `configure.html?j=${encodeURIComponent(JID)}`;
  const main = $('#jc-main'); main.innerHTML = '';
  for (const p of resolvePhases()) if (p.tint) main.style.setProperty(`--p-${p.id}`, p.tint);   // phase tints from data
  main.appendChild(el('h1', null, jrn.title || JID));
  main.appendChild(el('p', 'sub', `id: ${JID} · version ${jrn.version || '—'}`));
  renderMeta(main); renderModelsSection(main); renderBindingsSection(main); renderStepsSection(main);
  renderLint();
}

let shippedIds = null;
function isShipped(id) { return shippedIds ? shippedIds.has(id) : false; }
(async () => { try { const c = await loadJourneyCatalog(); shippedIds = new Set((c.journeys || []).map((e) => e.id)); if (JID && jrn) renderEditor(); } catch (_) { shippedIds = new Set(); } })();

function renderMeta(main) {
  main.appendChild(el('h2', null, 'Details'));
  const g = el('div', 'grid2');
  const title = el('input', 'f', ''); title.value = jrn.title || ''; title.placeholder = 'Title';
  title.onchange = () => mut((x) => jedit.setMeta(x, { title: title.value.trim() }));
  const pfx = el('input', 'f', ''); pfx.value = jrn.correlationPrefix || ''; pfx.placeholder = 'Correlation prefix';
  pfx.onchange = () => mut((x) => jedit.setMeta(x, { correlationPrefix: pfx.value.trim() }));
  const tw = el('div'); tw.appendChild(el('div', 'lab', 'Title')); tw.appendChild(title);
  const pw = el('div'); pw.appendChild(el('div', 'lab', 'Correlation prefix')); pw.appendChild(pfx);
  g.append(tw, pw); main.appendChild(g);
}

function renderModelsSection(main) {
  const h = el('h2', null, `Models <span class="cmeta">(${(jrn.models || []).length})</span>`); main.appendChild(h);
  for (const m of jrn.models || []) {
    const card = el('div', 'card'); card.style.setProperty('--nc', `var(--p-${m.phase || 'default'}, var(--p-default))`);
    const head = el('div', 'ch');
    head.appendChild(el('div', 'ct', m.as));
    head.appendChild(el('div', 'cmeta', `${m.ref} · ${m.phase}${m.role ? ' · ' + m.role : ''}`));
    const x = el('button', 'cx', 'remove');
    x.onclick = () => { const refs = jedit.referencesToModel(jrn, m.as); if (refs.length && !confirm(`"${m.as}" is used by ${refs.length} binding/trigger(s). Remove anyway?`)) return; mut((j) => jedit.removeModelRef(j, m.as)); };
    head.appendChild(x); card.appendChild(head); main.appendChild(card);
  }
  // add-model row
  const row = el('div', 'addrow');
  const ref = el('select', 'f'); ref.innerHTML = allModels.map((mm) => opt(mm.id, '', `${mm.title || mm.name || mm.id}`)).join('') || '<option value="">(no models)</option>';
  const as = el('input', 'f', ''); as.placeholder = 'alias';
  const phz = resolvePhases(); const phase = el('select', 'f'); phase.innerHTML = phz.map((p) => opt(p.id, (phz[0] || {}).id, p.label)).join('');
  const role = el('input', 'f', ''); role.placeholder = 'role (optional)';
  const add = el('button', 'jbtn', 'Add model');
  const suggestAlias = () => { if (!as.value.trim()) as.value = defaultAlias(ref.value); };
  ref.onchange = suggestAlias; suggestAlias();
  add.onclick = () => {
    const a = (as.value.trim() || defaultAlias(ref.value));
    if ((jrn.models || []).some((m) => m.as === a)) { toast('That alias is already used.', true); return; }
    mut((j) => jedit.addModelRef(j, { ref: ref.value, as: a, phase: phase.value, ...(role.value.trim() ? { role: role.value.trim() } : {}) }));
  };
  const wrap = (lab, node) => { const d = el('div'); d.appendChild(el('div', 'lab', lab)); d.appendChild(node); return d; };
  row.append(wrap('Model', ref), wrap('Alias', as), wrap('Phase', phase), wrap('Role', role), add);
  main.appendChild(row);
}
function defaultAlias(ref) { let base = (ref || 'model').replace(/[^a-z0-9]/gi, '') || 'model'; let a = base, n = 2; while ((jrn.models || []).some((m) => m.as === a)) a = base + n++; return a; }

function renderBindingsSection(main) {
  main.appendChild(el('h2', null, `Bindings <span class="cmeta">(${(jrn.bindings || []).length})</span>`));
  for (const b of jrn.bindings || []) {
    const card = el('div', 'card');
    const head = el('div', 'ch');
    head.appendChild(el('div', 'ct', b.id));
    head.appendChild(el('div', 'cmeta', `${b.from} → ${b.to}`));
    const x = el('button', 'cx', 'remove'); x.onclick = () => mut((j) => jedit.removeBinding(j, b.id)); head.appendChild(x);
    card.appendChild(head);
    const pv = (b.contract && b.contract.provides || []).map((p) => `${p.as}`).join(', ');
    const rq = (b.contract && b.contract.requires || []).map((r) => (r.target || r.name)).join(', ');
    card.appendChild(el('div', 'cmeta', `provides ${pv || '—'} → requires ${rq || '—'}`));
    card.appendChild(el('div', 'cmeta', 'Edit the mapping/condition on the canvas ◱'));
    main.appendChild(card);
  }
  const aliases = (jrn.models || []).map((m) => m.as);
  if (aliases.length < 2) { main.appendChild(el('p', 'sub', 'Add two or more models to create a binding.')); return; }
  const row = el('div', 'addrow');
  const from = el('select', 'f'); const to = el('select', 'f');
  from.innerHTML = aliases.map((a) => opt(a, aliases[0])).join('');
  to.innerHTML = aliases.map((a) => opt(a, aliases[1])).join('');
  const prov = el('select', 'f'); const req = el('select', 'f');
  const vmsg = el('div', 'vmsg');
  const add = el('button', 'jbtn', 'Add binding');
  const refreshOpts = () => {
    const fm = models[from.value], tm = models[to.value];
    prov.innerHTML = fm ? provideOptions(fm.merged) : '<option value="">(model not loaded)</option>';
    req.innerHTML = tm ? requireOptions(tm.merged) : '<option value="">(model not loaded)</option>';
    check();
  };
  const candidate = () => {
    const fm = models[from.value], tm = models[to.value];
    const [pkind, pid] = (prov.value || '').split(':');
    const tid = (req.value || '').split(':')[1];
    if (!fm || !tm || !pid || !tid) return null;
    const pl0 = categoryOf(fm.merged, pid) || 'amount_of_money';
    const rl0 = categoryOf(tm.merged, tid) || pl0;
    const id = uniqueBindingId(`${from.value}-${tid}`);
    const binding = {
      id, from: from.value, to: to.value,
      contract: { provides: [{ as: pid, l0: pl0, source: prov.value }], requires: [{ name: tid, l0: rl0, target: `field:${tid}` }] },
      mapping: [{ to: tid, from: { op: 'field', args: [pid] } }],
    };
    return jedit.addBinding(jrn, binding);
  };
  const check = () => {
    const cand = candidate();
    if (!cand) { vmsg.className = 'vmsg bad'; vmsg.textContent = 'Pick a provided value and a target field.'; add.disabled = true; return null; }
    const b = cand.bindings[cand.bindings.length - 1];
    const r = validateSeam(cand, b, models);
    if (r.ok) { vmsg.className = 'vmsg ok'; vmsg.textContent = `valid — injects ${b.contract.provides[0].as} → ${b.to}.${b.contract.requires[0].name}`; add.disabled = false; }
    else { vmsg.className = 'vmsg bad'; vmsg.textContent = r.errors[0]; add.disabled = true; }
    return cand;
  };
  from.onchange = refreshOpts; to.onchange = refreshOpts; prov.onchange = check; req.onchange = check;
  add.onclick = () => { const cand = check(); if (!cand || add.disabled) return; mut(() => cand); toast('Binding added'); };
  const wrap = (lab, node) => { const d = el('div'); d.appendChild(el('div', 'lab', lab)); d.appendChild(node); return d; };
  row.append(wrap('From', from), wrap('Provides', prov), wrap('To', to), wrap('Requires (input field)', req), add);
  main.appendChild(row); main.appendChild(vmsg); refreshOpts();
}
function provideOptions(m) {
  const os = (m.outputs || []).map((o) => opt(`output:${o.id}`, '', `output · ${o.label || o.id}`));
  const cs = (m.computed || []).map((c) => opt(`field:${c.id}`, '', `computed · ${c.id}`));
  return [...os, ...cs].join('') || '<option value="">(nothing to provide)</option>';
}
function requireOptions(m) {
  return (m.fields || []).map((f) => opt(`field:${f.id}`, '', `${f.label || f.id}`)).join('') || '<option value="">(no input fields)</option>';
}
function uniqueBindingId(base) { let id = base, n = 2; while ((jrn.bindings || []).some((b) => b.id === id)) id = `${base}-${n++}`; return id; }

function renderStepsSection(main) {
  main.appendChild(el('h2', null, `Process steps <span class="cmeta">(${((jrn.process && jrn.process.steps) || []).length})</span>`));
  const arr = (jrn.process && jrn.process.steps) || [];
  arr.forEach((s, i) => {
    const card = el('div', 'card'); card.style.setProperty('--nc', `var(--p-${s.phase || 'default'}, var(--p-default))`);
    const head = el('div', 'ch');
    head.appendChild(el('div', 'ct', s.id));
    head.appendChild(el('div', 'cmeta', `${s.phase} · ${s.kind}${s.model ? ' · ' + s.model : ''}`));
    const up = el('button', 'mini', '↑'); up.onclick = () => mut((j) => jedit.moveStep(j, s.id, -1)); up.disabled = i === 0;
    const dn = el('button', 'mini', '↓'); dn.onclick = () => mut((j) => jedit.moveStep(j, s.id, 1)); dn.disabled = i === arr.length - 1;
    const x = el('button', 'cx', 'remove'); x.onclick = () => mut((j) => jedit.removeStep(j, s.id));
    head.append(up, dn, x); card.appendChild(head);
    if (s.activity || s.outcome || s.produces) card.appendChild(el('div', 'cmeta', [s.produces && `produces ${s.produces}`, s.activity && `activity ${s.activity}`, s.outcome && `outcome ${s.outcome}`].filter(Boolean).join(' · ')));
    main.appendChild(card);
  });
  // add-step
  const row = el('div', 'addrow');
  const id = el('input', 'f', ''); id.placeholder = 'step id';
  const phz = resolvePhases(); const phase = el('select', 'f'); phase.innerHTML = phz.map((p) => opt(p.id, (phz[0] || {}).id, p.label)).join('');
  const kind = el('select', 'f'); kind.innerHTML = STEP_KINDS.map((k) => opt(k, 'capture')).join('');
  const modelSel = el('select', 'f'); const aliases = (jrn.models || []).map((m) => m.as);
  modelSel.innerHTML = '<option value="">(none)</option>' + aliases.map((a) => opt(a, '')).join('');
  const add = el('button', 'jbtn', 'Add step');
  add.onclick = () => {
    const sid = id.value.trim(); if (!sid) { toast('A step id is required.', true); return; }
    if (((jrn.process && jrn.process.steps) || []).some((s) => s.id === sid)) { toast('That step id already exists.', true); return; }
    const step = { id: sid, phase: phase.value, kind: kind.value };
    if (modelSel.value) step.model = modelSel.value;
    mut((j) => jedit.addStep(j, step));
    id.value = '';
  };
  const wrap = (lab, node) => { const d = el('div'); d.appendChild(el('div', 'lab', lab)); d.appendChild(node); return d; };
  row.append(wrap('Id', id), wrap('Phase', phase), wrap('Kind', kind), wrap('Model', modelSel), add);
  main.appendChild(row);
  main.appendChild(el('p', 'sub', 'Ceremony details (activity / outcome / prompt) and step ordering across phases can be refined here; run to preview.'));
}

function renderLint() {
  const side = $('#jc-side'); side.innerHTML = '';
  side.appendChild(el('h5', null, 'Lattice lint'));
  const a = analyzeJourney(jrn, models);
  if (!a.findings.length) { side.appendChild(el('div', 'clean', '✓ No issues — the journey composes.')); return; }
  for (const f of a.findings) side.appendChild(el('div', 'find ' + f.severity, `<div class="fk">${f.kind}</div>${f.message}`));
}
