// =============================================================================
// assembler.mjs — turns a declarative model.json into the engine's internal
// representation (IR), and (Stage 2) a compact binary MODEL image + IO manifest
// for the WASM VM.
//
// This ONE module is imported by both the browser runtime and the Node build
// gate, so there is a single layout algorithm and no two-copy drift.
//
// Stage 1 (this file, now): buildIR() + a JS `referenceEvaluate()` that mirrors
// the exact VM algorithm (settle -> compute -> outputs -> validations). The
// reference is the parity ORACLE for the AssemblyScript VM built in Stage 2.
//
// The expression model is a small AST: { op, args }. See docs/phase1-spec.md.
// =============================================================================

// ---- Opcodes (must match the AssemblyScript VM in Stage 2) ------------------
export const OP = {
  CONST: 0, LOAD: 1, ADD: 2, SUB: 3, MUL: 4, DIV: 5, NEG: 6, POW: 7,
  ABS: 8, FLOOR: 9, CEIL: 10, ROUND: 11, MIN: 12, MAX: 13, CLAMP: 14,
  EQ: 15, NE: 16, LT: 17, LE: 18, GT: 19, GE: 20, AND: 21, OR: 22, NOT: 23,
  IF: 24, HAS: 25, COUNTBITS: 26, LOOKUP1D: 27, LOOKUP2D: 28,
};

// ---- STATUS bitfield --------------------------------------------------------
export const STATUS = {
  OK: 0, DIV0: 1, TABLE_OOB: 2, NAN_INF: 4, DEPTH_EXCEEDED: 8, SETTLE_NOT_CONVERGED: 16,
};

// Model comparison/logic ops -> opcode
const CMP = { eq: OP.EQ, ne: OP.NE, lt: OP.LT, lte: OP.LE, gt: OP.GT, ge: OP.GE, gte: OP.GE };
const VARIADIC = { add: OP.ADD, sub: OP.SUB, mul: OP.MUL, min: OP.MIN, max: OP.MAX, and: OP.AND, or: OP.OR };

function fail(msg) { const e = new Error(msg); e.isModelError = true; throw e; }

// =============================================================================
// split / merge — the authoring-time two-file split (Phase A).
//
// A combined model is authored as two files: a DATA model (semantics) and a
// PRESENTATION model (bindings/layout/labels). `mergeModel` reconstructs the
// exact combined model that buildIR/serialize/the engine consume UNCHANGED.
// splitModel and mergeModel are exact inverses (guaranteed by test/split-merge).
// =============================================================================
const pickDefined = (obj, keys) => {
  const o = {};
  for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k];
  return o;
};

// Which keys are owned by which file. Split by ownership (see docs/editor-architecture.md §3).
const DATA_TOP = ['$schema', 'id', 'version', 'currency'];
const DATA_BLOCKS = ['effects', 'tables', 'computed', 'validations', 'bundles', 'units', 'rates'];
const DATA_FIELD = ['id', 'type', 'default', 'min', 'max', 'step', 'unit', 'canonicalUnit', 'formula'];
const DATA_OPTION = ['id', 'availableWhen'];
const PRES_TOP = ['name', 'brand', 'carryOverOnPrimaryChange'];
const PRES_FIELD = ['id', 'label', 'control', 'section', 'width', 'help', 'decimals', 'visibleWhen', 'enabledWhen'];
const PRES_OPTION = ['id', 'label', 'priceDelta', 'image'];

export function splitModel(m) {
  const data = {
    ...pickDefined(m, DATA_TOP),
    fields: (m.fields || []).map((f) => {
      const df = pickDefined(f, DATA_FIELD);
      if (f.options) df.options = f.options.map((o) => pickDefined(o, DATA_OPTION));
      return df;
    }),
    ...pickDefined(m, DATA_BLOCKS),
  };
  const presentation = {
    ...pickDefined(m, PRES_TOP),
    ...pickDefined(m, ['sections']),
    fields: (m.fields || []).map((f) => {
      const pf = pickDefined(f, PRES_FIELD);
      if (f.options) pf.options = f.options.map((o) => pickDefined(o, PRES_OPTION));
      return pf;
    }),
    ...pickDefined(m, ['outputs']),
  };
  return { data, presentation };
}

export function mergeModel(data, presentation) {
  const presById = new Map((presentation.fields || []).map((f) => [f.id, f]));
  const fields = (data.fields || []).map((df) => {
    const pf = presById.get(df.id) || {};
    const merged = { ...df, ...pf, id: df.id };
    if (df.options || pf.options) {
      const presOpt = new Map((pf.options || []).map((o) => [o.id, o]));
      merged.options = (df.options || []).map((dop) => ({ ...dop, ...(presOpt.get(dop.id) || {}), id: dop.id }));
    }
    return merged;
  });
  return {
    ...pickDefined(data, DATA_TOP),
    ...pickDefined(presentation, PRES_TOP),
    ...pickDefined(presentation, ['sections']),
    fields,
    ...pickDefined(data, DATA_BLOCKS),
    ...pickDefined(presentation, ['outputs']),
  };
}

