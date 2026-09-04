// Build gate: validate web/model.json before anything is deployed.
// Runs the real assembler (schema-shaped parse + semantic checks: unknown
// field/option/table refs, dependency cycles, bad enums, expression depth,
// multi-select bit cap). Any failure prints a message and exits non-zero, which
// stops the Cloudflare Pages build — a broken model never reaches production.

import { readFile } from 'node:fs/promises';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { validateBinding } from '../web/binding.mjs';

let data, pres, model;
try {
  [data, pres] = await Promise.all([
    readFile('web/data-model.json', 'utf8').then(JSON.parse),
    readFile('web/presentation-model.json', 'utf8').then(JSON.parse),
  ]);
  model = mergeModel(data, pres);
} catch (e) {
  console.error(`✖ could not read/merge the model files: ${e.message}`);
  process.exit(1);
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
