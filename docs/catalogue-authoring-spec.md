# Spec — the HQDM taxonomy emerges from the studio (no hand-JSON)

*2026-09-06. Design spec. The catalogue/taxonomy is authored through the UI by adding
objects (models) and drilling into them, and is DERIVED from what the studio captures —
never a separately hand-written file. Engine byte-frozen; numeric-configurator scope.*

---

## 0. The correction this spec encodes

The shipped `web/catalogues/registry.json` was **the wrong shape**: a *separately
hand-authored* file that invented its own taxonomy (`TransferableProperty → Vehicle →
RoadVehicle → motorcars`) which **no model references**. Meanwhile every model already
declares its real classes in `data.types` (`VehicleClass`, `ArtworkClass →
class_of_physical_object`). Two disconnected taxonomies.

**The target:** the taxonomy is the *projection* of what the studio already captures —
each model's `data.types` (its classes + `specializes` edges) plus a per-model tag for
the class it configures. Adding a model in the studio and saying what it is **grows the
browsable taxonomy behind the scenes**. `registry.json` becomes a *derived view*, not an
authored artefact. `catalogue.mjs`'s functions already take a `reg` object, so this is a
**builder swap, not an API change** — `isA`/landing/breadcrumbs are untouched.

---

## 1. Target, stated precisely

A person, using only the studio, can:

1. **Add an object** — create a new configurator (mint id, seed empty model, name it) —
   no dir creation, no `catalog.json` edit.
2. **Drill in and define it** — fields/computed/logic (exists today) **and** its HQDM
   classes: declare a class, its `specializes` parent, and mark which class this model
   *configures* — via widgets, no JSON.
3. **See it appear** — the model shows on the landing, grouped under its class, reachable
   by breadcrumb drill-down — because the taxonomy is derived from (1)+(2).

"How models fit *together*" (bindings/triggers/steps) is already UI-driven (Journey
Studio) and out of scope here. This spec is about how a model gets **into the taxonomy**.

---

## 2. Current state (grounded)

| Capability | Today | File evidence |
|---|---|---|
| Edit an existing model's fields/logic | ✅ studio | `data-editor.js`, `loom.mjs` |
| Tag a field/computed with an HQDM category | ✅ studio (D7) | `data.schema.json:14,25` category select |
| Declare a **new** class (`data.types` entry) | ❌ no widget | `data.schema.json` has no `types` collection |
| Mark **which class a model configures** | ❌ implicit + hardcoded | `individuals.mjs:45` stamps `#spec` = `class_of_physical_object` |
| **Create** a new model | ❌ none | `store.mjs` has `saveData`/`savePres` (edit-in-place) only; no `newModel`/`saveCatalog`; `studio-shell` nav is edit-only |
| Compose models (bindings/triggers) | ✅ studio | `journey-create.mjs`, `journey-loom.mjs` |
| The taxonomy | ❌ hand-JSON, disconnected | `catalogues/registry.json` invents `Vehicle/RoadVehicle/motorcars` |

**Precedent to mirror (journeys already do the whole pattern):** create-core
(`journey-create-core.mjs`: `slugify`/`uniqueJourneyId`/`newJourney`), a localStorage
overlay + merged catalogue (`store.mjs:82-102` `getLocalJourneyCatalog` /
`saveLocalJourneyEntry` / `mergedJourneyCatalog`), and browser-override-wins
(`currentJourney = getStoredJourney ?? loadJourney`). Models get the exact same shape.

---

## 3. The model of record (data shapes)

