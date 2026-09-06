// =============================================================================
// hqdm.mjs — a thin READER over the HQDM neutral lattice (web/hqdm-core.json).
//
// The vocabulary is DATA, not code: this module only traverses it. A domain
// model declares its OWN types by `specializes` (in data.types); pass that map
// as the `extra` arg and every function resolves it merged over the core, so the
// neutral category of a domain type (e.g. PurchasePrice → amount_of_money) is
// INFERRED by climbing the lattice. Machinery keys off the inferred neutral type
// (isA / leafCategoryOf), never the domain id — that is what keeps it agnostic.
// The step-kind vocabulary is read from the data file (STEP_KINDS); process PHASES
// are per-domain data read via phasesOf(doc), never a core constant. DOM-free leaf module.
// =============================================================================
import CORE from './hqdm-core.json' with { type: 'json' };

const TYPES = CORE.types || {};
const HINTS = CORE.renderHints || {};
// the neutral vocabulary of process-step kinds (data in hqdm-core.json, not a
// hardcoded list) — the shape gate + the runner + the journey editors all read it.
export const STEP_KINDS = (CORE.stepKinds || []).map((k) => k.id);
// PHASES are a DOMAIN lifecycle, not upper-ontology — read them from a domain/journey
// doc with this pure helper (never a baked-in constant). Returns them order-sorted.
export function phasesOf(doc) {
  const p = (doc && doc.phases) || [];
  return [...p].sort((a, b) => (a.order || 0) - (b.order || 0));
}
// the neutral leaves offered to authors (every type that carries a render hint)
export const NEUTRAL_CATEGORIES = Object.keys(HINTS);

const typeMap = (extra) => (extra ? { ...TYPES, ...extra } : TYPES);

// ordered supertypes, nearest → root, deduped. Kids-before-parents (BFS).
export function supertypesOf(id, extra) {
  const M = typeMap(extra);
  const out = [], seen = new Set();
  let frontier = [...((M[id] && M[id].specializes) || [])];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      if (seen.has(s)) continue;
      seen.add(s); out.push(s);
      const p = M[s] && M[s].specializes; if (p) next.push(...p);
    }
    frontier = next;
  }
  return out;
}

// does `id` specialize (transitively) `target`?
export function isA(id, target, extra) {
  return id === target || supertypesOf(id, extra).includes(target);
}

// the nearest type (self or ancestor) that carries a render hint; else null
export function leafCategoryOf(id, extra) {
  if (HINTS[id]) return id;
  for (const s of supertypesOf(id, extra)) if (HINTS[s]) return s;
  return null;
}

// the render hint for a type ({glyph, render}), resolved by climbing; null if none
export function renderOf(id, extra) {
  const c = leafCategoryOf(id, extra);
  return c ? HINTS[c] : null;
}

export const isKnownType = (id, extra) => !!typeMap(extra)[id];

// the categories offered to an author of a model: the neutral leaves plus the
// model's OWN declared domain types (which climb the lattice to a neutral leaf).
// Pure + deterministic — used to populate the studio's `category` dropdown.
export const authorCategories = (types) => [...new Set([...NEUTRAL_CATEGORIES, ...Object.keys(types || {})])];
