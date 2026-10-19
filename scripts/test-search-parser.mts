import { flatAttributes } from '../data/lexicon.mjs';
import { buildPhrases, parse } from '../supabase/functions/search/parse.ts';
const ph = buildPhrases(flatAttributes() as any);
for (const q of ['a smoky Syrah for brisket under $40', 'crisp white with white peach and wet stone for oysters', 'dry rosé for a picnic under 25',
  'something like Barolo, rose petals and tar, aged', 'bold red with dark chocolate and blackberry $50-90', 'orange wine skin contact funky natural', 'sweet wine for blue cheese', 'Champagne for celebration']) {
  const p = parse(q, ph);
  console.log(q, '→', JSON.stringify({ t: p.type, min: p.min_price, max: p.max_price, notes: p.notes.map(a => a.key), pair: p.pairings.map(a => a.key), s: p.struct, terms: p.terms }));
}
