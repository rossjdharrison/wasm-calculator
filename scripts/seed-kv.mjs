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

// live rate cards: mirror the baked table maps of ANY model that declares
// `tables.<name>.source` into rates:<source>, so KV starts == the baked snapshot
// (live == baked until someone PUTs an update). Read by functions/api/rates/[id].js;
// overlaid onto the model tables by web/store.mjs applyLiveTables. Scans every model
// dir (composed-only models like shipping are not in catalog.models).
const cards = {};
for (const d of await readdir(join(ROOT, 'web/models'), { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  let dm; try { dm = await readJson(`web/models/${d.name}/data-model.json`); } catch { continue; }
  for (const [name, t] of Object.entries(dm.tables || {})) {
    if (!t || !t.source) continue;
    const card = (cards[t.source] = cards[t.source] || { id: t.source, source: 'baked snapshot', tables: {} });
    card.tables[name] = t.map ? { map: t.map } : (t.rows ? { rows: t.rows } : {});
  }
}
for (const [id, card] of Object.entries(cards)) entries.push({ key: `rates:${id}`, value: JSON.stringify(card) });

await writeFile(join(ROOT, 'kv-seed.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(`✓ kv-seed.json: ${entries.length} keys (${(catalog.models || []).length} models, ${(jcat.journeys || []).length} journeys, ${Object.keys(cards).length} rate card(s), 1 catalog)`);
