// =============================================================================
// journey-edit.mjs — PURE mutations on a journey document (the composition/process
// model), mirroring model-edit.mjs. Every op deep-clones and returns a new
// journey; legality is journey-validate.mjs's job. Domain-agnostic: it edits
// models[], bindings[], triggers[] and the process — never any sale concept.
// =============================================================================
import { clone } from './studio-dom.mjs';

const j = (x) => clone(x);
const byId = (arr, id) => (arr || []).findIndex((x) => x.id === id);

export function addModelRef(journey, ref) {
  const next = j(journey); next.models = next.models || [];
  if (!next.models.some((m) => m.as === ref.as)) next.models.push(ref);
  return next;
}
export function removeModelRef(journey, alias) {
  const next = j(journey);
  next.models = (next.models || []).filter((m) => m.as !== alias);
  next.bindings = (next.bindings || []).filter((b) => b.from !== alias && b.to !== alias);
  next.triggers = (next.triggers || []).filter((t) => t.activates !== alias && t.on !== alias);
  if (next.process) next.process.steps = (next.process.steps || []).filter((s) => s.model !== alias);
  return next;
}
export function addBinding(journey, binding) {
  const next = j(journey); next.bindings = next.bindings || [];
  const i = byId(next.bindings, binding.id);
  if (i < 0) next.bindings.push(binding); else next.bindings[i] = binding;
  return next;
}
export function removeBinding(journey, id) {
  const next = j(journey); next.bindings = (next.bindings || []).filter((b) => b.id !== id); return next;
}
export function setSeamMapping(journey, bindingId, mapping) {
  const next = j(journey); const b = (next.bindings || []).find((x) => x.id === bindingId);
  if (b) b.mapping = mapping; return next;
}
export function setSeamCondition(journey, bindingId, ast) {
  const next = j(journey); const b = (next.bindings || []).find((x) => x.id === bindingId);
  if (b) { if (ast == null) delete b.condition; else b.condition = ast; } return next;
}
export function setTrigger(journey, trigger) {
  const next = j(journey); next.triggers = next.triggers || [];
  const i = byId(next.triggers, trigger.id);
  if (i < 0) next.triggers.push(trigger); else next.triggers[i] = trigger;
  return next;
}
export function removeTrigger(journey, id) {
  const next = j(journey); next.triggers = (next.triggers || []).filter((t) => t.id !== id); return next;
}

// top-level metadata (title / correlationPrefix / version) — id is never rewritten
// here (it is the storage key). Pure clone-and-return.
export function setMeta(journey, patch) {
  const next = j(journey);
  for (const k of ['title', 'correlationPrefix', 'version']) if (k in patch) next[k] = patch[k];
  return next;
}

// process steps (the declared journey process). Upsert by id / remove / reorder.
const steps = (nx) => { nx.process = nx.process || {}; nx.process.steps = nx.process.steps || []; return nx.process.steps; };
export function addStep(journey, step) {
  const next = j(journey); const arr = steps(next);
  const i = byId(arr, step.id);
  if (i < 0) arr.push(step); else arr[i] = step;
  return next;
}
export const setStep = addStep; // upsert-by-id — same semantics
export function removeStep(journey, id) {
  const next = j(journey); const arr = steps(next);
  next.process.steps = arr.filter((s) => s.id !== id);
  return next;
}
export function moveStep(journey, id, dir) {
  const next = j(journey); const arr = steps(next);
  const i = arr.findIndex((s) => s.id === id); if (i < 0) return next;
  const to = i + (dir < 0 ? -1 : 1);
  if (to < 0 || to >= arr.length) return next; // no-op at the ends
  const [s] = arr.splice(i, 1); arr.splice(to, 0, s);
  return next;
}

// everything (bindings + triggers) that touches a model alias — the cross-model
// blast radius, so the editor can warn before removing/renaming a model.
export function referencesToModel(journey, alias) {
  const out = [];
  for (const b of journey.bindings || []) if (b.from === alias || b.to === alias) out.push({ kind: 'binding', id: b.id, where: b.from === alias ? 'from' : 'to' });
  for (const t of journey.triggers || []) if (t.activates === alias || t.on === alias) out.push({ kind: 'trigger', id: t.id });
  return out;
}
