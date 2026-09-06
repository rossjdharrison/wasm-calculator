// /api/models/:id — read-serve (GET) + authenticated publish (PUT) / unpublish (DELETE)
// of an authored model { data, presentation } to KV. Writes are VALIDATED with the real
// assembler before they land (never trust the client) and update the authored `catalog`
// so a published model appears on the landing with no redeploy. Fails CLOSED: no writes
// unless env.PUBLISH_TOKEN is configured and the Bearer token matches.
import { assemble, mergeModel } from '../../../web/assembler.mjs';

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
  const doc = await env.DOCS.get(`model:${id}`, 'json');
  if (!doc) return new Response(null, { status: 404 });
  return Response.json(doc, { headers: { 'cache-control': 'public, max-age=30' } });
}

export async function onRequestPut({ request, params, env }) {
  const id = sanitize(params.id);
  if (!env.DOCS) return new Response('KV not bound', { status: 503 });
  if (!authed(request, env)) return new Response('publishing not configured or unauthorized', { status: 401 });
  if (!id) return new Response('bad id', { status: 400 });
  let body; try { body = await request.json(); } catch { return new Response('bad JSON', { status: 400 }); }
  const { data, presentation, card } = body || {};
  if (!data || !presentation) return new Response('body needs { data, presentation }', { status: 400 });
  try { assemble(mergeModel(data, presentation)); } catch (e) { return new Response(`invalid model: ${e.message}`, { status: 422 }); }
  await env.DOCS.put(`model:${id}`, JSON.stringify({ data, presentation }));
  await upsertCatalog(env, 'models', { id, title: (card && card.title) || presentation.name || id, blurb: (card && card.blurb) || '', hero: (card && card.hero) || '' });
  return Response.json({ ok: true, id });
}

export async function onRequestDelete({ request, params, env }) {
  const id = sanitize(params.id);
  if (!env.DOCS) return new Response('KV not bound', { status: 503 });
  if (!authed(request, env)) return new Response('unauthorized', { status: 401 });
  await env.DOCS.delete(`model:${id}`);
  const cat = (await env.DOCS.get('catalog', 'json')) || { models: [], journeys: [] };
  cat.models = (cat.models || []).filter((e) => e.id !== id);
  await env.DOCS.put('catalog', JSON.stringify(cat));
  return Response.json({ ok: true, id });
}
