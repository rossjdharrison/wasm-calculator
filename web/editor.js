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
import { $, debounce, setStatus } from './studio-dom.mjs';
import { buildDefaults, renderStaticPreview } from './preview.mjs';
import { mountStudioShell } from './studio-shell.mjs';

const WASM_URL = 'quote.wasm';

let wasmBytes = null;
let lastValid = null; // parsed model object from the most recent successful validate

boot();

async function boot() {
  mountStudioShell($('studio-head'), { active: 'json', title: 'Edit model', blurb: 'View and update the model that drives the configurator. <strong>Update model</strong> validates it, loads it into the WebAssembly engine, saves it (in this browser), and reopens the Configurator with the fresh model. Nothing here changes the engine.' });
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
  renderStaticPreview($('preview'), ir, res, 'Default quote (live from the engine)');
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

