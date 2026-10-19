// embed-wines — generates gte-small embeddings for wines whose embedding_text changed.
// POST {} → backfills up to `limit` wines; POST { wine_id } or { ids: [...] } → embeds those wines.
// Keep batches small: inference is CPU-bound and edge workers have a CPU budget per request.
// Uses Supabase's built-in gte-small model (no external API, no cost).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const model = new Supabase.ai.Session('gte-small');
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 6, 1), 20);

    let query = admin.from('wines').select('id, embedding_text').is('embedding', null).not('embedding_text', 'is', null);
    if (body.wine_id) query = query.eq('id', body.wine_id);
    if (Array.isArray(body.ids)) query = query.in('id', body.ids.slice(0, 20));
    const { data: rows, error } = await query.limit(limit);
    if (error) throw error;

    let done = 0;
    for (const row of rows ?? []) {
      const embedding = (await model.run(row.embedding_text, { mean_pool: true, normalize: true })) as number[];
      const { error: e } = await admin.rpc('set_wine_embedding', {
        p_wine: row.id,
        p_text: row.embedding_text,
        p_embedding: JSON.stringify(embedding),
      });
      if (e) console.warn(row.id, e.message);
      else done++;
    }
    const { count } = await admin.from('wines').select('id', { count: 'exact', head: true }).is('embedding', null);
    return Response.json({ embedded: done, remaining: count ?? null }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500, headers: cors });
  }
});
