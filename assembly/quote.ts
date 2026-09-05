// =============================================================================
// quote.ts — QCM1: the model-agnostic quote engine (compiled once to WASM).
//
// It knows nothing about vehicles or any domain. The JS assembler serializes a
// model into a binary MODEL image (a flattened-tree AST + structural records +
// baked tables) and an IO blob; this VM walks it. Boundary is numbers/bytes only.
//
// Layout (must match web/assembler.mjs serialize()):
//   HEADER: 32 x i32 at modelBase+0 (counts + region byte-offsets).
//   NODES:  i32[nodeCount*5]  (op, aux, k0, k1, k2)  — children inline, -1 = none
//   NODE_IMM: f64[nodeCount]  (CONST immediates)
//   FIELDS: i32[fieldCount*11] (kind, slot, visNode, enNode, minNode, maxNode,
//                               stepNode, compNode, optStart, optCount, defCode)
//   OPTIONS: i32[optionCount*2] (code, availNode)
//   EFFECTS: i32[effectCount*4] (condNode, targetSlot, valueNode, opKind)
//   VALIDATIONS: i32[valCount*4] (condNode, msgId, severity, targetSlot)
//   OUTPUTS: i32[outputCount*2] (slot, visNode)
//   TABLES: i32[tableCount*4]  (kind, rows, cols, dataOff)
//   COMPUTED: i32[computedCount*2] (slot, node)  — in dependency order
//   TABLE_DATA: f64[...]
// IO blob (relative to ioBase): VALUES f64[slot], STATE i32[slot],
//   LIMITS f64[slot*3], OPTSTATE i32[option], MSG_COUNT i32, MSG i32[cap*3],
//   OUTVALUES f64[out], OUTVIS i32[out], STATUS i32.
// =============================================================================

// ---- opcodes ----
const CONST: i32 = 0, LOAD: i32 = 1, ADD: i32 = 2, SUB: i32 = 3, MUL: i32 = 4,
  DIV: i32 = 5, NEG: i32 = 6, POW: i32 = 7, ABS: i32 = 8, FLOOR: i32 = 9,
  CEIL: i32 = 10, ROUND: i32 = 11, MIN: i32 = 12, MAX: i32 = 13, CLAMP: i32 = 14,
  EQ: i32 = 15, NE: i32 = 16, LT: i32 = 17, LE: i32 = 18, GT: i32 = 19, GE: i32 = 20,
  AND: i32 = 21, OR: i32 = 22, NOT: i32 = 23, IF: i32 = 24, HAS: i32 = 25,
  COUNTBITS: i32 = 26, LOOKUP1D: i32 = 27, LOOKUP2D: i32 = 28;

// ---- status bits ----
const ST_DIV0: i32 = 1, ST_TABLE_OOB: i32 = 2, ST_NAN_INF: i32 = 4,
  ST_DEPTH: i32 = 8, ST_SETTLE: i32 = 16;

// ---- field state bits ----
const S_VISIBLE: i32 = 1, S_ENABLED: i32 = 2, S_INVALID: i32 = 4,
  S_FORCED: i32 = 8, S_CHANGED: i32 = 16;

// ---- globals populated by loadModel ----
let MB: usize = 0, IB: usize = 0;
let slotCount: i32 = 0, nodeCount: i32 = 0, fieldCount: i32 = 0, optionCount: i32 = 0;
let effectCount: i32 = 0, validationCount: i32 = 0, outputCount: i32 = 0;
let tableCount: i32 = 0, computedCount: i32 = 0, settleMaxPasses: i32 = 0, messageCap: i32 = 0;

let nodesP: usize = 0, nodeImmP: usize = 0, fieldsP: usize = 0, optionsP: usize = 0;
let effectsP: usize = 0, validationsP: usize = 0, outputsP: usize = 0, tablesP: usize = 0;
let tableDataP: usize = 0, computedP: usize = 0;
let valuesP: usize = 0, stateP: usize = 0, limitsP: usize = 0, optStateP: usize = 0;
let msgCountP: usize = 0, msgP: usize = 0, outValuesP: usize = 0, outVisP: usize = 0, statusP: usize = 0;

let gStatus: i32 = 0;

