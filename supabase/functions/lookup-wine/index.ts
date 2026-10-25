// lookup-wine — researches a bottle on the web and drafts its profile for the add-wine form.
// POST { q: "Three Harbors Coastal Red Blend" } →
//   { found, wine: { label facts }, structure: { key: 0–100 }, notes: { key: 5–100 }, pairings: [key], confidence, caveat, sources }
// Nothing is saved here: the member reviews the draft in /wines/new and saves it with their own session, as before.
// Claude (with web search) does the research and maps what it reads onto the lexicon; every key it returns is checked
// against the attributes table. Signed-in members only, since each lookup is a paid API call.
// Needs the ANTHROPIC_API_KEY function secret.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';

const MODEL = 'claude-opus-5-5';
const TYPES = ['red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified'];
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Attr { key: string; label: string; kind: string; category: string; scale_labels: string[] | null }
interface Lexicon { notes: Attr[]; structure: Attr[]; pairings: Attr[]; catLabel: Map<string, string> }

let lexiconCache: Lexicon | null = null;
async function lexicon(): Promise<Lexicon> {
  if (lexiconCache) return lexiconCache;
  const [{ data: attrs, error: e1 }, { data: cats, error: e2 }] = await Promise.all([
    admin.from('attributes').select('key,label,kind,category,scale_labels').order('sort'),
    admin.from('attribute_categories').select('key,label'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const all = attrs as Attr[];
  lexiconCache = {
    notes: all.filter((a) => ['aroma', 'texture', 'style'].includes(a.kind)),
    structure: all.filter((a) => a.kind === 'structure'),
    pairings: all.filter((a) => a.kind === 'pairing'),
    catLabel: new Map((cats ?? []).map((c) => [c.key as string, c.label as string])),
  };
  return lexiconCache;
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

function recordTool(lx: Lexicon): Anthropic.Beta.BetaTool {
  return {
    name: 'record_wine',
    description: 'Record the researched wine as a draft profile for the cellar. Call this exactly once, when your research is done.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['found', 'producer', 'name', 'wine_type', 'country', 'region', 'appellation', 'grapes', 'price_usd', 'abv',
        'vintage', 'description', 'serve', 'decant', 'drink_window', 'elevage', 'structure', 'notes', 'pairings',
        'confidence', 'caveat', 'source_urls'],
      properties: {
        found: { type: 'boolean', description: 'False if you could not identify a real wine matching the request.' },
        producer: { type: 'string', description: 'Winery or brand as printed on the label.' },
        name: { type: 'string', description: 'The wine’s name without the producer, e.g. "Coastal Red Blend".' },
        wine_type: { type: 'string', enum: TYPES },
        country: { type: 'string' },
        region: { type: 'string', description: 'Broad region, e.g. "California", "Rhône", "Marlborough".' },
        appellation: { ...nullable('string'), description: 'Specific AVA, AOC or DOC if there is one.' },
        grapes: { type: 'array', items: { type: 'string' }, description: 'Main grapes, largest share first.' },
        price_usd: { ...nullable('integer'), description: 'Typical US retail price in whole dollars.' },
        abv: { ...nullable('number') },
        vintage: { ...nullable('integer'), description: 'Only if the request names a vintage; profiles describe the house style.' },
        description: { type: 'string', description: 'A 2–4 sentence tasting note in your own words (no copied marketing copy), under 600 characters.' },
        serve: { ...nullable('string'), description: 'Serving temperature, e.g. "16–18°C".' },
        decant: { ...nullable('string') },
        drink_window: { ...nullable('string'), description: 'e.g. "Now–2028".' },
        elevage: { ...nullable('string'), description: 'How it is aged, e.g. "10 months in French oak, 25% new".' },
        structure: {
          type: 'object',
          additionalProperties: false,
          required: lx.structure.map((a) => a.key),
          properties: Object.fromEntries(lx.structure.map((a) => [a.key, {
            type: 'integer',
            description: `0–100 on the scale ${(a.scale_labels ?? []).join(' → ')}`,
          }])),
        },
        notes: {
          type: 'array',
          description: '6–15 aroma, flavor, texture and style notes from the lexicon, strongest first.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'intensity'],
            properties: {
              key: { type: 'string', enum: lx.notes.map((a) => a.key) },
              intensity: { type: 'integer', description: '5–29 a hint, 30–64 clearly there, 65–100 a signature note.' },
            },
          },
        },
        pairings: { type: 'array', items: { type: 'string', enum: lx.pairings.map((a) => a.key) }, description: '2–6 classic matches.' },
        confidence: {
          type: 'string',
          enum: ['documented', 'partly_inferred', 'inferred'],
          description: 'documented: tasting notes and tech details came from sources about this wine. partly_inferred: some gaps filled from grape and place typicity. inferred: little was published, so the profile is mostly typicity.',
        },
        caveat: { ...nullable('string'), description: 'One short sentence on anything the member should double-check, or null.' },
        source_urls: { type: 'array', items: { type: 'string' }, description: 'URLs from your search results that you relied on, most useful first.' },
      },
    },
  };
}

function systemPrompt(lx: Lexicon): string {
  const byCat = new Map<string, string[]>();
  for (const a of lx.notes) byCat.set(a.category, [...(byCat.get(a.category) ?? []), a.key]);
  const listing = [...byCat].map(([c, keys]) => `${lx.catLabel.get(c) ?? c}: ${keys.join(', ')}`).join('\n');
  return `You research wines for Wine Wizard, a cellar app that matches bottles to people's palates. A member tasted a bottle that isn't in the cellar yet and wants to add it. Find the specific wine on the web and draft its profile, then call record_wine once.

Research: search for the producer's own page or tech sheet first, then retailer listings, critic and community reviews. Confirm the exact wine (producer, name, style) before describing it. Take grapes, place, ABV, price and élevage from the sources. If the label is a blend with an undisclosed recipe, give the grapes sources name, or the likely ones if none do, and say so in the caveat.

Profile: describe the wine's typical house style, not one vintage. Calibrate structure against the wine world as a whole: a ripe California red blend usually lands around acidity 50, tannin 55, alcohol 70, body 70, oak 45, and sweetness 5–15 if it is fruit-forward with some residual sugar. Choose notes only from the lexicon keys below, picking the ones reviewers and the winery actually mention, and fill gaps from grape and region typicity. Mark the profile's confidence honestly. Write the description in your own words.

If nothing matching the request exists, call record_wine with found = false and your best reading of the label in the text fields.

Lexicon notes by category:
${listing}`;
}

// Links come only from the search results Claude actually saw, so a source is never invented.
function collectSources(content: Anthropic.Beta.BetaContentBlock[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const r of block.content) if (r.type === 'web_search_result' && !seen.has(r.url)) seen.set(r.url, r.title);
  }
  return seen;
}

