// /api/rates/:id — a live REFERENCE-DATA card (rate tables) read-served from KV, with an
// authed publish. A model declares a table as live with `tables.<name>.source = "<id>"`;
// the browser overlays these values onto the model's own tables BEFORE assemble (see
// web/store.mjs applyLiveTables), keeping the shipped/baked tables as the fallback — so a
// missing key / no KV / a static host all degrade to the baked snapshot, never an error.
//
// Keys: rates:<id> -> { id, asOf?, source?, updatedAt, tables: { <name>: { map:{k:number} }
//                                                             | { rows:{ r:{ c:number } } } } }
//
// Writes are gated by a SEPARATE env.RATES_TOKEN (NOT the models/journeys PUBLISH_TOKEN), so
// a rate-writer credential cannot also replace models or the landing catalogue. Fails CLOSED.
// Values are validated numeric + finite + non-negative + sane-magnitude on write; the model's
// own per-table `bounds` are the authoritative guard, re-checked on the READ overlay.

const sanitize = (s) => String(s || '').replace(/[^a-z0-9_-]/gi, '');
const MAX = 1e9;   // reject absurd magnitudes (a poisoned 1e12 rate)

// constant-time-ish string compare (avoid leaking token length/prefix via early return)
function tokenOk(env, request) {
  const want = env.RATES_TOKEN;
  if (!want) return false;                                   // fail closed: no token configured → no writes
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

const isRate = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX;

// validate the incoming rate card: tables{ name: { map:{k:number} | rows:{r:{c:number}} } }.
// Returns an error string, or null when the shape is acceptable.
function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return 'body must be an object';
  if (!card.tables || typeof card.tables !== 'object') return 'body needs a "tables" object';
  for (const [name, t] of Object.entries(card.tables)) {
    if (!t || typeof t !== 'object') return `tables.${name} must be an object`;
    if (t.map && typeof t.map === 'object') {
      for (const [k, v] of Object.entries(t.map)) if (!isRate(v)) return `tables.${name}.map.${k} must be a finite number in [0, ${MAX}]`;
    } else if (t.rows && typeof t.rows === 'object') {
      for (const [r, row] of Object.entries(t.rows)) { if (!row || typeof row !== 'object') return `tables.${name}.rows.${r} must be an object`; for (const [c, v] of Object.entries(row)) if (!isRate(v)) return `tables.${name}.rows.${r}.${c} must be a finite number in [0, ${MAX}]`; }
    } else return `tables.${name} needs a numeric "map" (1d) or "rows" (2d)`;
  }
  return null;
}

export async function onRequestGet({ params, env }) {
  const id = sanitize(params.id);
  if (!id) return new Response(null, { status: 404 });
  if (!env.DOCS) return new Response(null, { status: 404 });            // no store → browser falls back to baked
  const doc = await env.DOCS.get(`rates:${id}`, 'json');
  if (!doc) return new Response(null, { status: 404, headers: { 'cache-control': 'public, max-age=30' } });
  return Response.json(doc, { headers: { 'cache-control': 'public, max-age=60' } });
}

export async function onRequestPut({ request, params, env }) {
  const id = sanitize(params.id);
  if (!tokenOk(env, request)) return new Response('rate publishing not configured or unauthorized', { status: 401 });
  if (!env.DOCS) return new Response('KV not bound', { status: 503 });
  if (!id) return new Response('bad id', { status: 400 });
  let card; try { card = await request.json(); } catch { return new Response('bad JSON', { status: 400 }); }
  const err = validateCard(card);
  if (err) return new Response(`invalid rate card: ${err}`, { status: 422 });
  card.id = id;
  card.updatedAt = new Date().toISOString();
  await env.DOCS.put(`rates:${id}`, JSON.stringify(card));
  return Response.json({ ok: true, id, updatedAt: card.updatedAt });
}

export async function onRequestDelete({ request, params, env }) {
  const id = sanitize(params.id);
  if (!tokenOk(env, request)) return new Response('unauthorized', { status: 401 });
  if (!env.DOCS) return new Response('KV not bound', { status: 503 });
  await env.DOCS.delete(`rates:${id}`);   // revert this dataset to the model's baked snapshot
  return Response.json({ ok: true, id });
}
