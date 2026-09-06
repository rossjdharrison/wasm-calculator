// =============================================================================
// catalogue-build.mjs — the taxonomy is DERIVED, not authored. It projects the
// browsable catalogue registry from what the studio already captures: every model's
// own `data.types` (its HQDM classes + `specializes` edges) plus the per-model
// `configures` tag (the class it configures = its leaf node). Adding a model in the
// studio and saying what it is grows the taxonomy — no hand-written registry.json.
//
// Output shape is byte-identical to the old hand-file ({ root, nodes }), so
// catalogue.mjs (typeMapOf/childrenOf/modelsUnder/isA/pathTo/glyphOf) consumes it
// unchanged — this is a BUILDER swap, not an API change. Pure, DOM-free, deterministic.
// =============================================================================

// nodes are a reference-view over the one lattice, keyed by class id, so the same
// class declared by two models collapses to one node (the DAG stays single-sourced).
export function registryFromModels(domain, modelCatalog, modelDataById) {
  const nodes = {};
  const upsert = (id, patch) => {
    const prev = nodes[id] || {};
    nodes[id] = { ...prev, ...patch };
    // never lose a specializes edge already known for this id
    nodes[id].specializes = patch.specializes || prev.specializes || [];
  };

  // (1) optional grouping seed from the domain — classes that have no model yet
  for (const [id, def] of Object.entries((domain && domain.taxonomy) || {})) upsert(id, { specializes: def.specializes || [], title: def.title });

  const cardById = Object.fromEntries(((modelCatalog && modelCatalog.models) || []).map((m) => [m.id, m]));

  for (const m of (modelCatalog && modelCatalog.models) || []) {
    const data = modelDataById && modelDataById[m.id];
    if (!data) continue;                                   // unloadable model → skip (landing degrades gracefully)
    // (2) fold the model's own declared classes into the lattice
    for (const [cid, def] of Object.entries(data.types || {})) upsert(cid, { specializes: def.specializes || [], title: def.title });
    // (3) mark the leaf class this model configures with the model + a display title
    const card = cardById[m.id] || {};
    const leaf = data.configures;
    if (leaf) {
      const declared = (data.types && data.types[leaf]) || {};
      upsert(leaf, { model: m.id, title: declared.title || card.title || leaf, specializes: declared.specializes || ['class_of_physical_object'] });
    } else {
      // back-compat: an untagged model contributes a synthetic leaf (today's #spec behaviour)
      upsert(`${m.id}#spec`, { model: m.id, title: card.title || m.id, specializes: ['class_of_physical_object'] });
    }
  }

  // root: the domain's declared browse-from class, else the neutral physical-object
  // class (which the leaves climb to) so the landing works with no taxonomy authoring.
  const root = (domain && domain.rootCatalogue) || 'class_of_physical_object';
  return { root, nodes };
}
