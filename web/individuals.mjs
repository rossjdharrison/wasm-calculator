// =============================================================================
// individuals.mjs — a model's PUBLIC SEAM SURFACE: the typed HQDM individuals it
// produces, with stable cross-model ids. This is what the composition tier (L2)
// binds to — never a model's internal fields. Two kinds:
//   • scalar    — a surfaced output whose value resolves (by climbing the L0
//                 lattice) to a leaf category, e.g. the Purchase Price
//                 (amount_of_money) or a spec figure (physical_quantity);
//   • composite — the Configured Specification: every field tagged (transitively)
//                 class_of_physical_object, folded into one <modelId>#spec.
// A downstream model receives these by identity + neutral category, never the
// domain shape. Pure, DOM-free; imports only the hqdm reader.
// =============================================================================
import { isA, leafCategoryOf, isKnownType } from './hqdm.mjs';

export const refOf = (modelId, localId) => `${modelId}#${localId}`;

// the HQDM class this model configures (its leaf class in the taxonomy), declared as
// a top-level `configures` on the data model and picked in the studio. Falls back to
// the neutral class_of_physical_object so models authored before the tag still work.
export const configuredClassOf = (data) => (data && data.configures) || 'class_of_physical_object';

// the L0 category tagged on a field or computed by id (null if none)
export function categoryOf(data, id) {
  const f = (data.fields || []).find((x) => x.id === id);
  if (f && f.category) return f.category;
  const c = (data.computed || []).find((x) => x.id === id);
  return c && c.category ? c.category : null;
}

// the fields that (transitively) specialize class_of_physical_object — the spec parts
function specPartsOf(data) {
  const types = data.types || {};
  return (data.fields || []).filter((f) => f.category && isA(f.category, 'class_of_physical_object', types)).map((f) => f.id);
}

// the individuals this model exposes. `data` carries fields/computed/types + category
// tags; `pres` carries outputs. (A merged model works as both.)
export function individualsOf(data, pres) {
  const types = data.types || {};
  const modelId = data.id;
  const out = [];
  for (const o of (pres.outputs || [])) {
    const category = categoryOf(data, o.id);
    if (!category) continue;
    const leaf = leafCategoryOf(category, types);
    if (!leaf) continue;
    out.push({ ref: refOf(modelId, o.id), localId: o.id, category, leaf, kind: 'scalar', surfaced: true, emphasis: !!o.emphasis });
  }
  const parts = specPartsOf(data);
  if (parts.length) {
    const cls = configuredClassOf(data);
    out.push({ ref: refOf(modelId, 'spec'), localId: 'spec', category: cls, leaf: leafCategoryOf(cls, types) || 'class_of_physical_object', kind: 'composite', surfaced: true, parts });
  }
  return out;
}

// the default Purchase Price = the emphasised amount_of_money output (falling back
// to any surfaced amount_of_money). null if the model surfaces no money value.
export function purchasePriceOf(data, pres) {
  const types = data.types || {};
  const isMoney = (o) => isA(categoryOf(data, o.id) || '', 'amount_of_money', types);
  const em = (pres.outputs || []).find((o) => o.emphasis && isMoney(o)) || (pres.outputs || []).find(isMoney);
  return em ? { ref: refOf(data.id, em.id), localId: em.id, category: categoryOf(data, em.id) } : null;
}

// runtime projection: the typed seam PAYLOAD for a concrete evaluation.
// `model` = the merged model; `valueById` = engine/oracle valueById (id → number);
// `config` = the raw inputs. Returns { model, price, spec } — the individuals a
// downstream (financing, fulfilment…) would receive at the seam.
export function projectIndividuals(model, valueById, config) {
  const pp = purchasePriceOf(model, model);
  const price = pp ? { ...pp, amount: valueById ? (valueById[pp.localId] ?? null) : null, currency: model.currency || null } : null;
  const parts = specPartsOf(model);
  const spec = parts.length ? { ref: refOf(model.id, 'spec'), category: configuredClassOf(model), parts: Object.fromEntries(parts.map((id) => [id, config ? config[id] : undefined])) } : null;
  return { model: model.id, price, spec };
}

// is every category tag in the model a known type (neutral core OR a declared
// domain type)? Returns the unknown ones (for the coverage advisor). Pure.
export function unknownCategories(data) {
  const types = data.types || {};
  const bad = [];
  const check = (id, cat, where) => { if (cat && !isKnownType(cat, types)) bad.push({ where, id, category: cat }); };
  for (const f of data.fields || []) { check(f.id, f.category, 'field'); for (const o of f.options || []) check(`${f.id}.${o.id}`, o.category, 'option'); }
  for (const c of data.computed || []) check(c.id, c.category, 'computed');
  return bad;
}