// =============================================================================
// buildIR — parse a model into the internal representation.
// =============================================================================
export function buildIR(model) {
  // ---- 1. Slot namespace: every input field + every computed value ---------
  const slotOf = new Map();       // id -> slot index
  const fieldById = new Map();    // id -> field object (inputs only)
  const computedById = new Map(); // id -> computed object

  const inputFields = model.fields || [];
  const computed = model.computed || [];

  let slotCount = 0;
  for (const f of inputFields) {
    if (slotOf.has(f.id)) fail(`duplicate field id: ${f.id}`);
    slotOf.set(f.id, slotCount++);
    fieldById.set(f.id, f);
  }
  for (const c of computed) {
    if (slotOf.has(c.id)) fail(`duplicate id (field/computed clash): ${c.id}`);
    slotOf.set(c.id, slotCount++);
    computedById.set(c.id, c);
  }

  // ---- 2. Option codes/bits per choice/multichoice field -------------------
  // dense code == option index == multi-select bit index.
  const optionCode = new Map(); // `${fieldId}\0${optId}` -> code
  const fieldOptions = new Map(); // fieldId -> [{id,label,priceDelta,availableWhen}]
  for (const f of inputFields) {
    if (f.type === 'choice' || f.type === 'multichoice') {
      if (!Array.isArray(f.options) || f.options.length === 0) fail(`field ${f.id} needs options`);
      if (f.type === 'multichoice' && f.options.length > 31) fail(`field ${f.id}: multichoice capped at 31 options`);
      f.options.forEach((o, i) => optionCode.set(`${f.id}\0${o.id}`, i));
      fieldOptions.set(f.id, f.options);
    }
  }
  const codeOf = (fieldId, optId) => {
    const c = optionCode.get(`${fieldId}\0${optId}`);
    if (c === undefined) fail(`unknown option "${optId}" on field "${fieldId}"`);
    return c;
  };

  // ---- 3. Node pool + expression parser ------------------------------------
  const nodes = []; // {op, aux, imm, kids:[nodeIdx]}
  const MAX_DEPTH = 64;
  const addNode = (op, { aux = 0, imm = 0, kids = [] } = {}) => {
    nodes.push({ op, aux, imm, kids });
    return nodes.length - 1;
  };
  const constNode = (n) => addNode(OP.CONST, { imm: n });
  const loadNode = (id) => {
    if (!slotOf.has(id)) fail(`expression references unknown field/computed "${id}"`);
    return addNode(OP.LOAD, { aux: slotOf.get(id) });
  };

  // resolve an operand that may be a bare number, a bare option-id string
  // (resolved against a companion field), or a nested expression.
  const resolveArg = (arg, companionFieldId, depth) => {
    if (typeof arg === 'number') return constNode(arg);
    if (typeof arg === 'boolean') return constNode(arg ? 1 : 0);
    if (typeof arg === 'string') {
      if (!companionFieldId) fail(`bare string "${arg}" with no companion field to resolve against`);
      return constNode(codeOf(companionFieldId, arg));
    }
    return parseExpr(arg, depth);
  };

  function foldBinary(op, argNodes) {
    if (argNodes.length === 0) fail('variadic op with no args');
    let acc = argNodes[0];
    for (let i = 1; i < argNodes.length; i++) acc = addNode(op, { kids: [acc, argNodes[i]] });
    return acc;
  }

  function parseExpr(expr, depth = 0) {
    if (depth > MAX_DEPTH) fail(`expression nesting exceeds ${MAX_DEPTH}`);
    if (typeof expr === 'number') return constNode(expr);
    if (typeof expr === 'boolean') return constNode(expr ? 1 : 0);
    if (expr == null || typeof expr !== 'object' || !expr.op) fail(`invalid expression: ${JSON.stringify(expr)}`);

    const op = expr.op;
    const args = expr.args || [];

    if (op === 'const') return constNode(Number(args[0]));
    if (op === 'field') return loadNode(args[0]);

    if (op in CMP) {
      // one side is usually a field; the other may be a bare option-id string.
      const fieldArg = args.find((a) => a && typeof a === 'object' && a.op === 'field');
      const companion = fieldArg ? fieldArg.args[0] : null;
      const kids = args.map((a) => resolveArg(a, companion, depth + 1));
      if (kids.length !== 2) fail(`${op} needs 2 args`);
      return addNode(CMP[op], { kids });
    }

    if (op in VARIADIC) {
      const kids = args.map((a) => parseExpr(a, depth + 1));
      return foldBinary(VARIADIC[op], kids);
    }

    switch (op) {
      case 'div': return addNode(OP.DIV, { kids: [parseExpr(args[0], depth + 1), parseExpr(args[1], depth + 1)] });
      case 'pow': return addNode(OP.POW, { kids: [parseExpr(args[0], depth + 1), parseExpr(args[1], depth + 1)] });
      case 'neg': return addNode(OP.NEG, { kids: [parseExpr(args[0], depth + 1)] });
      case 'not': return addNode(OP.NOT, { kids: [parseExpr(args[0], depth + 1)] });
      case 'abs': return addNode(OP.ABS, { kids: [parseExpr(args[0], depth + 1)] });
      case 'floor': return addNode(OP.FLOOR, { kids: [parseExpr(args[0], depth + 1)] });
      case 'ceil': return addNode(OP.CEIL, { kids: [parseExpr(args[0], depth + 1)] });
      case 'round': return addNode(OP.ROUND, { kids: [parseExpr(args[0], depth + 1)] });
      case 'clamp': return addNode(OP.CLAMP, { kids: args.map((a) => parseExpr(a, depth + 1)) });
      case 'if': return addNode(OP.IF, { kids: [parseExpr(args[0], depth + 1), parseExpr(args[1], depth + 1), parseExpr(args[2], depth + 1)] });
      case 'has': {
        const [fid, oid] = args;
        return addNode(OP.HAS, { aux: codeOf(fid, oid), kids: [loadNode(fid)] });
      }
      case 'notHas': {
        const [fid, oid] = args;
        const has = addNode(OP.HAS, { aux: codeOf(fid, oid), kids: [loadNode(fid)] });
        return addNode(OP.NOT, { kids: [has] });
      }
      case 'lookup': return parseLookup(args, depth);
      default: fail(`unknown op "${op}"`);
    }
  }

  // ---- tables: assign ids, remember key field(s), bake after parsing --------
  const tableId = new Map();      // name -> id
  const tableMeta = [];           // [{name, def, keyFields:[fieldId|null,...]}]
  function getTableId(name) {
    if (!model.tables || !model.tables[name]) fail(`unknown table "${name}"`);
    if (!tableId.has(name)) {
      tableId.set(name, tableMeta.length);
      tableMeta.push({ name, def: model.tables[name], keyFields: [] });
    }
    return tableId.get(name);
  }
  const keyFieldOf = (arg) => (arg && typeof arg === 'object' && arg.op === 'field') ? arg.args[0] : null;

  function parseLookup(args, depth) {
    const name = args[0];
    const id = getTableId(name);
    const meta = tableMeta[id];
    const keyArgs = args.slice(1);
    keyArgs.forEach((k, i) => { if (meta.keyFields[i] == null) meta.keyFields[i] = keyFieldOf(k); });
    const kids = keyArgs.map((k) => parseExpr(k, depth + 1));
    if (kids.length === 1) return addNode(OP.LOOKUP1D, { aux: id, kids });
    if (kids.length === 2) return addNode(OP.LOOKUP2D, { aux: id, kids });
    fail(`lookup "${name}" needs 1 or 2 keys`);
  }

  const parseOpt = (expr) => (expr === undefined ? -1 : parseExpr(expr));

  // ---- 4. Parse field structural expressions -------------------------------
  const fields = inputFields.map((f) => {
    const kindMap = { number: 0, boolean: 1, choice: 2, multichoice: 3, computed: 4 };
    const opts = (fieldOptions.get(f.id) || []).map((o) => ({
      id: o.id, code: codeOf(f.id, o.id), label: o.label, priceDelta: o.priceDelta || 0,
      availableWhenNode: parseOpt(o.availableWhen),
    }));
    return {
      id: f.id, slot: slotOf.get(f.id), kind: kindMap[f.type], type: f.type,
      control: f.control || null, section: f.section || null, width: f.width || 'full',
      label: f.label || f.id, unit: f.unit || null, decimals: f.decimals ?? null,
      options: opts,
      visibleWhenNode: parseOpt(f.visibleWhen),
      enabledWhenNode: parseOpt(f.enabledWhen),
      minNode: parseOpt(typeof f.min === 'object' ? f.min : (typeof f.min === 'number' ? f.min : undefined)),
      maxNode: parseOpt(typeof f.max === 'object' ? f.max : (typeof f.max === 'number' ? f.max : undefined)),
      stepNode: parseOpt(typeof f.step === 'object' ? f.step : (typeof f.step === 'number' ? f.step : undefined)),
      computedValueNode: f.type === 'computed' && f.formula ? parseExpr(f.formula) : -1,
      defaultRaw: f.default,
    };
  });

  // ---- 5. Computed values (top-level) --------------------------------------
  const computedIR = computed.map((c) => ({
    id: c.id, slot: slotOf.get(c.id), node: parseExpr(c.formula), label: c.label || c.id,
  }));

  // ---- 6. Effects ----------------------------------------------------------
  const effects = (model.effects || []).map((e, i) => {
    if (!slotOf.has(e.setField)) fail(`effect targets unknown field "${e.setField}"`);
    const targetSlot = slotOf.get(e.setField);
    const targetField = fieldById.get(e.setField);
    let valueNode;
    if (typeof e.toValue === 'string' && targetField && (targetField.type === 'choice')) {
      valueNode = constNode(codeOf(e.setField, e.toValue));
    } else {
      valueNode = parseExpr(e.toValue);
    }
    return { condNode: parseExpr(e.when), targetSlot, valueNode, opKind: 0, priority: i };
  });

  // ---- 7. Validations ------------------------------------------------------
  const validations = (model.validations || []).map((v) => {
    const sev = { info: 0, warning: 1, error: 2 }[v.severity] ?? 1;
    return {
      id: v.id || null, condNode: parseExpr(v.when), message: v.message, severity: sev,
      targetSlot: v.field && slotOf.has(v.field) ? slotOf.get(v.field) : -1,
    };
  });

  // ---- 8. Outputs ----------------------------------------------------------
  const outputs = (model.outputs || []).map((o) => {
    if (!slotOf.has(o.id)) fail(`output references unknown id "${o.id}"`);
    const fmt = o.format || {};
    return {
      id: o.id, slot: slotOf.get(o.id), label: o.label || o.id,
      formatType: fmt.type || 'number', unit: fmt.unit || null,
      currencyCode: fmt.currencyCode || model.currency || 'USD', decimals: fmt.decimals ?? 2,
      canonicalUnit: fmt.canonicalUnit || null, baseCurrency: fmt.baseCurrency || model.currency || null,
      visibleWhenNode: parseOpt(o.visibleWhen),
    };
  });

  // ---- 9. Bake tables ------------------------------------------------------
  const tables = tableMeta.map((m) => {
    const def = m.def;
    if (def.kind === '1d') {
      const kf = m.keyFields[0];
      if (!kf || !fieldOptions.has(kf)) fail(`table "${m.name}" 1D key field unknown/not enumerable`);
      const opts = fieldOptions.get(kf);
      const data = new Array(opts.length).fill(0);
      for (const [k, v] of Object.entries(def.map)) data[codeOf(kf, k)] = v;
      return { name: m.name, kind: 1, rows: opts.length, cols: 1, data };
    }
    if (def.kind === '2d') {
      const rf = m.keyFields[0], cf = m.keyFields[1];
      if (!rf || !cf) fail(`table "${m.name}" 2D key fields unknown`);
      const rOpts = fieldOptions.get(rf), cOpts = fieldOptions.get(cf);
      const data = new Array(rOpts.length * cOpts.length).fill(0);
      for (const [rk, row] of Object.entries(def.rows))
        for (const [ck, val] of Object.entries(row))
          data[codeOf(rf, rk) * cOpts.length + codeOf(cf, ck)] = val;
      return { name: m.name, kind: 2, rows: rOpts.length, cols: cOpts.length, data };
    }
    fail(`table "${m.name}" has unknown kind`);
  });

  // ---- 10. Dependency order for computed slots (Kahn) ----------------------
  const evalOrder = topoComputed(computed, computedById, fieldById);
  const computedBySlot = new Map();
  for (const c of computedIR) computedBySlot.set(c.slot, c);
  // order computed IR by evalOrder (list of ids) -> slots
  const orderedComputedSlots = evalOrder.map((id) => slotOf.get(id));

  return {
    slotCount, slotOf, fields, computedIR, computedBySlot, orderedComputedSlots,
    effects, validations, outputs, tables, nodes,
    fieldById, fieldOptions,
    currency: model.currency || 'USD',
    units: model.units || null, rates: model.rates || null,
    settleMaxPasses: (model.effects?.length || 0) + fields.reduce((n, f) => n + f.options.length, 0) + 4,
  };
}

