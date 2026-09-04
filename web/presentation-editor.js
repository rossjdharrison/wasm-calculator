// =============================================================================
// presentation-editor.js — the PRESENTATION design page (Phase B).
//
// Left: schema-like editors for sections, per-field bindings, and outputs.
// Right: a LIVE WYSIWYG preview — the *real* Configurator (render-form.mjs),
// rebuilt as you edit, with two-way click-to-edit selection between the form and
// the editors. Cross-file binding check + Save reopens the Configurator.
// =============================================================================
import { assemble, loadEngine, mergeModel } from './assembler.mjs';
import { currentData, currentPres, savePres, loadDefaultPres } from './store.mjs';
import { validateBinding } from './binding.mjs';
import { el, textRow, numRow, checkRow, selectRow, hint, addBtn, makeRuleUI } from './editor-ui.mjs';
import { mountConfigurator } from './render-form.mjs';
import { pickImage } from './asset-picker.mjs';
import { resolve as resolveAsset } from './assets.mjs';

const WASM_URL = 'quote.wasm';
const $ = (id) => document.getElementById(id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const CONTROLS = { choice: ['radio', 'dropdown', 'buttons'], multichoice: ['buttons', 'checkboxes'], number: ['input', 'stepper'], boolean: ['switch', 'checkbox'] };
const WIDTHS = ['full', 'half', 'third', 'quarter'];
const FORMATS = ['currency', 'number', 'unit', 'percent'];

let data = null, pres = null, wasm = null;
let assembledOk = null, preview = null, previewToken = 0;
let sel = { group: 'fields', index: 0 };

const rules = makeRuleUI(() => (data.fields || []).map((f) => ({ id: f.id, type: f.type, options: f.options || [] })));

boot();
async function boot() {
  try {
    [data, pres, wasm] = await Promise.all([
      currentData(), currentPres().then(clone),
      fetch(WASM_URL).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    ]);
  } catch (e) { $('status').textContent = `Load failed: ${e.message}`; return; }
  $('btn-save').addEventListener('click', save);
  $('btn-revert').addEventListener('click', () => location.reload());
  $('btn-default').addEventListener('click', async () => { pres = clone(await loadDefaultPres()); renderAll(); });
  renderAll();
}

const GROUPS = [
  { key: 'sections', title: 'Sections', label: (x) => x.label || x.id },
  { key: 'fields', title: 'Fields', label: (x) => x.id },
  { key: 'outputs', title: 'Outputs', label: (x, i) => x.id || `#${i}` },
];
function items(group) { return group === 'fields' ? (data.fields || []) : (pres[group] || []); }
function dataValueIds() { return [...(data.computed || []).map((c) => c.id), ...(data.fields || []).map((f) => f.id)]; }
function ensurePresField(id) { pres.fields = pres.fields || []; let pf = pres.fields.find((f) => f.id === id); if (!pf) { pf = { id }; pres.fields.push(pf); } return pf; }
function ensurePresOption(pf, oid) { pf.options = pf.options || []; let o = pf.options.find((x) => x.id === oid); if (!o) { o = { id: oid }; pf.options.push(o); } return o; }

// Per-option image control: thumbnail + Choose/Change/Remove, backed by the
// asset picker. Stores a reference ("asset:<id>" or a URL) on the option.
function imageCell(po) {
  const cell = el('div', 'de-opt-img');
  const thumb = el('div', 'de-opt-thumb'); thumb.setAttribute('aria-hidden', 'true');
  const btn = el('button', 'qc-btn-link'); btn.type = 'button';
  const rm = el('button', 'qc-btn-link de-opt-rm'); rm.type = 'button'; rm.textContent = '✕'; rm.title = 'Remove image';
  const paint = () => {
    thumb.innerHTML = '';
    if (po.image) { const im = el('img'); resolveAsset(po.image).then((u) => { if (u) im.src = u; }); thumb.appendChild(im); thumb.classList.add('has'); btn.textContent = 'Change'; rm.hidden = false; }
    else { thumb.classList.remove('has'); btn.textContent = 'Image…'; rm.hidden = true; }
  };
  btn.addEventListener('click', async () => { const ref = await pickImage({ current: po.image }); if (ref) { set(po, 'image', ref); paint(); } });
  rm.addEventListener('click', () => { set(po, 'image', undefined); paint(); });
  cell.append(thumb, btn, rm);
  paint();
  return cell;
}

function renderAll() { renderOutline(); renderDetail(); renderIssues(); scheduleRebuild(); }

function renderOutline() {
  const root = $('outline'); root.innerHTML = '';
  for (const g of GROUPS) {
    const sec = el('div', 'de-group');
    const head = el('div', 'de-group__head');
    const h = el('span'); h.textContent = g.title; head.appendChild(h);
    if (g.key !== 'fields') head.appendChild(addBtn('+ add', () => addItem(g.key)));
    sec.appendChild(head);
    items(g.key).forEach((it, i) => {
      const b = el('button', 'de-item'); b.type = 'button'; b.textContent = g.label(it, i);
      if (sel.group === g.key && sel.index === i) b.classList.add('is-active');
      b.addEventListener('click', () => selectItem(g.key, i));
      sec.appendChild(b);
    });
    root.appendChild(sec);
  }
}

// ---- selection (two-way with the preview) ----------------------------------
function selectItem(group, index) { sel = { group, index }; renderOutline(); renderDetail(); highlightSelection(); }
function highlightSelection() {
  if (!preview) return;
  const list = items(sel.group); const it = list[sel.index]; if (!it) return;
  const kind = { sections: 'section', fields: 'field', outputs: 'output' }[sel.group];
  const id = sel.group === 'fields' ? it.id : (sel.group === 'sections' ? it.id : it.id);
  preview.highlight(kind, id);
}
function onEdit(kind, id) {
  if (kind === 'field') { const i = (data.fields || []).findIndex((f) => f.id === id); if (i >= 0) selectItem('fields', i); }
  else if (kind === 'section') { const i = (pres.sections || []).findIndex((s) => s.id === id); if (i >= 0) selectItem('sections', i); }
  else if (kind === 'output') { const i = (pres.outputs || []).findIndex((o) => o.id === id); if (i >= 0) selectItem('outputs', i); }
}

function renderDetail() {
  const root = $('detail'); root.innerHTML = '';
  const list = items(sel.group);
  if (!list.length) { root.appendChild(hint('Nothing here yet.')); return; }
  if (sel.index >= list.length) sel.index = list.length - 1;
  ({ sections: sectionEditor, fields: fieldEditor, outputs: outputEditor }[sel.group])(list[sel.index], sel.index, root);
}

function sectionEditor(s, idx, root) {
  root.appendChild(titleRow(`Section: ${s.id}`, () => removeItem('sections', idx)));
  root.appendChild(textRow('Label', s.label || '', (v) => set(s, 'label', v)));
  root.appendChild(numRow('Order', s.order, (v) => set(s, 'order', v)));
}

function fieldEditor(f, idx, root) {
  const pf = ensurePresField(f.id);
  root.appendChild(titleRow(`Field: ${f.id}`, null, `type: ${f.type}`));
  root.appendChild(textRow('Label', pf.label || '', (v) => set(pf, 'label', v || undefined)));
  root.appendChild(selectRow('Control', CONTROLS[f.type] || ['input'], pf.control || (CONTROLS[f.type] || [''])[0], (v) => set(pf, 'control', v)));
  root.appendChild(selectRow('Section', ['(none)', ...(pres.sections || []).map((s) => s.id)], pf.section || '(none)', (v) => set(pf, 'section', v === '(none)' ? undefined : v)));
  root.appendChild(selectRow('Width', WIDTHS, pf.width || 'full', (v) => set(pf, 'width', v)));
  root.appendChild(textRow('Help', pf.help || '', (v) => set(pf, 'help', v || undefined)));
  if (f.type === 'number') root.appendChild(numRow('Decimals', pf.decimals, (v) => set(pf, 'decimals', v)));
  root.appendChild(rules.ruleRow('Show when', () => pf.visibleWhen, (a) => set(pf, 'visibleWhen', a)));
  root.appendChild(rules.ruleRow('Enable when', () => pf.enabledWhen, (a) => set(pf, 'enabledWhen', a)));
  if (f.options) {
    const box = el('div', 'de-sub');
    const bh = el('div', 'de-sub__head'); bh.textContent = 'Option labels, prices & images'; box.appendChild(bh);
    for (const o of f.options) {
      const po = ensurePresOption(pf, o.id);
      const r = el('div', 'de-opt-row');
      const id = el('code', 'de-opt__id'); id.textContent = o.id; r.appendChild(id);
      const li = el('input', 'qc-input'); li.placeholder = 'label'; li.setAttribute('aria-label', `${o.id} label`); li.value = po.label || ''; li.addEventListener('input', () => set(po, 'label', li.value || undefined)); r.appendChild(li);
      const pd = el('input', 'qc-input de-price'); pd.type = 'number'; pd.placeholder = 'price'; pd.setAttribute('aria-label', `${o.id} price delta`); pd.value = po.priceDelta ?? ''; pd.addEventListener('input', () => set(po, 'priceDelta', pd.value === '' ? undefined : Number(pd.value))); r.appendChild(pd);
      r.appendChild(imageCell(po, o.id));
      box.appendChild(r);
    }
    root.appendChild(box);
  }
}

function outputEditor(o, idx, root) {
  root.appendChild(titleRow(`Output: ${o.id}`, () => removeItem('outputs', idx)));
  root.appendChild(selectRow('Value', dataValueIds(), o.id, (v) => set(o, 'id', v)));
  root.appendChild(textRow('Label', o.label || '', (v) => set(o, 'label', v)));
  o.format = o.format || { type: 'number' };
  root.appendChild(selectRow('Format', FORMATS, o.format.type || 'number', (v) => { set(o.format, 'type', v); renderDetail(); }));
  root.appendChild(numRow('Decimals', o.format.decimals, (v) => set(o.format, 'decimals', v)));
  if (o.format.type === 'unit') root.appendChild(textRow('Unit', o.format.unit || '', (v) => set(o.format, 'unit', v)));
  if (o.format.type === 'currency') root.appendChild(textRow('Currency code', o.format.currencyCode || '', (v) => set(o.format, 'currencyCode', v)));
  root.appendChild(checkRow('Emphasis (headline)', o.emphasis, (v) => set(o, 'emphasis', v || undefined)));
  root.appendChild(rules.ruleRow('Show when', () => o.visibleWhen, (a) => set(o, 'visibleWhen', a)));
}

function addItem(group) {
  if (group === 'sections') { const id = prompt('New section id:'); if (!id) return; pres.sections = pres.sections || []; pres.sections.push({ id, label: id, order: pres.sections.length + 1 }); sel = { group, index: pres.sections.length - 1 }; }
  else if (group === 'outputs') { pres.outputs = pres.outputs || []; pres.outputs.push({ id: dataValueIds()[0], label: '', format: { type: 'number', decimals: 2 } }); sel = { group, index: pres.outputs.length - 1 }; }
  renderAll();
}
function removeItem(group, idx) { if (!confirm('Remove this item?')) return; pres[group].splice(idx, 1); sel.index = Math.max(0, idx - 1); renderAll(); }

// ---- helpers ----
function titleRow(t, onRemove, sub) {
  const h = el('div', 'de-title'); const left = el('div');
  const a = el('h3'); a.textContent = t; left.appendChild(a);
  if (sub) { const s = el('div', 'de-title__sub'); s.textContent = sub; left.appendChild(s); }
  h.appendChild(left);
  if (onRemove) { const b = el('button', 'qc-btn-link'); b.type = 'button'; b.textContent = 'Remove'; b.addEventListener('click', onRemove); h.appendChild(b); }
  return h;
}
function set(obj, key, val) { if (val === undefined) delete obj[key]; else obj[key] = val; if (['label', 'id', 'order'].includes(key)) renderOutline(); renderIssues(); scheduleRebuild(); }

// ---- binding issues --------------------------------------------------------
function renderIssues() {
  const host = $('issues'); host.innerHTML = '';
  const { errors, warnings } = validateBinding(data, pres);
  if (!errors.length && !warnings.length) { host.appendChild(line('info', 'Bindings look good.')); return; }
  for (const e of errors) host.appendChild(line('error', e));
  for (const w of warnings) host.appendChild(line('warn', w));
}
function line(kind, text) { const d = el('div', `qc-message qc-message--${kind}`); d.textContent = text; return d; }

// ---- WYSIWYG live preview (the real Configurator) --------------------------
const scheduleRebuild = debounce(rebuildPreview, 140);
function rebuildPreview() {
  let model, assembled;
  try { model = mergeModel(data, pres); assembled = assemble(model); }
  catch (e) { assembledOk = null; preview = null; setStatus('error', `Model error: ${e.message}`); $('preview').innerHTML = ''; return; }
  const token = ++previewToken;
  loadEngine(wasm, assembled).then((engine) => {
    if (token !== previewToken) return; // a newer edit superseded this build
    assembledOk = assembled;
    setStatus('ok', 'Live preview — click any field to edit it.');
    preview = mountConfigurator($('preview'), { model, ir: assembled.ir, engine, onEdit });
    highlightSelection();
  }).catch((e) => { if (token !== previewToken) return; assembledOk = null; preview = null; setStatus('error', `Engine: ${e.message}`); });
}
function setStatus(kind, msg) { const s = $('status'); s.className = `qc-status qc-status--${kind}`; s.textContent = msg; }

function save() {
  const { errors } = validateBinding(data, pres);
  if (errors.length) { setStatus('error', `Fix ${errors.length} binding error(s) first.`); return; }
  if (!assembledOk) { setStatus('error', 'Fix the model errors first.'); return; }
  if (!savePres(pres)) { setStatus('error', 'Could not save (storage blocked).'); return; }
  location.href = './';
}