**A model's `data.types`** — unchanged shape, now studio-authored:
```json
"types": {
  "VehicleClass":  { "specializes": ["TransferableProperty"], "title": "Motorcars" },
  "TransferableProperty": { "specializes": ["class_of_physical_object"], "title": "Transferable Property" },
  "PurchasePrice": { "specializes": ["amount_of_money"] }
}
```
- Key = the class id. Value = `{ specializes: [parentId, ...], title? }`.
- `title` is new + optional — the human label a grouping class shows on the landing
  (a class with no model needs its own label; a leaf borrows the model's card title).
- Parents resolve into `hqdm-core` (`class_of_physical_object` etc.) exactly as today.

**A model's `configures` tag** — NEW, top-level on the data model:
```json
"id": "vehicles", "currency": "EUR", "configures": "VehicleClass", ...
```
- The class (from this model's own `data.types`) whose individuals this model configures —
  i.e. its **leaf node** in the taxonomy. Replaces the hardcoded `class_of_physical_object`
  at `individuals.mjs:45`.
- Optional/back-compatible: if absent, fall back to today's behaviour (a synthetic
  `<modelId>#spec` leaf categorised `class_of_physical_object`), so shipped models keep working.

**The derived registry** — `{ root, nodes }`, byte-identical in shape to today's
`registry.json`, but *computed* (never fetched):
```
nodes = ⋃(every catalogued model's data.types)                     // classes + specializes
      ⊕ { <m.configures>: { specializes, title: card.title, model: m.id } }   // one leaf per model
      ⊕ (domain.taxonomy grouping seed, optional)                  // classes with no model yet
root  = domain.rootCatalogue ?? "class_of_physical_object"          // neutral fallback that always exists
```
Union is keyed by class id, so two vehicle models both declaring `TransferableProperty`
collapse to one node (DAG stays single-sourced — the reference-view invariant, now enforced
by construction). Non-object classes (`PurchasePrice → amount_of_money`) enter the type-map
for `isA` closure but never surface as landing groups, because `childrenOf(root)` only
returns classes specializing the physical-object root — **the grouping self-selects**.

---

## 4. Deliverables

### D-A — the `types` editor (data studio)

**`web/data.schema.json`** — add a `types` collection (a map, mirroring `tables`):
```json
{ "key": "types", "kind": "map", "title": "Classes (HQDM)", "singular": "Class",
  "add": { "prompt": "New class id:", "template": { "specializes": [] } },
  "form": [
    { "prop": "title", "label": "Label", "widget": "text" },
    { "prop": "specializes", "label": "Specialises", "widget": "parents", "source": "categories" }
  ] }
```
- `kind:"map"` already renders as outline-keys → per-entry form (`editor-engine.mjs:65,81,
  176-179`), and the map key is the class id.
- **New widget `parents`** in `editor-engine.mjs`: a select (sourced like the category
  select) whose chosen id is written as a **one-element `specializes` array** (v1 = a single
  parent / a chain); it reads `specializes[0]` and offers "＋ parent" for multi-inheritance
  as the extension. Register it in `WIDGETS` **and** `WIDGET_CONTRACTS`
  (`{ needsProp:true, oneOf:['options','source'] }`) — the drift guard
  (`schema-conformance.test.mjs`) asserts the two key-sets match.
- The `categories` source (already in `DATA_SOURCES`, `data-editor.js` `SOURCE_FNS`) is
  reused verbatim: `authorCategories(data.types)` = neutral leaves ∪ this model's own classes,
  so a parent can be a core leaf **or** another class you just declared. Exclude the row's own
  id from its parent options (no self-specialization).

**`web/data.schema.json`** — add the `configures` tag as a **singleton-style select** on a
new top-level (or on a `settings`/root form): `{ "widget":"select", "prop":"configures",
"label":"This model configures", "source":"typeIds", "target":"root", "allowNone":true }`,
where `typeIds` is a new source = `Object.keys(data.types)` (the model's own classes). This is
the "what kind of thing is this?" act.

**Tests:** `schema-conformance.test.mjs` — the `types` collection + `parents`/`typeIds`
wiring validate; `WIDGET_TYPES === WIDGET_CONTRACTS` still holds. A new
`test/data-types-edit.test.mjs` for the pure add/label/parent behaviours if the parent-array
coercion is extracted to a pure helper.

### D-B — `configures` consumed; retire the hardcode

**`web/individuals.mjs`** — the `#spec` composite category becomes the model's declared class:
```
const configuredClass = data.configures || 'class_of_physical_object';   // was hardcoded :45
```
Use `configuredClass` for the composite's `category`/`leaf` in `individualsOf` (`:45`) and
`projectIndividuals` (`:66`); `specPartsOf` still gathers fields `isA class_of_physical_object`.
Pure, no engine contact. **Test:** extend `individual.test.mjs` — a model with
`configures:"VehicleClass"` mints `#spec` categorised `VehicleClass` (leaf resolves through
its `specializes` to `class_of_physical_object`); absent `configures` keeps today's behaviour.

### D-C — create/add-model flow

**`web/model-create-core.mjs`** (NEW, pure, mirrors `journey-create-core.mjs`):
`slugify` (reuse/copy), `uniqueModelId(base, existingIds)`, and
`newModelData(id, {title, currency, configures?})` + `newModelPres(id, {title})` returning the
**minimal valid** two files (a data model that assembles: one number field, one output; a
presentation with a title/brand). Deterministic, unit-tested.

**`web/store.mjs`** — parametrise save/load by id + a local model-catalogue overlay
(mirror of the journey overlay `:82-102`):
- `saveDataFor(id,d)` / `savePresFor(id,p)` / `getStoredDataFor(id)` / `getStoredPresFor(id)`
  (the existing `saveData`/`getStoredData` become `…For(MODEL_ID)`).
- `loadModelFiles(id)` and `currentData/Pres` **fall back to the stored override** when there
  is no shipped file (a browser-created model has no `models/<id>/*.json`), so a 404 never
  breaks it.
- `getLocalModelCatalog` / `saveLocalModelEntry({id,title,blurb,hero,configures})` /
  `removeLocalModelEntry` (key `qc:models:catalog:v1`) + `mergedModelCatalog()` = shipped
  `models/catalog.json` ∪ overlay by id.

**`web/landing.js`** — read `mergedModelCatalog()` instead of `loadCatalog()` so created
models appear; card titles/blurbs/heroes come from the merged catalogue by id (as today).

**Create UI** — the lightest surface: a "＋ New configurator" entry on the landing (and/or in
`studio-shell` nav). Its form captures title + (optional) `configures` class, calls
`newModelData/Pres` + `saveDataFor`/`savePresFor` + `saveLocalModelEntry`, then navigates to
`data-editor.html?m=<newId>` to drill in. (No separate page needed for v1 — a small dialog on
the landing, or reuse the studio shell.)

**Tests:** `test/model-create.test.mjs` — `uniqueModelId` disambiguation; `newModelData`
assembles clean (feed it through `tryAssemble`); `mergedModelCatalog` merges overlay over
shipped.

### D-D — derive the registry from the models

**`web/catalogue-build.mjs`** (NEW, pure, DOM-free):
```
export function registryFromModels(domain, modelCatalog, modelDataById) → { root, nodes }
```
- `nodes` = for every model in `modelCatalog`: fold its `data.types` into `nodes` (each
  `{specializes, title?}`, union by id), then upsert its leaf node
  `nodes[m.configures] = { ...(existing), specializes, title: card.title, model: m.id }`
  (a model with no `configures` contributes a synthetic `<id>#spec` leaf → `class_of_physical_object`,
  preserving today's landing).
- Seed `domain.taxonomy` (if the domain still declares grouping-only classes) into `nodes`
  first, so an empty group can pre-exist.
- `root` = `domain.rootCatalogue ?? 'class_of_physical_object'`.
- Pure + deterministic → fully unit-testable; **no engine, no DOM.**

**`web/store.mjs` `loadCatalogue`** — build instead of fetch:
```
export const loadCatalogue = async () => {
  const [domain, cat] = await Promise.all([loadDomain(), mergedModelCatalog()]);
  const datas = Object.fromEntries(await Promise.all((cat.models||[]).map(async m =>
    [m.id, (await loadModelFilesSafe(m.id)).data])));   // override-or-fetch, null-tolerant
  return registryFromModels(domain || {}, cat, datas);
};
```
This is the **only** wiring change landing needs — `catalogue.mjs` (`typeMapOf`/`childrenOf`/
`modelsUnder`/`isA`/`pathTo`/`glyphOf`) is untouched because it already consumes a `reg` object.
The KV/R2 seam is unchanged: swapping whole-file model fetches for lazy per-node loads stays a
loader concern.

**Retire `web/catalogues/registry.json`** — delete it (or keep as an optional `domain.taxonomy`
seed for grouping-only classes). Remove the `catalogues/` copy from `build-site.mjs` if deleted.
Keep `catalogue.mjs` + its tests (feed them a synthetic `reg` from `registryFromModels`).

**Build gate** — `scripts/validate-model.mjs` builds the derived registry from the shipped
models and runs the same referential-integrity check `catalogue.test.mjs` does (every
`specializes` parent exists as a node or a core type; `configures` names a real `data.type`).

**Tests:** `test/catalogue-build.test.mjs` — `registryFromModels` over the two shipped models
yields nodes containing `VehicleClass`/`ArtworkClass` with `model:` set; `childrenOf(root)`
groups them; non-object classes (`PurchasePrice`) don't surface as groups; a model missing
`configures` still yields a leaf. Update `catalogue.test.mjs` to build its `reg` from models
rather than reading `registry.json`.

---

## 5. Sequencing, parity, green

Order (each step green before the next): **D-B** (tiny, unblocks a real `configures`) →
**D-A** (`types` + `configures` widgets) → **D-D** (derive registry; delete `registry.json`) →
**D-C** (create-model flow). D-D can precede D-C; both need D-A's `configures` to be meaningful,
D-B to consume it.

**Parity:** nothing here touches `assembly/quote.ts`, `serialize()`, the QCM1 image, or
`evaluate()/graph()`. `data.types`/`configures`/`title` are model-tier data the compiler never
reads (like `category` — carried through merge, ignored by the VM). The two-file whitelist:
`configures` + `types.title` are DATA-owned; if `types` is not already whole-block-passed by
`splitModel`/`mergeModel`, add it to `DATA_TOP` and **regenerate `test/fixtures/vehicle-combined.json`
in the same commit** (the split-merge deepEqual guard). Confirm `types` round-trips before shipping.

**Scope:** pure data authoring + a derived view — squarely inside the numeric-configurator
envelope; no new engine capability.

---

## 6. Open decisions

1. **Single vs multi parent** in the `parents` widget — v1 single (a chain, stored as a
   1-element array) with "＋ parent" deferred? *Recommend yes.*
2. **Root fallback** — `domain.rootCatalogue` default to `class_of_physical_object` (works with
   today's models, no types-editing needed) vs require the author to declare a grouping root?
   *Recommend the neutral fallback so the landing works immediately.*
3. **Keep `registry.json` as a grouping seed** vs delete outright? *Recommend delete; fold any
   grouping-only classes into `domain.taxonomy`.*
4. **Create entry location** — a landing dialog vs a `studio-shell` nav item vs a small
   `model-create.html`? *Recommend a landing dialog for v1 (least surface).*
5. **`configures` naming** — `configures` vs `class` vs `kind`? *Recommend `configures`* (avoids
   the `class`/`kind` collisions; reads as "this model configures a <class>").
