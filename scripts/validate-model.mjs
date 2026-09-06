// Build gate: validate EVERY shipped model before anything is deployed.
// build-site ships every models/<id>/* listed in catalog.json, so the gate must
// cover them all — a broken antiques model must fail the build, not assemble in
// the user's browser while the deploy goes green. Runs the real assembler + the
// pure validators (schema conformance, coverage, cross-file binding) per model.
// Any failure prints a message and exits non-zero, stopping the Pages build.

import { readFile, readdir } from 'node:fs/promises';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { validateBinding } from '../web/binding.mjs';
import { validateEditorSchema, validateDocAgainstSchema, PRES_SOURCES } from '../web/schema-check.mjs';
import { analyzeCoverage } from '../web/coverage.mjs';
import { analyzeJourney } from '../web/journey-validate.mjs';
import { validateJourneyShape } from '../web/journey-schema.mjs';

const readJson = (p) => readFile(p, 'utf8').then(JSON.parse);
const die = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

// ---- shared editor schemas (validated once — they drive every model's editor) ----
let editorSchema, presSchema, catalog;
try {
  [editorSchema, presSchema, catalog] = await Promise.all([
    readJson('web/data.schema.json'),
    readJson('web/presentation.schema.json'),
    readJson('web/models/catalog.json'),
  ]);
} catch (e) { die(`could not read editor schemas / catalog: ${e.message}`); }

{
  const s = validateEditorSchema(editorSchema);
  const p = validateEditorSchema(presSchema, { sources: PRES_SOURCES });
  for (const w of [...s.warnings, ...p.warnings]) console.warn(`  ⚠ schema: ${w}`);
  if (s.errors.length || p.errors.length) {
    for (const e of [...s.errors, ...p.errors]) console.error(`✖ schema: ${e}`);
    process.exit(1);
  }
  console.log(`✓ editor schemas well-formed (data: ${editorSchema.collections.length} collections, pres: ${presSchema.collections.length}).`);
}

const ids = (catalog.models || []).map((m) => m.id);
if (!ids.length) die('catalog.json lists no models to validate.');

// ---- validate each shipped model; collect every model's problems, fail if any ----
let failed = 0;
for (const id of ids) {
  const base = `web/models/${id}`;
  let data, pres, model;
  try {
    [data, pres] = await Promise.all([readJson(`${base}/data-model.json`), readJson(`${base}/presentation-model.json`)]);
    model = mergeModel(data, pres);
  } catch (e) { console.error(`✖ [${id}] could not read/merge model: ${e.message}`); failed++; continue; }

  const problems = [];
  const ds = validateDocAgainstSchema(editorSchema, data);
  const ps = validateDocAgainstSchema(presSchema, pres);
  for (const w of [...ds.warnings, ...ps.warnings]) console.warn(`  ⚠ [${id}] schema: ${w}`);
  problems.push(...ds.errors.map((e) => `schema: ${e}`), ...ps.errors.map((e) => `pres-schema: ${e}`));

  const cov = analyzeCoverage(data, pres);
  for (const f of cov.findings) if (f.severity !== 'error') console.warn(`  ⚠ [${id}] coverage: ${f.message}`);
  problems.push(...cov.findings.filter((f) => f.severity === 'error').map((f) => `coverage: ${f.message}`));

  const { errors, warnings } = validateBinding(data, pres);
  for (const w of warnings) console.warn(`  ⚠ [${id}] ${w}`);
  problems.push(...errors.map((e) => `binding: ${e}`));

  let a;
  try { a = assemble(model); } catch (e) { problems.push(`model invalid: ${e.message}`); }

  if (problems.length) {
    for (const p of problems) console.error(`✖ [${id}] ${p}`);
    failed++;
  } else {
    console.log(`✓ [${id}] "${model.id}" v${model.version}: ${a.ir.fields.length} fields, ` +
      `${a.ir.computedIR.length} computed, ${a.ir.slotCount} slots, ${a.modelBytes.length}-byte image, ` +
      `${a.ioLayout.totalBytes}-byte IO.`);
  }
}

// ---- validate journeys (the composition tier) + the models they reference ----
// phases are a domain lifecycle held in the top-level domain model; a journey may
// carry them inline or inherit them — resolve the domain default for the shape gate.
let domainPhaseIds = null;
try { const dom = await readJson('web/domain.json'); domainPhaseIds = (dom.phases || []).map((p) => p.id); } catch { /* no domain */ }
let jfiles = [];
try { jfiles = (await readdir('web/journeys')).filter((f) => f.endsWith('.json') && f !== 'catalog.json'); } catch { /* no journeys */ }
for (const jf of jfiles) {
  let journey;
  try { journey = await readJson(`web/journeys/${jf}`); } catch (e) { console.error(`✖ [journey ${jf}] unreadable: ${e.message}`); failed++; continue; }
  // shape gate first: a malformed journey fails fast, before models load and
  // before the (now-pointless) semantic pass. A journey without inline phases
  // validates against the domain's phases.
  const shapeOpts = (journey.phases && journey.phases.length) ? {} : (domainPhaseIds ? { phases: domainPhaseIds } : {});
  const sh = validateJourneyShape(journey, shapeOpts);
  for (const w of sh.warnings) console.warn(`  ⚠ [journey ${journey.id || jf}] shape: ${w}`);
  if (sh.errors.length) { for (const e of sh.errors) console.error(`✖ [journey ${journey.id || jf}] shape: ${e}`); failed++; continue; }
  const models = {}; let ok = true;
  for (const m of journey.models || []) {
    try { const merged = mergeModel(await readJson(`web/models/${m.ref}/data-model.json`), await readJson(`web/models/${m.ref}/presentation-model.json`)); assemble(merged); models[m.as] = { merged, assembled: assemble(merged) }; }
    catch (e) { console.error(`✖ [journey ${journey.id}] referenced model "${m.ref}" invalid: ${e.message}`); ok = false; }
  }
  const a = analyzeJourney(journey, models);
  for (const f of a.findings) { const line = `[journey ${journey.id}] ${f.kind}: ${f.message}`; if (f.severity === 'error') { console.error(`✖ ${line}`); ok = false; } else console.warn(`  ⚠ ${line}`); }
  if (ok) console.log(`✓ [journey ${journey.id}] ${(journey.models || []).length} models, ${(journey.bindings || []).length} bindings — composes.`);
  else failed++;
}

if (failed) die(`${failed} validation failure(s) across models + journeys.`);
console.log(`✓ all ${ids.length} shipped models + ${jfiles.length} journey(s) valid.`);
