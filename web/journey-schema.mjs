// =============================================================================
// journey-schema.mjs — the STRUCTURAL shape gate for a journey document, the
// composition-tier analogue of schema-check.mjs's validateEditorSchema. It is
// pure, DOM-free and deterministic (no Date.now/Math.random). It checks SHAPE
// only — required fields, unique ids, kinds/phases drawn from the neutral data
// vocabulary, and intra-document alias references. It deliberately does NOT
// re-do analyzeJourney's SEMANTIC seam checks (does a provided source resolve?
// does the mapping assemble? double-authority? cross-model cycles?) — those need
// the loaded models and run after this gate. Running first gives a fast, clear
// failure before any model is loaded.
//
// The kind/phase/category vocabularies are DATA (hqdm-core.json via hqdm.mjs), so
// a new step kind is added by editing that file, never by editing this validator.
// =============================================================================
import { STEP_KINDS, NEUTRAL_CATEGORIES } from './hqdm.mjs';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string' && x.length > 0;
// an expression operand: a nested {op,args} AST, or a bare number/string/boolean
const isExpr = (x) => isObj(x) || typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean';

export function validateJourneyShape(journey, opts = {}) {
  // legal phases = the caller's list, else the journey's OWN declared phases (a
  // domain lifecycle lives in data, never a baked-in sale list).
  const phases = opts.phases || (Array.isArray(journey && journey.phases) ? journey.phases.map((p) => p.id) : []);
  const noPhases = !phases.length;
  const kinds = opts.kinds || STEP_KINDS;
  const categories = opts.categories || NEUTRAL_CATEGORIES;
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!isObj(journey)) { E('journey must be an object'); return { errors, warnings }; }

  // ---- top-level -----------------------------------------------------------
  for (const k of ['id', 'version', 'title']) if (!isStr(journey[k])) E(`"${k}" is required and must be a non-empty string`);
  if ('correlationPrefix' in journey && typeof journey.correlationPrefix !== 'string') W('"correlationPrefix" should be a string');
  if (!Array.isArray(journey.models)) { E('"models" is required and must be an array'); }
  else if (!journey.models.length) E('"models" must not be empty');
  if ('bindings' in journey && !Array.isArray(journey.bindings)) E('"bindings" must be an array');
  if ('triggers' in journey && !Array.isArray(journey.triggers)) E('"triggers" must be an array');
  if (!isObj(journey.process)) E('"process" is required and must be an object');
  // phases are a domain lifecycle held as data; without them (inline or from the
  // domain) the process is undefined — one clear error beats a cascade of "unknown phase".
  if (noPhases && ((Array.isArray(journey.models) && journey.models.some((m) => m && m.phase)) || (isObj(journey.process) && Array.isArray(journey.process.steps) && journey.process.steps.some((s) => s && s.phase)))) {
    E('no phases are declared (on the journey or passed from its domain) — the process lifecycle is undefined');
  }

  // ---- models[] → collect declared aliases --------------------------------
  const aliases = new Set();
  (Array.isArray(journey.models) ? journey.models : []).forEach((m, i) => {
    const at = `models[${i}]`;
    if (!isObj(m)) { E(`${at} must be an object`); return; }
    if (!isStr(m.ref)) E(`${at}: "ref" is required (a model directory id)`);
    if (!isStr(m.as)) E(`${at}: "as" is required (a unique alias)`);
    else if (aliases.has(m.as)) E(`${at}: duplicate model alias "${m.as}"`);
    else aliases.add(m.as);
    if (!isStr(m.phase)) E(`${at}: "phase" is required`);
    else if (!noPhases && !phases.includes(m.phase)) E(`${at}: phase "${m.phase}" is not a known phase (known: ${phases.join(', ')})`);
    if ('role' in m && typeof m.role !== 'string') W(`${at}: "role" should be a string`);
  });
  const alias = (id) => aliases.has(id);

  // ---- bindings[] ----------------------------------------------------------
  const bindingIds = new Set();
  (Array.isArray(journey.bindings) ? journey.bindings : []).forEach((b, i) => {
    const at = `bindings[${i}]`;
    if (!isObj(b)) { E(`${at} must be an object`); return; }
    if (!isStr(b.id)) E(`${at}: "id" is required`);
    else if (bindingIds.has(b.id)) E(`${at}: duplicate binding id "${b.id}"`);
    else bindingIds.add(b.id);
    const bid = isStr(b.id) ? `binding "${b.id}"` : at;
    if (!isStr(b.from)) E(`${bid}: "from" is required`);
    else if (!alias(b.from)) E(`${bid}: "from" alias "${b.from}" is not a declared model`);
    if (!isStr(b.to)) E(`${bid}: "to" is required`);
    else if (!alias(b.to)) E(`${bid}: "to" alias "${b.to}" is not a declared model`);
    if (isStr(b.from) && b.from === b.to) E(`${bid}: "from" and "to" are the same model ("${b.from}")`);
    if (!isObj(b.contract)) { E(`${bid}: "contract" is required and must be an object`); }
    else {
      for (const side of ['provides', 'requires']) if (!Array.isArray(b.contract[side])) E(`${bid}: contract.${side} must be an array`);
      (Array.isArray(b.contract.provides) ? b.contract.provides : []).forEach((p, pi) => {
        if (!isObj(p)) { E(`${bid}: contract.provides[${pi}] must be an object`); return; }
        if (!isStr(p.as)) E(`${bid}: contract.provides[${pi}].as is required`);
        if (!isStr(p.source)) E(`${bid}: contract.provides[${pi}].source is required (e.g. "output:grandTotal")`);
      });
      (Array.isArray(b.contract.requires) ? b.contract.requires : []).forEach((r, ri) => {
        if (!isObj(r)) { E(`${bid}: contract.requires[${ri}] must be an object`); return; }
        if (!isStr(r.name) && !isStr(r.target)) E(`${bid}: contract.requires[${ri}] needs a "name" or "target"`);
      });
    }
    if ('mapping' in b) {
      if (!Array.isArray(b.mapping)) E(`${bid}: "mapping" must be an array`);
      else b.mapping.forEach((mp, mi) => {
        if (!isObj(mp)) { E(`${bid}: mapping[${mi}] must be an object`); return; }
        if (!isStr(mp.to)) E(`${bid}: mapping[${mi}].to is required`);
        if (!('from' in mp) || !isExpr(mp.from)) E(`${bid}: mapping[${mi}].from must be an expression`);
      });
    }
    if ('condition' in b && b.condition != null && !isExpr(b.condition)) E(`${bid}: "condition" must be an expression`);
  });

  // ---- triggers[] ----------------------------------------------------------
  const triggerIds = new Set();
  (Array.isArray(journey.triggers) ? journey.triggers : []).forEach((t, i) => {
    const at = `triggers[${i}]`;
    if (!isObj(t)) { E(`${at} must be an object`); return; }
    if (!isStr(t.id)) E(`${at}: "id" is required`);
    else if (triggerIds.has(t.id)) E(`${at}: duplicate trigger id "${t.id}"`);
    else triggerIds.add(t.id);
    const tid = isStr(t.id) ? `trigger "${t.id}"` : at;
    if (!isStr(t.on)) E(`${tid}: "on" is required`);
    else if (!alias(t.on)) E(`${tid}: "on" alias "${t.on}" is not a declared model`);
    if (!isStr(t.activates)) E(`${tid}: "activates" is required`);
    else if (!alias(t.activates)) E(`${tid}: "activates" alias "${t.activates}" is not a declared model`);
    if ('guard' in t && t.guard != null && !isExpr(t.guard)) E(`${tid}: "guard" must be an expression`);
  });

  // ---- process.steps[] -----------------------------------------------------
  if (isObj(journey.process)) {
    if (!Array.isArray(journey.process.steps)) E('process.steps is required and must be an array');
    else if (!journey.process.steps.length) E('process.steps must not be empty');
    else {
      const stepIds = new Set();
      journey.process.steps.forEach((s, i) => {
        const at = `process.steps[${i}]`;
        if (!isObj(s)) { E(`${at} must be an object`); return; }
        if (!isStr(s.id)) E(`${at}: "id" is required`);
        else if (stepIds.has(s.id)) E(`${at}: duplicate step id "${s.id}"`);
        else stepIds.add(s.id);
        const sid = isStr(s.id) ? `step "${s.id}"` : at;
        if (!isStr(s.phase)) E(`${sid}: "phase" is required`);
        else if (!noPhases && !phases.includes(s.phase)) E(`${sid}: phase "${s.phase}" is not a known phase (known: ${phases.join(', ')})`);
        if (!isStr(s.kind)) E(`${sid}: "kind" is required`);
        else if (!kinds.includes(s.kind)) E(`${sid}: kind "${s.kind}" is not a known step kind (known: ${kinds.join(', ')})`);
        if ('model' in s && s.model != null && !alias(s.model)) E(`${sid}: model "${s.model}" is not a declared model alias`);
        // produces/activity/outcome are HQDM categories; a domain type climbs the
        // lattice to a neutral one, and the shape gate lacks the merged model types
        // to resolve that — so an unknown value is a WARNING, not an error.
        for (const k of ['produces', 'activity', 'outcome']) {
          if (k in s && s[k] != null) {
            if (!isStr(s[k])) E(`${sid}: "${k}" should be a string`);
            else if (!categories.includes(s[k])) W(`${sid}: "${k}" = "${s[k]}" is not a core HQDM category (ok if a domain type declares it)`);
          }
        }
        for (const k of ['prompt', 'actionLabel', 'commitLabel', 'label']) if (k in s && typeof s[k] !== 'string') W(`${sid}: "${k}" should be a string`);
        if ('enters' in s && !Array.isArray(s.enters)) E(`${sid}: "enters" must be an array`);
      });
    }
  }

  return { errors, warnings };
}
