// GET /api/journeys/:id — serve an authored journey document from KV.
// 404 when absent (or KV unbound) so the browser falls back to the shipped static file.
export async function onRequestGet({ params, env }) {
  const id = String(params.id || '').replace(/[^a-z0-9_-]/gi, '');
  if (!id || !env.DOCS) return new Response(null, { status: 404 });
  const doc = await env.DOCS.get(`journey:${id}`, 'json');
  if (!doc) return new Response(null, { status: 404 });
  return Response.json(doc, { headers: { 'cache-control': 'public, max-age=30' } });
}
