// =============================================================================
// store.mjs — per-MODEL storage (multi-model aware). The active model id comes
// from the page URL (?m=<id>, default "vehicles"); each model has its own two
// files under models/<id>/ and its own pair of localStorage override keys, so
// several configurators (vehicles, antiques, …) coexist without colliding.
// (Custom models live in this browser for now; → Cloudflare KV in Phase 2.)
// =============================================================================
import { mergeModel } from './assembler.mjs';
import { registryFromModels } from './catalogue-build.mjs';

// Active model id from the URL (?m=antiques). Sanitised to a safe path segment.
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const MODEL_ID = ((params.get('m') || 'vehicles').replace(/[^a-z0-9_-]/gi, '') || 'vehicles');

const get = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
const del = (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } };

// per-MODEL override keys (multi-model aware; a created model has no shipped file).
const DKEY = (id) => `qc:data:${id}:v1`;
const PKEY = (id) => `qc:pres:${id}:v1`;
export const DATA_KEY = DKEY(MODEL_ID);   // back-compat (the active model's keys)
export const PRES_KEY = PKEY(MODEL_ID);
export const getStoredDataFor = (id) => get(DKEY(id));
export const getStoredPresFor = (id) => get(PKEY(id));
export const saveDataFor = (id, d) => set(DKEY(id), d);
export const savePresFor = (id, p) => set(PKEY(id), p);

export const getStoredData = () => getStoredDataFor(MODEL_ID);
export const getStoredPres = () => getStoredPresFor(MODEL_ID);
export const saveData = (d) => saveDataFor(MODEL_ID, d);
export const savePres = (p) => savePresFor(MODEL_ID, p);
export const resetModel = () => { del(DKEY(MODEL_ID)); del(PKEY(MODEL_ID)); };
export const isCustom = () => !!(getStoredData() || getStoredPres());

