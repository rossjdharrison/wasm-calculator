// =============================================================================
// app.js — the public Configurator page. Thin: load the model, assemble it,
// start the wasm engine, and mount the shared renderer (render-form.mjs). The
// same renderer powers the Presentation editor's live WYSIWYG preview.
// =============================================================================

import { assemble, loadEngine } from './assembler.mjs';
import { currentModel, isCustom, resetModel } from './store.mjs';
import { mountConfigurator } from './render-form.mjs';

const WASM_URL = 'quote.wasm';
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const doReset = () => { resetModel(); location.reload(); };

(async function boot() {
  let model, modelSource;
  try { model = await currentModel(); modelSource = isCustom() ? 'edited' : 'default'; }
  catch (e) { return fatal(`Could not load the model: ${e.message}`); }

  let assembled;
  try { assembled = assemble(model); }
  catch (e) {
    return modelSource === 'edited' ? fatal(`Your saved model is invalid: ${e.message}`, true) : fatal(`Invalid model: ${e.message}`);
  }

  let engine;
  try {
    const bytes = new Uint8Array(await (await fetch(WASM_URL)).arrayBuffer());
    engine = await loadEngine(bytes, assembled);
  } catch (e) { return fatal(`Could not start engine: ${e.message}`); }

  renderBanner(modelSource);
  mountConfigurator(document.getElementById('app'), { model, ir: assembled.ir, engine });
})();

function renderBanner(modelSource) {
  const host = document.getElementById('model-banner');
  if (!host) return;
  host.innerHTML = '';
  if (modelSource !== 'edited') return;
  const b = el('div', 'qc-banner');
  const span = el('span'); span.textContent = 'Showing a custom model saved in this browser.';
  const btn = el('button', 'qc-btn-link'); btn.type = 'button'; btn.textContent = 'Reset to default';
  btn.addEventListener('click', doReset);
  b.append(span, btn);
  host.appendChild(b);
}

function fatal(msg, offerReset) {
  const root = document.getElementById('app') || document.body;
  root.innerHTML = '';
  const b = el('div', 'qc-fatal'); b.textContent = msg; root.appendChild(b);
  if (offerReset) {
    const row = el('div', 'qc-fatal__actions');
    const a = el('a', 'qc-btn-link'); a.href = 'editor.html'; a.textContent = 'Open the editor';
    const r = el('button', 'qc-btn-link'); r.type = 'button'; r.textContent = 'Reset to default';
    r.addEventListener('click', doReset);
    row.append(a, r); root.appendChild(row);
  }
}