// Topological order of computed ids by inter-computed dependencies.
function topoComputed(computed, computedById, fieldById) {
  const ids = computed.map((c) => c.id);
  const deps = new Map(ids.map((id) => [id, new Set()]));
  const refs = (expr, out) => {
    if (!expr || typeof expr !== 'object') return;
    if (expr.op === 'field' && computedById.has(expr.args[0])) out.add(expr.args[0]);
    for (const a of expr.args || []) refs(a, out);
  };
  for (const c of computed) { const s = new Set(); refs(c.formula, s); s.delete(c.id); deps.set(c.id, s); }
  const order = [];
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const d of deps.get(id)) indeg.set(id, indeg.get(id) + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const other of ids) {
      if (deps.get(other).has(id)) { indeg.set(other, indeg.get(other) - 1); if (indeg.get(other) === 0) queue.push(other); }
    }
  }
  if (order.length !== ids.length) fail('cycle detected among computed values');
  return order;
}

// =============================================================================
// referenceEvaluate — the JS oracle that mirrors the VM algorithm exactly.
// Returns { values, outputs, optionState, visible, enabled, limits, messages, status }.
// =============================================================================
const popcount = (x) => { x = x | 0; let c = 0; while (x) { x &= x - 1; c++; } return c; };

function makeEval(ir, V, status) {
  const N = ir.nodes;
  const e = (i) => {
    const n = N[i], k = n.kids;
    switch (n.op) {
      case OP.CONST: return n.imm;
      case OP.LOAD: return V[n.aux];
      case OP.ADD: return e(k[0]) + e(k[1]);
      case OP.SUB: return e(k[0]) - e(k[1]);
      case OP.MUL: return e(k[0]) * e(k[1]);
      case OP.DIV: { const d = e(k[1]); if (d === 0) { status.flags |= STATUS.DIV0; return 0; } return e(k[0]) / d; }
      case OP.NEG: return -e(k[0]);
      case OP.POW: { const r = Math.pow(e(k[0]), e(k[1])); if (!Number.isFinite(r)) status.flags |= STATUS.NAN_INF; return r; }
      case OP.ABS: return Math.abs(e(k[0]));
      case OP.FLOOR: return Math.floor(e(k[0]));
      case OP.CEIL: return Math.ceil(e(k[0]));
      case OP.ROUND: return Math.round(e(k[0]));
      case OP.MIN: return Math.min(e(k[0]), e(k[1]));
      case OP.MAX: return Math.max(e(k[0]), e(k[1]));
      case OP.CLAMP: return Math.max(e(k[1]), Math.min(e(k[2]), e(k[0])));
      case OP.EQ: return e(k[0]) === e(k[1]) ? 1 : 0;
      case OP.NE: return e(k[0]) !== e(k[1]) ? 1 : 0;
      case OP.LT: return e(k[0]) < e(k[1]) ? 1 : 0;
      case OP.LE: return e(k[0]) <= e(k[1]) ? 1 : 0;
      case OP.GT: return e(k[0]) > e(k[1]) ? 1 : 0;
      case OP.GE: return e(k[0]) >= e(k[1]) ? 1 : 0;
      case OP.AND: return e(k[0]) !== 0 ? (e(k[1]) !== 0 ? 1 : 0) : 0;
      case OP.OR: return e(k[0]) !== 0 ? 1 : (e(k[1]) !== 0 ? 1 : 0);
      case OP.NOT: return e(k[0]) === 0 ? 1 : 0;
      case OP.IF: return e(k[0]) !== 0 ? e(k[1]) : e(k[2]);
      case OP.HAS: return ((e(k[0]) | 0) >> n.aux) & 1;
      case OP.COUNTBITS: return popcount(e(k[0]));
      case OP.LOOKUP1D: {
        const t = ir.tables[n.aux]; let i = Math.round(e(k[0]));
        if (i < 0 || i >= t.rows) { status.flags |= STATUS.TABLE_OOB; i = Math.max(0, Math.min(t.rows - 1, i)); }
        return t.data[i];
      }
      case OP.LOOKUP2D: {
        const t = ir.tables[n.aux]; let r = Math.round(e(k[0])), c = Math.round(e(k[1]));
        if (r < 0 || r >= t.rows || c < 0 || c >= t.cols) { status.flags |= STATUS.TABLE_OOB; r = Math.max(0, Math.min(t.rows - 1, r)); c = Math.max(0, Math.min(t.cols - 1, c)); }
        return t.data[r * t.cols + c];
      }
      default: fail(`bad opcode ${n.op}`);
    }
  };
  return e;
}