// bump allocator over the AS heap base (no GC; we never free)
let bump: usize = 0;
export function alloc(size: usize): usize {
  if (bump == 0) bump = (__heap_base + 7) & ~(<usize>7);
  let p = (bump + 7) & ~(<usize>7);
  bump = p + size;
  // grow memory if needed
  let need = <i32>((bump + 0xffff) >> 16);
  let have = <i32>memory.size();
  if (need > have) memory.grow(need - have);
  return p;
}

function hi(i: i32): i32 { return load<i32>(MB + (<usize>i << 2)); }

export function loadModel(modelBase: usize, ioBase: usize): void {
  MB = modelBase; IB = ioBase;
  slotCount = hi(1); nodeCount = hi(2); fieldCount = hi(3); optionCount = hi(4);
  effectCount = hi(5); validationCount = hi(6); outputCount = hi(7); tableCount = hi(8);
  computedCount = hi(9); settleMaxPasses = hi(10); messageCap = hi(11);
  nodesP = MB + <usize>hi(12); nodeImmP = MB + <usize>hi(13); fieldsP = MB + <usize>hi(14);
  optionsP = MB + <usize>hi(15); effectsP = MB + <usize>hi(16); validationsP = MB + <usize>hi(17);
  outputsP = MB + <usize>hi(18); tablesP = MB + <usize>hi(19); tableDataP = MB + <usize>hi(20);
  computedP = MB + <usize>hi(21);
  valuesP = IB + <usize>hi(22); stateP = IB + <usize>hi(23); limitsP = IB + <usize>hi(24);
  optStateP = IB + <usize>hi(25); msgCountP = IB + <usize>hi(26); msgP = IB + <usize>hi(27);
  outValuesP = IB + <usize>hi(28); outVisP = IB + <usize>hi(29); statusP = IB + <usize>hi(30);
}

// ---- accessors ----
// @ts-ignore: decorator
@inline function vGet(slot: i32): f64 { return load<f64>(valuesP + (<usize>slot << 3)); }
// @ts-ignore: decorator
@inline function vSet(slot: i32, x: f64): void { store<f64>(valuesP + (<usize>slot << 3), x); }
// @ts-ignore: decorator
@inline function nOp(i: i32): i32 { return load<i32>(nodesP + <usize>i * 20); }
// @ts-ignore: decorator
@inline function nAux(i: i32): i32 { return load<i32>(nodesP + <usize>i * 20 + 4); }
// @ts-ignore: decorator
@inline function nK(i: i32, c: i32): i32 { return load<i32>(nodesP + <usize>i * 20 + 8 + (<usize>c << 2)); }
// @ts-ignore: decorator
@inline function nImm(i: i32): f64 { return load<f64>(nodeImmP + (<usize>i << 3)); }
// @ts-ignore: decorator
@inline function optState(gi: i32): i32 { return load<i32>(optStateP + (<usize>gi << 2)); }
// @ts-ignore: decorator
@inline function setBit(slot: i32, bit: i32): void {
  store<i32>(stateP + (<usize>slot << 2), load<i32>(stateP + (<usize>slot << 2)) | bit);
}

