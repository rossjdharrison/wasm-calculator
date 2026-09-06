// =============================================================================
// model-edit.mjs — PURE mutations on the two-file model ({data, pres}).
//
// Every operation deep-clones its input and returns a new { data, pres } pair —
// it never mutates the argument, so an editor can compute a candidate, validate
// it (model-validate.tryAssemble), and only then commit. Nothing here validates
// internally: legality is the assembler's job (the authority), reached via
// tryAssemble on the merged result. These functions only decide WHICH document a
// change belongs in (the DATA_*/PRES_* ownership the merge/split round-trip
// enforces): value/logic → data; label/visibility/format → presentation.
//
//   value/logic (DATA):  computed formulas, tables, min/max/step, option
//                        availableWhen, effects, validations
//   presentation (PRES): field visibleWhen/enabledWhen, labels, outputs + their
//                        format and visibleWhen
//
// renameId rewrites every {op:'field'} / has / notHas reference across BOTH files
// as well as the definitions themselves; a missed reference would make the next
// assemble throw, which the round-trip parity test is there to catch.
// =============================================================================
import { clone } from './studio-dom.mjs';
import { astRefs } from './coverage.mjs';

const pair = ({ data, pres }) => ({ data: clone(data), pres: clone(pres) });
const findById = (arr, id) => (arr || []).find((x) => x.id === id);

// ---- creation ---------------------------------------------------------------

// Add a computed value (DATA). To make it visible on a quote, also addOutput.
export function addComputed({ data, pres }, { id, label, currency, formula }) {
  const next = pair({ data, pres });
  next.data.computed = next.data.computed || [];
  const def = { id, formula };
  if (label != null) def.label = label;
  if (currency != null) def.currency = currency;
  next.data.computed.push(def);
  return next;
}

// Surface a computed/field value as a quote output (PRES). `id` must resolve to
// an existing value; a dangling id is caught by tryAssemble.
export function addOutput({ data, pres }, { id, label, format }) {
  const next = pair({ data, pres });
  next.pres.outputs = next.pres.outputs || [];
  next.pres.outputs.push({ id, label: label ?? id, format: format || { type: 'number', decimals: 0 } });
  return next;
}

// ---- value / logic edits (DATA) ---------------------------------------------

export function setComputedFormula({ data, pres }, id, ast) {
  const next = pair({ data, pres });
  const c = findById(next.data.computed, id);
  if (!c) throw new Error(`setComputedFormula: no computed "${id}"`);
  c.formula = ast;
  return next;
}

// which: 'availableWhen' lives on a DATA option.
export function setOptionPredicate({ data, pres }, fieldId, optionId, ast) {
  const next = pair({ data, pres });
  const f = findById(next.data.fields, fieldId);
  const o = f && findById(f.options, optionId);
  if (!o) throw new Error(`setOptionPredicate: no option "${fieldId}.${optionId}"`);
  o.availableWhen = ast;
  return next;
}

// which: 'min' | 'max' | 'step' — an Expr or a bare number (DATA).
export function setFieldLimit({ data, pres }, fieldId, which, astOrNumber) {
  if (!['min', 'max', 'step'].includes(which)) throw new Error(`setFieldLimit: bad limit "${which}"`);
  const next = pair({ data, pres });
  const f = findById(next.data.fields, fieldId);
  if (!f) throw new Error(`setFieldLimit: no field "${fieldId}"`);
  f[which] = astOrNumber;
  return next;
}

// ---- presentation edits (PRES) ----------------------------------------------

// which: 'visibleWhen' | 'enabledWhen' — presentation owns these.
export function setFieldPredicate({ data, pres }, fieldId, which, ast) {
  if (!['visibleWhen', 'enabledWhen'].includes(which)) throw new Error(`setFieldPredicate: bad predicate "${which}"`);
  const next = pair({ data, pres });
  next.pres.fields = next.pres.fields || [];
  let pf = findById(next.pres.fields, fieldId);
  if (!pf) { pf = { id: fieldId }; next.pres.fields.push(pf); }
  pf[which] = ast;
  return next;
}

export function setOutputPredicate({ data, pres }, outputId, ast) {
  const next = pair({ data, pres });
  const o = findById(next.pres.outputs, outputId);
  if (!o) throw new Error(`setOutputPredicate: no output "${outputId}"`);
  o.visibleWhen = ast;
  return next;
}

// ---- deletion ---------------------------------------------------------------
// By design these do NOT prune EXTERNAL references — a still-referenced id left
// dangling makes tryAssemble report 'unknown field/computed', so the editor can
// warn (referencesTo) and block rather than silently corrupt the model.

export function deleteComputed({ data, pres }, id) {
  const next = pair({ data, pres });
  next.data.computed = (next.data.computed || []).filter((c) => c.id !== id);
  next.pres.outputs = (next.pres.outputs || []).filter((o) => o.id !== id);
  return next;
}