export function encodeInput(field, raw) {
  if (field.type === 'choice') {
    const v = raw ?? field.defaultRaw;
    const o = field.options.find((x) => x.id === v);
    return o ? o.code : 0;
  }
  if (field.type === 'multichoice') {
    const arr = raw ?? field.defaultRaw ?? [];
    let mask = 0;
    for (const id of arr) { const o = field.options.find((x) => x.id === id); if (o) mask |= (1 << o.code); }
    return mask;
  }
  if (field.type === 'boolean') return (raw ?? field.defaultRaw) ? 1 : 0;
  // number
  const n = raw ?? field.defaultRaw;
  return typeof n === 'number' ? n : 0;
}

export function referenceEvaluate(ir, rawInputs) {
  const V = new Float64Array(ir.slotCount);
  const status = { flags: 0 };

  // seed input values
  for (const f of ir.fields) V[f.slot] = encodeInput(f, rawInputs[f.id]);

  const recomputeComputed = () => {
    const e = makeEval(ir, V, status);
    for (const slot of ir.orderedComputedSlots) V[slot] = e(ir.computedBySlot.get(slot).node);
  };

  const forced = new Set();
  const cap = ir.settleMaxPasses;
  let converged = false;
  for (let pass = 0; pass < cap; pass++) {
    let dirty = false;
    recomputeComputed();
    const e = makeEval(ir, V, status);

    // effects (priority/declaration order)
    for (const eff of ir.effects) {
      if (e(eff.condNode) !== 0) {
        const nv = e(eff.valueNode);
        forced.add(eff.targetSlot);
        if (V[eff.targetSlot] !== nv) { V[eff.targetSlot] = nv; dirty = true; }
      }
    }

    // option availability + auto-deselect / single-select fallback
    for (const f of ir.fields) {
      if (f.kind !== 2 && f.kind !== 3) continue;
      const avail = f.options.map((o) => (o.availableWhenNode < 0 ? 1 : (e(o.availableWhenNode) !== 0 ? 1 : 0)));
      if (f.kind === 3) { // multichoice: clear unavailable selected bits (monotonic)
        let mask = V[f.slot] | 0;
        for (const o of f.options) if (!avail[o.code] && (mask & (1 << o.code))) { mask &= ~(1 << o.code); dirty = true; }
        V[f.slot] = mask;
      } else { // single-select fallback
        const cur = V[f.slot] | 0;
        if (!avail[cur]) {
          const def = f.options.find((o) => o.id === f.defaultRaw);
          let next = def && avail[def.code] ? def.code : f.options.findIndex((o, i) => avail[i]);
          if (next < 0) next = cur; // nothing available; leave as-is
          if (next !== cur) { V[f.slot] = next; dirty = true; }
        }
      }
    }

    if (!dirty) { converged = true; break; }
  }
  if (!converged) status.flags |= STATUS.SETTLE_NOT_CONVERGED;

  // finalize
  recomputeComputed();
  const e = makeEval(ir, V, status);

  const optionState = {};
  const visible = {}, enabled = {}, limits = {};
  for (const f of ir.fields) {
    visible[f.id] = f.visibleWhenNode < 0 ? true : e(f.visibleWhenNode) !== 0;
    enabled[f.id] = f.enabledWhenNode < 0 ? true : e(f.enabledWhenNode) !== 0;
    limits[f.id] = {
      min: f.minNode < 0 ? null : e(f.minNode),
      max: f.maxNode < 0 ? null : e(f.maxNode),
      step: f.stepNode < 0 ? null : e(f.stepNode),
    };
    if (f.kind === 2 || f.kind === 3) {
      optionState[f.id] = {};
      for (const o of f.options) optionState[f.id][o.id] = o.availableWhenNode < 0 ? true : e(o.availableWhenNode) !== 0;
    }
  }

  const outputs = ir.outputs.map((o) => ({
    id: o.id, label: o.label, value: V[o.slot],
    visible: o.visibleWhenNode < 0 ? true : e(o.visibleWhenNode) !== 0,
    format: o.formatType, unit: o.unit, currencyCode: o.currencyCode, decimals: o.decimals,
    canonicalUnit: o.canonicalUnit, baseCurrency: o.baseCurrency,
  }));

  const messages = ir.validations.filter((v) => e(v.condNode) !== 0)
    .map((v) => ({ id: v.id, message: v.message, severity: v.severity, targetSlot: v.targetSlot }));

  return {
    values: V, valueById: Object.fromEntries([...ir.slotOf].map(([id, s]) => [id, V[s]])),
    outputs, optionState, visible, enabled, limits, messages, forced: [...forced], status: status.flags,
  };
}

