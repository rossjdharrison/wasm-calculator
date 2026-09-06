# The framework contract

*The authoritative description of what this framework interprets, the wall between
its neutral machinery and domain data, and the invariants that are **enforced** (not
merely intended). If the code and this document disagree, one of them is a bug —
`scripts/check-neutral.mjs` exists to keep them honest.*

---

## 1. What this is (the capability envelope)

A **declarative configurator-and-quote engine**: you describe — as data — how a
*single object* is specified, priced or scored, and walked through a linear process;
it runs as a deterministic, auditable, replayable calculation with a live UI, and
you swap the domain by editing data, no redeploy.

It fits a problem **only if all five hold** (else no amount of data will save it):

1. **One object at a time** — a single entity with a fixed, known-up-front attribute set.
2. **Bounded, enumerable inputs** — number / boolean / choice-from-a-fixed-list (≤31 multi-select). No free text, dates, files, or lists.
3. **Logic is a finite calculation** — arithmetic / table-lookup / gating. No loops, recursion over runtime data, or text/calendar logic.
4. **Dimensions don't feed back** — when several configurators compose, data flows one way (A → B); no dimension re-opens an earlier one.
5. **Single authority per record** — one party configures; the record is theirs.

This is domain-neutral *within numeric configuration* (cars, antiques, insurance
quotes, subscription tiers, finance products, spec-and-price of catalogued goods).
It is **not** "any domain" — admissions/case-files/BOM/coupled/text/temporal/
multi-actor problems are the wrong foundation, by construction (see §6).

## 2. The interpreted documents (the contract)

The machinery interprets exactly these document types. Each has a **draft-07 JSON
schema** (documentation + editor autocomplete) *and* a **pure `.mjs` validator**
(the build gate). **The schema is a static snapshot; the validator is the runtime
truth** — when they can disagree, the validator wins and `check-neutral.mjs` asserts
the schema hasn't drifted from the live vocabulary.

| Document | Files | Schema | Validator (the gate) |
|---|---|---|---|
| **Data model** | `web/models/<id>/data-model.json` | `web/data.schema.json` | `web/schema-check.mjs` (`validateEditorSchema` + `validateDocAgainstSchema`) + `assemble()` |
| **Presentation model** | `web/models/<id>/presentation-model.json` | `web/presentation.schema.json` | same |
| — merged → **model** | (data + presentation, by the ownership whitelist) | — | `web/assembler.mjs` `mergeModel`/`splitModel` + the VM |
| **Journey** (composition) | `web/journeys/<id>.json` | `web/journey.schema.json` | `web/journey-schema.mjs` `validateJourneyShape` + `web/journey-validate.mjs` `analyzeJourney` |
| **Domain** (site model) | `web/domain.json` | — | consumed by `landing.js` / `store.mjs` |
| **Catalogue** (taxonomy) | *derived* — no file | — | `web/catalogue-build.mjs` `registryFromModels` |

- **Data + presentation** split by an ownership whitelist (`DATA_TOP`/`DATA_BLOCKS`/`DATA_FIELD`/`DATA_OPTION` vs `PRES_TOP`/`PRES_FIELD`/`PRES_OPTION` in `assembler.mjs`); `mergeModel(splitModel(m)) === m` is guarded (§5 coverage). A key not on a whitelist is dropped on save — the coverage check catches it.
- The **catalogue is derived, never authored**: `registryFromModels(domain, modelCatalog, modelDataById)` projects `{ root, nodes }` from every model's `data.types` + its `configures` leaf (+ an optional `domain.taxonomy` grouping seed); `root` defaults to `class_of_physical_object`. `catalogue.mjs` reads that projection; `isA` climbs it into the frozen core.

## 3. The neutral vocabulary vs domain data

**Neutral, in `web/hqdm-core.json` (a small HQDM upper lattice — the machinery keys off the *inferred* neutral category, never a domain id):**
- `types` — the upper `specializes` lattice (the only relation interpreted; see §6).
- `renderHints` — L0 category → `{ glyph, render }`, paired 1:1 with `category-render.mjs`.
- `stepKinds` — the neutral process-step kinds (`capture` / `capture-downstream` / `ceremony` / `preview`).