// ---- expression evaluator (recursive tree walk) ----
function evalNode(i: i32): f64 {
  let op = nOp(i);
  switch (op) {
    case CONST: return nImm(i);
    case LOAD: return vGet(nAux(i));
    case ADD: return evalNode(nK(i, 0)) + evalNode(nK(i, 1));
    case SUB: return evalNode(nK(i, 0)) - evalNode(nK(i, 1));
    case MUL: return evalNode(nK(i, 0)) * evalNode(nK(i, 1));
    case DIV: {
      let a = evalNode(nK(i, 0)); let b = evalNode(nK(i, 1));
      if (b == 0.0) { gStatus |= ST_DIV0; return 0.0; }
      return a / b;
    }
    case NEG: return -evalNode(nK(i, 0));
    case POW: {
      let r = Math.pow(evalNode(nK(i, 0)), evalNode(nK(i, 1)));
      if (r != r || r == Infinity || r == -Infinity) gStatus |= ST_NAN_INF;
      return r;
    }
    case ABS: return Math.abs(evalNode(nK(i, 0)));
    case FLOOR: return Math.floor(evalNode(nK(i, 0)));
    case CEIL: return Math.ceil(evalNode(nK(i, 0)));
    case ROUND: return Math.round(evalNode(nK(i, 0)));
    case MIN: return Math.min(evalNode(nK(i, 0)), evalNode(nK(i, 1)));
    case MAX: return Math.max(evalNode(nK(i, 0)), evalNode(nK(i, 1)));
    case CLAMP: {
      let x = evalNode(nK(i, 0)); let lo = evalNode(nK(i, 1)); let hi2 = evalNode(nK(i, 2));
      return Math.max(lo, Math.min(hi2, x));
    }
    case EQ: return evalNode(nK(i, 0)) == evalNode(nK(i, 1)) ? 1.0 : 0.0;
    case NE: return evalNode(nK(i, 0)) != evalNode(nK(i, 1)) ? 1.0 : 0.0;
    case LT: return evalNode(nK(i, 0)) < evalNode(nK(i, 1)) ? 1.0 : 0.0;
    case LE: return evalNode(nK(i, 0)) <= evalNode(nK(i, 1)) ? 1.0 : 0.0;
    case GT: return evalNode(nK(i, 0)) > evalNode(nK(i, 1)) ? 1.0 : 0.0;
    case GE: return evalNode(nK(i, 0)) >= evalNode(nK(i, 1)) ? 1.0 : 0.0;
    case AND: { if (evalNode(nK(i, 0)) == 0.0) return 0.0; return evalNode(nK(i, 1)) != 0.0 ? 1.0 : 0.0; }
    case OR: { if (evalNode(nK(i, 0)) != 0.0) return 1.0; return evalNode(nK(i, 1)) != 0.0 ? 1.0 : 0.0; }
    case NOT: return evalNode(nK(i, 0)) == 0.0 ? 1.0 : 0.0;
    case IF: { if (evalNode(nK(i, 0)) != 0.0) return evalNode(nK(i, 1)); return evalNode(nK(i, 2)); }
    case HAS: { let mask = <i32>evalNode(nK(i, 0)); return <f64>((mask >> nAux(i)) & 1); }
    case COUNTBITS: return <f64>popcnt<i32>(<i32>evalNode(nK(i, 0)));
    case LOOKUP1D: {
      let tb = tablesP + <usize>nAux(i) * 16;
      let rows = load<i32>(tb + 4); let dataOff = load<i32>(tb + 12);
      let idx = <i32>Math.round(evalNode(nK(i, 0)));
      if (idx < 0 || idx >= rows) { gStatus |= ST_TABLE_OOB; idx = idx < 0 ? 0 : rows - 1; }
      return load<f64>(tableDataP + (<usize>(dataOff + idx) << 3));
    }
    case LOOKUP2D: {
      let tb = tablesP + <usize>nAux(i) * 16;
      let rows = load<i32>(tb + 4); let cols = load<i32>(tb + 8); let dataOff = load<i32>(tb + 12);
      let r = <i32>Math.round(evalNode(nK(i, 0)));
      let c = <i32>Math.round(evalNode(nK(i, 1)));
      if (r < 0 || r >= rows || c < 0 || c >= cols) {
        gStatus |= ST_TABLE_OOB;
        r = r < 0 ? 0 : (r >= rows ? rows - 1 : r);
        c = c < 0 ? 0 : (c >= cols ? cols - 1 : c);
      }
      return load<f64>(tableDataP + (<usize>(dataOff + r * cols + c) << 3));
    }
    default: return 0.0;
  }
}

// @ts-ignore: decorator
@inline function fI(fb: usize, k: i32): i32 { return load<i32>(fb + (<usize>k << 2)); }

function recomputeComputed(): void {
  for (let c = 0; c < computedCount; c++) {
    let cb = computedP + <usize>c * 8;
    let slot = load<i32>(cb);
    let node = load<i32>(cb + 4);
    vSet(slot, evalNode(node));
  }
}