// =============================================================================
// serialize — flatten the IR into the binary MODEL image + IO layout, matching
// the layout the AssemblyScript VM (assembly/quote.ts) reads.
// =============================================================================
const align8 = (n) => (n + 7) & ~7;
const MAGIC = 0x51434d31; // 'QCM1'

function setI32s(dv, at, arr) { arr.forEach((v, i) => dv.setInt32(at + i * 4, v | 0, true)); }

export function serialize(ir) {
  const nodeCount = ir.nodes.length;

  // flatten options; per-field optStart + default code
  const options = [];
  const fieldMeta = ir.fields.map((f) => {
    const optStart = options.length;
    for (const o of f.options) options.push(o);
    const defCode = f.type === 'choice' ? (f.options.find((o) => o.id === f.defaultRaw)?.code ?? -1) : -1;
    return { optStart, defCode };
  });

  const computed = ir.orderedComputedSlots.map((slot) => ({ slot, node: ir.computedBySlot.get(slot).node }));

  // table data pool
  let tableData = [];
  const tableRecs = ir.tables.map((t) => {
    const dataOff = tableData.length;
    tableData = tableData.concat(t.data);
    return { kind: t.kind, rows: t.rows, cols: t.cols, dataOff };
  });

  // ---- MODEL region placement ----
  const HEADER_BYTES = 128;
  let off = HEADER_BYTES;
  const place = (bytes) => { off = align8(off); const s = off; off += bytes; return s; };
  const nodesOff = place(nodeCount * 20);
  const nodeImmOff = place(nodeCount * 8);
  const fieldsOff = place(ir.fields.length * 44);
  const optionsOff = place(options.length * 8);
  const effectsOff = place(ir.effects.length * 16);
  const validationsOff = place(ir.validations.length * 16);
  const outputsOff = place(ir.outputs.length * 8);
  const tablesOff = place(tableRecs.length * 16);
  const computedOff = place(computed.length * 8);
  const tableDataOff = place(tableData.length * 8);
  const modelBytes = new Uint8Array(align8(off));
  const dv = new DataView(modelBytes.buffer);

  // nodes
  for (let i = 0; i < nodeCount; i++) {
    const n = ir.nodes[i]; const b = nodesOff + i * 20;
    dv.setInt32(b, n.op, true);
    dv.setInt32(b + 4, n.aux | 0, true);
    dv.setInt32(b + 8, n.kids[0] ?? -1, true);
    dv.setInt32(b + 12, n.kids[1] ?? -1, true);
    dv.setInt32(b + 16, n.kids[2] ?? -1, true);
    dv.setFloat64(nodeImmOff + i * 8, n.imm || 0, true);
  }
  // fields
  ir.fields.forEach((f, i) => {
    const m = fieldMeta[i]; const b = fieldsOff + i * 44;
    setI32s(dv, b, [f.kind, f.slot, f.visibleWhenNode, f.enabledWhenNode, f.minNode, f.maxNode,
      f.stepNode, f.computedValueNode, m.optStart, f.options.length, m.defCode]);
  });
  // options
  options.forEach((o, i) => { const b = optionsOff + i * 8; dv.setInt32(b, o.code, true); dv.setInt32(b + 4, o.availableWhenNode, true); });
  // effects
  ir.effects.forEach((e, i) => setI32s(dv, effectsOff + i * 16, [e.condNode, e.targetSlot, e.valueNode, e.opKind]));
  // validations (msgId = index)
  ir.validations.forEach((v, i) => setI32s(dv, validationsOff + i * 16, [v.condNode, i, v.severity, v.targetSlot]));
  // outputs
  ir.outputs.forEach((o, i) => { const b = outputsOff + i * 8; dv.setInt32(b, o.slot, true); dv.setInt32(b + 4, o.visibleWhenNode, true); });
  // tables
  tableRecs.forEach((t, i) => setI32s(dv, tablesOff + i * 16, [t.kind, t.rows, t.cols, t.dataOff]));
  // computed
  computed.forEach((c, i) => { const b = computedOff + i * 8; dv.setInt32(b, c.slot, true); dv.setInt32(b + 4, c.node, true); });
  // table data
  tableData.forEach((v, i) => dv.setFloat64(tableDataOff + i * 8, v, true));

  // ---- IO layout (relative to ioBase) ----
  const slotCount = ir.slotCount;
  const messageCap = Math.max(1, ir.validations.length);
  let ioff = 0;
  const ioPlace = (bytes) => { ioff = align8(ioff); const s = ioff; ioff += bytes; return s; };
  const valuesOff = ioPlace(slotCount * 8);
  const stateOff = ioPlace(slotCount * 4);
  const limitsOff = ioPlace(slotCount * 24);
  const optStateOff = ioPlace(options.length * 4);
  const msgCountOff = ioPlace(4);
  const msgOff = ioPlace(messageCap * 12);
  const outValuesOff = ioPlace(ir.outputs.length * 8);
  const outVisOff = ioPlace(ir.outputs.length * 4);
  const statusOff = ioPlace(4);
  const ioBytes = align8(ioff);

  // ---- header (indices must match quote.ts hi()) ----
  setI32s(dv, 0, [
    MAGIC, slotCount, nodeCount, ir.fields.length, options.length, ir.effects.length,
    ir.validations.length, ir.outputs.length, tableRecs.length, computed.length, ir.settleMaxPasses, messageCap,
    nodesOff, nodeImmOff, fieldsOff, optionsOff, effectsOff, validationsOff, outputsOff, tablesOff, tableDataOff, computedOff,
    valuesOff, stateOff, limitsOff, optStateOff, msgCountOff, msgOff, outValuesOff, outVisOff, statusOff,
  ]);

  const io = {
    totalBytes: ioBytes, slotCount, optionCount: options.length, outputCount: ir.outputs.length, messageCap,
    valuesOff, stateOff, limitsOff, optStateOff, msgCountOff, msgOff, outValuesOff, outVisOff, statusOff,
  };
  // per-field option start (global option index base) for readback
  const optStartById = {};
  ir.fields.forEach((f, i) => { if (f.options.length) optStartById[f.id] = fieldMeta[i].optStart; });

  return { modelBytes, ioLayout: io, optStartById };
}

