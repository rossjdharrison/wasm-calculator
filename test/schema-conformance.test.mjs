// Schema-conformance tests (Phase B3). The editor SCHEMA that drives the generic
// editor (data.schema.json) must be well-formed, and the data model must render
// cleanly through it. These lock that in and prove the validator REJECTS the real
// silent-failure modes of editor-engine.mjs (unknown widget, kind typo, missing
// prop, bad item shapes, …) — the mutations below each map to a documented break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateEditorSchema, validateDocAgainstSchema, DATA_SOURCES, PRES_SOURCES } from '../web/schema-check.mjs';
import { WIDGET_TYPES, WIDGET_CONTRACTS } from '../web/editor-engine.mjs';
import { authorCategories } from '../web/hqdm.mjs';

const readJson = (p) => readFile(new URL(p, import.meta.url)).then((b) => JSON.parse(b));
const SCHEMA = await readJson('../web/data.schema.json');
const PRES_SCHEMA = await readJson('../web/presentation.schema.json');
const DOC = await readJson('../web/models/vehicles/data-model.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
const errs = (r) => r.errors.join(' | ');

// ---- the shipped artifacts are clean --------------------------------------
test('shipped data.schema.json is a well-formed editor schema (no errors/warnings)', () => {
  const r = validateEditorSchema(SCHEMA);
  assert.equal(r.errors.length, 0, `errors: ${errs(r)}`);
  assert.equal(r.warnings.length, 0, `warnings: ${r.warnings.join(' | ')}`);
});

test('shipped data-model.json conforms to the editor schema (no errors/warnings)', () => {
  const r = validateDocAgainstSchema(SCHEMA, DOC);
  assert.equal(r.errors.length, 0, `errors: ${errs(r)}`);
  assert.equal(r.warnings.length, 0, `warnings: ${r.warnings.join(' | ')}`);
});

// ---- drift guard: every rendered widget has a contract, and vice versa -----
test('WIDGET_CONTRACTS covers exactly the widget registry (no drift)', () => {
  assert.deepEqual([...WIDGET_TYPES].sort(), Object.keys(WIDGET_CONTRACTS).sort());
});

test('every select.source in the shipped schema is a declared DATA_SOURCE', () => {
  for (const c of SCHEMA.collections)
    for (const s of c.form || [])
      if (s.widget === 'select' && s.source) assert.ok(DATA_SOURCES.includes(s.source), `undeclared source ${s.source}`);
});

// ---- schema mutations are each rejected ------------------------------------
const schemaCase = (name, needle, mutate) => test(`rejects schema: ${name}`, () => {
  const s = clone(SCHEMA);
  mutate(s);
  const r = validateEditorSchema(s);
  assert.ok(r.errors.length > 0, 'expected at least one error');
  if (needle) assert.ok(r.errors.some((e) => e.includes(needle)), `no error matched "${needle}" in: ${errs(r)}`);
});

const fields = (s) => s.collections.find((c) => c.key === 'fields');
const coll = (s, k) => s.collections.find((c) => c.key === k);

schemaCase('no collections', 'collections must be an array', (s) => { delete s.collections; });
schemaCase('empty collections', 'must not be empty', (s) => { s.collections = []; });
schemaCase('collection missing key', '"key" is required', (s) => { delete fields(s).key; });
schemaCase('duplicate collection key', 'duplicated', (s) => { s.collections[1].key = s.collections[0].key; });
schemaCase('kind typo', '"kind" must be', (s) => { fields(s).kind = 'list'; });
schemaCase('array missing itemLabel', 'requires a non-empty string "itemLabel"', (s) => { delete fields(s).itemLabel; });
schemaCase('form not an array', '"form" must be an array', (s) => { fields(s).form = { prop: 'unit', widget: 'text' }; });
schemaCase('unknown widget', 'unknown widget', (s) => { fields(s).form[0].widget = 'textbox'; });
schemaCase('value widget missing prop', 'requires a non-empty string "prop"', (s) => { delete fields(s).form[0].prop; });
schemaCase('duplicate form prop', 'same prop', (s) => { fields(s).form.push({ prop: 'unit', widget: 'text', label: 'Dup' }); });
schemaCase('when missing eq', 'when requires an "eq"', (s) => { delete fields(s).form[0].when.eq; });
schemaCase('when missing prop', 'requires a non-empty "prop"', (s) => { delete fields(s).form[0].when.prop; });
schemaCase('select without options or source', 'requires one of', (s) => {
  const sev = coll(s, 'validations').form.find((f) => f.prop === 'severity'); delete sev.options;
});
schemaCase('select with undeclared source', 'not provided by the page', (s) => {
  coll(s, 'effects').form.find((f) => f.prop === 'setField').source = 'ghost';
});
schemaCase('array add.prompt without into', 'no "into"', (s) => { delete fields(s).add.into; });
schemaCase('no-prompt add template missing itemLabel', 'seed the itemLabel', (s) => { delete coll(s, 'validations').add.template.id; });

// ---- doc mutations are each rejected ---------------------------------------
const docCase = (name, needle, mutate) => test(`rejects doc: ${name}`, () => {
  const d = clone(DOC);
  mutate(d);
  const r = validateDocAgainstSchema(SCHEMA, d);
  assert.ok(r.errors.length > 0, 'expected at least one error');
  if (needle) assert.ok(r.errors.some((e) => e.includes(needle)), `no error matched "${needle}" in: ${errs(r)}`);
});
const choiceField = (d) => d.fields.find((f) => f.type === 'choice');

docCase('fields not an array', 'must be an array', (d) => { d.fields = {}; });
docCase('tables not an object', 'must be a plain object', (d) => { d.tables = []; });
docCase('field missing type', 'missing a string "type"', (d) => { delete d.fields[0].type; });
docCase('field missing id', 'is missing its "id"', (d) => { delete d.fields[0].id; });
docCase('duplicate field id', 'duplicate id', (d) => { d.fields[1].id = d.fields[0].id; });
docCase('choice options not objects', 'must be an object with a string "id"', (d) => { choiceField(d).options = ['a', 'b']; });
docCase('table missing kind', 'must have kind', (d) => { delete d.tables.engineDelta.kind; });
docCase('2d table missing rows', 'must have a "rows"', (d) => { delete d.tables.modelTrimPrice.rows; });
docCase('1d table non-number cell', 'must be a number', (d) => {
  const k = Object.keys(d.tables.engineDelta.map)[0]; d.tables.engineDelta.map[k] = 'oops';
});

test('dangling source-select ref is a warning, not an error', () => {
  const d = clone(DOC);
  d.effects.find((e) => 'setField' in e).setField = 'ghostField';
  const r = validateDocAgainstSchema(SCHEMA, d);
  assert.equal(r.errors.length, 0, `unexpected errors: ${errs(r)}`);
  assert.ok(r.warnings.some((w) => w.includes('ghostField')), `expected a ghostField warning, got: ${r.warnings.join(' | ')}`);
});

// ---- new collection shapes (presentation-editor adoption substrate) --------
test('accepts a singleton collection (no itemLabel / add needed)', () => {
  const s = { collections: [{ key: 'settings', kind: 'singleton', title: 'Collection', titleText: 'Collection settings', form: [
    { widget: 'text', prop: 'name', label: 'Name', target: 'root' },
    { widget: 'toggle', prop: 'carryOverOnPrimaryChange', label: 'Carry over', target: 'root', default: true, explicit: true },
    { widget: 'text', prop: 'brandMark', path: 'brand.mark', label: 'Brand mark', target: 'root' },
  ] }] };
  const r = validateEditorSchema(s);
  assert.equal(r.errors.length, 0, `errors: ${errs(r)}`);
});
test('cross-doc collection requires editIn', () => {
  const s = { collections: [{ key: 'fields', kind: 'array', itemLabel: 'id', title: 'Fields', docSource: 'data.fields', form: [{ widget: 'text', prop: 'label', label: 'Label' }] }] };
  const r = validateEditorSchema(s);
  assert.ok(r.errors.some((e) => e.includes('editIn')), `expected editIn error, got: ${errs(r)}`);
});
test('add.seed skips the static-template itemLabel requirement', () => {
  const withSeed = { collections: [{ key: 'outputs', kind: 'array', itemLabel: 'id', title: 'Outputs', add: { seed: 'output' }, form: [{ widget: 'text', prop: 'label', label: 'Label' }] }] };
  assert.equal(validateEditorSchema(withSeed).errors.length, 0, 'seed add should be legal without a template');
  const noSeed = { collections: [{ key: 'outputs', kind: 'array', itemLabel: 'id', title: 'Outputs', add: { template: {} }, form: [] }] };
  assert.ok(validateEditorSchema(noSeed).errors.some((e) => e.includes('seed the itemLabel')), 'a template add must still seed itemLabel');
});
// ---- D7: the L0-tag editor widgets (category / render) --------------------
test('the data schema offers a category select (source: categories) on fields AND computed', () => {
  for (const key of ['fields', 'computed']) {
    const sel = coll(SCHEMA, key).form.find((f) => f.widget === 'select' && f.prop === 'category');
    assert.ok(sel, `${key} has a category select`);
    assert.equal(sel.source, 'categories');
    assert.equal(sel.allowNone, true);
  }
  assert.ok(DATA_SOURCES.includes('categories'), 'categories is a declared data source');
});

test('the presentation schema offers a render select with the fixed neutral vocabulary', () => {
  const r = validateEditorSchema(PRES_SCHEMA, { sources: PRES_SOURCES });
  assert.equal(r.errors.length, 0, `pres schema errors: ${errs(r)}`);
  const sel = coll(PRES_SCHEMA, 'fields').form.find((f) => f.widget === 'select' && f.prop === 'render');
  assert.ok(sel, 'fields has a render select');
  assert.deepEqual(sel.options, ['glyph', 'swatch', 'track']);
  assert.equal(sel.allowNone, true);
});

test('every category in the shipped model is offered by authorCategories(types)', () => {
  const allowed = new Set(authorCategories(DOC.types));
  const tagged = [...(DOC.fields || []), ...(DOC.computed || [])].filter((x) => x && x.category);
  for (const x of tagged) assert.ok(allowed.has(x.category), `category "${x.category}" on "${x.id}" is not offered by the editor`);
});

test('when accepts exists and a nested path with source', () => {
  const s = { collections: [{ key: 'fields', kind: 'array', itemLabel: 'id', title: 'Fields', docSource: 'data.fields', editIn: 'fields', form: [
    { widget: 'number', prop: 'decimals', label: 'Decimals', when: { from: 'source', prop: 'type', eq: 'number' } },
    { widget: 'optionRows', when: { from: 'source', prop: 'options', exists: true } },
    { widget: 'text', prop: 'unit', path: 'format.unit', label: 'Unit', when: { path: 'format.type', eq: 'unit' } },
  ] }] };
  const r = validateEditorSchema(s);
  assert.equal(r.errors.length, 0, `errors: ${errs(r)}`);
});
