// =============================================================================
// app.js — the public Configurator page. It IS the showroom now: load the model,
// assemble it, start the wasm engine, and mount the turntable showroom renderer
// (showroom-view.mjs). Car images are resolved from the asset store (assets.mjs);
// the header/brand come from the model's presentation config.
// =============================================================================

import { assemble, loadEngine, mergeModel } from './assembler.mjs';
import { currentModel, isCustom, resetModel, MODEL_ID, JOURNEY_ID, ORDER_ID, currentJourney, loadModelFiles, loadDomain } from './store.mjs';
import { phasesOf } from './hqdm.mjs';
import { mountShowroom } from './showroom-view.mjs';
import { EngineHost } from './compose.mjs';
import { mountJourney } from './journey-view.mjs';
import { mountOrderPicker } from './order-picker.mjs';
import { listOrders, deleteOrder } from './order-store.mjs';
import { ordersForJourney } from './order.mjs';
import { resolve as resolveImage } from './assets.mjs';
import { takeRestore } from './saved.mjs';

const WASM_URL = 'quote.wasm';
// editor/studio links carry the active model id so they edit THIS collection.
// (The brand lockup links home to the collections; these live in the Studio menu.)
const LINKS = [
  { href: `data-editor.html?m=${MODEL_ID}`, label: 'Data model' },
  { href: `presentation-editor.html?m=${MODEL_ID}`, label: 'Presentation' },
  { href: `editor.html?m=${MODEL_ID}`, label: 'JSON' },
];

(async function boot() {
  // ---- journey mode (opt-in via ?j=): run the composed sale, not a single model ----
  if (JOURNEY_ID) return bootJourney();

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

async function bootJourney() {
  let journey, domain;
  // currentJourney = a browser-edited/created journey overrides the shipped one, so
  // a journey authored in the Loom actually runs here. The domain (top-level model)
  // supplies default phases + label vocabulary + brand when the journey omits them.
  try { journey = await currentJourney(JOURNEY_ID); }
  catch (e) { return fatal(`Could not load the journey: ${e.message}`); }
  domain = await loadDomain();
  // phases + labels + brand come from DATA: the journey overrides the domain default.
  const phases = (journey.phases && journey.phases.length) ? phasesOf(journey) : phasesOf(domain || {});
  const labels = { ...((domain && domain.labels) || {}), ...(journey.labels || {}) };
  const brand = journey.brand || (domain && domain.brand) || { mark: 'ROWBLAA', rest: 'LUXURY' };
  let wasmBytes;
  try { wasmBytes = new Uint8Array(await (await fetch(WASM_URL)).arrayBuffer()); }
  catch (e) { return fatal(`Could not start the engine: ${e.message}`); }
  const host = new EngineHost(wasmBytes);
  const models = {};
  for (const m of journey.models || []) {
    try { const { data, presentation } = await loadModelFiles(m.ref); const merged = mergeModel(data, presentation); models[m.as] = { merged, assembled: assemble(merged) }; }
    catch (e) { return fatal(`Journey model "${m.ref}" is invalid: ${e.message}`); }
  }
  const app = document.getElementById('app');
  const mount = (resumeOrderId) => mountJourney(app, { journey, models, host, brand, resolveImage, links: LINKS, resumeOrderId, phases, labels });
  // no ?o= and saved orders exist → offer a picker; otherwise resume ?o= (sanitised) or start fresh.
  const showPicker = () => {
    const saved = ordersForJourney(listOrders(), JOURNEY_ID);
    if (!saved.length) return mount(null);
    mountOrderPicker(app, {
      journeyName: journey.title,
      orders: saved,
      phases,
      onResume: (id) => { const u = new URL(location.href); u.searchParams.set('o', id); location.href = u.toString(); },
      onStartNew: () => mount(null),
      onDelete: (id) => { deleteOrder(id); showPicker(); },
    });
  };
  if (!ORDER_ID && ordersForJourney(listOrders(), JOURNEY_ID).length) return showPicker();
  mount(ORDER_ID);
}

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