export function assemble(model) {
  const ir = buildIR(model);
  const { modelBytes, ioLayout, optStartById } = serialize(ir);
  return { ir, modelBytes, ioLayout, optStartById };
}

// =============================================================================
// loadEngine — instantiate the wasm VM with an assembled model and return a
// handle whose evaluate(inputs) mirrors referenceEvaluate()'s return shape.
// `source` may be wasm bytes (ArrayBuffer/Uint8Array) or a WebAssembly.Instance.
// =============================================================================
const WASM_IMPORTS = { env: { abort() {}, trace() {}, seed: () => 0 } };

export async function loadEngine(source, assembled) {
  let exports;
  if (source && source.exports) exports = source.exports;
  else {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const { instance } = await WebAssembly.instantiate(bytes, WASM_IMPORTS);
    exports = instance.exports;
  }
  const { ir, modelBytes, ioLayout, optStartById } = assembled;
  const mem = exports.memory;
  let U8, I32, F64;
  const refresh = () => { U8 = new Uint8Array(mem.buffer); I32 = new Int32Array(mem.buffer); F64 = new Float64Array(mem.buffer); };
  refresh();

  const modelBase = exports.alloc(modelBytes.length); refresh();
  U8.set(modelBytes, modelBase);
  const ioBase = exports.alloc(ioLayout.totalBytes); refresh();
  U8.fill(0, ioBase, ioBase + ioLayout.totalBytes);
  exports.loadModel(modelBase, ioBase); refresh();

  const verifyMagic = I32[modelBase >> 2];
  if (verifyMagic !== MAGIC) throw new Error(`MODEL magic mismatch (got 0x${verifyMagic.toString(16)})`);

  const io = ioLayout;
  const f64at = (byteOff) => F64[(ioBase + byteOff) >> 3];
  const i32at = (byteOff) => I32[(ioBase + byteOff) >> 2];

  function evaluate(rawInputs) {
    // write inputs into VALUES
    for (const f of ir.fields) F64[(ioBase + io.valuesOff + f.slot * 8) >> 3] = encodeInput(f, rawInputs[f.id]);
    const status = exports.evaluate();

    const valueById = {};
    for (const [id, slot] of ir.slotOf) valueById[id] = f64at(io.valuesOff + slot * 8);

    const outputs = ir.outputs.map((o, i) => ({
      id: o.id, label: o.label, value: f64at(io.outValuesOff + i * 8),
      visible: i32at(io.outVisOff + i * 4) !== 0,
      format: o.formatType, unit: o.unit, currencyCode: o.currencyCode, decimals: o.decimals,
      canonicalUnit: o.canonicalUnit, baseCurrency: o.baseCurrency,
    }));

    const visible = {}, enabled = {}, limits = {}, optionState = {}, forced = [];
    for (const f of ir.fields) {
      const st = i32at(io.stateOff + f.slot * 4);
      visible[f.id] = (st & 1) !== 0;
      enabled[f.id] = (st & 2) !== 0;
      if (st & 8) forced.push(f.slot);
      const lb = io.limitsOff + f.slot * 24;
      const n2 = (v) => (Number.isNaN(v) ? null : v);
      limits[f.id] = { min: n2(f64at(lb)), max: n2(f64at(lb + 8)), step: n2(f64at(lb + 16)) };
      if (f.kind === 2 || f.kind === 3) {
        optionState[f.id] = {};
        const base = optStartById[f.id];
        for (const o of f.options) optionState[f.id][o.id] = i32at(io.optStateOff + (base + o.code) * 4) !== 0;
      }
    }

    const count = i32at(io.msgCountOff);
    const messages = [];
    for (let m = 0; m < count; m++) {
      const mb = io.msgOff + m * 12;
      const msgId = i32at(mb), severity = i32at(mb + 4), targetSlot = i32at(mb + 8);
      const v = ir.validations[msgId];
      messages.push({ id: v?.id ?? null, message: v?.message ?? '', severity, targetSlot });
    }

    return { valueById, outputs, optionState, visible, enabled, limits, messages, forced, status };
  }

  return { evaluate, exports, modelBase, ioBase };
}