const clamp = (n: unknown, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, Number(n) || 0)));
const text = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function shape(input: Record<string, unknown>, lx: Lexicon, seen: Map<string, string>) {
  const noteKeys = new Set(lx.notes.map((a) => a.key));
  const pairKeys = new Set(lx.pairings.map((a) => a.key));
  const notes: Record<string, number> = {};
  for (const n of (input.notes as { key: string; intensity: number }[] | undefined) ?? []) {
    if (noteKeys.has(n.key) && !(n.key in notes)) notes[n.key] = clamp(n.intensity, 5, 100);
  }
  const structIn = (input.structure ?? {}) as Record<string, number>;
  const urls = ((input.source_urls as string[] | undefined) ?? []).filter((u) => seen.has(u));
  const sources = (urls.length ? urls : [...seen.keys()]).slice(0, 5).map((url) => ({ url, title: seen.get(url) || url }));
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
  return {
    found: input.found !== false,
    wine: {
      producer: text(input.producer, 200),
      name: text(input.name, 200),
      wine_type: TYPES.includes(input.wine_type as string) ? input.wine_type : 'red',
      country: text(input.country, 80),
      region: text(input.region, 120),
      appellation: text(input.appellation, 120),
      grapes: ((input.grapes as string[] | undefined) ?? []).map((g) => text(g, 60)).filter(Boolean).slice(0, 12),
      price_usd: num(input.price_usd, 1, 99999) != null ? Math.round(input.price_usd as number) : null,
      abv: num(input.abv, 0, 25),
      vintage: num(input.vintage, 1800, 2100),
      description: text(input.description, 2000),
      serve: text(input.serve, 80),
      decant: text(input.decant, 80),
      drink_window: text(input.drink_window, 80),
      elevage: text(input.elevage, 200),
    },
    structure: Object.fromEntries(lx.structure.map((a) => [a.key, clamp(structIn[a.key], 0, 100)])),
    notes,
    pairings: [...new Set(((input.pairings as string[] | undefined) ?? []).filter((k) => pairKeys.has(k)))],
    confidence: ['documented', 'partly_inferred', 'inferred'].includes(input.confidence as string) ? input.confidence : 'inferred',
    caveat: text(input.caveat, 300) || null,
    sources,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth?.user) return Response.json({ error: 'Sign in to look up wines.' }, { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const q = String(body.q ?? '').slice(0, 200).trim();
    if (q.length < 3) return Response.json({ error: 'Describe the bottle: producer and wine name.' }, { status: 400, headers: cors });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'Online lookup isn’t set up yet (missing ANTHROPIC_API_KEY).' }, { status: 503, headers: cors });

    const lx = await lexicon();
    const anthropic = new Anthropic({ apiKey, timeout: 140_000, maxRetries: 1 });
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
      recordTool(lx),
    ];
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: systemPrompt(lx), cache_control: { type: 'ephemeral' } }];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `The bottle: ${q}` }];
    const seen = new Map<string, string>();

    // Server-side web search can pause a long turn; resume it, and nudge once if the research ends without a record.
    let nudged = false;
    for (let turn = 0; turn < 5; turn++) {
      const res = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system,
        tools,
        messages,
      });
      for (const [url, title] of collectSources(res.content)) if (!seen.has(url)) seen.set(url, title);
      if (res.stop_reason === 'refusal') throw new Error('The lookup was declined. Try describing the bottle differently.');
      const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'record_wine');
      if (call) return Response.json({ query: q, ...shape(call.input as Record<string, unknown>, lx, seen) }, { headers: cors });
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'pause_turn') continue;
      if (nudged) break;
      messages.push({ role: 'user', content: 'Record what you found with record_wine now.' });
      nudged = true;
    }
    return Response.json({ error: 'Couldn’t put a profile together for that bottle. Try adding the producer or region.' }, { status: 502, headers: cors });
  } catch (e) {
    console.error(e);
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500, headers: cors });
  }
});
