// =============================================================================
// live-tables.mjs — the PURE overlay of live reference-data (edge rate cards) onto a
// model's baked tables, applied BEFORE assemble so the WASM image bakes the live figures
// exactly as if an author edited the snapshot (no VM change, parity preserved). No fetch
// and no DOM here — the caller (web/store.mjs applyLiveTables) resolves the datasets and
// passes them in; this file is pure + node-testable.
//
// SAFE BY CONSTRUCTION: overlays only keys ALREADY present in the baked map/rows, only
// finite numbers within the table's declared `bounds`, onto a CLONE — so a partial /
// malformed / poisoned / absent dataset always degrades to the baked table and the
// assembled image stays shape-identical (only Float64 table values differ).
// =============================================================================
const clone = (x) => { try { return structuredClone(x); } catch (_) { return JSON.parse(JSON.stringify(x)); } };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inBounds = (v, b) => !b || ((b.min == null || v >= b.min) && (b.max == null || v <= b.max));

// which datasets does this model reference? (unique `source` ids across its tables)
export const liveSourcesOf = (data) => [...new Set(Object.values((data && data.tables) || {}).filter((t) => t && t.source).map((t) => t.source))];

// overlay resolved rate-card docs onto data.tables. `docsBySource` = { [sourceId]: doc|null }.
export function overlayTables(data, docsBySource) {
  if (!data || !data.tables) return data;
  const live = Object.entries(data.tables).filter(([, t]) => t && t.source);
  if (!live.length) return data;
  const out = clone(data);
  for (const [name, t] of live) {
    const src = docsBySource && docsBySource[t.source];
    const liveT = src && src.tables && src.tables[name];
    if (!liveT) continue;                                      // absent dataset/table → keep baked
    const dst = out.tables[name]; const b = t.bounds;
    if (liveT.map && dst.map) { for (const k in dst.map) { const v = liveT.map[k]; if (isNum(v) && inBounds(v, b)) dst.map[k] = v; } }
    else if (liveT.rows && dst.rows) { for (const r in dst.rows) { const lr = liveT.rows[r]; if (!lr) continue; for (const c in dst.rows[r]) { const v = lr[c]; if (isNum(v) && inBounds(v, b)) dst.rows[r][c] = v; } } }
  }
  return out;
}