export function deleteField({ data, pres }, id) {
  const next = pair({ data, pres });
  next.data.fields = (next.data.fields || []).filter((f) => f.id !== id);
  next.pres.fields = (next.pres.fields || []).filter((f) => f.id !== id);
  next.pres.outputs = (next.pres.outputs || []).filter((o) => o.id !== id);
  return next;
}

// ---- rename an id (a field or computed) everywhere ---------------------------

// Rewrite every {op:'field'} / has / notHas reference to `oldId` inside one AST.
// Leaves table names (lookup arg0) and bare option-id literals (has/notHas arg1,
// cmp string operands) untouched — those are renameOption's job, not this.
function rewriteRefs(node, oldId, newId) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((n) => rewriteRefs(n, oldId, newId));
  const { op, args = [] } = node;
  if (op === 'field') return { ...node, args: args.map((a, i) => (i === 0 && a === oldId ? newId : rewriteRefs(a, oldId, newId))) };
  if (op === 'has' || op === 'notHas') return { ...node, args: args.map((a, i) => (i === 0 ? (a === oldId ? newId : a) : a)) };
  if (op === 'lookup') return { ...node, args: args.map((a, i) => (i === 0 ? a : rewriteRefs(a, oldId, newId))) };
  return { ...node, args: args.map((a) => rewriteRefs(a, oldId, newId)) };
}

export function renameId({ data, pres }, oldId, newId) {
  if (oldId === newId) return pair({ data, pres });
  const next = pair({ data, pres });
  const d = next.data, p = next.pres;
  const R = (ast) => (ast === undefined ? ast : rewriteRefs(ast, oldId, newId));

  for (const c of d.computed || []) c.formula = R(c.formula);
  for (const f of d.fields || []) {
    for (const k of ['min', 'max', 'step']) if (f[k] !== undefined) f[k] = R(f[k]);
    for (const o of f.options || []) if (o.availableWhen !== undefined) o.availableWhen = R(o.availableWhen);
  }
  for (const v of d.validations || []) { if (v.when !== undefined) v.when = R(v.when); if (v.field === oldId) v.field = newId; }
  for (const e of d.effects || []) { if (e.when !== undefined) e.when = R(e.when); if (e.toValue !== undefined) e.toValue = R(e.toValue); if (e.setField === oldId) e.setField = newId; }
  for (const pf of p.fields || []) { for (const k of ['visibleWhen', 'enabledWhen']) if (pf[k] !== undefined) pf[k] = R(pf[k]); for (const o of pf.options || []) if (o.availableWhen !== undefined) o.availableWhen = R(o.availableWhen); }
  for (const o of p.outputs || []) if (o.visibleWhen !== undefined) o.visibleWhen = R(o.visibleWhen);

  // rename the definitions + surfacing overlays themselves
  for (const f of d.fields || []) if (f.id === oldId) f.id = newId;
  for (const c of d.computed || []) if (c.id === oldId) c.id = newId;
  for (const pf of p.fields || []) if (pf.id === oldId) pf.id = newId;
  for (const o of p.outputs || []) if (o.id === oldId) o.id = newId;
  return next;
}

// ---- read-only impact analysis (no wasm) ------------------------------------

function* ownersOf(data, pres) {
  for (const c of data.computed || []) yield { owner: c.id, ast: c.formula, where: `computed ${c.id}` };
  for (const f of data.fields || []) {
    for (const k of ['min', 'max', 'step']) if (f[k] && typeof f[k] === 'object') yield { owner: f.id, ast: f[k], where: `${f.id}.${k}` };
    for (const o of f.options || []) if (o.availableWhen) yield { owner: f.id, ast: o.availableWhen, where: `${f.id}.${o.id} availableWhen` };
  }
  for (const v of data.validations || []) if (v.when) yield { owner: v.field, ast: v.when, where: `validation on ${v.field}` };
  for (const e of data.effects || []) { if (e.when) yield { owner: e.setField, ast: e.when, where: `effect on ${e.setField}` }; if (e.toValue && typeof e.toValue === 'object') yield { owner: e.setField, ast: e.toValue, where: `effect value on ${e.setField}` }; }
  for (const pf of pres.fields || []) for (const k of ['visibleWhen', 'enabledWhen']) if (pf[k]) yield { owner: pf.id, ast: pf[k], where: `${pf.id}.${k}` };
  for (const o of pres.outputs || []) if (o.visibleWhen) yield { owner: o.id, ast: o.visibleWhen, where: `output ${o.id} visibleWhen` };
}

// Everything that would break if `id` were renamed or deleted. Pure (no wasm).
export function referencesTo({ data, pres }, id) {
  const out = [];
  for (const { owner, ast, where } of ownersOf(data, pres)) if (astRefs(ast).has(id)) out.push({ owner, where });
  for (const o of pres.outputs || []) if (o.id === id) out.push({ owner: o.id, where: `output ${o.id}` });
  for (const e of data.effects || []) if (e.setField === id) out.push({ owner: id, where: 'effect target' });
  for (const v of data.validations || []) if (v.field === id) out.push({ owner: id, where: 'validation target' });
  return out;
}
