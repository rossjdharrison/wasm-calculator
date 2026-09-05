// =============================================================================
// store.mjs — per-MODEL storage (multi-model aware). The active model id comes
// from the page URL (?m=<id>, default "vehicles"); each model has its own two
// files under models/<id>/ and its own pair of localStorage override keys, so
// several configurators (vehicles, antiques, …) coexist without colliding.
// (Custom models live in this browser for now; → Cloudflare KV in Phase 2.)
// =============================================================================
import { mergeModel } from './assembler.mjs';

// Active model id from the URL (?m=antiques). Sanitised to a safe path segment.
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const MODEL_ID = ((params.get('m') || 'vehicles').replace(/[^a-z0-9_-]/gi, '') || 'vehicles');
const BASE = `models/${MODEL_ID}`;

export const DATA_KEY = `qc:data:${MODEL_ID}:v1`;
export const PRES_KEY = `qc:pres:${MODEL_ID}:v1`;

const get = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
const del = (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } };

export const getStoredData = () => get(DATA_KEY);
export const getStoredPres = () => get(PRES_KEY);
export const saveData = (d) => set(DATA_KEY, d);
export const savePres = (p) => set(PRES_KEY, p);
export const resetModel = () => { del(DATA_KEY); del(PRES_KEY); };
export const isCustom = () => !!(getStoredData() || getStoredPres());

export const loadDefaultData = () => fetch(`${BASE}/data-model.json`).then((r) => r.json());
export const loadDefaultPres = () => fetch(`${BASE}/presentation-model.json`).then((r) => r.json());

export const currentData = async () => getStoredData() ?? await loadDefaultData();
export const currentPres = async () => getStoredPres() ?? await loadDefaultPres();
export const currentModel = async () => mergeModel(await currentData(), await currentPres());

// The model catalogue (landing page + header descriptor). Shared, tiny.
export const loadCatalog = () => fetch('models/catalog.json').then((r) => r.json());
