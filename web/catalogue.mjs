// =============================================================================
// catalogue.mjs — the taxonomy as a browsable CATALOGUE, a derived reference-VIEW
// over the one specializes lattice. A catalogue node IS an HQDM class; its
// navigational rows are its direct specialization CHILDREN (class ⊆ class); a leaf
// node carries `model` — the specialization→classification SEAM where the class's
// members become configured individuals in a configurator. "isA resolves to a
// catalogue lookup" is literal here: we PROJECT the registry into the {id:{specializes}}
// map hqdm already climbs, and delegate — so isA stays synchronous and hqdm.mjs stays
// byte-frozen. Pure + DOM-free.
//
// NB the ontology (do not collapse): a configurator's OPTIONS (gtCoupe under a model)
// are classification MEMBERS, not subclasses, and a configured build is an INDIVIDUAL
// member_of the leaf class — neither is a catalogue row here (see the configurator-as-
// catalogue stage). isA() covers the class→class leg only; a build-level query is
// isA(classOf(build), target).
// =============================================================================
import { isA as hIsA, supertypesOf, renderOf } from './hqdm.mjs';

const NODES = (reg) => (reg && reg.nodes) || {};

// PROJECTION: strip the registry into the exact {id:{specializes}} shape hqdm reads.
// Passed as hqdm's `extra` it merges over the frozen core, so climbing continues from
// a registry node into hqdm-core (class_of_physical_object → class → … → thing).
// The isA type-map IS the catalogue, projected.
export const typeMapOf = (reg) =>
  Object.fromEntries(Object.entries(NODES(reg)).map(([k, n]) => [k, { specializes: n.specializes || [] }]));

export const nodeOf = (reg, id) => NODES(reg)[id] || null;

// direct specialization children of a node (the navigational rows of a catalogue).
export const childrenOf = (reg, id) =>
  Object.keys(NODES(reg)).filter((k) => (NODES(reg)[k].specializes || []).includes(id));

// "isA resolves to a catalogue lookup" — delegate to hqdm over the projected map.
export const isA = (reg, id, target, extra) => hIsA(id, target, { ...typeMapOf(reg), ...(extra || {}) });

// every leaf (model-bearing) node (transitively) under `id` — the configurators a
// catalogue surfaces. View rows {id, model, title}, in registry declaration order.
export const modelsUnder = (reg, id, extra) => {
  const M = { ...typeMapOf(reg), ...(extra || {}) };
  return Object.entries(NODES(reg))
    .filter(([k, n]) => n.model && hIsA(k, id, M))
    .map(([k, n]) => ({ id: k, model: n.model, title: n.title }));
};
export const catalogueOf = modelsUnder; // alias — a catalogue's surfaced models

// derived row kind (never asserted): journey (a different lattice branch) | model | catalogue.
export const rowKind = (reg, id, extra) => {
  const M = { ...typeMapOf(reg), ...(extra || {}) };
  if (hIsA(id, 'activity', M)) return 'journey';
  const n = nodeOf(reg, id);
  if (n && n.model) return 'model';
  return 'catalogue';
};

// root-first ancestry, restricted to catalogue nodes (breadcrumb): [...ancestors, id].
export const pathTo = (reg, id) =>
  [...supertypesOf(id, typeMapOf(reg)).filter((a) => nodeOf(reg, a)).reverse(), id];

// glyph via the neutral render family (climbs to an L0 hint). Deterministic: renderOf
// takes the FIRST hint in BFS order, so declare the primary parent FIRST in specializes.
export const glyphOf = (reg, id, extra) =>
  ((renderOf(id, { ...typeMapOf(reg), ...(extra || {}) })) || {}).glyph || '';
