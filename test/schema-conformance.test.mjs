// Schema-conformance tests (Phase B3). The editor SCHEMA that drives the generic
// editor (data.schema.json) must be well-formed, and the data model must render
// cleanly through it. These lock that in and prove the validator REJECTS the real
// silent-failure modes of editor-engine.mjs (unknown widget, kind typo, missing
// prop, bad item shapes, …) — the mutations below each map to a documented break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateEditorSchema, validateDocAgainstSchema, DATA_SOURCES } from '../web/schema-check.mjs';
import { WIDGET_TYPES, WIDGET_CONTRACTS } from '../web/editor-engine.mjs';

const readJson = (p) => readFile(new URL(p, import.meta.url)).then((b) => JSON.parse(b));
const SCHEMA = await readJson('../web/data.schema.json');
const DOC = await readJson('../web/data-model.json');
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
schemaCase('kind typo', '"kind" must be exactly', (s) => { fields(s).kind = 'list'; });
schemaCase('array missing itemLabel', 'requires a non-empty string "itemLabel"', (s) => { delete fields(s).itemLabel; });
schemaCase('form not an array', '"form" must be an array', (s) => { fields(s).form = { prop: 'unit', widget: 'text' }; });
schemaCase('unknown widget', 'unknown widget', (s) => { fields(s).form[0].widget = 'textbox'; });
schemaCase('value widget missing prop', 'requires a non-empty string "prop"', (s) => { delete fields(s).form[0].prop; });
schemaCase('duplicate form prop', 'same prop', (s) => { fields(s).form.push({ prop: 'unit', widget: 'text', label: 'Dup' }); });
schemaCase('when missing eq', 'when requires an "eq"', (s) => { delete fields(s).form[0].when.eq; });
schemaCase('when missing prop', 'when.prop is required', (s) => { delete fields(s).form[0].when.prop; });
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
