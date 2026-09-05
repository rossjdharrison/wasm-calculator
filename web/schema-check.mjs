// =============================================================================
// schema-check.mjs — conformance checks for the reflective editor (Phase B3).
//
// Two pure, DOM-free validators that guard the tower's L2→L1 link:
//   validateEditorSchema(schema)      — is an editor SCHEMA well-formed for
//                                       editor-engine.mjs? (the "L2 valid" check)
//   validateDocAgainstSchema(schema,doc) — does the model DOC render cleanly
//                                       through that schema? (the "L1 conforms" check)
//
// editor-engine.mjs is deliberately lenient at runtime — an unknown widget, a
// missing `prop`, or a `kind` typo fail *silently* (a control just never appears,
// or writes land under a junk key). For a no-code tool that silence is the
// danger, so these checks turn every silent failure into a build error. Both are
// wired into scripts/validate-model.mjs (the gate `npm run build` already runs).
//
// The widget rules are driven off WIDGET_CONTRACTS (co-located with the widget
// registry) so they cannot drift from what the engine actually renders.
// =============================================================================
import { WIDGET_TYPES, WIDGET_CONTRACTS } from './editor-engine.mjs';

// Source names the Data page wires into ctx.sources. Single source of truth:
// data-editor.js builds its ctx.sources from this list, and the validator checks
// every `select.source` against it — so a schema can't reference a source the
// page never provides (which would silently render an empty dropdown).
export const DATA_SOURCES = ['fields'];

// Source names the Presentation page wires into ctx.sources (presentation.schema.json
// references these). controls = the controls valid for a field's type; sections =
// the section ids; values = the data field/computed ids an output can bind to.
export const PRES_SOURCES = ['controls', 'sections', 'values'];

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string' && x.length > 0;

