// Emit kv-seed.json — the shipped models + journeys + an authored catalogue, in the
// `wrangler kv bulk put` shape ([{ key, value }], value a JSON string). Seeding is
// OPTIONAL (the browser falls back to the static files), but it proves read-serve
// end-to-end and lets KV edits override the shipped docs without a redeploy.
//
//   node scripts/seed-kv.mjs
//   wrangler kv bulk put kv-seed.json --binding DOCS --remote   # PRODUCTION namespace (what the deployed site reads)
//   wrangler kv bulk put kv-seed.json --binding DOCS            # LOCAL store (default) — for `wrangler pages dev`
// NB (wrangler 4.x) `kv bulk put` defaults to LOCAL; add --remote to seed the deployed namespace.
// The DOCS binding must appear ONCE in wrangler.jsonc (duplicate bindings are rejected).
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => readFile(join(ROOT, p), 'utf8').then(JSON.parse);

const entries = [];
const catalog = await readJson('web/models/catalog.json');
for (const m of catalog.models || []) {
  const data = await readJson(`web/models/${m.id}/data-model.json`);
  const presentation = await readJson(`web/models/${m.id}/presentation-model.json`);
  entries.push({ key: `model:${m.id}`, value: JSON.stringify({ data, presentation }) });
}

let jcat = { journeys: [] };
try { jcat = await readJson('web/journeys/catalog.json'); } catch { /* none */ }
for (const j of jcat.journeys || []) {
  const doc = await readJson(`web/journeys/${j.id}.json`);
  entries.push({ key: `journey:${j.id}`, value: JSON.stringify(doc) });
}

entries.push({ key: 'catalog', value: JSON.stringify({ models: catalog.models || [], journeys: jcat.journeys || [] }) });

await writeFile(join(ROOT, 'kv-seed.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(`✓ kv-seed.json: ${entries.length} keys (${(catalog.models || []).length} models, ${(jcat.journeys || []).length} journeys, 1 catalog)`);
