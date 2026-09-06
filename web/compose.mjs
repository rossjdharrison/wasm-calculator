// =============================================================================
// compose.mjs — the L2/L3 orchestrator. It sequences per-model WASM evaluations
// along a journey's typed bindings, injecting one model's output individual into
// the next's input — with NO global settle (each model settles internally; the
// journey is a one-pass DAG). It consumes only the public engine API + the
// parity-pinned referenceEvaluate for the tiny seam mappings, so it adds no
// second interpreter and no parity risk (see seam-parity.test.mjs).
// =============================================================================
import { assemble, loadEngine, referenceEvaluate } from './assembler.mjs';
import { purchasePriceOf, projectIndividuals, individualsOf } from './individuals.mjs';

// one WASM instance per model alias; dispose drops it so GC reclaims the memory
// (the VM is allocate-once/no-free, so a fresh instance IS the reset).
export class EngineHost {
  constructor(wasmBytes) { this.bytes = wasmBytes; this.instances = new Map(); }
  async acquire(alias, assembled) {
    if (this.instances.has(alias)) return this.instances.get(alias);
    const e = await loadEngine(this.bytes, assembled);
    this.instances.set(alias, e);
    return e;
  }
  dispose(alias) { this.instances.delete(alias); }
  disposeAll() { this.instances.clear(); }
}

// topological order of model aliases by binding edges (from → to). Throws on a
// cross-model cycle (an implicit cross-VM fixed point is never allowed).
export function orderModels(journey) {
  const aliases = (journey.models || []).map((m) => m.as);
  const indeg = {}, adj = {};
  for (const a of aliases) { indeg[a] = 0; adj[a] = []; }
  for (const b of journey.bindings || []) {
    if (!(b.from in adj) || !(b.to in indeg)) continue; // unknown alias — the validator reports it
    adj[b.from].push(b.to); indeg[b.to]++;
  }
  const q = aliases.filter((a) => indeg[a] === 0); const order = [];
  while (q.length) { const a = q.shift(); order.push(a); for (const t of adj[a]) if (--indeg[t] === 0) q.push(t); }
  if (order.length !== aliases.length) throw Object.assign(new Error('cross-model cycle in journey'), { isJourneyError: true });
  return order;
}

// the set of a model's input fields that an upstream binding WRITES (its
// requires-targets) — i.e. the fields that are authoritative-from-upstream and
// must not be user-editable in a downstream capture. Pure, DOM-free.
export function boundTargetsOf(journey, alias) {
  const out = new Set();
  for (const b of (journey.bindings || [])) {
    if (b.to !== alias) continue;
    for (const r of (b.contract && b.contract.requires) || []) {
      const tid = (r.target || '').split(':')[1] || r.name;
      if (tid) out.add(tid);
    }
  }
  return out;
}

// a synthetic micro-model that computes a binding's mapping targets from its
// provided values — so the mapping/condition expressions are evaluated by the
// real assembler+oracle, never an ad-hoc interpreter.
export function buildSeamModel(binding) {
  const provides = (binding.contract && binding.contract.provides) || [];
  const fields = provides.map((p) => ({ id: p.as, type: 'number', default: 0 }));
  const computed = (binding.mapping || []).map((m) => ({ id: m.to, formula: m.from }));
  if (binding.condition) computed.push({ id: '__cond__', formula: binding.condition });
  return { id: '__seam__', fields, computed };
}

// run a binding's mapping through the oracle; returns { injected, gated }.
function runSeam(binding, providedValues) {
  const seam = assemble(buildSeamModel(binding));
  const sres = referenceEvaluate(seam.ir, providedValues);
  const gated = !!binding.condition && sres.valueById.__cond__ === 0;
  const injected = {};
  if (!gated) for (const r of (binding.contract.requires || [])) {
    const tid = (r.target || '').split(':')[1] || r.name;
    injected[tid] = sres.valueById[tid];
  }
  return { injected, gated };
}

// evaluate a whole journey. `models` = { alias: { merged, assembled } } (pre-loaded
// by the caller — fs+assemble in tests, store+assemble in the app). Returns the
// per-model results + the accumulated order. One forward pass; no upstream re-run.
export async function evaluateJourney(journey, models, host, configByAlias = {}) {
  const order = orderModels(journey);
  const byAlias = {}; const injected = {};
  for (const alias of order) {
    const M = models[alias];
    const cfg = { ...(configByAlias[alias] || {}), ...(injected[alias] || {}) };
    const engine = await host.acquire(alias, M.assembled);
    const res = engine.evaluate(cfg);
    byAlias[alias] = { config: cfg, valueById: res.valueById, outputs: res.outputs, status: res.status, individuals: projectIndividuals(M.merged, res.valueById, cfg) };
    for (const b of (journey.bindings || []).filter((x) => x.from === alias)) {
      const provided = {};
      for (const p of (b.contract.provides || [])) { const id = (p.source || '').split(':')[1] || p.as; provided[p.as] = res.valueById[id]; }
      const { injected: inj, gated } = runSeam(b, provided);
      if (!gated) injected[b.to] = { ...(injected[b.to] || {}), ...inj };
    }
  }
  // one-off lines = each model's Purchase Price (an amount_of_money, role 'total').
  // recurring lines (role 'recurring', e.g. a monthly payment) are surfaced
  // SEPARATELY and never summed into the one-off order total.
  const lines = []; const totalsByCurrency = {}; const recurring = [];
  for (const alias of order) {
    const M = models[alias]; const currency = M.merged.currency || 'EUR';
    const vById = byAlias[alias].valueById;
    const pp = purchasePriceOf(M.merged, M.merged);
    if (pp) {
      // a money model: its Purchase Price is the line + contributes to the total.
      const amount = vById[pp.localId];
      lines.push({ alias, ref: pp.ref, localId: pp.localId, amount, currency, category: pp.category });
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
    } else {
      // a money-FREE model (e.g. an application, a case file): surface its emphasised
      // individual as a non-money line, rendered by its own L0 category, no total.
      const inds = individualsOf(M.merged, M.merged);
      const em = inds.find((i) => i.emphasis && i.kind === 'scalar') || inds.find((i) => i.kind === 'scalar') || inds[0];
      if (em) lines.push({ alias, ref: em.ref, localId: em.localId, value: em.localId ? vById[em.localId] : null, category: em.category, nonMoney: true });
    }
    for (const o of (M.assembled.ir.outputs || [])) {
      if (o.role !== 'recurring') continue;
      recurring.push({ alias, localId: o.id, label: o.label, amount: vById[o.id], currency });
    }
  }
  // `injected` = the fields actually written into each alias this pass (gated
  // bindings inject nothing) — the authority for which downstream fields are locked.
  return { order, byAlias, lines, totalsByCurrency, recurring, injected };
}