function computeOptionAvailability(fb: usize): void {
  let optStart = fI(fb, 8); let optCount = fI(fb, 9);
  for (let j = 0; j < optCount; j++) {
    let ob = optionsP + <usize>(optStart + j) * 8;
    let availNode = load<i32>(ob + 4);
    let av = availNode < 0 ? 1 : (evalNode(availNode) != 0.0 ? 1 : 0);
    store<i32>(optStateP + (<usize>(optStart + j) << 2), av);
  }
}

export function evaluate(): i32 {
  gStatus = 0;
  // reset state / outputs / messages
  for (let s = 0; s < slotCount; s++) store<i32>(stateP + (<usize>s << 2), 0);
  for (let o = 0; o < outputCount; o++) {
    store<f64>(outValuesP + (<usize>o << 3), 0.0);
    store<i32>(outVisP + (<usize>o << 2), 0);
  }
  store<i32>(msgCountP, 0);

  // ---- settle (bounded fixpoint) ----
  let converged = false;
  for (let pass = 0; pass < settleMaxPasses; pass++) {
    let dirty = false;
    recomputeComputed();

    // effects (declaration/priority order)
    for (let e = 0; e < effectCount; e++) {
      let eb = effectsP + <usize>e * 16;
      let cond = load<i32>(eb); let tgt = load<i32>(eb + 4); let vn = load<i32>(eb + 8);
      if (evalNode(cond) != 0.0) {
        let nv = evalNode(vn);
        setBit(tgt, S_FORCED | S_CHANGED);
        if (vGet(tgt) != nv) { vSet(tgt, nv); dirty = true; }
      }
    }

    // option availability + auto-deselect / single-select fallback
    for (let f = 0; f < fieldCount; f++) {
      let fb = fieldsP + <usize>f * 44;
      let kind = fI(fb, 0);
      if (kind != 2 && kind != 3) continue;
      let slot = fI(fb, 1); let optStart = fI(fb, 8); let optCount = fI(fb, 9); let defCode = fI(fb, 10);
      computeOptionAvailability(fb);
      if (kind == 3) {
        let mask = <i32>vGet(slot);
        for (let j = 0; j < optCount; j++) {
          if (optState(optStart + j) == 0 && ((mask >> j) & 1) != 0) { mask &= ~(1 << j); dirty = true; }
        }
        vSet(slot, <f64>mask);
      } else {
        let cur = <i32>vGet(slot);
        if (cur < 0 || cur >= optCount || optState(optStart + cur) == 0) {
          let next = -1;
          if (defCode >= 0 && optState(optStart + defCode) == 1) next = defCode;
          else { for (let j = 0; j < optCount; j++) { if (optState(optStart + j) == 1) { next = j; break; } } }
          if (next < 0) next = cur;
          if (next != cur) { vSet(slot, <f64>next); setBit(slot, S_CHANGED); dirty = true; }
        }
      }
    }

    if (!dirty) { converged = true; break; }
  }
  if (!converged) gStatus |= ST_SETTLE;

  // ---- finalize ----
  recomputeComputed();
  for (let f = 0; f < fieldCount; f++) {
    let fb = fieldsP + <usize>f * 44;
    let kind = fI(fb, 0); let slot = fI(fb, 1);
    let visNode = fI(fb, 2); let enNode = fI(fb, 3);
    let minNode = fI(fb, 4); let maxNode = fI(fb, 5); let stepNode = fI(fb, 6);
    if (visNode < 0 || evalNode(visNode) != 0.0) setBit(slot, S_VISIBLE);
    if (enNode < 0 || evalNode(enNode) != 0.0) setBit(slot, S_ENABLED);
    let lb = limitsP + <usize>slot * 24;
    store<f64>(lb, minNode < 0 ? NaN : evalNode(minNode));
    store<f64>(lb + 8, maxNode < 0 ? NaN : evalNode(maxNode));
    store<f64>(lb + 16, stepNode < 0 ? NaN : evalNode(stepNode));
    if (kind == 2 || kind == 3) computeOptionAvailability(fb);
  }

  // outputs
  for (let o = 0; o < outputCount; o++) {
    let ob = outputsP + <usize>o * 8;
    let slot = load<i32>(ob); let visNode = load<i32>(ob + 4);
    store<f64>(outValuesP + (<usize>o << 3), vGet(slot));
    store<i32>(outVisP + (<usize>o << 2), (visNode < 0 || evalNode(visNode) != 0.0) ? 1 : 0);
  }

  // validations
  let mc = 0;
  for (let v = 0; v < validationCount; v++) {
    let vb = validationsP + <usize>v * 16;
    let cond = load<i32>(vb); let msgId = load<i32>(vb + 4); let sev = load<i32>(vb + 8); let tgt = load<i32>(vb + 12);
    if (evalNode(cond) != 0.0) {
      if (mc < messageCap) {
        let mb = msgP + <usize>mc * 12;
        store<i32>(mb, msgId); store<i32>(mb + 4, sev); store<i32>(mb + 8, tgt);
        mc++;
      }
      if (sev == 2 && tgt >= 0) setBit(tgt, S_INVALID);
    }
  }
  store<i32>(msgCountP, mc);
  store<i32>(statusP, gStatus);
  return gStatus;
}

