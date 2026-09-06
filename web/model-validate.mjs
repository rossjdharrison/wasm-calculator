// =============================================================================
// model-validate.mjs — the engine-backed validation authority for live editing.
//
// The Loom (and any editor) must know, before committing an edit, whether a
// formula is legal and whether the whole model still assembles — WITHOUT letting
// the assembler's fail-fast exception escape into the UI. Both answers are
// delegated to the real toolchain, never re-implemented:
//
//   • tryAssemble(model)  — a non-throwing wrapper around assemble(): the
//     assembler IS the structural authority, so "does it assemble?" is the
//     definitive legality check. Model errors (fail(), .isModelError) come back
//     as data; genuine programmer bugs still throw.
//
//   • validateFormula(model, source[, opts]) — validate ONE expression against a
//     model's slot namespace. A string is parsed by expr.parseExpr (the same
//     text→AST the editor uses); an AST/number/boolean is taken as-is. Reference
//     resolution, op/arity checks and option/table checks are borrowed verbatim
//     by probing: the formula is spliced onto a clone of the model as a reserved
//     computed and the clone is assembled. No duplicated parser ⇒ zero parity
//     risk. Returns { ok, refs, error } and NEVER throws.
//
// Leaf module: it imports assembler/expr/coverage/studio-dom but nothing imports
// it back, so it introduces no cycle.
// =============================================================================
import { assemble } from './assembler.mjs';
import { parseExpr } from './expr.mjs';
import { astRefs } from './coverage.mjs';
import { clone } from './studio-dom.mjs';

const PROBE_ID = '__loom_validate_probe__';

// Non-throwing assemble. `model` is the MERGED model (mergeModel output), not the
// split {data, pres} pair. Returns the assembled artifact on success, or the
// first model error on failure. Re-throws non-model errors (real bugs).
export function tryAssemble(model) {
  try {
    return { ok: true, assembled: assemble(model), errors: [] };
  } catch (e) {
    if (e && e.isModelError) return { ok: false, assembled: null, errors: [{ message: e.message, isModelError: true }] };
    throw e;
  }
}

// Validate one expression against `model` (MERGED). `source` may be an expression
// string, an already-built AST, or a bare number/boolean. Returns:
//   { ok: true,  refs: string[], error: null }
//   { ok: false, refs: string[], error: { kind: 'syntax'|'model', message } }
// Never throws. Assumes `model` already assembles clean (the Loom only ever holds
// a valid model); if it does not, the probe error may reflect that pre-existing
// fault — pass opts.baseline: false to skip the guard, or rely on the caller
// having a valid base (the default, which the Loom guarantees).
export function validateFormula(model, source, opts = {}) {
  let ast;
  if (typeof source === 'string') {
    try { ast = parseExpr(source); }
    catch (e) { return { ok: false, refs: [], error: { kind: 'syntax', message: e.message } }; }
  } else {
    ast = source; // AST object, or a bare number / boolean literal
  }
  // Defense-in-depth: the probe delegates to assemble(), and tryAssemble RE-THROWS
  // non-model errors by contract (real bugs). A malformed AST or a malformed
  // table def could therefore raise a raw throw here — catch it so this function
  // honours its "never throws" guarantee regardless, reporting it as a model error.
  try {
    const refs = [...astRefs(ast)].filter((r) => r != null);
    const probe = clone(model);
    probe.computed = (probe.computed || []).slice();
    probe.computed.push({ id: PROBE_ID, formula: ast });
    const r = tryAssemble(probe);
    if (r.ok) return { ok: true, refs, error: null };

    // Baseline guard: if the model was already broken, the probe error is not the
    // formula's fault — surface it, but tag it so the caller can tell.
    if (opts.baseline !== false) {
      const base = tryAssemble(model);
      if (!base.ok) return { ok: false, refs, error: { kind: 'model', message: base.errors[0].message, isModelError: true, preexisting: true } };
    }
    return { ok: false, refs, error: { kind: 'model', message: r.errors[0].message, isModelError: true } };
  } catch (e) {
    return { ok: false, refs: [], error: { kind: 'model', message: e.message } };
  }
}
