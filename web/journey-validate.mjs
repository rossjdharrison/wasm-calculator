// =============================================================================
// journey-validate.mjs — the validateFormula-analogue for the composition tier.
// It never throws: it turns every seam problem into a finding. The definitive
// legality checks (does the mapping assemble? is the target real?) are delegated
// to the real assembler via a synthetic seam model, so the journey editor's live
// validation cannot drift from the build gate.
// =============================================================================
import { tryAssemble } from './model-validate.mjs';
import { orderModels, buildSeamModel } from './compose.mjs';
import { isA } from './hqdm.mjs';

const has = (arr, id) => (arr || []).some((x) => x.id === id);

// validate ONE binding against the loaded models. Returns { ok, errors:[string] }.
export function validateSeam(journey, binding, models) {
  const errors = [];
  const from = models[binding.from], to = models[binding.to];
  if (!from) errors.push(`binding "${binding.id}": unknown from-model alias "${binding.from}"`);
  if (!to) errors.push(`binding "${binding.id}": unknown to-model alias "${binding.to}"`);
  if (!from || !to) return { ok: false, errors };
  const types = { ...(from.merged.types || {}), ...(to.merged.types || {}) };

  // provides.source must resolve in the from-model (an output, or a value)
  for (const p of binding.contract?.provides || []) {
    const [kind, id] = (p.source || '').split(':');
    const exists = kind === 'output' ? has(from.merged.outputs, id)
      : kind === 'field' ? (has(from.merged.fields, id) || has(from.merged.computed, id))
        : false;
    if (!exists) errors.push(`binding "${binding.id}": provided "${p.source}" not found in "${binding.from}"`);
  }

  // requires.target must be a PLAIN INPUT field in the to-model, singly authored
  for (const r of binding.contract?.requires || []) {
    const tid = (r.target || '').split(':')[1] || r.name;
    if (!has(to.merged.fields, tid)) { errors.push(`binding "${binding.id}": required target "field:${tid}" is not an input of "${binding.to}"`); continue; }
    if (has(to.merged.computed, tid)) errors.push(`binding "${binding.id}": target "${tid}" is a computed value (already authored) — cannot be bound (double-authority)`);
    if ((to.merged.effects || []).some((e) => e.setField === tid)) errors.push(`binding "${binding.id}": target "${tid}" is written by "${binding.to}" effects (double-authority)`);
    const rivals = (journey.bindings || []).filter((b) => b !== binding && b.to === binding.to && (b.contract?.requires || []).some((rr) => ((rr.target || '').split(':')[1] || rr.name) === tid));
    if (rivals.length) errors.push(`binding "${binding.id}": target "${tid}" is also bound by ${rivals.map((b) => `"${b.id}"`).join(', ')} (double-authority)`);
    // l0Satisfies: some provided individual's L0 must satisfy the required L0
    if (r.l0 && !(binding.contract?.provides || []).some((p) => p.l0 && isA(p.l0, r.l0, types))) {
      errors.push(`binding "${binding.id}": no provided value satisfies required L0 "${r.l0}" (l0-mismatch)`);
    }
  }

  // the mapping/condition expressions must assemble against the seam scope
  const r = tryAssemble(buildSeamModel(binding));
  if (!r.ok) errors.push(`binding "${binding.id}": seam mapping/condition does not assemble — ${r.errors[0].message}`);

  return { ok: errors.length === 0, errors };
}

// analyse a whole journey → { findings:[{kind,severity,message}], counts }.
export function analyzeJourney(journey, models) {
  const findings = [];
  const add = (kind, severity, message) => findings.push({ kind, severity, message });

  for (const m of journey.models || []) if (!models[m.as]) add('unknown-model', 'error', `journey model "${m.as}" (ref "${m.ref}") did not load`);
  for (const b of journey.bindings || []) { const v = validateSeam(journey, b, models); for (const e of v.errors) add('seam', 'error', e); }
  try { orderModels(journey); } catch (e) { add('cross-model-cycle', 'error', e.message); }
  if ((journey.models || []).length > 1) {
    const touched = new Set();
    for (const b of journey.bindings || []) { touched.add(b.from); touched.add(b.to); }
    for (const m of journey.models || []) if (!touched.has(m.as)) add('orphan-model', 'warn', `model "${m.as}" participates in no binding`);
  }
  // triggers (behavioural saga edges) are NOT interpreted by this framework —
  // cross-model feedback is outside the frozen one-pass numeric scope. A populated
  // triggers[] is rejected by the shape gate (journey-schema.mjs), so nothing to run here.

  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return { findings, counts };
}

// convenience: does the whole journey compose legally?
export function tryComposeJourney(journey, models) {
  const a = analyzeJourney(journey, models);
  return { ok: a.counts.error === 0, ...a };
}
