// =============================================================================
// model-create-core.mjs — the PURE, DOM-free heart of "add a configurator": mint a
// unique id from a title, and seed a minimal VALID two-file model that assembles out
// of the box (the author then drills into the studio to build it out and declare its
// HQDM class). Deterministic + unit-testable; no Date.now/Math.random.
// =============================================================================
import { slugify } from './journey-create-core.mjs';

// a model-dir id not already taken by `existingIds` (array or Set). Appends -2, -3, …
export function uniqueModelId(base, existingIds = []) {
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const slug = slugify(base, 'model');
  if (!taken.has(slug)) return slug;
  let n = 2; while (taken.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

// the neutral category a model is placed under when the author has not (yet) chosen a
// more specific one — the physical-object root the catalogue climbs to, so a model with
// no explicit type still lands somewhere real. Neutral hqdm-core vocabulary, not domain.
export const DEFAULT_CATEGORY = 'class_of_physical_object';

// the model-UNIQUE leaf class this model configures. Derived from the model id so it is
// unique per model — two models must NEVER share a leaf class or the DERIVED catalogue
// collapses them onto one node (registryFromModels upsert is keyed by class id).
export const ownLeafId = (id) => `${id}_class`;

// ensure the model OWNS a unique leaf class specialising `category`, and point
// `configures` at it. Pure: mutates + returns the passed data. The single home of the
// "born typed" invariant — reused by the seed below, by fork, and by the in-studio type
// picker, so a model is always placed via a real editable leaf, never a synthetic #spec.
export function ensureOwnLeaf(data, category = DEFAULT_CATEGORY, title) {
  const leaf = ownLeafId(data.id);
  const prev = (data.types && data.types[leaf]) || {};
  data.types = { ...(data.types || {}), [leaf]: { title: title || prev.title || data.id, specializes: [category] } };
  data.configures = leaf;
  return data;
}

// a minimal data model that assembles: one number input → one computed price. It is
// BORN TYPED — a unique own leaf specialising `category` (default the neutral root) with
// `configures` pointing at it — so a new model appears in the catalogue as a real leaf
// (never a synthetic #spec orphan) and the studio's type dropdown is never empty. An
// explicit `configures` (e.g. a fork pointing at a pre-built leaf) is honoured as-is.
export function newModelData(id, { currency = 'EUR', configures, category, title } = {}) {
  const d = {
    $schema: 'https://quote.rowblaa.com/schema/model.schema.json',
    id, version: '1.0.0', currency,
    fields: [{ id: 'quantity', type: 'number', default: 1, min: 1, max: 100 }],
    computed: [{ id: 'price', formula: { op: 'mul', args: [{ op: 'field', args: ['quantity'] }, 100] } }],
  };
  if (configures) d.configures = configures;
  else ensureOwnLeaf(d, category || DEFAULT_CATEGORY, title);
  return d;
}

// FORK a whole model: deep-clone both files, re-id, and give the fork its OWN unique
// leaf class — a SIBLING of the source's configured class (same parent), never the same
// leaf (or the derived catalogue would collapse the two models onto one node). So a fork
// is typed from birth and stays grouped beside its source. Pure + deterministic.
export function forkModelData(srcData, newId, { title } = {}) {
  const d = structuredClone(srcData);
  d.id = newId;
  const srcLeaf = srcData.configures;
  const srcDef = (srcData.types && srcLeaf && srcData.types[srcLeaf]) || {};
  const parents = (srcDef.specializes && srcDef.specializes.length) ? srcDef.specializes : [DEFAULT_CATEGORY];
  if (d.types && srcLeaf) delete d.types[srcLeaf];                 // drop the source's own leaf — the fork mints its own
  ensureOwnLeaf(d, parents[0], title || srcDef.title || newId);   // a sibling under the same parent (v1: single parent)
  return d;
}

// the matching presentation for a fork: same layout/controls/outputs, retitled.
export function forkModelPres(srcPres, { title } = {}) {
  const p = structuredClone(srcPres);
  if (title) { p.name = title; p.brand = { ...(p.brand || {}), mark: title }; }
  return p;
}

// the matching presentation: a titled configurator surfacing the price as its total.
export function newModelPres(id, { title = 'Untitled', currency = 'EUR' } = {}) {
  return {
    name: title,
    brand: { mark: title, rest: '' },
    sections: [{ id: 'main', label: 'Options', order: 1 }],
    fields: [{ id: 'quantity', label: 'Quantity', section: 'main' }],
    outputs: [{ id: 'price', label: 'Price', emphasis: true, role: 'total', format: { type: 'currency', decimals: 0, currencyCode: currency } }],
  };
}