**Domain vocabulary lives ONLY in data** — never in the neutral machinery:
- process **phases** (a lifecycle), user-facing **labels**, **brand**, `defaultModel` → `web/domain.json`.
- domain **classes** (e.g. `VehicleClass specializes class_of_physical_object`) → each model's `data.types`; the class a model configures → its top-level `configures`.

## 4. Extension points (all data-driven)

| To add… | Do this | Enforced by |
|---|---|---|
| a domain **class** | declare it in a model's `data.types` (studio: *Classes (HQDM)*), give it a `specializes` parent | `check-neutral` coverage; `hqdm.isA` climbs it |
| **what a model configures** | set the model's `configures` (studio: *Model → This model configures*) | derives its catalogue leaf |
| a process **phase** | add to `domain.json.phases` (or a journey's `phases`) | `journey-schema` validates step/model phases against them |
| a process **step kind** | add to `hqdm-core.json.stepKinds` + a render branch in `journey-view.mjs` | `check-neutral` drift (schema enum == core) |
| an **L0 render category** | add a `hqdm-core.json.renderHints` leaf + a `category-render.mjs` renderer | `check-neutral` drift (renderers key off real types) |
| an editor **widget** | add to `editor-engine.mjs` `WIDGETS` **and** `WIDGET_CONTRACTS` | `check-neutral` drift (`WIDGET_TYPES == keys(WIDGET_CONTRACTS)`) |
| a **configurator** | the landing's *＋ New configurator* (mints id, seeds a valid model, drill in) | `model-create-core` + the local model-catalogue overlay |

## 5. The enforced invariants (the wall)

Run by `npm run build` (via `scripts/check-neutral.mjs`, before `validate:model`) and by `npm test` (via `test/contract.test.mjs`):

- **Neutrality (R6)** — the neutral machinery contains no domain vocabulary (model ids, their `data.types` class ids, journey ids). A **lower-only ratchet** (`MAX_DOMAIN_LEAKS`) carries the few bootstrap defaults (the `?m=`/`?j=` URL fallbacks) and forbids new leaks — the wall can only tighten.
- **Accepted ⟺ executed** — the framework never accepts an authored construct it does not run. Concretely, a populated `triggers[]` is a schema **error** (§6), not a silently-ignored no-op.
- **Vocab drift (R2)** — every schema enum that snapshots `hqdm-core` equals the live set; every `category-render` renderer keys off a real type; the widget registry and its contracts cannot diverge.
- **Coverage** — every shipped model round-trips `split → merge` losslessly, so no authored top-level key can silently vanish.
- **Engine frozen** — `assembly/quote.ts`, the QCM1 binary image, and `evaluate()`/`graph()` output shapes are byte-stable, pinned by `vm-parity` / `reflect-parity` / `wire-format` / `seam-parity`. Adding engine capability (a string op, a date type, a loop, a `let`) is a deliberate, re-pinning act — the whole framework is organised to avoid it; the numeric envelope (§1) is that decision.

## 6. What is NOT interpreted (and why)

- **Triggers / behavioural saga edges.** Cross-model feedback is outside the frozen one-pass numeric scope (`compose.mjs` is an acyclic single pass; single-authority-per-fact is enforced). Rather than accept-and-ignore them, the shape gate **rejects a populated `triggers[]`**. If a coupled/saga framework is ever built, triggers get re-derived *there*, where they'd fire.
- **HQDM relations beyond `specialization`.** `classification`, `part_of`, `participant_in`, `temporal_part_of`, … are real ontology but this framework only *climbs* specialization; the rest are not carried as inert vocabulary.

## 7. Deferred (not yet, by decision)

- **KV/R2 + Cloudflare Pages deploy** to `quote.rowblaa.com` — the substrate that makes "swap the data, no redeploy" *true* across authors/machines (today authored artefacts live in one browser's localStorage). It should serve **contract-valid, neutrality-checked** documents — which is why this contract lands first.
- **Authoring DX** — `let`/named sub-expressions + a git-diffable infix on-disk formula form (desugared *before* `assemble()`, never a new VM op).
- **A second, non-vehicle configurator authored end-to-end through the studios + a getting-started** — the honest graduation test.
- **Order durability + concurrency** — the two-tab data-loss fix as compare-and-set on the real substrate, under the single-authority-record clause.

*See also `docs/catalogue-authoring-spec.md` (the studio-authored taxonomy) and the memory notes.*