// ---- L2: is the editor schema well-formed? ---------------------------------
export function validateEditorSchema(schema, opts = {}) {
  const widgets = opts.widgetTypes || WIDGET_TYPES;
  const contracts = opts.contracts || WIDGET_CONTRACTS;
  const sources = opts.sources || DATA_SOURCES;
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!isObj(schema)) { E('schema must be an object'); return { errors, warnings }; }
  if (!Array.isArray(schema.collections)) { E('schema.collections must be an array'); return { errors, warnings }; }
  if (!schema.collections.length) E('schema.collections must not be empty');

  const seenKeys = new Map();
  const seenTitles = new Map();

  schema.collections.forEach((c, ci) => {
    const at = `collections[${ci}]`;
    if (!isObj(c)) { E(`${at} must be an object`); return; }
    const cid = isStr(c.key) ? `collection "${c.key}"` : at;

    // key
    if (!isStr(c.key)) E(`${at}: "key" is required and must be a non-empty string`);
    else if (seenKeys.has(c.key)) E(`collection key "${c.key}" is duplicated (both ${seenKeys.get(c.key)} and ${at} bind the same doc slice)`);
    else seenKeys.set(c.key, at);

    // kind — must be exact; the engine treats anything else as "array" silently
    if (!['array', 'map', 'singleton'].includes(c.kind)) E(`${cid}: "kind" must be "array", "map", or "singleton" (got ${JSON.stringify(c.kind)})`);

    // title
    if (!isStr(c.title)) E(`${cid}: "title" is required and must be a non-empty string`);
    else if (seenTitles.has(c.title)) W(`title "${c.title}" is shared by ${seenTitles.get(c.title)} and ${at} — the outline shows two identical sections`);
    else seenTitles.set(c.title, at);

    // optional cosmetic props
    if ('singular' in c && typeof c.singular !== 'string') W(`${cid}: "singular" should be a string`);
    if ('sub' in c && !isStr(c.sub)) W(`${cid}: "sub" should be a non-empty string naming an item property`);
    if ('itemLabelPrefix' in c && typeof c.itemLabelPrefix !== 'string') W(`${cid}: "itemLabelPrefix" should be a string`);
    if ('removable' in c && typeof c.removable !== 'boolean') W(`${cid}: "removable" should be a boolean (only literal false hides Remove)`);

    // itemLabel — arrays need it for labels + identity
    if (c.kind === 'array' && !isStr(c.itemLabel)) E(`${cid}: kind "array" requires a non-empty string "itemLabel"`);

    // cross-doc collection: outline sourced from a read-only companion (docSource),
    // edits written into doc[editIn], linked by id.
    if ('docSource' in c && !isStr(c.docSource)) E(`${cid}: "docSource" must be a non-empty string`);
    if (isStr(c.docSource) && !isStr(c.editIn)) E(`${cid}: a docSource collection needs "editIn" (the doc slice edits are written to)`);

    // add
    if ('add' in c) {
      const add = c.add;
      if (!isObj(add)) E(`${cid}: "add" must be an object`);
      else {
        if ('template' in add && !isObj(add.template)) E(`${cid}: add.template must be a plain object`);
        if ('prompt' in add && typeof add.prompt !== 'string') W(`${cid}: add.prompt should be a string`);
        if ('into' in add && typeof add.into !== 'string') W(`${cid}: add.into should be a string`);
        if ('seed' in add && !isStr(add.seed)) E(`${cid}: add.seed must be a string naming a ctx.seeds factory`);
        // a seeded add supplies its own (dynamic) template incl. the itemLabel, so
        // the static-template checks below don't apply.
        if (c.kind === 'array' && !add.seed) {
          if (isStr(add.prompt)) {
            if (!isStr(add.into)) E(`${cid}: add has a "prompt" but no "into" — the typed value is discarded and the new item has no label`);
            else if (isStr(c.itemLabel) && add.into !== c.itemLabel) W(`${cid}: add.into ("${add.into}") differs from itemLabel ("${c.itemLabel}") — added items may render as "#i"`);
          } else if (isStr(c.itemLabel) && !(isObj(add.template) && c.itemLabel in add.template)) {
            E(`${cid}: add has no prompt, so add.template must seed the itemLabel property "${c.itemLabel}"`);
          }
        }
      }
    }

    // form
    if ('form' in c) {
      if (!Array.isArray(c.form)) { E(`${cid}: "form" must be an array`); return; }
      // props knowable on an item: template keys, itemLabel, add.into, sub, and
      // any prop a form spec writes. Used to sanity-check `when.prop`.
      const knowable = new Set([
        ...(isObj(c.add && c.add.template) ? Object.keys(c.add.template) : []),
        ...(isStr(c.itemLabel) ? [c.itemLabel] : []),
        ...(isStr(c.add && c.add.into) ? [c.add.into] : []),
        ...(isStr(c.sub) ? [c.sub] : []),
      ]);
      c.form.forEach((s) => { if (isObj(s) && isStr(s.prop)) knowable.add(s.prop); });

      const propSeen = new Map();
      c.form.forEach((spec, si) => {
        const sat = `${cid} form[${si}]`;
        if (!isObj(spec)) { E(`${sat} must be an object`); return; }
        if (!isStr(spec.widget)) { E(`${sat}: "widget" is required`); return; }
        if (!widgets.includes(spec.widget)) { E(`${sat}: unknown widget "${spec.widget}" (known: ${widgets.join(', ')})`); return; }
        const contract = contracts[spec.widget] || {};

        if (contract.needsProp) {
          if (!isStr(spec.prop)) E(`${sat}: widget "${spec.widget}" requires a non-empty string "prop"`);
          else if (propSeen.has(spec.prop)) E(`${cid}: two form specs target the same prop "${spec.prop}" (they will desync)`);
          else propSeen.set(spec.prop, si);
        }

        if (contract.oneOf && !contract.oneOf.some((k) => k in spec)) E(`${sat}: widget "${spec.widget}" requires one of: ${contract.oneOf.join(', ')}`);

        if (spec.widget === 'select') {
          if ('options' in spec && !Array.isArray(spec.options)) E(`${sat}: select "options" must be an array`);
          if ('source' in spec) {
            if (!isStr(spec.source)) E(`${sat}: select "source" must be a string`);
            else if (!sources.includes(spec.source)) E(`${sat}: select source "${spec.source}" is not provided by the page (known: ${sources.join(', ')})`);
          }
        }

        for (const f of contract.boolFlags || []) if (f in spec && typeof spec[f] !== 'boolean') W(`${sat}: "${f}" should be a boolean`);
        if ('clearEmpty' in spec && typeof spec.clearEmpty !== 'boolean') W(`${sat}: "clearEmpty" should be a boolean (only literal false keeps empty strings)`);
        if ('label' in spec && typeof spec.label !== 'string') W(`${sat}: "label" should be a string`);
        else if (contract.needsProp && spec.widget !== 'default' && !('label' in spec)) W(`${sat}: widget "${spec.widget}" should declare a "label"`);

        if ('when' in spec) {
          const w = spec.when;
          if (!isObj(w)) E(`${sat}: "when" must be an object`);
          else {
            // prop (top-level or nested via path) may read the item (default) or
            // the read-only cross-doc source (from:'source'); test eq or existence.
            if (!isStr(w.prop) && !isStr(w.path)) E(`${sat}: when requires a non-empty "prop" or "path"`);
            else if (isStr(w.prop) && !w.path && w.from !== 'source' && !knowable.has(w.prop)) W(`${sat}: when.prop "${w.prop}" is never seeded on items — the field may show/hide unconditionally`);
            if (!('eq' in w) && !('exists' in w)) E(`${sat}: when requires an "eq" value or an "exists" boolean`);
          }
        }
      });
    }
  });

  return { errors, warnings };
}

