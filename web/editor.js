// =============================================================================
// editor.js — view / update the model.
//
// It parses the edited JSON, assembles it, and actually loads it into the WASM
// engine (a trial evaluate on the defaults) — so "Update model" only succeeds
// for a model the engine accepts. On success it saves the model (localStorage)
// and reopens the Configurator, which loads the fresh model.
// =============================================================================

import { assemble, loadEngine, mergeModel, splitModel } from './assembler.mjs';
import { currentModel, saveData, savePres, loadDefaultData, loadDefaultPres } from './store.mjs';

const WASM_URL = 'quote.wasm';

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

let wasmBytes = null;
let lastValid = null; // parsed model object from the most recent successful validate

boot();

async function boot() {
  try {
    wasmBytes = new Uint8Array(await (await fetch(WASM_URL)).arrayBuffer());
  } catch (e) {
    setStatus('error', `Could not load the engine (${WASM_URL}): ${e.message}`);
    return;
  }
  $('model-src').value = await currentModelText();
  validate();
  $('model-src').addEventListener('input', debounce(validate, 300));
  $('btn-format').addEventListener('click', format);
  $('btn-reset').addEventListener('click', loadDefault);
  $('btn-update').addEventListener('click', update);
}

async function currentModelText() {
  return JSON.stringify(await currentModel(), null, 2);
}

// ---- validation: parse -> assemble -> load into wasm -> evaluate defaults ----
function validate() {
  const text = $('model-src').value;
  let model;
  try { model = JSON.parse(text); }
  catch (e) { fail(`JSON syntax error: ${e.message}`); return null; }

  let assembled;
  try { assembled = assemble(model); }
  catch (e) { fail(`Model error: ${e.message}`); return null; }

  // trial-load into the engine and evaluate the defaults
  loadEngine(wasmBytes, assembled)
    .then((engine) => {
      const inputs = buildDefaults(assembled.ir);
      const res = engine.evaluate(inputs);
      lastValid = model;
      ok(model, assembled, res);
    })
    .catch((e) => fail(`Engine rejected the model: ${e.message}`));
  return assembled;
}

function fail(msg) {
  lastValid = null;
  setStatus('error', msg);
  $('preview').innerHTML = '';
  $('btn-update').disabled = true;
}

function ok(model, assembled, res) {
  const ir = assembled.ir;
  setStatus('ok', `Valid — “${model.name || model.id}” v${model.version}: `
    + `${ir.fields.length} fields, ${ir.computedIR.length} computed, ${ir.outputs.length} outputs, `
    + `${assembled.modelBytes.length}-byte image.`);
  $('btn-update').disabled = false;
  renderPreview(ir, res);
}

// ---- preview: the default quote produced by the fresh model ------------------
function renderPreview(ir, res) {
  const host = $('preview');
  host.innerHTML = '';
  const h = el('div', 'qc-preview__title'); h.textContent = 'Default quote (live from the engine)';
  host.appendChild(h);
  for (let i = 0; i < ir.outputs.length; i++) {
    const o = ir.outputs[i], r = res.outputs[i];
    if (!r.visible) continue;
    const row = el('div', 'qc-preview__row');
    const l = el('span'); l.textContent = o.label;
    const v = el('span'); v.textContent = fmt(r);
    row.append(l, v); host.appendChild(row);
  }
}

function buildDefaults(ir) {
  const inp = {};
  for (const f of ir.fields) {
    if (f.type === 'choice') inp[f.id] = f.defaultRaw ?? f.options[0].id;
    else if (f.type === 'multichoice') inp[f.id] = f.defaultRaw ?? [];
    else if (f.type === 'boolean') inp[f.id] = !!f.defaultRaw;
    else inp[f.id] = f.defaultRaw ?? 0;
  }
  return inp;
}

function fmt(o) {
  const v = o.value;
  const nf = (opts) => new Intl.NumberFormat(undefined, opts).format(v);
  if (o.format === 'currency') return nf({ style: 'currency', currency: o.currencyCode, minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals });
  if (o.format === 'percent') return nf({ style: 'percent', minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals });
  if (o.format === 'unit') { const n = nf({ minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals }); return o.unit ? `${n} ${o.unit}` : n; }
  return nf({ maximumFractionDigits: o.decimals ?? 2 });
}

// ---- actions ----------------------------------------------------------------
function format() {
  try {
    $('model-src').value = JSON.stringify(JSON.parse($('model-src').value), null, 2);
  } catch (_) { /* leave as-is; validate() will report the syntax error */ }
  validate();
}

async function loadDefault() {
  const def = mergeModel(await loadDefaultData(), await loadDefaultPres());
  $('model-src').value = JSON.stringify(def, null, 2);
  validate();
}

function update() {
  const assembled = validate();
  if (!assembled || !lastValid) { setStatus('error', 'Fix the errors above before updating.'); return; }
  // validate() completes the engine trial-load asynchronously; do it synchronously here too
  loadEngine(wasmBytes, assembled)
    .then((engine) => {
      engine.evaluate(buildDefaults(assembled.ir)); // final proof it loads
      const { data, presentation } = splitModel(JSON.parse($('model-src').value));
      if (!saveData(data) || !savePres(presentation)) { setStatus('error', 'Could not save (storage blocked).'); return; }
      location.href = './'; // reopen the Configurator with the fresh model
    })
    .catch((e) => setStatus('error', `Engine rejected the model: ${e.message}`));
}

// ---- helpers ----------------------------------------------------------------
function setStatus(kind, msg) {
  const s = $('status');
  s.className = `qc-status qc-status--${kind}`;
  s.textContent = msg;
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
