// =============================================================================
// publish.mjs — the studio's client for PUBLISHING an authored document to the edge
// (the /api PUT functions over KV), so an edit is served everywhere with no redeploy.
// The publish token (the PUBLISH_TOKEN Pages secret) is entered once and kept in this
// browser only; a 401 clears it so a wrong token is re-prompted. Never bundles a secret.
// =============================================================================
const TKEY = 'qc:publishToken';

export function getPublishToken(ask = true) {
  let t = null; try { t = localStorage.getItem(TKEY); } catch (_) { /* ignore */ }
  if (!t && ask && typeof prompt === 'function') { t = prompt('Publish token (the PUBLISH_TOKEN Pages secret):'); if (t) try { localStorage.setItem(TKEY, t); } catch (_) { /* ignore */ } }
  return t;
}
export function clearPublishToken() { try { localStorage.removeItem(TKEY); } catch (_) { /* ignore */ } }

async function put(path, body) {
  const t = getPublishToken(); if (!t) return { ok: false, error: 'no publish token' };
  try {
    const r = await fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
    if (r.status === 401) { clearPublishToken(); return { ok: false, status: 401, error: 'unauthorized — token cleared, try again' }; }
    const raw = await r.text(); let j = {}; try { j = raw ? JSON.parse(raw) : {}; } catch (_) { j = { error: raw }; }
    return { ok: r.ok, status: r.status, ...(j || {}), error: r.ok ? null : (j.error || `HTTP ${r.status}`) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export const publishModel = (id, { data, presentation, card }) => put(`/api/models/${encodeURIComponent(id)}`, { data, presentation, card });
export const publishJourney = (id, journey, card) => put(`/api/journeys/${encodeURIComponent(id)}`, { journey, card });
