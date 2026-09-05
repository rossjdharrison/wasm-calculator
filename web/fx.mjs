// =============================================================================
// fx.mjs — daily ECB reference rates via Frankfurter (api.frankfurter.dev),
// base EUR, no key. Reference rates (daily), not real-time. Cached per-day in
// localStorage; a failed fetch falls back to the last cache, then to base-only
// (no conversion) — the UI stays functional offline, just can't convert.
//
// Returns { base, date, rates } where rates includes base:1, shaped for
// ui.mjs formatOutput ({ base, <CODE>: rateFromBase }).
// =============================================================================
const KEY = 'qc:fx:v1';
const HOST = 'https://api.frankfurter.dev/v1/latest';
const today = () => new Date().toISOString().slice(0, 10);
const readCache = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
const writeCache = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* blocked */ } };

export async function loadRates({ base = 'EUR', symbols = [] } = {}) {
  const day = today();
  const want = symbols.filter((s) => s && s !== base);
  const cached = readCache();
  const fresh = cached && cached.base === base && cached.fetchedDay === day && want.every((s) => s in cached.rates);
  if (fresh) return cached;
  try {
    const url = `${HOST}?base=${encodeURIComponent(base)}` + (want.length ? `&symbols=${want.join(',')}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`FX ${r.status}`);
    const j = await r.json();
    const out = { base: j.base, date: j.date, fetchedDay: day, rates: { ...j.rates, [j.base]: 1 } };
    writeCache(out);
    return out;
  } catch (e) {
    if (cached) return { ...cached, stale: true };            // last known rates
    return { base, date: null, rates: { [base]: 1 }, offline: true };  // base only
  }
}
