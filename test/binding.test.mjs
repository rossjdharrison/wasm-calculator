// A3: the cross-file binding validator — the shipped models are clean, and it
// catches dangling refs, unknown sections/options, and unknown outputs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateBinding } from '../web/binding.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const data = await web('models/vehicles/data-model.json');
const pres = await web('models/vehicles/presentation-model.json');

test('the shipped models bind cleanly (no errors, no warnings)', () => {
  const { errors, warnings } = validateBinding(data, pres);
  assert.deepStrictEqual(errors, [], `errors:\n${errors.join('\n')}`);
  assert.deepStrictEqual(warnings, [], `warnings:\n${warnings.join('\n')}`);
});

test('catches unknown section, dangling field, bad option, unknown output', () => {
  const bad = JSON.parse(JSON.stringify(pres));
  bad.fields[0].section = 'nope';                 // unknown section
  bad.fields.push({ id: 'ghost', label: 'Ghost' }); // dangling field
  bad.fields[1].options = [{ id: 'not-an-option', label: 'x' }]; // bad option
  bad.outputs.push({ id: 'missingValue', label: 'x' });          // unknown output
  const { errors } = validateBinding(data, bad);
  assert.ok(errors.some((e) => /unknown section/.test(e)), 'unknown section');
  assert.ok(errors.some((e) => /unknown field "ghost"/.test(e)), 'dangling field');
  assert.ok(errors.some((e) => /unknown option/.test(e)), 'bad option');
  assert.ok(errors.some((e) => /Output "missingValue"/.test(e)), 'unknown output');
});

test('warns when an input field is unbound', () => {
  const bad = JSON.parse(JSON.stringify(pres));
  bad.fields = bad.fields.filter((f) => f.id !== 'quantity' && f.id !== 'model');
  const { warnings } = validateBinding(data, bad);
  assert.ok(warnings.some((w) => /no presentation binding/.test(w)), 'unbound warning');
});
