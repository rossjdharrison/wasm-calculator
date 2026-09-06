// GET /api/models/:id — serve an authored model { data, presentation } from KV.
// 404 when absent (or KV unbound) so the browser falls back to the shipped static file.
// Read-serve only; the write/publish path (PUT) lands in a later slice.
export async function onRequestGet({ params, env }) {
  const id = String(params.id || '').replace(/[^a-z0-9_-]/gi, '');
  if (!id || !env.DOCS) return new Response(null, { status: 404 });
  const doc = await env.DOCS.get(`model:${id}`, 'json');
  if (!doc) return new Response(null, { status: 404 });
  return Response.json(doc, { headers: { 'cache-control': 'public, max-age=30' } });
}
