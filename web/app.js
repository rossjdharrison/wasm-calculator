// =============================================================================
// app.js — the public Configurator page. It IS the showroom now: load the model,
// assemble it, start the wasm engine, and mount the turntable showroom renderer
// (showroom-view.mjs). Car images are resolved from the asset store (assets.mjs);
// the header/brand come from the model's presentation config.
// =============================================================================

import { assemble, loadEngine } from './assembler.mjs';
import { currentModel, isCustom, resetModel, MODEL_ID } from './store.mjs';
import { mountShowroom } from './showroom-view.mjs';
import { resolve as resolveImage } from './assets.mjs';
import { takeRestore } from './saved.mjs';

const WASM_URL = 'quote.wasm';
// editor links carry the active model id so they edit THIS collection, not vehicles
const LINKS = [
  { href: 'index.html', label: 'Collections' },
  { href: `data-editor.html?m=${MODEL_ID}`, label: 'Data model' },
  { href: `presentation-editor.html?m=${MODEL_ID}`, label: 'Presentation' },
  { href: `editor.html?m=${MODEL_ID}`, label: 'JSON' },
];

(async function boot() {
  let model, custom;
  try { model = await currentModel(); custom = isCustom(); }
  catch (e) { return fatal(`Could not load the model: ${e.message}`); }

  let assembled;
  try { assembled = assemble(model); }
  catch (e) { return fatal(custom ? `Your saved model is invalid: ${e.message}` : `Invalid model: ${e.message}`, custom); }

  let engine;
  try { engine = await loadEngine(new Uint8Array(await (await fetch(WASM_URL)).arrayBuffer()), assembled); }
  catch (e) { return fatal(`Could not start the engine: ${e.message}`); }

  mountShowroom(document.getElementById('app'), {
    model, ir: assembled.ir, engine, brand: model.brand, resolveImage, links: LINKS, modelId: MODEL_ID,
    initialConfig: takeRestore(MODEL_ID),   // restore a "saved build" opened from the saved list
  });
})();

function fatal(msg, offerReset) {
  const root = document.getElementById('app') || document.body;
  root.innerHTML = '';
  const box = document.createElement('div'); box.className = 'sh-fatal';
  const p = document.createElement('p'); p.textContent = msg; box.appendChild(p);
  const row = document.createElement('div'); row.className = 'sh-fatal__actions';
  const edit = document.createElement('a'); edit.href = 'editor.html'; edit.textContent = 'Open the JSON editor'; row.appendChild(edit);
  if (offerReset) { const r = document.createElement('button'); r.type = 'button'; r.textContent = 'Reset to default'; r.addEventListener('click', () => { resetModel(); location.reload(); }); row.appendChild(r); }
  box.appendChild(row); root.appendChild(box);
}
