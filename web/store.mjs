// =============================================================================
// store.mjs — where custom models live in this browser (Phase A; → Cloudflare KV
// in Phase 2). Two keys, matching the two-file split: a custom DATA model and a
// custom PRESENTATION model, each falling back to the shipped default file.
// =============================================================================
import { mergeModel } from './assembler.mjs';

export const DATA_KEY = 'qc:data:v1';
export const PRES_KEY = 'qc:pres:v1';

const get = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
const del = (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } };

export const getStoredData = () => get(DATA_KEY);
export const getStoredPres = () => get(PRES_KEY);
export const saveData = (d) => set(DATA_KEY, d);
export const savePres = (p) => set(PRES_KEY, p);
export const resetModel = () => { del(DATA_KEY); del(PRES_KEY); };
export const isCustom = () => !!(getStoredData() || getStoredPres());

export const loadDefaultData = () => fetch('data-model.json').then((r) => r.json());
export const loadDefaultPres = () => fetch('presentation-model.json').then((r) => r.json());

export const currentData = async () => getStoredData() ?? await loadDefaultData();
export const currentPres = async () => getStoredPres() ?? await loadDefaultPres();
export const currentModel = async () => mergeModel(await currentData(), await currentPres());