// ---- L1: does the doc render cleanly through the schema? --------------------
export function validateDocAgainstSchema(schema, doc, opts = {}) {
  const contracts = opts.contracts || WIDGET_CONTRACTS;
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!isObj(schema) || !Array.isArray(schema.collections)) { E('schema is not a usable editor schema'); return { errors, warnings }; }
  if (!isObj(doc)) { E('doc must be an object'); return { errors, warnings }; }

  const fieldIds = new Set(Array.isArray(doc.fields) ? doc.fields.filter(isObj).map((f) => f.id).filter(isStr) : []);

  for (const c of schema.collections) {
    if (!isObj(c) || !isStr(c.key)) continue;
    if (c.kind !== 'array' && c.kind !== 'map') continue; // already flagged by the schema check
    const slice = doc[c.key];
    if (slice === undefined) continue; // absent is fine — the engine creates it lazily

    // container type must match kind (a scalar top-level field here throws in the engine)
    if (c.kind === 'array' && !Array.isArray(slice)) { E(`doc.${c.key} must be an array (collection kind "array")`); continue; }
    if (c.kind === 'map' && !isObj(slice)) { E(`doc.${c.key} must be a plain object (collection kind "map")`); continue; }

    // array: items are objects, itemLabel present + unique
    if (c.kind === 'array') {
      const seen = new Set();
      slice.forEach((it, i) => {
        if (!isObj(it)) { E(`doc.${c.key}[${i}] must be an object`); return; }
        if (isStr(c.itemLabel)) {
          const lab = it[c.itemLabel];
          if (lab === undefined || lab === null || lab === '') E(`doc.${c.key}[${i}] is missing its "${c.itemLabel}" (label/identity)`);
          else if (seen.has(String(lab))) E(`doc.${c.key} has a duplicate ${c.itemLabel} "${lab}"`);
          else seen.add(String(lab));
        }
      });
    } else {
      Object.entries(slice).forEach(([k, it]) => { if (!isObj(it)) E(`doc.${c.key}["${k}"] must be an object`); });
    }

    // widget item-contracts + source-select ref checks, applied to every item
    const specs = Array.isArray(c.form) ? c.form.filter(isObj) : [];
    const itemContracts = [...new Set(specs.map((s) => contracts[s.widget] && contracts[s.widget].item).filter(Boolean))];
    const sourceSelects = specs.filter((s) => s.widget === 'select' && s.source === 'fields' && isStr(s.prop));
    const items = c.kind === 'array'
      ? slice.map((it, i) => [`doc.${c.key}[${i}]`, it])
      : Object.entries(slice).map(([k, it]) => [`doc.${c.key}["${k}"]`, it]);

    for (const [where, it] of items) {
      if (!isObj(it)) continue;
      for (const ic of itemContracts) {
        if (ic === 'table') checkTable(it, where, E);
        else if (ic === 'fieldType') checkFieldType(it, where, E, W);
        else if (ic === 'optionList') checkOptionList(it, where, E);
      }
      for (const s of sourceSelects) {
        const v = it[s.prop];
        if (v !== undefined && v !== '' && !fieldIds.has(v)) W(`${where}.${s.prop} = "${v}" is not an existing field id`);
      }
    }
  }

  return { errors, warnings };
}

function checkFieldType(it, where, E, W) {
  if (!isStr(it.type)) { E(`${where} is missing a string "type"`); return; }
  const known = ['number', 'choice', 'multichoice', 'boolean'];
  if (!known.includes(it.type)) W(`${where}.type "${it.type}" is not one the editor understands (${known.join(', ')})`);
}

function checkOptionList(it, where, E) {
  if (!('options' in it)) return; // number/boolean fields have none — fine
  if (!Array.isArray(it.options)) { E(`${where}.options must be an array`); return; }
  it.options.forEach((o, oi) => { if (!isObj(o) || !isStr(o.id)) E(`${where}.options[${oi}] must be an object with a string "id"`); });
}

function checkTable(it, where, E) {
  if (it.kind === '1d') {
    if (!isObj(it.map)) { E(`${where} (1d table) must have a "map" object`); return; }
    for (const [k, v] of Object.entries(it.map)) if (typeof v !== 'number') E(`${where}.map["${k}"] must be a number`);
  } else if (it.kind === '2d') {
    if (!isObj(it.rows)) { E(`${where} (2d table) must have a "rows" object`); return; }
    const rowKeys = Object.keys(it.rows);
    if (!rowKeys.length) { E(`${where} (2d table) has no rows`); return; }
    if (!isObj(it.rows[rowKeys[0]])) { E(`${where}.rows["${rowKeys[0]}"] must be an object`); return; }
    const cols = Object.keys(it.rows[rowKeys[0]]);
    for (const rk of rowKeys) {
      const rowv = it.rows[rk];
      if (!isObj(rowv)) { E(`${where}.rows["${rk}"] must be an object`); continue; }
      const rc = Object.keys(rowv);
      if (rc.length !== cols.length || !cols.every((cc) => cc in rowv)) E(`${where}.rows["${rk}"] columns differ from the first row (ragged 2d table)`);
      for (const cc of cols) if (cc in rowv && typeof rowv[cc] !== 'number') E(`${where}.rows["${rk}"]["${cc}"] must be a number`);
    }
  } else {
    E(`${where} (grid table) must have kind "1d" or "2d" (got ${JSON.stringify(it.kind)})`);
  }
}
