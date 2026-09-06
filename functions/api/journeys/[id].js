// /api/journeys/:id — read-serve (GET) + authenticated publish (PUT) / unpublish (DELETE)
// of an authored journey to KV. Writes are VALIDATED with the real shape gate before they
// land (required fields, known step kinds, and the contract's trigger rejection) and update
// the authored `catalog`. Fails CLOSED without a matching env.PUBLISH_TOKEN.
import { validateJourneyShape } from '../../../web/journey-schema.mjs';

const sanitize = (s) => String(s || '').replace(/[^a-z0-9_-]/gi, '');
const authed = (request, env) => !!env.PUBLISH_TOKEN && request.headers.get('authorization') === `Bearer ${env.PUBLISH_TOKEN}`;

async function upsertCatalog(env, kind, entry) {
  const cat = (await env.DOCS.get('catalog', 'json')) || { models: [], journeys: [] };
  const list = cat[kind] || (cat[kind] = []);
  const i = list.findIndex((e) => e.id === entry.id);
  if (i < 0) list.push(entry); else list[i] = { ...list[i], ...entry };
  await env.DOCS.put('catalog', JSON.stringify(cat));
}

export async function onRequestGet({ params, env }) {
  const id = sanitize(params.id);
  if (!id || !env.DOCS) return new Response(null, { status: 404 });
  const doc = await env.DOCS.get(`journey:${id}`, 'json');
  if (!doc) return new Response(null, { status: 404 });
  return Response.json(doc, { headers: { 'cache-control': 'public, max-age=30' } });
}

export async function onRequestPut({ request, params, env }) {
  const id = sanitize(params.id);
  if (!env.DOCS) return new Response('KV not bound', { status: 503 });
  if (!authed(request, env)) return new Response('publishing not configured or unauthorized', { status: 401 });
  if (!id) return new Response('bad id', { status: 400 });
  let body; try { body = await request.json(); } catch { return new Response('bad JSON', { status: 400 }); }
  const { journey, card } = body || {};
  if (!journey || typeof journey !== 'object') return new Response('body needs { journey }', { status: 400 });
  // validate shape against the journey's OWN declared phases (validateJourneyShape reads them)
  const r = validateJourneyShape(journey);
  if (r.errors.length) return new Response(`invalid journey: ${r.errors[0]}`, { status: 422 });
  await env.DOCS.put(`journey:${id}`, JSON.stringify(journey));
  await upsertCatalog(env, 'journeys', { id, title: (card && card.title) || journey.title || id, blurb: (card && card.blurb) || '' });
  return Response.json({ ok: true, id });
}

export async function onRequestDelete({ request, params, env }) {
  const id = sanitize(params.id);
  if (!env.DOCS) return new Response('KV not bound', { status: 503 });
  if (!authed(request, env)) return new Response('unauthorized', { status: 401 });
  await env.DOCS.delete(`journey:${id}`);
  const cat = (await env.DOCS.get('catalog', 'json')) || { models: [], journeys: [] };
  cat.journeys = (cat.journeys || []).filter((e) => e.id !== id);
  await env.DOCS.put('catalog', JSON.stringify(cat));
  return Response.json({ ok: true, id });
}
