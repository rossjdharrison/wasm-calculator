// =============================================================================
// presentation-editor.js — the PRESENTATION design page (Phase B).
//
// Left: the generic createEditor (editor-engine.mjs), driven by
// presentation.schema.json — the same engine the Data page uses. The pres model
// is the mutated doc; the data model is injected read-only (ctx.docs) so the
// Fields group can list data.fields but write pres.fields, linked by id.
// Right: a LIVE WYSIWYG — the real Configurator (render-form.mjs), rebuilt on
// every edit, with two-way click-to-edit selection between form and editor.
// =============================================================================
import { currentData, currentPres, savePres, loadDefaultPres } from './store.mjs';
import { validateBinding } from './binding.mjs';
import { mountConfigurator } from './render-form.mjs';
import { pickImage } from './asset-picker.mjs';
import { resolve as resolveAsset } from './assets.mjs';
import { createEditor } from './editor-engine.mjs';
import { $, clone, debounce, setStatus, message, assembleLive } from './studio-dom.mjs';
import { mountStudioShell } from './studio-shell.mjs';

const WASM_URL = 'quote.wasm';
// the controls valid for each field type (the Fields "Control" select reads this
// off the source field's type via ctx.sources.controls)
const CONTROLS = { choice: ['radio', 'dropdown', 'buttons'], multichoice: ['buttons', 'checkboxes'], number: ['input', 'stepper'], boolean: ['switch', 'checkbox'] };

let data = null, pres = null, wasm = null, schema = null;
let editor = null, assembledOk = null, preview = null, previewToken = 0;
let lastSel = { key: null, id: null };   // remembered selection, re-applied after each rebuild

boot();
async function boot() {
  mountStudioShell($('studio-head'), { active: 'pres', title: 'Presentation', blurb: 'How the data is shown: bind each field to a control, place it in a section, set labels &amp; option text, choose outputs and formats. The logic lives on the Data page; this only changes the look and layout.' });
  try {
    [data, pres, wasm, schema] = await Promise.all([
      currentData(), currentPres().then(clone),
      fetch(WASM_URL).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      fetch('presentation.schema.json').then((r) => r.json()),
    ]);
  } catch (e) { $('status').textContent = `Load failed: ${e.message}`; return; }
  $('btn-save').addEventListener('click', save);
  $('btn-revert').addEventListener('click', () => location.reload());
  $('btn-default').addEventListener('click', async () => { pres = clone(await loadDefaultPres()); mountEditor(); });
  mountEditor();
}

const dataValueIds = () => [...(data.computed || []).map((c) => c.id), ...(data.fields || []).map((f) => f.id)];

function mountEditor() {
  editor = createEditor({
    schema, doc: pres, outline: $('outline'), detail: $('detail'),
    ctx: {
      fields: () => (data.fields || []).map((f) => ({ id: f.id, type: f.type, options: f.options || [] })),
      docs: { 'data.fields': () => data.fields || [] },   // read-only companion for the cross-doc Fields group
      sources: {
        controls: (_item, source) => CONTROLS[source && source.type] || ['input'],
        sections: () => (pres.sections || []).map((s) => s.id),
        values: () => dataValueIds(),
      },
      assets: { pick: pickImage, resolve: resolveAsset },
      seeds: {
        section: () => { const id = prompt('New section id:'); if (!id) return null; return { id, label: id, order: (pres.sections ? pres.sections.length : 0) + 1 }; },
        output: () => ({ id: dataValueIds()[0], label: '', format: { type: 'number', decimals: 2 } }),
      },
    },
    // selection must NOT rebuild the live preview (that would remount it on every
    // click); only real edits do. Both keep the binding issues fresh.
    onChange: (info) => { if (info && info.reason === 'select') return; renderIssues(); scheduleRebuild(); },
    onSelect: (key, id) => { lastSel = { key, id }; applyHighlight(); },
  });
  renderIssues();
  scheduleRebuild();     // createEditor's initial render fires onSelect, not onChange — kick the first preview
}

// map an editor collection to the preview's highlight kind (settings has none)
const HL_KIND = { sections: 'section', fields: 'field', outputs: 'output' };
function applyHighlight() {
  if (!preview) return;
  const kind = HL_KIND[lastSel.key];
  if (kind && lastSel.id) preview.highlight(kind, lastSel.id);
}
// two-way: clicking a field/section/output in the live form selects it on the left
function onEdit(kind, id) {
  const key = { section: 'sections', field: 'fields', output: 'outputs' }[kind];
  if (key && editor) editor.select(key, id);
}

// ---- binding issues --------------------------------------------------------
function renderIssues() {
  const host = $('issues'); host.innerHTML = '';
  const { errors, warnings } = validateBinding(data, pres);
  if (!errors.length && !warnings.length) { host.appendChild(message('info', 'Bindings look good.')); return; }
  for (const e of errors) host.appendChild(message('error', e));
  for (const w of warnings) host.appendChild(message('warn', w));
}

// ---- WYSIWYG live preview (the real Configurator) --------------------------
const scheduleRebuild = debounce(rebuildPreview, 140);
function rebuildPreview() {
  const token = ++previewToken;
  assembleLive(data, pres, wasm).then(({ model, assembled, engine }) => {
    if (token !== previewToken) return; // a newer edit superseded this build
    assembledOk = assembled;
    setStatus('ok', 'Live preview — click any field to edit it.');
    preview = mountConfigurator($('preview'), { model, ir: assembled.ir, engine, onEdit });
    applyHighlight();                   // re-ring the current selection after the remount
  }).catch((e) => {
    if (token !== previewToken) return;
    assembledOk = null; preview = null;
    if (e.phase === 'assemble') { setStatus('error', `Model error: ${e.message}`); $('preview').innerHTML = ''; }
    else setStatus('error', `Engine: ${e.message}`);
  });
}

function save() {
  const { errors } = validateBinding(data, pres);
  if (errors.length) { setStatus('error', `Fix ${errors.length} binding error(s) first.`); return; }
  if (!assembledOk) { setStatus('error', 'Fix the model errors first.'); return; }
  if (!savePres(pres)) { setStatus('error', 'Could not save (storage blocked).'); return; }
  location.href = './';
}
