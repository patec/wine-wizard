// search — natural-language wine search.
// "a smoky Syrah for brisket under $40" →
//   lexicon notes [smoke], pairings [bbq], keyword terms [syrah], price ≤ 40,
//   plus a gte-small embedding of the whole sentence; ranked by search_wines() in Postgres.
// Signed-in callers get a light personalisation from their palate.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { type Attr, type Phrase, buildPhrases, parse } from './parse.ts';

const model = new Supabase.ai.Session('gte-small');
const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let phrases: Phrase[] | null = null;
async function lexicon(): Promise<Phrase[]> {
  if (phrases) return phrases;
  const { data, error } = await admin.from('attributes').select('key,label,kind,synonyms');
  if (error) throw error;
  phrases = buildPhrases(data as Attr[]);
  return phrases;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q ?? '').slice(0, 300).trim();
    if (!q) return Response.json({ error: 'q is required' }, { status: 400, headers: cors });

    const parsed = parse(q, await lexicon());
    const type = body.type ?? parsed.type;
    const min_price = body.min_price ?? parsed.min_price;
    const max_price = body.max_price ?? parsed.max_price;
    const embedding = (await model.run(q, { mean_pool: true, normalize: true })) as number[];

    // forward the caller's JWT so search_wines can personalise via auth.uid()
    const client = createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get('Authorization') ?? `Bearer ${ANON}` } },
    });
    const { data, error } = await client.rpc('search_wines', {
      p_embedding: JSON.stringify(embedding),
      p_attr_keys: parsed.notes.map((a) => a.key),
      p_pairing_keys: parsed.pairings.map((a) => a.key),
      p_terms: parsed.terms,
      p_struct: parsed.struct,
      p_type: type,
      p_min_price: min_price,
      p_max_price: max_price,
      p_limit: Math.min(Math.max(Number(body.limit) || 24, 1), 60),
    });
    if (error) throw error;

    return Response.json({
      query: q,
      interpretation: {
        type, min_price, max_price,
        notes: parsed.notes.map((a) => ({ key: a.key, label: a.label })),
        pairings: parsed.pairings.map((a) => ({ key: a.key, label: a.label })),
        structure: parsed.structLabels,
        terms: parsed.terms,
      },
      results: data,
    }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500, headers: cors });
  }
});
