// GET /api/catalog — the AUTHORED catalogue overlay (models + journeys) from KV, so
// documents authored-and-published to KV appear on the landing without a redeploy.
// Empty (not 404) when absent, so the browser merges cleanly over the shipped catalogue.
export async function onRequestGet({ env }) {
  const empty = { models: [], journeys: [] };
  if (!env.DOCS) return Response.json(empty);
  const cat = await env.DOCS.get('catalog', 'json');
  return Response.json(cat || empty, { headers: { 'cache-control': 'public, max-age=30' } });
}
