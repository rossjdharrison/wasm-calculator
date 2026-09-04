I have full context on the current prototype and all the locked inputs. Here is the Phase 1 Build Spec.

---

# Quote Configurator — Phase 1 Build Spec (QCM1)

**Status:** implementation-ready · **Engine codename:** QCM1 (Quote Configurator Model, v1) · **Target:** Cloudflare Pages, `quote.rowblaa.com` · **Node:** 22 (`.nvmrc`) · **AssemblyScript:** 0.27.x, `--runtime stub`.

This document is the single source of truth for building Phase 1. It supersedes nothing in the locked architecture — it *details* it. An engineer should be able to implement every file from this document plus Appendices A (JSON Schema) and B (`model.json`).

> **Deliberate corrections to the raw design sketch** (all reconciled below, flagged where they occur):
> 1. `FIELD` record is **56 bytes** (the sketch's "48B" cannot 8-byte-align the trailing `f64`).
> 2. `OUTPUT` record is **20 bytes** — a `visibleWhenNode` is added (the model has `outputs[].visibleWhen`).
> 3. Variadic `add/sub/mul/min/max` in `model.json` are **folded to binary trees** by the assembler; VM opcodes are strictly fixed-arity.
> 4. Single-select auto-fallback is a defined **in-engine settle rule** (reset to default/first-available), so no domain logic leaks back into JS.
> 5. The assembler is **one shared ES module** imported by both the build gate and the runtime, eliminating the two-copy drift risk.

---

## 1. Architecture recap

Three layers, one wall between each, crossable in one direction only:

| Layer | Owner | Artifacts | Contains | Never contains |
|---|---|---|---|---|
| **Model** | Non-dev author | `model.json` (+ `model.schema.json`) | fields, order, sections, control hints, coarse width, all logic (expressions, tables, effects, validations, outputs) | any colour, font, px, class, CSS |
| **Engine** | Dev (build once) | `quote.wasm` + `assembler.mjs` + `app.js` + `qc-base.css` | the QCM1 VM, the JS assembler, the DOM contract, structural CSS referencing only tokens | brand colours/fonts, per-model logic |
| **Designer** | Designer | `theme.css` | `--qc-*` tokens (light+dark), skins | logic, markup, field ids |

**The invariant:** one model-agnostic `quote.wasm`, compiled once from git, runs *both* the editor live-preview and the public site. Publishing a new model is **new bytes behind one URL** (`MODEL_URL`) — no engine rebuild, zero preview/production drift.

**The data flow (per session):**

```
model.json ──fetch──▶ assembler.mjs ──▶ [ MODEL blob (bytes) ] ─write─▶ wasm linear memory
                              │                                              │
                              └──▶ [ IO layout manifest (JS-only) ]          │ loadModel()
                                                                            ▼
  user input ─▶ write VALUES ─▶ evaluate():STATUS ─▶ read OUT_VALUES / state / limits / options / messages ─▶ paint DOM
```

The **assembler** flattens `model.json` into a compact binary MODEL image + a JS-side IO manifest. The **VM** is a flattened-tree walker: a preorder AST in typed memory plus parallel structural record arrays, walked by one `evalNode()` switch inside a fixed `evaluate()` loop. The **front-end** renders fields once from the manifest, then per input change writes numbers in, calls `evaluate()`, and runs a **paint pass** — the only DOM mutation — toggling state classes, attributes, limits, values, and messages, all keyed off `data-field` / `data-output`.

Only **numbers/bytes** cross into wasm. Strings (messages, units, labels) stay in JS, resolved from integer ids.

The current repo is the *apparel* prototype: a hardcoded domain engine (`assembly/quote.ts`) with a pure-numeric getter boundary and a bespoke `web/app.js`. Phase 1 **replaces** the engine internals and generalizes the front-end while keeping the toolchain (`asconfig.json`, `build-site.mjs`, `server.mjs`, `wrangler.jsonc`) essentially intact.

---

## 2. The VM (QCM1)

### 2.1 Model — a flattened-tree walker

- No bytecode, no operand stack, no register file. Expressions are serialized to fixed-width **AST NODE records** (16 B) in preorder; children are referenced by index through a shared **CHILDREN** i32 pool.
- The one hot function is `evalNode(nodeIdx: i32): f64` — reads `NODE.op` (`load<u8>`), dispatches on a `switch`, recurses into children.
- Structural concerns (fields, options, effects, validations, outputs, tables, sections) are **not** walked as expressions — they are parallel record arrays iterated by the fixed `evaluate()` algorithm, which calls `evalNode()` on the node indices those records point at.
- Recursion depth is capped at build time (**≤ 64**); an explicit-index-stack variant of `evalNode()` is the documented drop-in if a hard runtime bound is ever required.

### 2.2 Expression opcodes (`u8` in `NODE.op`)

All arithmetic is `f64`. Booleans are `1.0`/`0.0`. `AND`/`OR`/`IF` **short-circuit** (only the taken branch is walked) — this is what makes the annuity's divide guard and the finance/lease/`cash` gating safe with no jump bookkeeping.

| Code | Op | nargs | Semantics |
|---|---|---|---|
| 0 | `CONST` | 0 | leaf; value in `NODE.imm` (f64) |
| 1 | `LOAD` | 0 | leaf; `VALUES[NODE.aux]` (number / bool / dense enum code / multi-select mask-as-f64) |
| 2 | `ADD` | 2 | a + b |
| 3 | `SUB` | 2 | a − b |
| 4 | `MUL` | 2 | a × b |
| 5 | `DIV` | 2 | **guarded**: denom==0 → 0.0 and `STATUS |= DIV0` |
| 6 | `NEG` | 1 | −a (used for `(1+r)^-n`) |
| 7 | `POW` | 2 | `Math.pow(base, exp)`; result finiteness checked → `STATUS |= NAN_INF` |
| 8 | `ABS` | 1 | `Math.abs` |
| 9 | `FLOOR` | 1 | `Math.floor` |
| 10 | `CEIL` | 1 | `Math.ceil` |
| 11 | `ROUND` | 1 | nearest integer (step-snapping; money rounding is JS-side at format time) |
| 12 | `MIN` | 2 | `Math.min` |
| 13 | `MAX` | 2 | `Math.max` |
| 14 | `CLAMP` | 3 | `max(lo, min(hi, x))` |
| 15 | `EQ` | 2 | a==b → 1/0 |
| 16 | `NE` | 2 | a!=b → 1/0 |
| 17 | `LT` | 2 | a<b → 1/0 |
| 18 | `LE` | 2 | a<=b → 1/0 (model `lte`) |
| 19 | `GT` | 2 | a>b → 1/0 |
| 20 | `GE` | 2 | a>=b → 1/0 (model `gte`) |
| 21 | `AND` | 2 | short-circuit, operands `!=0` → 1/0 |
| 22 | `OR` | 2 | short-circuit → 1/0 |
| 23 | `NOT` | 1 | a==0 → 1/0 |
| 24 | `IF` | 3 | **lazy**: eval cond, then exactly one of then/else |
| 25 | `HAS` | 1 | `aux`=bit index; child = mask expr → `((i32(mask) >> bit) & 1)` |
| 26 | `COUNTBITS` | 1 | `popcount(i32(mask))` |
| 27 | `LOOKUP1D` | 1 | `aux`=tableId; child=index → `TABLE_DATA[dataOff + clampIdx(round(i), rows)]`; OOB → 0.0 + `STATUS |= TABLE_OOB` |
| 28 | `LOOKUP2D` | 2 | `aux`=tableId; children=row,col → `TABLE_DATA[dataOff + clamp(row)*cols + clamp(col)]`; OOB → 0.0 + `STATUS |= TABLE_OOB` |

**Bit manipulation is not an opcode.** Set-membership *reads* use `HAS`; set *writes* live in `EFFECT.opKind` (structural), keeping the AST purely functional so lazy evaluation stays clean.

**Model-op → opcode mapping (assembler):** `field`→`LOAD`, `const`→`CONST`, `lte`→`LE`, `gte`→`GE`, `notHas`→`NOT(HAS(...))`, `lookup`→`LOOKUP1D`/`LOOKUP2D` by arity, variadic `add/sub/mul/min/max`→left-associated binary chains, `has(fieldId,optId)`→`HAS(aux=bit, LOAD(fieldSlot))`.

### 2.3 Structural record types (iterated by `evaluate()`)

`-1` in any node-index field means *absent / "always" / form-level*.

| Record | Size | Fields (byte offset) |
|---|---|---|
| **NODE** | 16 B | `u8 op`(0) · `u8 nargs`(1) · `u16 aux`(2) · `i32 childPtr`(4) · `f64 imm`(8) |
| **FIELD** | **56 B** | `u16 kind`(0) · _pad_(2) · `i32 valueSlot`(4) · `i32 visibleWhenNode`(8) · `i32 enabledWhenNode`(12) · `i32 minNode`(16) · `i32 maxNode`(20) · `i32 stepNode`(24) · `i32 computedValueNode`(28) · `i32 optionStart`(32) · `i32 optionCount`(36) · `i32 stateSlot`(40) · _pad_(44) · `f64 defaultValue`(48) |
| **OPTION** | 20 B | `i32 code`(0) · `i32 availableWhenNode`(4) · `i32 ownerFieldSlot`(8) · `i32 optionBit`(12) · `i32 stateByteIdx`(16) |
| **EFFECT** | 20 B | `i32 condNode`(0) · `i32 targetFieldSlot`(4) · `i32 valueNodeOrBit`(8) · `i32 opKind`(12) · `i32 priority`(16) |
| **VALIDATION** | 16 B | `i32 condNode`(0) · `i32 messageId`(4) · `i32 severity`(8) · `i32 targetFieldSlot`(12) |
| **OUTPUT** | **20 B** | `i32 exprNode`(0) · `i32 formatCode`(4) · `i32 unitId`(8) · `i32 labelId`(12) · `i32 visibleWhenNode`(16) |
| **TABLE** | 24 B | `i32 kind`(0) · `i32 rows`(4) · `i32 cols`(8) · `i32 dataOff`(12) · `i32 rowKeyMapOff`(16, `-1`) · `i32 colKeyMapOff`(20, `-1`) |
| **SECTION** | 12 B | `i32 id`(0) · `i32 fieldStart`(4) · `i32 fieldCount`(8) |
| **MSG** | 12 B | `i32 messageId`(0) · `i32 severity`(4) · `i32 targetFieldSlot`(8) |

- `FIELD.kind`: `0 num · 1 bool · 2 single · 3 multi · 4 computed`.
- `EFFECT.opKind`: `0 SET value(from valueNodeOrBit as node) · 1 SET_BIT · 2 CLEAR_BIT`.
- `severity`: `0 info · 1 warn · 2 error`; `formatCode`: `0 currency · 1 number · 2 unit · 3 percent`.
- **Dense codes are identity keys:** an option's `code` == its table row/col index == its multi-select bit index. `rowKeyMap`/`colKeyMap` are reserved `-1` for future sparse tables.
- **Multi-select cap = 31 options/field** (i32-safe bit ops via `i32()` truncation), validated at build.

### 2.4 Memory layout — two blobs in one linear memory

Memory is **pre-sized to model+IO up front**; no growth on the hot path, so JS typed-array views stay valid across every `evaluate()`. All region offsets are **relative to the owning blob's base**; wasm adds the base cached at `loadModel`. Every `f64` region is 8-byte aligned (assembler pads); every record stride is a multiple of its widest field.

#### MODEL blob (immutable; written once per `model.json` fetch)

**HEADER (256 B) at +0:**

| Offset | Bytes | Field |
|---|---|---|
| 0 | 4 | `u32 magic` = `0x51434D31` (`'QCM1'`) |
| 4 | 4 | `u32 version` |
| 8 | 4 | `u32 layoutHash` (JS verifies against its own derived layout) |
| 12 | 72 | region table: 9 × (`u32 count`, `u32 relOffset`) for NODES, CHILDREN, FIELDS, OPTIONS, EFFECTS, VALIDATIONS, OUTPUTS, TABLE_DIR, SECTIONS |
| 84 | 20 | `u32 tableDataOff`, `u32 tableDataLen`, `u32 evalOrderOff`, `u32 fieldCount`, `u32 settleMaxPasses` |
| 104 | 36 | IO sub-offsets (relative to IO base): `valuesOff, stateBitsOff, limitsOff, optionStateOff, messagesOff, u32 messageCap, outValuesOff, u32 outputCount, statusOff` |
| 140 | 116 | reserved |

**Regions (in order):** `NODES` (16 B each) · `CHILDREN` (i32 pool) · `FIELDS` (56 B) · `OPTIONS` (20 B) · `EFFECTS` (20 B) · `VALIDATIONS` (16 B) · `OUTPUTS` (20 B) · `TABLE_DIR` (24 B) · `SECTIONS` (12 B) · `TABLE_DATA` (f64 row-major cells for all tables; the 2D price matrix has model-base+trim-uplift baked in) · `EVAL_ORDER` (`i32[fieldCount]`, Kahn topological order — the only "graph" the runtime needs).

#### IO blob (mutable; rewritten per `evaluate`; sub-offsets from HEADER)

| Region | Type | Purpose |
|---|---|---|
| `VALUES` | `f64[fieldCount]` | inputs written by JS; computed/forced/auto-deselected values written back by wasm. Multi-select = integer-valued mask, ≤31 bits |
| `FIELD_STATE_BITS` | `u32[fieldCount]` | bit0 visible · bit1 enabled · bit2 invalid · bit3 forced/locked · bit4 changed-by-engine |
| `FIELD_LIMITS` | `f64[fieldCount*3]` | (min, max, step) per field |
| `OPTION_STATE` | `u8[optionCount]` | 1 available / 0 unavailable |
| `MESSAGES` | `u32 count` + `MSG[messageCap]` | active validations this pass |
| `OUT_VALUES` | `f64[outputCount]` | output values |
| `STATUS` | `i32` bitfield | 0 ok; `DIV0=1, TABLE_OOB=2, NAN_INF=4, DEPTH_EXCEEDED=8, SETTLE_NOT_CONVERGED=16` |

For the vehicle model this is a few hundred nodes and low-KB blobs.

### 2.5 The JS ⇄ wasm boundary protocol

**Exports:** `memory`, `alloc(n: usize): usize`, `loadModel(modelBase: usize, ioBase: usize): void`, `evaluate(): i32` (returns STATUS).

```ts
// assembly/quote.ts — allocator
export function alloc(n: usize): usize { return heap.alloc(n); } // bump, --runtime stub
```

**LOAD (once per `model.json` fetch):**
1. **Assembler (JS):** JSON-Schema validate → semantic validate → assign dense codes/bits → parse expressions to NODES+CHILDREN → build record arrays + TABLE_DATA → build field DAG, Kahn topo-sort into EVAL_ORDER → compute IO layout, all sub-offsets, `settleMaxPasses`, `layoutHash`. **Hard-fail** on unknown ref / bad enum / cycle / depth>64 / mask>31 (§4).
2. `modelBase = alloc(modelBytes); ioBase = alloc(ioBytes);` — **re-acquire** all typed-array views (`Uint8/Int32/Uint32/Float64`) on `memory.buffer` after each `alloc`.
3. JS writes every MODEL region at `modelBase + relOffset` via the matching view, writes the HEADER (magic, version, `layoutHash`, region table, tableData/evalOrder offsets, `settleMaxPasses`, IO sub-offsets, `messageCap`, `outputCount`), then calls `loadModel(modelBase, ioBase)`.
4. JS verifies `magic`/`version`/`layoutHash` against its own layout (guards model-image ↔ JS-layout drift). Because memory is pre-sized and never grows after this, IO views stay valid for all later `evaluate()` calls.

**EVALUATE (per input change, debounced to `requestAnimationFrame`):**
1. JS writes current control values into `VALUES[valueSlot]`: number/bool as f64, single-select as its dense code, multi-select as the OR of selected option bits.
2. JS calls `evaluate()`. Wasm, in order:

   **(a) Reset:** zero `OUT_VALUES`, `FIELD_STATE_BITS`; `MESSAGES.count = 0`; `STATUS = 0`. Preserve `VALUES`.

   **(b) SETTLE** — bounded fixpoint, `pass < settleMaxPasses` (= `optionCount + effectCount + 2`). Each pass walks `EVAL_ORDER`; for each slot `s`:
      - Apply every `EFFECT` targeting `s` in **(priority, declaration)** order: `SET` writes `evalNode(valueNode)`; `SET_BIT`/`CLEAR_BIT` flips a mask bit. On any change → mark `s` bit4 (changed) + bit3 (forced/locked); `dirty = true`.
      - If `s` is **computed**: `VALUES[s] = evalNode(computedValueNode)`.
      - Compute `s`'s options' availability **in declaration order, incrementally** (each option's `availableWhen` reads the current, in-pass-updated mask), writing `OPTION_STATE`:
        - **multi-select:** if a selected bit is now unavailable → clear it, mark changed, `dirty`. (Monotonic — bits only clear — so this provably converges. Declaration-order incrementality resolves mutual exclusion deterministically: e.g. `towing` declared before `panoramicRoof`, so `towing` survives and `panoramicRoof` is cleared.)
        - **single-select:** if `VALUES[s]` points to an unavailable option → reset to `defaultValue` if available, else the lowest-code available option; mark changed, `dirty`.
      Stop on a clean pass. Cap hit → `STATUS |= SETTLE_NOT_CONVERGED`.

      > *Optimization the assembler may enable:* if no `availableWhen`/effect condition references a computed slot (statically checkable), hoist computed-value evaluation out of the loop into (c).

   **(c) FINALIZE** — one pass over `EVAL_ORDER`: `visibleWhen` → bit0, `enabledWhen` → bit1, `min`/`max`/`step` → `FIELD_LIMITS`.

   **(d) OUTPUTS:** `OUT_VALUES[i] = evalNode(OUTPUT.exprNode)`; `OUTPUT.visibleWhenNode` result stored (JS reads it back via a convention — see below) or folded into a state slot.

   **(e) VALIDATIONS:** for each, if `evalNode(condNode) != 0` → append `{messageId, severity, targetFieldSlot}` to `MESSAGES` (bounded by `messageCap`); if `severity==error` and `targetFieldSlot>=0`, set bit2 (invalid) on that field.

   **(f)** return `STATUS`.

   > *Output visibility:* to keep OUT reads purely numeric, output `visibleWhen` is emitted as an extra entry in `FIELD_STATE_BITS` addressed by `fieldCount + outputIndex` (the assembler pre-sizes `FIELD_STATE_BITS` to `fieldCount + outputCount` and the manifest records the output-state base). JS reads bit0 there to toggle `is-hidden` on `qc-output`.

3. **JS reads back (all numeric):** `OUT_VALUES` → format by `formatCode`/`unitId`; `FIELD_STATE_BITS` → toggle `is-hidden`/`is-disabled`/`is-invalid` (+ aria) on `[data-field]`; `FIELD_LIMITS` → set control `min`/`max`/`step`; `OPTION_STATE` → enable/disable each `qc-option`; `VALUES` where bit3(forced) or bit4(changed) → write the control's value/selection and lock it (`is-forced`); `MESSAGES[0..count)` → map `messageId`→text (JS table) + severity → render `qc-message`; `STATUS != 0` → surface an engine-error banner instead of a stale quote.

No pointers or strings ever leave wasm.

### 2.6 Worked mapping of the hard cases

- **2D lookup:** `vehiclePrice` uses `LOOKUP2D(modelTrimPrice; LOAD(model), LOAD(trim))` into a baked 3×4 matrix.
- **1D lookups:** engine/wheels/colour deltas, road tax, ranges, term months, lease residual — each `LOOKUP1D(tableId; LOAD(field))`, dense code = row index.
- **Annuity (`pow`, 0%-safe):** `monthly = IF(financing==finance, P·r / (1 − (1+r)^(−n)), IF(financing==lease, lease…, 0))`, with `DIV` guarded and `POW` finiteness-checked. APR is fixed 7.9% so `r≠0`, but the guard makes any authored 0% edge safe.
- **Effect (Off-road → AWD):** `EFFECT{cond: EQ(LOAD(trim), code_offRoad), target: drivetrain, valueNode: CONST(code_awd), opKind: SET, priority: 0}`; `drivetrain.enabledWhen = NOT(EQ(trim, offRoad))` → JS locks the control (`is-forced` + `readonly`).
- **Multi-level auto-deselect:** dropping `tech` makes `driverAssist`/`premiumAudio` `availableWhen = HAS(packages, tech)` false → settle clears both bits on the next pass.

---

## 3. The model schema (summary) + full artifacts

**Full JSON Schema:** Appendix A (`model.schema.json`, draft-07). **Full vehicle model:** Appendix B (`model.json`).

One AST powers everything: `{ "op": <name>, "args": [...] }`. The same evaluator serves conditions and formulas; `if` short-circuits so hidden-field lookups are safe.

**Top level:** `id`, `version`, `currency` (required), plus `sections[]`, `fields[]` (required, ≥1), `effects[]`, `computed[]`, `tables{}`, `validations[]`, `outputs[]`.

**Field:** `id`, `type` (`choice|multichoice|number|boolean|computed`) required; optional `label`, `control` (`radio|dropdown|buttons|stepper`), `section`, `width` (`full|half|third|quarter`), `default`, `unit`, `decimals`, `min|max|step` (number **or** expr), `options[]`, `visibleWhen`, `enabledWhen`, `formula`. `choice`/`multichoice` require `options`; `computed` requires `formula`.

**Option:** `id`, `label` required; `priceDelta` (UI-facing per-option price), `availableWhen`.
**Effect:** `when`, `setField`, `toValue`.
**Computed:** `id`, `formula`; optional `currency`.
**Validation:** `when`, `message`, `severity` (`error|warning|info`); optional `id`, `field`.
**Output:** `id` (of a field/computed), `label`, `format` (`currency|number|unit|percent` + `decimals`/`unit`/`currencyCode`); optional `visibleWhen`.
**Table:** `1d` (`map: {key→number}`) or `2d` (`rows: {rowKey → {colKey→number}}`).

**exprNode ops:** `field, const, eq, ne, lt, lte, gt, gte, and, or, not, has, notHas, add, sub, mul, div, min, max, pow, if, lookup`.

**Authoritative pricing note:** option `priceDelta` values mirror the tables for UI display; the `computed[]` formulas (2D + 1D lookups, `has`, `if`, `pow`) are authoritative for totals.

---

## 4. The JS assembler (`web/assembler.mjs`)

**One shared ES module**, imported by both the runtime (`web/app.js`, in the browser) and the build gate (`scripts/validate-model.mjs`, in Node). This is the single point that turns `model.json` into the MODEL image + IO manifest, so there is exactly one layout algorithm and no two-copy drift. Pure functions, no DOM, no wasm — it emits plain typed arrays and a JS object.

### 4.1 Public surface

```js
// assembler.mjs
export function validateModel(model, schema) -> { ok, errors: [{ path, message }] }
export function assemble(model) -> {
  modelBytes: Uint8Array,          // the full MODEL blob (HEADER + all regions), ready to copy at modelBase
  ioLayout: { totalBytes, fieldCount, outputCount, optionCount, messageCap, subOffsets:{…} },
  layoutHash: number,
  manifest: Manifest               // JS-only, never enters wasm (see 4.4)
}
```

### 4.2 Responsibilities (in order)

1. **JSON-Schema validate** against `model.schema.json` (draft-07; use `ajv` or an inlined validator). Fail with `path → message`.
2. **Semantic validation** the schema can't express — each failure is `path → message`, non-zero exit at build time:
   - unknown field/option references in any expression;
   - undefined table references; wrong-arity `lookup` (1D vs 2D vs table `kind`);
   - **cycles** in the field dependency graph (Kahn leftover set);
   - bad enum values; a `control` invalid for its `type`; unknown `section` id; unknown `width` token;
   - duplicate option `id`s within a field; duplicate field/computed ids;
   - expression depth > 64; multi-select field with > 31 options.
3. **Dense codes & bits:** per choice/multichoice field, assign options `code = 0..n-1` in declaration order; `optionBit = code`. Build `optionId → {code, bit}` maps per field.
4. **Value slots:** assign a `valueSlot` to every VM "field" = model input fields **+** every `computed[]` entry **+** every `type:"computed"` field. Record `stateSlot`.
5. **Parse expressions → NODES + CHILDREN** using the op mapping (§2.2): fold variadic `add/sub/mul/min/max` into binary chains; `notHas → NOT(HAS)`; `lte→LE`, `gte→GE`; `has(field,opt)` → `HAS(aux=bit, LOAD(fieldSlot))`; `lookup` → `LOOKUP1D`/`2D` with `aux=tableId`; `field→LOAD`, `const→CONST`. Optional common-subexpression dedup. `-1` for absent optional expressions.
6. **Build record arrays** FIELDS/OPTIONS/EFFECTS/VALIDATIONS/OUTPUTS/TABLE_DIR/SECTIONS.
7. **Bake TABLE_DATA:** for each table, resolve string keys to dense indices using the option-code map of the field(s) used as the lookup key(s) (a table referenced with keys not matching that field's options, or referenced over different fields, is a build error). 2D matrix baked row-major; the `modelTrimPrice` cells are used directly (they already equal model base + trim uplift).
8. **Dependency DAG + topo sort:** nodes = value slots. For slot `F`, add edge `G→F` for every slot `G` referenced by `F`'s expressions (`visibleWhen`, `enabledWhen`, `min/max/step`, `computedValue`, and its options' `availableWhen`) and for every effect targeting `F` (edges from the effect's `cond`/`value` refs). Kahn's algorithm → `EVAL_ORDER`; leftover nodes ⇒ cycle ⇒ **hard fail** with the offending ref.
9. **Compute IO layout:** all sub-offsets, `messageCap` (bounded ring; default = `validations.length`), `settleMaxPasses`, `layoutHash` (FNV-1a over `{version, all region counts, all strides, all IO sub-offsets}`).
10. **Emit** `modelBytes` (HEADER + regions, correctly aligned/padded) and the `manifest`.

### 4.3 Effects normalization

`{ when, setField, toValue }` → `EFFECT{ condNode: parse(when), targetFieldSlot: slot(setField), valueNodeOrBit: parse(toValue), opKind: SET, priority: declarationIndex }`. `toValue: "awd"` (a string matching an option of `setField`) compiles to `CONST(code_awd)`. Auto-deselect is **not** an effect — it is the settle loop's monotonic bit-clear (§2.5b).

### 4.4 The IO manifest (JS-only)

The manifest is the JS half of the contract — it carries everything strings-and-presentation, so wasm stays numbers-only:

```
Manifest = {
  fields: [{ id, valueSlot, stateSlot, kind, control, section, width, label, help?, unit?, decimals?,
             options: [{ id, code, bit, label, priceDelta }] }],
  computed: [{ id, valueSlot }],
  outputs:  [{ id, index, formatCode, unit?, currencyCode?, decimals?, label, outputStateIndex }],
  sections: [{ id, title, order }],
  messages: { [messageId]: { text, severity, field? } },   // resolves MSG ids
  units:    { [unitId]: string }, labels: { [labelId]: string },
  currency: "GBP",
  io: { subOffsets, fieldCount, outputCount, optionCount, messageCap, statusBits: {...} }
}
```

---

## 5. The generic front-end (`web/app.js`)

### 5.1 Boot

```
1. fetch(MODEL_URL) -> model.json           // MODEL_URL = '/model.json'
2. { ok, errors } = validateModel(model, schema); if (!ok) render fatal banner, stop
3. { modelBytes, ioLayout, layoutHash, manifest } = assemble(model)
4. engine = await instantiate('quote.wasm', { env:{ abort(){}, trace(){}, seed:()=>0 } })
5. modelBase = engine.alloc(modelBytes.length);  reacquireViews()
   ioBase    = engine.alloc(ioLayout.totalBytes); reacquireViews()
6. copy modelBytes at modelBase; write HEADER; engine.loadModel(modelBase, ioBase)
7. verify HEADER magic/version/layoutHash === expected; else fatal banner
8. renderForm(manifest)          // build DOM once, per the contract (5.3)
9. seed VALUES from manifest defaults; recompute()
```

`reacquireViews()` rebuilds `u8/i32/u32/f64` views on `engine.memory.buffer` (defensive; memory is pre-sized so it won't grow after boot).

### 5.2 Reactive loop

```
form.addEventListener('input',  scheduleRecompute)
form.addEventListener('change', scheduleRecompute)   // scheduleRecompute debounces to rAF

recompute():
  writeValues(manifest)          // controls -> VALUES (single=code, multi=OR of bits, num/bool=f64)
  status = engine.evaluate()
  paint(status)
```

There is **no JS-side normalize loop** — the engine's settle phase owns all forced values, auto-deselect, and single-select fallback. JS only mirrors the result.

### 5.3 Render once, from the manifest

Fields render at boot in model order, grouped by section; the paint pass never adds/removes fields. The engine emits the **stable DOM contract** below; the paint pass only toggles state, attributes, limits, values, and messages.

**Root / sections / summary:**
```html
<form class="qc" data-model="vehicle-configurator" autocomplete="off">
  <section class="qc-section" data-section="s_powertrain">
    <h2 class="qc-section__title">Powertrain &amp; drivetrain</h2>
    <div class="qc-section__body"><!-- fields in model order --></div>
  </section>
  <aside class="qc-summary" aria-live="polite">
    <div class="qc-messages" data-role="messages"></div>
    <div class="qc-outputs"><!-- outputs + total --></div>
  </aside>
</form>
```

**Field wrapper (every type):** `qc-field qc-field--<type> qc-field--w-<width>` with `data-field`, `data-type`, `data-control`, `data-width`; label (`for`/`id` for single native controls, `aria-labelledby` for grouped controls); optional `qc-field__help`; `qc-field__control`; inline `qc-field__error[data-field-error]`.

**Controls by (`type`,`control`):**
- `choice` → `radio` (`role=radiogroup` + `qc-option`s, default ≤6 options), `dropdown` (`qc-select`, default >6), `buttons` (`qc-buttons` segmented + a hidden input carrying the value).
- `multichoice` → `checkboxes` (default, `qc-option`s) or `buttons` (`qc-buttons--multi` chips, `aria-pressed`).
- `number` → `input` (`qc-input`, default) or `stepper` (`qc-stepper` with ± buttons + `qc-field__affix`).
- `boolean` → `switch` (`qc-switch`, default) or `checkbox` (`qc-check`).

Per-option `availableWhen` false ⇒ option kept in place with `is-disabled` + `disabled`/`aria-disabled` (+ optional `[data-role="reason"]`), never removed. Each `qc-option`/`qc-button` carries `data-value="<optionId>"`.

**Outputs / total / messages:** `qc-output[data-output][data-format]` with `qc-output__label` + `qc-output__value[data-role="value"]`; the emphasised output also gets `qc-total`. `qc-messages` holds one `qc-message qc-message--{error|warn|info}[data-severity][data-field]` per active rule, ordered error → warn → info.

### 5.4 Paint pass (the only DOM mutation)

| Read from IO | Applied to DOM |
|---|---|
| `OUT_VALUES[i]` | `[data-output].qc-output__value` text via `Intl.NumberFormat` per `formatCode`/`unit`/`currencyCode`/`decimals` |
| output-state bit0 | `is-hidden` on `qc-output` (e.g. monthly hidden for Cash) |
| `FIELD_STATE_BITS` bit0/1/2/3/4 | `is-hidden` / `is-disabled`(+`disabled`/`aria-disabled`) / `is-invalid`(+`aria-invalid`) / `is-forced`(+`readonly`/`aria-readonly`) on `[data-field]` |
| `FIELD_LIMITS[3*slot..]` | control `min`/`max`/`step` attributes (the live hook) |
| `OPTION_STATE[byte]` | per `qc-option`/`qc-button`: `is-disabled` + native disabled/`aria-disabled`; `is-selected` + `checked`/`aria-checked`/`aria-pressed` from `VALUES` |
| `VALUES` where bit3/bit4 set | write the control's value/selection and lock it (Off-road→AWD, dropped packages) |
| `MESSAGES[0..count)` | render `qc-message` (text from `manifest.messages`), and flip targeted field to `is-invalid` + un-hide its `qc-field__error` |
| `STATUS != 0` | replace the quote with an engine-error banner (never show a stale total) |

### 5.5 Theming contract (designer-facing)

- **Two stylesheets:** engine-owned `web/qc-base.css` (structural; references only `--qc-*` tokens) and designer-owned `web/theme.css` (tokens + skins). Link `qc-base.css` **then** `theme.css`.
- **Tokens:** `--qc-color-*`, `--qc-font-*`, `--qc-space-*`, `--qc-radius-*`, borders/effects — full light+dark tables are the shipped defaults from the theming spec.
- **Three-way theme state:** default follows OS via `@media (prefers-color-scheme: dark)` guarded `:root:not([data-theme="light"])`; explicit `data-theme="light|dark"` on `<html>` wins both ways. **Skins** = named token sets under `:root[data-skin="…"]`, switched via `data-skin` on `<html>`, no markup change.
- **Contract designers may rely on:** the `qc-*` block classes, `qc-field--<type>`/`--w-<width>`, `qc-message--{error|warn|info}`, state classes (`is-hidden/-disabled/-invalid/-selected/-forced/-computed/-required`), and data hooks (`data-field/-section/-control/-value/-output/-format/-unit/-severity/-role`). **Never** select by tag or `nth-child` — element order beyond the contract is not guaranteed.
- **Coarse width → span request:** `qc-section__body` is a CSS grid (`repeat(6,1fr)`); `--w-full/-half/-third` map to `span 6/3/2`; CSS collapses to one column at narrow widths. The model can never name a colour, font, px, class, or breakpoint.

---

## 6. Deploy a new model

Publishing a model **does not rebuild the engine**. `quote.wasm` is model-agnostic and compiled once by the git build; a model change replaces data behind one URL.

1. **Edit `model.json`, guided by the schema.** First key `"$schema": "./model.schema.json"` gives editors autocomplete + inline validation for types, control enums, width tokens, expression ops, and table shapes.
2. **Build validation (fails clearly, before deploy).** `npm run build` runs `scripts/validate-model.mjs` **first** — schema validation plus the semantic checks in §4.2. Any failure prints `path → message` and exits non-zero, which **stops the Cloudflare Pages build**; a broken model never reaches production. Only on success does the build assemble `dist/`.
3. **Push to `main`.** Cloudflare Pages runs `npm run build` with Node pinned by `.nvmrc` (22) and publishes `dist/` (`pages_build_output_dir` in `wrangler.jsonc`). Live at **https://quote.rowblaa.com** within a minute or two (custom domain already wired; DNS/TLS auto-managed). Manual path: `npm run deploy` (wrangler).
4. **Single-URL fetch (and the KV repoint later).**
   ```js
   const MODEL_URL = '/model.json'; // Phase 1: static asset in dist/
   ```
   - **Phase 1:** `model.json` is a static asset; publishing = commit + push (through the build gate) or replace the file.
   - **Phase 2 (KV/R2):** point `MODEL_URL` at a route backed by a tiny Pages Function reading a KV key; publishing becomes a **KV write** (no engine rebuild, no site redeploy). Keep the URL constant unchanged; run the same `assembler.validateModel` as a pre-write gate so KV-published models get identical safety. The wasm and DOM contract are identical across both phases, so preview and production stay in lock-step.

**Restyling** is decoupled: `theme.css` is a static asset a designer edits and pushes (or swaps) without touching `model.json`, `app.js`, or the wasm.

---

## 7. Parity test plan

Extend `test/quote.test.mjs` into a **golden-vector suite** run with `node --test` (the `pretest` script builds `build/quote.wasm` first). The harness does the *real* pipeline — no shortcuts:

```js
// test harness shape
import { readFile } from 'node:fs/promises';
import { assemble } from '../web/assembler.mjs';
const model  = JSON.parse(await readFile('web/model.json','utf8'));
const { modelBytes, ioLayout, manifest } = assemble(model);
const { instance } = await WebAssembly.instantiate(await readFile('build/quote.wasm'),
  { env:{ abort(){}, trace(){}, seed:()=>0 } });
const e = instance.exports;
// alloc + write blobs + loadModel exactly as app.js does (share a tiny loader helper)

function quote(inputs) {
  writeValues(e, manifest, inputs);   // ids -> VALUES (single=code, multi=OR of bits)
  const status = e.evaluate();
  return { status, out: readOutputs(e, manifest), state: readStateBits(e, manifest),
           values: readValues(e, manifest), options: readOptionState(e, manifest),
           messages: readMessages(e, manifest) };
}
const near = (a,b,eps=0.02) => Math.abs(a-b) <= eps;
```

Assert against the four worked examples (values are the authoritative `computed[]` results; money compared before JS formatting, tolerance ±£0.02, range raw before rounding):

| # | Config (abbrev.) | vehiclePrice | otr | monthly | range (raw) | Also asserts |
|---|---|---|---|---|---|---|
| 1 | City/Standard, P1.5, FWD, 17″, Solid, none, **Cash** | 22000.00 | 23190.00 | monthly output `is-hidden` | 500.0 | Cash hides monthly; 2D lookup city/standard |
| 2 | Trail/**Off-road**, Hybrid, (AWD forced), 18″, Metallic, {Winter,Tech,Towing}, **Finance** t48, dep 5000 | 43350.00 | 44500.00 | **962.46** | 558.6 | Off-road→AWD `is-forced`+drivetrain disabled; Towing available; deposit min 4450 ≤ 5000; `pow` annuity |
| 3 | Cruiser/Sport, 2.0T, AWD, 19″, Matte, {Tech,Performance,DriverAssist,PremiumAudio}, **Finance** t36, dep=10% OTR (4429) | 43100.00 | 44290.00 | **1247.25** | 389.88 | Performance prereqs (Sport+turbo+≥19″); Matte on Sport; dynamic deposit min via expr |
| 4 | Cruiser/Luxury, Electric, AWD, 20″, Premium, {Winter,Tech,PremiumAudio,PanoramicRoof}, **Lease** t36, mileage 15000 | 46700.00 | 47700.00 | **847.95** | 267.9 | Electric not-on-Trail ok; Panoramic/Towing exclusion; lease formula; 20″ info message |

**Additional targeted vectors:**
- **1D deltas:** each trim/engine/wheel/colour delta isolated against a baseline.
- **2D price matrix:** all 3×4 model×trim cells.
- **Annuity edges:** normal 7.9% APR (Ex 2/3) **and** an authored 0% APR case → `DIV` guard returns finite, no `NAN_INF`.
- **Off-road→AWD forced:** `VALUES[drivetrain]==awd`, bit3 set, `enabledWhen`=false.
- **Multi-level auto-deselect chain:** select {tech, driverAssist, premiumAudio}, then remove tech → both auto-clear in one `evaluate()`; `VALUES[packages]` mask has only prior unrelated bits; `STATUS` clean.
- **Towing↔Panoramic exclusion:** attempt both → declaration order keeps `towing`, clears `panoramicRoof`.
- **Deposit min/max validation:** dep < 10%·OTR → `deposit_min` error + field `is-invalid`; dep > OTR → `deposit_max` error.
- **Performance prereqs negative:** Sport+turbo+18″ → Performance `OPTION_STATE`=0; if previously selected → auto-cleared.
- **STATUS hygiene:** every vector asserts `status === 0` unless it intentionally exercises a guard.

Keep the existing `near()` style; run exactly as today against `build/quote.wasm`.

---

## 8. File-by-file build checklist

Paths are absolute-from-repo-root (`C:\Users\rossh\Development\wasm-calculator\`). Status: **NEW** / **REWRITE** / **MODIFY** / **KEEP**.

| Path | Status | Purpose / work |
|---|---|---|
| `assembly/quote.ts` | **REWRITE** | Replace the apparel domain engine with the QCM1 VM: `alloc(n)`, `loadModel(modelBase,ioBase)` (stash bases, read HEADER sub-offsets), `evaluate():i32` (reset → settle → finalize → outputs → validations), and `evalNode(idx):f64` (the §2.2 switch). Guarded `DIV`/`POW`/`LOOKUP`; STATUS bitfield; depth cap 64. No classes/GC on the hot path. |
| `assembly/tsconfig.json` | **KEEP** | AS TS config. |
| `asconfig.json` | **MODIFY** | Keep `runtime: "stub"`, `exportStart: false`, `optimizeLevel 3`. Ensure `memory` is exported (default) and `alloc` reachable. Consider `initialMemory`/`maximumMemory` sized generously (blobs are low-KB; pre-sizing avoids hot-path growth). Keep `noAssert:false` for debug, may set true for release. |
| `web/assembler.mjs` | **NEW** | Shared assembler core (§4): `validateModel`, `assemble`. Imported by both `web/app.js` and `scripts/validate-model.mjs`. Pure ES module, no DOM/wasm. |
| `web/model.schema.json` | **NEW** | Appendix A verbatim. Ships to `dist/` for editor autocomplete + build validation. |
| `web/model.json` | **NEW** | Appendix B verbatim. The Phase-1 vehicle model; fetched at runtime as `/model.json`. |
| `web/app.js` | **REWRITE** | Generic front-end (§5): boot (fetch→validate→assemble→instantiate→loadModel→verify), `renderForm(manifest)` (DOM contract), reactive loop (rAF-debounced `writeValues`→`evaluate`→`paint`), paint pass, `Intl.NumberFormat` formatting, engine-error banner. Remove all apparel-specific enums/flags. |
| `web/qc-base.css` | **NEW** | Engine-owned structural CSS: `qc-*` layout, section grid, control structure, state-class behavior — references only `--qc-*` tokens. No brand colours. |
| `web/theme.css` | **NEW** | Designer-owned tokens (full light + dark palettes), the `data-theme` three-way handling, and at least one example skin. |
| `web/index.html` | **REWRITE** | Minimal shell: `<head>` links `qc-base.css` then `theme.css`; `<body>` has the `<form class="qc">` mount region (or an empty root `app.js` fills), a theme/skin toggle, and `<script src="app.js" type="module">`. Drop apparel markup. |
| `web/styles.css` | **DELETE** | Superseded by `qc-base.css` + `theme.css` (remove from `FILES`). |
| `scripts/validate-model.mjs` | **NEW** | Build gate CLI: read `web/model.json` + `web/model.schema.json`, run `validateModel` + a trial `assemble` (catches cycles/arity/depth/mask), print `path → message`, `process.exit(1)` on any failure. |
| `scripts/build-site.mjs` | **MODIFY** | Update `FILES` to copy: `index.html`, `app.js`, `assembler.mjs`, `model.json`, `model.schema.json`, `qc-base.css`, `theme.css`, `quote.wasm`. Remove `styles.css`. |
| `package.json` | **MODIFY** | `"build": "npm run validate:model && npm run asbuild:release && npm run build:site"`; add `"validate:model": "node scripts/validate-model.mjs"`; keep `pretest`/`test`/`start`/`serve`/`preview`/`deploy`. Add `ajv` (or inline validator) to devDependencies if used. |
| `test/quote.test.mjs` | **REWRITE** | Golden-vector suite (§7): assemble `web/model.json`, load `build/quote.wasm`, run the 4 worked examples + targeted vectors. |
| `server.mjs` | **KEEP** | Flat-URL dev server already serves `.json`/`.wasm` with correct MIME and searches `web/` then `build/`; `model.json`, `assembler.mjs`, `qc-base.css`, `theme.css`, `model.schema.json` all resolve from `web/`. No change needed. |
| `wrangler.jsonc` | **KEEP** (Phase 1) | Static Pages config. Phase 2: add a Pages Function + KV binding to serve `/model.json` from KV. |
| `.nvmrc` | **KEEP** | Node 22. |
| `.gitignore` | **KEEP/MODIFY** | Ensure `dist/` and `build/` handling matches intent. |
| `README.md` | **MODIFY** | Document the three layers, the assemble→loadModel→evaluate flow, the deploy-a-model flow, and the theming contract. |
| `build/quote.wasm` | **GENERATED** | Output of `asbuild:release`. |
| `dist/*` | **GENERATED** | Output of `build:site`; the Pages publish dir. |

**Build order (must hold for CI/Pages):** `validate:model` → `asbuild:release` → `build:site`. An invalid model fails at step 1 and never produces a `dist/`.

---

## Appendix A — `model.schema.json` (draft-07)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://quote.rowblaa.com/schema/model.schema.json",
  "title": "CPQ Quote Model",
  "description": "Declarative, model-agnostic quote/configurator description consumed by the WASM VM.",
  "type": "object",
  "required": ["id", "version", "currency", "fields"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "id": { "type": "string", "pattern": "^[a-zA-Z0-9_.-]+$" },
    "name": { "type": "string" },
    "version": { "type": "string" },
    "currency": { "type": "string", "description": "ISO 4217 code, e.g. GBP." },
    "sections": { "type": "array", "items": { "$ref": "#/definitions/section" } },
    "fields": { "type": "array", "minItems": 1, "items": { "$ref": "#/definitions/field" } },
    "effects": { "type": "array", "items": { "$ref": "#/definitions/effect" } },
    "computed": { "type": "array", "items": { "$ref": "#/definitions/computed" } },
    "tables": {
      "type": "object",
      "additionalProperties": { "$ref": "#/definitions/table" }
    },
    "validations": { "type": "array", "items": { "$ref": "#/definitions/validation" } },
    "outputs": { "type": "array", "items": { "$ref": "#/definitions/output" } }
  },

  "definitions": {

    "section": {
      "type": "object",
      "required": ["id", "label"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "label": { "type": "string" },
        "order": { "type": "integer" }
      }
    },

    "field": {
      "type": "object",
      "required": ["id", "type"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-zA-Z0-9_]+$" },
        "label": { "type": "string" },
        "type": { "enum": ["choice", "multichoice", "number", "boolean", "computed"] },
        "control": { "enum": ["radio", "dropdown", "buttons", "stepper"] },
        "section": { "type": "string" },
        "width": { "enum": ["full", "half", "third", "quarter"] },
        "default": { "type": ["number", "string", "boolean", "array", "null"] },
        "unit": { "type": "string" },
        "decimals": { "type": "integer", "minimum": 0 },
        "min": { "$ref": "#/definitions/numberOrExpr" },
        "max": { "$ref": "#/definitions/numberOrExpr" },
        "step": { "$ref": "#/definitions/numberOrExpr" },
        "options": { "type": "array", "items": { "$ref": "#/definitions/option" } },
        "visibleWhen": { "$ref": "#/definitions/expr" },
        "enabledWhen": { "$ref": "#/definitions/expr" },
        "formula": { "$ref": "#/definitions/expr" }
      },
      "allOf": [
        {
          "if": { "properties": { "type": { "enum": ["choice", "multichoice"] } } },
          "then": { "required": ["options"] }
        },
        {
          "if": { "properties": { "type": { "const": "computed" } } },
          "then": { "required": ["formula"] }
        }
      ]
    },

    "option": {
      "type": "object",
      "required": ["id", "label"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "label": { "type": "string" },
        "priceDelta": { "type": "number", "default": 0 },
        "availableWhen": { "$ref": "#/definitions/expr" }
      }
    },

    "effect": {
      "type": "object",
      "required": ["when", "setField", "toValue"],
      "additionalProperties": false,
      "properties": {
        "when": { "$ref": "#/definitions/expr" },
        "setField": { "type": "string" },
        "toValue": { "$ref": "#/definitions/expr" }
      }
    },

    "computed": {
      "type": "object",
      "required": ["id", "formula"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-zA-Z0-9_]+$" },
        "label": { "type": "string" },
        "formula": { "$ref": "#/definitions/expr" },
        "currency": {
          "type": ["boolean", "string"],
          "description": "true = format in model currency; or an explicit ISO 4217 code."
        }
      }
    },

    "validation": {
      "type": "object",
      "required": ["when", "message", "severity"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "field": { "type": "string" },
        "when": { "$ref": "#/definitions/expr" },
        "message": { "type": "string" },
        "severity": { "enum": ["error", "warning", "info"] }
      }
    },

    "output": {
      "type": "object",
      "required": ["id", "label", "format"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "description": "id of a field or computed value to read." },
        "label": { "type": "string" },
        "format": { "$ref": "#/definitions/format" },
        "visibleWhen": { "$ref": "#/definitions/expr" }
      }
    },

    "format": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": { "enum": ["currency", "number", "unit", "percent"] },
        "decimals": { "type": "integer", "minimum": 0 },
        "unit": { "type": "string" },
        "currencyCode": { "type": "string" }
      }
    },

    "table": {
      "oneOf": [
        {
          "type": "object",
          "required": ["kind", "map"],
          "additionalProperties": false,
          "properties": {
            "kind": { "const": "1d" },
            "map": { "type": "object", "additionalProperties": { "type": "number" } }
          }
        },
        {
          "type": "object",
          "required": ["kind", "rows"],
          "additionalProperties": false,
          "properties": {
            "kind": { "const": "2d" },
            "rows": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "additionalProperties": { "type": "number" }
              }
            }
          }
        }
      ]
    },

    "numberOrExpr": {
      "oneOf": [
        { "type": "number" },
        { "type": "string", "description": "Optional expression-string form (engine may parse to AST)." },
        { "$ref": "#/definitions/exprNode" }
      ]
    },

    "expr": {
      "oneOf": [
        { "type": "number" },
        { "type": "string" },
        { "type": "boolean" },
        { "$ref": "#/definitions/exprNode" }
      ]
    },

    "exprNode": {
      "type": "object",
      "required": ["op", "args"],
      "additionalProperties": false,
      "properties": {
        "op": {
          "enum": [
            "field", "const",
            "eq", "ne", "lt", "lte", "gt", "gte",
            "and", "or", "not",
            "has", "notHas",
            "add", "sub", "mul", "div", "min", "max", "pow",
            "if", "lookup"
          ]
        },
        "args": {
          "type": "array",
          "items": { "$ref": "#/definitions/expr" }
        }
      },
      "description": "AST node. field:[fieldId]; const:[value]; comparisons:[a,b]; and/or:[..]; not:[cond]; has/notHas:[fieldId,optionId]; add/sub/mul/div/min/max:[..]; pow:[base,exp]; if:[cond,then,else] (short-circuits); lookup:[tableId,key] (1D) or [tableId,rowKey,colKey] (2D)."
    }
  }
}
```

---

## Appendix B — `model.json` (vehicle configurator, v1.0.0)

```json
{
  "$schema": "https://quote.rowblaa.com/schema/model.schema.json",
  "id": "vehicle-configurator",
  "name": "Vehicle Configurator",
  "version": "1.0.0",
  "currency": "GBP",

  "sections": [
    { "id": "s_model", "label": "Model & trim", "order": 1 },
    { "id": "s_powertrain", "label": "Powertrain & drivetrain", "order": 2 },
    { "id": "s_appearance", "label": "Wheels & appearance", "order": 3 },
    { "id": "s_packages", "label": "Packages", "order": 4 },
    { "id": "s_finance", "label": "Payment", "order": 5 }
  ],

  "fields": [
    {
      "id": "model", "label": "Model", "type": "choice", "control": "buttons",
      "section": "s_model", "width": "full", "default": "city",
      "options": [
        { "id": "city", "label": "City (hatch)", "priceDelta": 22000 },
        { "id": "cruiser", "label": "Cruiser (sedan)", "priceDelta": 27000 },
        { "id": "trail", "label": "Trail (SUV)", "priceDelta": 31000 }
      ]
    },
    {
      "id": "trim", "label": "Trim", "type": "choice", "control": "buttons",
      "section": "s_model", "width": "full", "default": "standard",
      "options": [
        { "id": "standard", "label": "Standard", "priceDelta": 0 },
        { "id": "sport", "label": "Sport", "priceDelta": 3500 },
        { "id": "luxury", "label": "Luxury", "priceDelta": 6000 },
        {
          "id": "offRoad", "label": "Off-road", "priceDelta": 4500,
          "availableWhen": { "op": "eq", "args": [ { "op": "field", "args": ["model"] }, "trail" ] }
        }
      ]
    },
    {
      "id": "engine", "label": "Engine", "type": "choice", "control": "radio",
      "section": "s_powertrain", "width": "full", "default": "petrol15",
      "options": [
        {
          "id": "petrol15", "label": "Petrol 1.5", "priceDelta": 0,
          "availableWhen": { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] } ] }
        },
        {
          "id": "petrol20turbo", "label": "Petrol 2.0 Turbo", "priceDelta": 2500,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "sport" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "luxury" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] }
          ] }
        },
        { "id": "hybrid", "label": "Hybrid", "priceDelta": 3000 },
        {
          "id": "electric", "label": "Electric", "priceDelta": 6000,
          "availableWhen": { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["model"] }, "trail" ] } ] }
        }
      ]
    },
    {
      "id": "drivetrain", "label": "Drivetrain", "type": "choice", "control": "buttons",
      "section": "s_powertrain", "width": "full", "default": "fwd",
      "enabledWhen": { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] } ] },
      "options": [
        {
          "id": "fwd", "label": "Front-wheel drive", "priceDelta": 0,
          "availableWhen": { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] } ] }
        },
        {
          "id": "awd", "label": "All-wheel drive", "priceDelta": 0,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["engine"] }, "petrol20turbo" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["engine"] }, "electric" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] }
          ] }
        }
      ]
    },
    {
      "id": "wheels", "label": "Wheels", "type": "choice", "control": "buttons",
      "section": "s_appearance", "width": "full", "default": "w17",
      "options": [
        {
          "id": "w17", "label": "17-inch", "priceDelta": 0,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "standard" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] }
          ] }
        },
        {
          "id": "w18", "label": "18-inch", "priceDelta": 600,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "standard" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "sport" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] }
          ] }
        },
        {
          "id": "w19", "label": "19-inch", "priceDelta": 1200,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "sport" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "luxury" ] }
          ] }
        },
        {
          "id": "w20", "label": "20-inch", "priceDelta": 1800,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "sport" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "luxury" ] }
          ] }
        }
      ]
    },
    {
      "id": "colour", "label": "Colour", "type": "choice", "control": "dropdown",
      "section": "s_appearance", "width": "half", "default": "solid",
      "options": [
        { "id": "solid", "label": "Solid", "priceDelta": 0 },
        { "id": "metallic", "label": "Metallic", "priceDelta": 650 },
        { "id": "premium", "label": "Premium", "priceDelta": 900 },
        {
          "id": "matte", "label": "Matte", "priceDelta": 1200,
          "availableWhen": { "op": "or", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "sport" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "luxury" ] }
          ] }
        }
      ]
    },
    {
      "id": "packages", "label": "Packages", "type": "multichoice", "control": "buttons",
      "section": "s_packages", "width": "full", "default": [],
      "options": [
        { "id": "winter", "label": "Winter", "priceDelta": 800 },
        { "id": "tech", "label": "Tech", "priceDelta": 1500 },
        {
          "id": "driverAssist", "label": "Driver-Assist", "priceDelta": 1900,
          "availableWhen": { "op": "has", "args": ["packages", "tech"] }
        },
        {
          "id": "premiumAudio", "label": "Premium Audio", "priceDelta": 1100,
          "availableWhen": { "op": "has", "args": ["packages", "tech"] }
        },
        {
          "id": "performance", "label": "Performance", "priceDelta": 3200,
          "availableWhen": { "op": "and", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "sport" ] },
            { "op": "or", "args": [
              { "op": "eq", "args": [ { "op": "field", "args": ["engine"] }, "petrol20turbo" ] },
              { "op": "eq", "args": [ { "op": "field", "args": ["engine"] }, "electric" ] }
            ] },
            { "op": "or", "args": [
              { "op": "eq", "args": [ { "op": "field", "args": ["wheels"] }, "w19" ] },
              { "op": "eq", "args": [ { "op": "field", "args": ["wheels"] }, "w20" ] }
            ] }
          ] }
        },
        {
          "id": "towing", "label": "Towing", "priceDelta": 1300,
          "availableWhen": { "op": "and", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["model"] }, "trail" ] },
            { "op": "eq", "args": [ { "op": "field", "args": ["drivetrain"] }, "awd" ] },
            { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["wheels"] }, "w20" ] } ] },
            { "op": "notHas", "args": ["packages", "panoramicRoof"] }
          ] }
        },
        {
          "id": "panoramicRoof", "label": "Panoramic Roof", "priceDelta": 1600,
          "availableWhen": { "op": "and", "args": [
            { "op": "notHas", "args": ["packages", "towing"] },
            { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] } ] }
          ] }
        }
      ]
    },
    {
      "id": "financing", "label": "Payment method", "type": "choice", "control": "buttons",
      "section": "s_finance", "width": "full", "default": "cash",
      "options": [
        { "id": "cash", "label": "Cash", "priceDelta": 0 },
        { "id": "finance", "label": "Finance", "priceDelta": 0 },
        { "id": "lease", "label": "Lease", "priceDelta": 0 }
      ]
    },
    {
      "id": "term", "label": "Term (months)", "type": "choice", "control": "buttons",
      "section": "s_finance", "width": "half", "default": "t36",
      "visibleWhen": { "op": "or", "args": [
        { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "finance" ] },
        { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "lease" ] }
      ] },
      "options": [
        { "id": "t24", "label": "24", "priceDelta": 0 },
        { "id": "t36", "label": "36", "priceDelta": 0 },
        { "id": "t48", "label": "48", "priceDelta": 0 },
        { "id": "t60", "label": "60", "priceDelta": 0 }
      ]
    },
    {
      "id": "deposit", "label": "Deposit", "type": "number", "control": "stepper",
      "section": "s_finance", "width": "half", "unit": "GBP", "decimals": 0, "step": 100,
      "min": { "op": "mul", "args": [ { "op": "field", "args": ["otr"] }, 0.1 ] },
      "max": { "op": "field", "args": ["otr"] },
      "visibleWhen": { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "finance" ] }
    },
    {
      "id": "annualMileage", "label": "Annual mileage", "type": "number", "control": "stepper",
      "section": "s_finance", "width": "half", "unit": "mi", "decimals": 0,
      "min": 5000, "max": 30000, "step": 1000, "default": 10000,
      "visibleWhen": { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "lease" ] }
    }
  ],

  "effects": [
    {
      "when": { "op": "eq", "args": [ { "op": "field", "args": ["trim"] }, "offRoad" ] },
      "setField": "drivetrain",
      "toValue": "awd"
    }
  ],

  "tables": {
    "modelTrimPrice": {
      "kind": "2d",
      "rows": {
        "city":    { "standard": 22000, "sport": 25500, "luxury": 28000, "offRoad": 26500 },
        "cruiser": { "standard": 27000, "sport": 30500, "luxury": 33000, "offRoad": 31500 },
        "trail":   { "standard": 31000, "sport": 34500, "luxury": 37000, "offRoad": 35500 }
      }
    },
    "engineDelta": { "kind": "1d", "map": { "petrol15": 0, "petrol20turbo": 2500, "hybrid": 3000, "electric": 6000 } },
    "wheelsDelta": { "kind": "1d", "map": { "w17": 0, "w18": 600, "w19": 1200, "w20": 1800 } },
    "colourDelta": { "kind": "1d", "map": { "solid": 0, "metallic": 650, "premium": 900, "matte": 1200 } },
    "roadTax":     { "kind": "1d", "map": { "petrol15": 190, "petrol20turbo": 190, "hybrid": 150, "electric": 0 } },
    "engineRange": { "kind": "1d", "map": { "petrol15": 500, "petrol20turbo": 450, "hybrid": 600, "electric": 300 } },
    "wheelRangeFactor": { "kind": "1d", "map": { "w17": 1.0, "w18": 0.98, "w19": 0.96, "w20": 0.94 } },
    "termMonths":  { "kind": "1d", "map": { "t24": 24, "t36": 36, "t48": 48, "t60": 60 } },
    "leaseResidual": { "kind": "1d", "map": { "t24": 0.62, "t36": 0.55, "t48": 0.48, "t60": 0.42 } }
  },

  "computed": [
    {
      "id": "packagesTotal", "label": "Packages total",
      "formula": { "op": "add", "args": [
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "winter"] }, 800, 0 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "tech"] }, 1500, 0 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "driverAssist"] }, 1900, 0 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "premiumAudio"] }, 1100, 0 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "performance"] }, 3200, 0 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "towing"] }, 1300, 0 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "panoramicRoof"] }, 1600, 0 ] }
      ] }
    },
    {
      "id": "vehiclePrice", "label": "Vehicle price", "currency": true,
      "formula": { "op": "add", "args": [
        { "op": "lookup", "args": ["modelTrimPrice", { "op": "field", "args": ["model"] }, { "op": "field", "args": ["trim"] }] },
        { "op": "lookup", "args": ["engineDelta", { "op": "field", "args": ["engine"] }] },
        { "op": "lookup", "args": ["wheelsDelta", { "op": "field", "args": ["wheels"] }] },
        { "op": "lookup", "args": ["colourDelta", { "op": "field", "args": ["colour"] }] },
        { "op": "field", "args": ["packagesTotal"] }
      ] }
    },
    {
      "id": "roadTax", "label": "Road tax",
      "formula": { "op": "lookup", "args": ["roadTax", { "op": "field", "args": ["engine"] }] }
    },
    {
      "id": "feesTotal", "label": "Fees", "currency": true,
      "formula": { "op": "add", "args": [ 700, 300, { "op": "field", "args": ["roadTax"] } ] }
    },
    {
      "id": "otr", "label": "On-the-road total", "currency": true,
      "formula": { "op": "add", "args": [ { "op": "field", "args": ["vehiclePrice"] }, { "op": "field", "args": ["feesTotal"] } ] }
    },
    {
      "id": "monthlyPayment", "label": "Monthly payment", "currency": true,
      "formula": {
        "op": "if",
        "args": [
          { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "finance" ] },
          { "op": "div", "args": [
            { "op": "mul", "args": [
              { "op": "sub", "args": [ { "op": "field", "args": ["otr"] }, { "op": "field", "args": ["deposit"] } ] },
              { "op": "div", "args": [ 0.079, 12 ] }
            ] },
            { "op": "sub", "args": [
              1,
              { "op": "pow", "args": [
                { "op": "add", "args": [ 1, { "op": "div", "args": [ 0.079, 12 ] } ] },
                { "op": "mul", "args": [ -1, { "op": "lookup", "args": ["termMonths", { "op": "field", "args": ["term"] }] } ] }
              ] }
            ] }
          ] },
          { "op": "if", "args": [
            { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "lease" ] },
            { "op": "add", "args": [
              { "op": "div", "args": [
                { "op": "sub", "args": [
                  { "op": "field", "args": ["otr"] },
                  { "op": "mul", "args": [ { "op": "field", "args": ["otr"] }, { "op": "lookup", "args": ["leaseResidual", { "op": "field", "args": ["term"] }] } ] }
                ] },
                { "op": "lookup", "args": ["termMonths", { "op": "field", "args": ["term"] }] }
              ] },
              { "op": "mul", "args": [
                { "op": "add", "args": [
                  { "op": "field", "args": ["otr"] },
                  { "op": "mul", "args": [ { "op": "field", "args": ["otr"] }, { "op": "lookup", "args": ["leaseResidual", { "op": "field", "args": ["term"] }] } ] }
                ] },
                { "op": "div", "args": [ 0.079, 24 ] }
              ] },
              { "op": "mul", "args": [
                { "op": "max", "args": [ 0, { "op": "sub", "args": [ { "op": "field", "args": ["annualMileage"] }, 10000 ] } ] },
                { "op": "div", "args": [ 0.02, 12 ] }
              ] }
            ] },
            0
          ] }
        ]
      }
    },
    {
      "id": "range", "label": "Range / economy",
      "formula": { "op": "mul", "args": [
        { "op": "lookup", "args": ["engineRange", { "op": "field", "args": ["engine"] }] },
        { "op": "lookup", "args": ["wheelRangeFactor", { "op": "field", "args": ["wheels"] }] },
        { "op": "if", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["drivetrain"] }, "awd" ] }, 0.95, 1 ] },
        { "op": "if", "args": [ { "op": "has", "args": ["packages", "performance"] }, 0.95, 1 ] }
      ] }
    }
  ],

  "validations": [
    {
      "id": "deposit_min", "field": "deposit", "severity": "error",
      "message": "Deposit must be at least 10% of the on-the-road price.",
      "when": { "op": "and", "args": [
        { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "finance" ] },
        { "op": "lt", "args": [ { "op": "field", "args": ["deposit"] }, { "op": "mul", "args": [ { "op": "field", "args": ["otr"] }, 0.1 ] } ] }
      ] }
    },
    {
      "id": "deposit_max", "field": "deposit", "severity": "error",
      "message": "Deposit cannot exceed the on-the-road price.",
      "when": { "op": "and", "args": [
        { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "finance" ] },
        { "op": "gt", "args": [ { "op": "field", "args": ["deposit"] }, { "op": "field", "args": ["otr"] } ] }
      ] }
    },
    {
      "id": "mileage_high", "field": "annualMileage", "severity": "warning",
      "message": "High annual mileage significantly increases lease cost.",
      "when": { "op": "and", "args": [
        { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "lease" ] },
        { "op": "gt", "args": [ { "op": "field", "args": ["annualMileage"] }, 15000 ] }
      ] }
    },
    {
      "id": "big_wheels_info", "field": "wheels", "severity": "info",
      "message": "20-inch wheels increase price and reduce range.",
      "when": { "op": "eq", "args": [ { "op": "field", "args": ["wheels"] }, "w20" ] }
    }
  ],

  "outputs": [
    { "id": "vehiclePrice", "label": "Vehicle price", "format": { "type": "currency", "decimals": 2, "currencyCode": "GBP" } },
    { "id": "otr", "label": "On-the-road total", "format": { "type": "currency", "decimals": 2, "currencyCode": "GBP" } },
    {
      "id": "monthlyPayment", "label": "Monthly payment",
      "format": { "type": "currency", "decimals": 2, "currencyCode": "GBP" },
      "visibleWhen": { "op": "not", "args": [ { "op": "eq", "args": [ { "op": "field", "args": ["financing"] }, "cash" ] } ] }
    },
    { "id": "range", "label": "Range / economy", "format": { "type": "unit", "unit": "mi", "decimals": 0 } }
  ]
}
```

**Documented open-decision formulas (already baked into `computed[]`):**
- **Lease monthly** = `(OTR − residual)/n + (OTR + residual)·MF + excessMileageSurcharge`, where `residual = OTR × leaseResidual(term)`, `MF = APR/24 = 0.079/24`, `excessMileageSurcharge = max(0, mileage − 10000) × 0.02/12`.
- **Range** = `engineRange(engine) × wheelRangeFactor(wheels) × (AWD ? 0.95 : 1) × (Performance ? 0.95 : 1)`.