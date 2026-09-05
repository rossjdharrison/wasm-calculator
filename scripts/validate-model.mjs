// Build gate: validate web/model.json before anything is deployed.
// Runs the real assembler (schema-shaped parse + semantic checks: unknown
// field/option/table refs, dependency cycles, bad enums, expression depth,
// multi-select bit cap). Any failure prints a message and exits non-zero, which
// stops the Cloudflare Pages build — a broken model never reaches production.

import { readFile } from 'node:fs/promises';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { validateBinding } from '../web/binding.mjs';
import { validateEditorSchema, validateDocAgainstSchema, PRES_SOURCES } from '../web/schema-check.mjs';
import { analyzeCoverage } from '../web/coverage.mjs';

let data, pres, model;
try {
  [data, pres] = await Promise.all([
    readFile('web/models/vehicles/data-model.json', 'utf8').then(JSON.parse),
    readFile('web/models/vehicles/presentation-model.json', 'utf8').then(JSON.parse),
  ]);
  model = mergeModel(data, pres);
} catch (e) {
  console.error(`✖ could not read/merge the model files: ${e.message}`);
  process.exit(1);
}

// editor-schema conformance (L2): the data.schema.json that drives the generic
// editor must be well-formed, and the data model must render cleanly through it.
// A broken schema edit fails the build here instead of silently breaking the UI.
let editorSchema;
try {
  editorSchema = JSON.parse(await readFile('web/data.schema.json', 'utf8'));
} catch (e) {
  console.error(`✖ could not read/parse web/data.schema.json: ${e.message}`);
  process.exit(1);
}
{
  const s1 = validateEditorSchema(editorSchema);
  const s2 = validateDocAgainstSchema(editorSchema, data);
  for (const w of [...s1.warnings, ...s2.warnings]) console.warn(`  ⚠ schema: ${w}`);
  if (s1.errors.length || s2.errors.length) {
    for (const e of [...s1.errors, ...s2.errors]) console.error(`✖ schema: ${e}`);
    process.exit(1);
  }
  console.log(`✓ editor schema "${editorSchema.title || 'data'}": ${editorSchema.collections.length} collections conform.`);
}

// presentation-editor schema conformance: the presentation.schema.json that will
// drive the presentation editor must be well-formed (with the presentation source
// names it references) and the presentation model must render cleanly through it.
{
  let presSchema;
  try {
    presSchema = JSON.parse(await readFile('web/presentation.schema.json', 'utf8'));
  } catch (e) {
    console.error(`✖ could not read/parse web/presentation.schema.json: ${e.message}`);
    process.exit(1);
  }
  const s1 = validateEditorSchema(presSchema, { sources: PRES_SOURCES });
  const s2 = validateDocAgainstSchema(presSchema, pres);
  for (const w of [...s1.warnings, ...s2.warnings]) console.warn(`  ⚠ pres-schema: ${w}`);
  if (s1.errors.length || s2.errors.length) {
    for (const e of [...s1.errors, ...s2.errors]) console.error(`✖ pres-schema: ${e}`);
    process.exit(1);
  }
  console.log(`✓ presentation schema: ${presSchema.collections.length} collections conform.`);
}

// model coverage (Area 1): a shipped model must be COMPLETE — every option an
// expression indexes must have its table value, or pricing is silently wrong.
// Errors block the build; warnings/info (labels, dead options, orphans) advise.
{
  const cov = analyzeCoverage(data, pres);
  for (const f of cov.findings) if (f.severity !== 'error') console.warn(`  ⚠ coverage: ${f.message}`);
  const covErrors = cov.findings.filter((f) => f.severity === 'error');
  if (covErrors.length) {
    for (const f of covErrors) console.error(`✖ coverage: ${f.message}`);
    process.exit(1);
  }
  console.log(`✓ model coverage: every option is connected (${Object.keys(cov.indexing).length} indexed tables).`);
}

// cross-file binding integrity (errors block the build; warnings are advisory)
const { errors, warnings } = validateBinding(data, pres);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖ binding: ${e}`);
  process.exit(1);
}

try {
  const a = assemble(model);
  console.log(`✓ model "${model.id}" v${model.version}: ${a.ir.fields.length} fields, ` +
    `${a.ir.computedIR.length} computed, ${a.ir.slotCount} slots, ` +
    `${a.modelBytes.length}-byte image, ${a.ioLayout.totalBytes}-byte IO.`);
} catch (e) {
  console.error(`✖ model invalid: ${e.message}`);
  process.exit(1);
}
