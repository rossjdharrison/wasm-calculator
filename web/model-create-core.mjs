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

// a minimal data model that assembles: one number input → one computed price.
export function newModelData(id, { currency = 'EUR', configures } = {}) {
  const d = {
    $schema: 'https://quote.rowblaa.com/schema/model.schema.json',
    id, version: '1.0.0', currency,
    fields: [{ id: 'quantity', type: 'number', default: 1, min: 1, max: 100 }],
    computed: [{ id: 'price', formula: { op: 'mul', args: [{ op: 'field', args: ['quantity'] }, 100] } }],
  };
  if (configures) d.configures = configures;
  return d;
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
