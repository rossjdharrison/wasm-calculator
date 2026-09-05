// =============================================================================
// studio-dom.mjs — the Studio's shared plumbing (the editor pages' counterpart
// to the small helpers ui.mjs gives the public pages). One definition of the
// DOM/util atoms all three editors used to each re-declare, plus the live
// model→engine pipeline the two design pages share.
// =============================================================================
import { assemble, loadEngine, mergeModel } from './assembler.mjs';
import { el } from './ui.mjs';

export const $ = (id) => document.getElementById(id);
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// the shared #status line every studio page carries in its right rail
export const setStatus = (kind, msg) => { const s = $('status'); if (!s) return; s.className = `qc-status qc-status--${kind}`; s.textContent = msg; };

// a single qc-message row (info / warn / error) — the studio's message atom
export const message = (kind, text) => el('div', `qc-message qc-message--${kind}`, { text });

// The live model→engine pipeline shared by the two design pages: merge the two
// documents, assemble to bytecode, and load the engine. On failure the thrown
// error carries .phase ('assemble' | 'engine') so each caller can word its own
// status message while the merge/assemble/load core lives in one place.
export async function assembleLive(data, pres, bytes) {
  let model, assembled;
  try { model = mergeModel(data, pres); assembled = assemble(model); }
  catch (e) { e.phase = 'assemble'; throw e; }
  let engine;
  try { engine = await loadEngine(bytes, assembled); }
  catch (e) { e.phase = 'engine'; throw e; }
  return { model, assembled, engine };
}