// override-or-fetch, per id — null-tolerant so a browser-created model (no shipped
// file) resolves from its localStorage override rather than 404-ing.
export const loadModelData = async (id) => getStoredDataFor(id) ?? await fetch(`models/${id}/data-model.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
export const loadModelPres = async (id) => getStoredPresFor(id) ?? await fetch(`models/${id}/presentation-model.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export const loadDefaultData = () => fetch(`models/${MODEL_ID}/data-model.json`).then((r) => r.json());
export const loadDefaultPres = () => fetch(`models/${MODEL_ID}/presentation-model.json`).then((r) => r.json());

export const currentData = async () => getStoredData() ?? await loadDefaultData();
export const currentPres = async () => getStoredPres() ?? await loadDefaultPres();
export const currentModel = async () => mergeModel(await currentData(), await currentPres());

// The shipped model catalogue (landing cards). Shared, tiny.
export const loadCatalog = () => fetch('models/catalog.json').then((r) => r.json());

// ---- browser-authored models: a local catalogue overlay (mirror of journeys) ----
const LMCAT = 'qc:models:catalog:v1';
export const getLocalModelCatalog = () => get(LMCAT) || { models: [] };
export const saveLocalModelEntry = (entry) => {
  const cat = getLocalModelCatalog();
  const i = (cat.models || []).findIndex((e) => e.id === entry.id);
  if (i < 0) (cat.models = cat.models || []).push(entry); else cat.models[i] = entry;
  return set(LMCAT, cat);
};
export const removeLocalModelEntry = (id) => {
  const cat = getLocalModelCatalog();
  cat.models = (cat.models || []).filter((e) => e.id !== id);
  return set(LMCAT, cat);
};
// shipped models ∪ the local overlay, merged by id (local wins).
export const mergedModelCatalog = async () => {
  const shipped = await loadCatalog().catch(() => ({ models: [] }));
  const local = getLocalModelCatalog();
  const byId = new Map((shipped.models || []).map((e) => [e.id, e]));
  for (const e of local.models || []) byId.set(e.id, e);
  return { ...shipped, models: [...byId.values()] };
};

// The top-level SITE/domain model (brand, labels, phases, taxonomy, catalogue).
// The one swappable document that drives navigation + process vocabulary; a
// missing file degrades to null so single-model pages still work.
export const loadDomain = () => fetch('domain.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);

// The catalogue registry — DERIVED from the models (their data.types + `configures`),
// never a hand-authored file. Projected via registryFromModels; catalogue.mjs consumes
// the { root, nodes } view unchanged. Null-tolerant → the landing degrades to a flat grid.
export const loadCatalogue = async () => {
  try {
    const [domain, cat] = await Promise.all([loadDomain(), mergedModelCatalog()]);
    const datas = {};
    await Promise.all((cat.models || []).map(async (m) => { datas[m.id] = await loadModelData(m.id); }));
    return registryFromModels(domain || {}, cat, datas);
  } catch (_) { return null; }
};
// SEAM (KV/R2, deferred): lazy per-model data load with ancestor-closure so the
// projected type-map stays complete for isA/leafCategoryOf. Swapping the whole-catalogue
// build above for a partial one is a LOADER change only — catalogue.mjs fns take a `reg`.

// ---- journeys (the composition tier) ----
// The active journey id from the URL (?j=vehicle-sale), sanitised; null if none —
// in which case every page behaves exactly as today (single-model configurator).
export const JOURNEY_ID = (((params.get('j') || '').replace(/[^a-z0-9_-]/gi, '')) || null);
// the active catalogue node to browse from (?c=<classId>); null → the domain root.
export const CAT_ID = (((params.get('c') || '').replace(/[^a-z0-9_-]/gi, '')) || null);
export const loadJourneyCatalog = () => fetch('journeys/catalog.json').then((r) => r.json()).catch(() => ({ journeys: [] }));
export const loadJourney = (id) => fetch(`journeys/${String(id).replace(/[^a-z0-9_-]/gi, '')}.json`).then((r) => r.json());
// a browser-edited journey overrides the shipped default (like the model overrides).
const JKEY = (id) => `qc:journey:${id}:v1`;
export const getStoredJourney = (id) => get(JKEY(id));
export const saveJourney = (id, journey) => set(JKEY(id), journey);
export const resetJourney = (id) => del(JKEY(id));
export const currentJourney = async (id) => getStoredJourney(id) ?? await loadJourney(id);
// load a referenced model's two files by directory id (journey sub-models use the
// shipped defaults — per-model browser overrides remain scoped to the main page).
export const loadModelFiles = async (id) => ({
  data: await loadModelData(id),
  presentation: await loadModelPres(id),
});

// The active order id from the URL (?o=<id>), sanitised the same way; null if none.
// Case-insensitive class keeps minted ids like "VS-A1B2C3" intact.
export const ORDER_ID = (((params.get('o') || '').replace(/[^a-z0-9_-]/gi, '')) || null);

// ---- browser-authored journeys: a local catalogue overlay -------------------
// journeys/catalog.json is shipped/static and unwritable from the browser, so a
// journey created in the Loom registers here and merges over the shipped list.
const LJCAT = 'qc:journeys:catalog:v1';
export const getLocalJourneyCatalog = () => get(LJCAT) || { journeys: [] };
export const saveLocalJourneyEntry = (entry) => {
  const cat = getLocalJourneyCatalog();
  const i = (cat.journeys || []).findIndex((e) => e.id === entry.id);
  if (i < 0) (cat.journeys = cat.journeys || []).push(entry); else cat.journeys[i] = entry;
  return set(LJCAT, cat);
};
export const removeLocalJourneyEntry = (id) => {
  const cat = getLocalJourneyCatalog();
  cat.journeys = (cat.journeys || []).filter((e) => e.id !== id);
  return set(LJCAT, cat);
};
// shipped journeys + the local overlay, merged by id (local wins). {journeys:[...]}.
export const mergedJourneyCatalog = async () => {
  const shipped = await loadJourneyCatalog().catch(() => ({ journeys: [] }));
  const local = getLocalJourneyCatalog();
  const byId = new Map((shipped.journeys || []).map((e) => [e.id, e]));
  for (const e of local.journeys || []) byId.set(e.id, e);
  return { journeys: [...byId.values()] };
};