// ---- reflection: the value-dependency graph over the loaded image -----------
// graph(scope) returns a pointer to [edgeCount:i32, (depSlot,ownerSlot):i32...].
// An edge dep->owner means "owner's calculation reads dep". scope 0 = computed
// owners only; scope != 0 = all value roots (fields' vis/enable/min/max/step/
// computed-value + option availability, effects, validations, outputs). The
// engine is the authority: this walks the SAME nodes evaluate() runs. Numbers
// only — JS maps slots back to ids. Duplicates/self-edges are left for JS to
// clean. alloc() may grow memory, so the caller must re-grab its views after.
function collectEdges(i: i32, owner: i32, edges: usize, ec: i32, maxEdges: i32): i32 {
  if (i < 0 || ec >= maxEdges) return ec;
  if (nOp(i) == LOAD) {
    store<i32>(edges + <usize>ec * 8, nAux(i));       // dep slot
    store<i32>(edges + <usize>ec * 8 + 4, owner);     // owner slot
    return ec + 1;
  }
  for (let c = 0; c < 3; c++) ec = collectEdges(nK(i, c), owner, edges, ec, maxEdges);
  return ec;
}

export function graph(scope: i32): usize {
  let maxEdges = nodeCount;                            // <= one edge per LOAD node
  let base = alloc(<usize>(1 + maxEdges * 2) * 4);
  let edges = base + 4;
  let ec = 0;
  for (let c = 0; c < computedCount; c++) {            // computed owners
    let cb = computedP + <usize>c * 8;
    ec = collectEdges(load<i32>(cb + 4), load<i32>(cb), edges, ec, maxEdges);
  }
  if (scope != 0) {
    for (let f = 0; f < fieldCount; f++) {             // field structural roots + options
      let fb = fieldsP + <usize>f * 44;
      let slot = fI(fb, 1);
      for (let k = 2; k <= 7; k++) ec = collectEdges(fI(fb, k), slot, edges, ec, maxEdges);
      let optStart = fI(fb, 8); let optCount = fI(fb, 9);
      for (let j = 0; j < optCount; j++) {
        let an = load<i32>(optionsP + <usize>(optStart + j) * 8 + 4);
        ec = collectEdges(an, slot, edges, ec, maxEdges);
      }
    }
    for (let e = 0; e < effectCount; e++) {             // effects: owner = target
      let eb = effectsP + <usize>e * 16; let tgt = load<i32>(eb + 4);
      ec = collectEdges(load<i32>(eb), tgt, edges, ec, maxEdges);
      ec = collectEdges(load<i32>(eb + 8), tgt, edges, ec, maxEdges);
    }
    for (let v = 0; v < validationCount; v++) {         // validations: owner = target (if any)
      let vb = validationsP + <usize>v * 16; let tgt = load<i32>(vb + 12);
      if (tgt >= 0) ec = collectEdges(load<i32>(vb), tgt, edges, ec, maxEdges);
    }
    for (let o = 0; o < outputCount; o++) {             // outputs: owner = the output's slot
      let ob = outputsP + <usize>o * 8;
      ec = collectEdges(load<i32>(ob + 4), load<i32>(ob), edges, ec, maxEdges);
    }
  }
  store<i32>(base, ec);
  return base;
}
