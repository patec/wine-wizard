// Query parser for natural-language wine search (pure — unit-testable with `node --experimental-strip-types`).
export type Attr = { key: string; label: string; kind: string; synonyms: string[] };
export type Phrase = { phrase: string; attr: Attr };

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");

export function buildPhrases(attrs: Attr[]): Phrase[] {
  const out: Phrase[] = [];
  for (const a of attrs) {
    if (a.kind === 'structure') continue; // structure handled by STRUCT_WORDS
    for (const p of new Set([a.label, ...a.synonyms].map(norm))) if (p.length >= 3) out.push({ phrase: p, attr: a });
  }
  return out.sort((x, y) => y.phrase.length - x.phrase.length); // longest phrase wins
}

const TYPE_WORDS: [RegExp, string][] = [
  [/\b(sparkling|bubbl(y|es)|fizz(y)?|champagne|cava|prosecco|cremant|pet[- ]?nat|sekt|franciacorta)\b/, 'sparkling'],
  [/\b(dessert wine|sticky|stickies|sauternes|tokaji|ice ?wine)\b/, 'dessert'],
  [/\b(fortified|port|sherry|madeira|marsala)\b/, 'fortified'],
  [/\b(red|reds)\b/, 'red'],
  [/\b(white|whites)\b/, 'white'],
];

const STRUCT_WORDS: [RegExp, Record<string, number>, string][] = [
  [/\b(light[- ]bodied|light|delicate)\b/, { body: 0.3 }, 'light-bodied'],
  [/\b(medium[- ]bodied)\b/, { body: 0.55 }, 'medium-bodied'],
  [/\b(full[- ]bodied|big|bold|heavy)\b/, { body: 0.88 }, 'full-bodied'],
  [/\b(crisp|zesty|zippy|high[- ]acid|racy|tart|refreshing)\b/, { acidity: 0.88 }, 'high acidity'],
  [/\b(bone[- ]dry)\b/, { sweetness: 0.0 }, 'bone dry'],
  [/\b(off[- ]dry|semi[- ]sweet|slightly sweet)\b/, { sweetness: 0.32 }, 'off-dry'],
  [/\b(sweet)\b/, { sweetness: 0.75 }, 'sweet'],
  [/\b(dry)\b/, { sweetness: 0.03 }, 'dry'],
  [/\b(tannic|grippy|firm)\b/, { tannin: 0.82 }, 'firm tannin'],
  [/\b(soft|smooth|mellow|gentle)\b/, { tannin: 0.35 }, 'soft tannin'],
  [/\b(oaky|oaked|buttery)\b/, { oak_influence: 0.7 }, 'oaked'],
  [/\b(low[- ]alcohol|low abv)\b/, { alcohol: 0.15 }, 'low alcohol'],
  [/\b(aged|mature|tertiary)\b/, { maturity: 0.7 }, 'mature'],
  [/\b(young|youthful)\b/, { maturity: 0.15 }, 'youthful'],
];

const STOP = new Set((
  'a an the with for and or of to in on at by from into is are be it its this that these those i me my we our you ' +
  'want wanted looking look find show give get recommend suggest need something anything some any wine wines bottle bottles glass ' +
  'like similar style kind sort type please tonight dinner lunch party good great nice really very bit little more less than not but ' +
  'too also pair pairs pairing paired goes go going match matches drink drinking under over below above between around about cheap ' +
  'budget affordable splurge dollars bucks usd price priced cost costs notes note hint hints touch flavor flavors flavour flavours ' +
  'taste tastes tasting aromas aroma nose palate finish lots plenty'
).split(/\s+/));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words from curated producer names, so a producer called e.g. "Textbook" is still found by name
// even though "textbook" is also a lexicon synonym (of classic).
export function producerWords(producers: string[]): Set<string> {
  return new Set(producers.flatMap((p) => norm(p).split(/[^a-z0-9]+/)).filter((w) => w.length >= 3));
}

export function parse(qRaw: string, ph: Phrase[], producers: Set<string> = new Set()) {
  const raw = qRaw.toLowerCase();
  let q = ' ' + norm(qRaw).replace(/\s+/g, ' ') + ' ';
  const out = {
    type: null as string | null, min_price: null as number | null, max_price: null as number | null,
    notes: [] as Attr[], pairings: [] as Attr[], struct: {} as Record<string, number>,
    structLabels: [] as string[], terms: [] as string[],
  };

  // price
  let m: RegExpMatchArray | null;
  if ((m = q.match(/\$?\s?(\d{1,4})\s?(?:-|to|–)\s?\$?\s?(\d{1,4})/))) {
    out.min_price = +m[1]; out.max_price = +m[2]; q = q.replace(m[0], ' ');
  } else {
    if ((m = q.match(/(?:under|below|less than|max|up to|<)\s*\$?\s?(\d{1,4})/))) { out.max_price = +m[1]; q = q.replace(m[0], ' '); }
    if ((m = q.match(/(?:over|above|more than|at least|>)\s*\$?\s?(\d{1,4})/))) { out.min_price = +m[1]; q = q.replace(m[0], ' '); }
    if ((m = q.match(/\$\s?(\d{1,4})\b/))) { out.max_price = out.max_price ?? Math.round(+m[1] * 1.15); q = q.replace(m[0], ' '); }
  }
  if (out.max_price === null && /\b(cheap|budget|affordable|inexpensive|value|weeknight)\b/.test(q)) out.max_price = 25;
  if (out.min_price === null && /\b(splurge|special occasion|fancy|collectible)\b/.test(q)) out.min_price = 80;

  // types whose words collide with lexicon notes: rosé (≠ rose petal), orange wine (≠ orange)
  if (/rosé|\brosado\b|\brosato\b|\bpink\b|\brose wine\b/.test(raw)) {
    out.type = 'rose';
    q = q.replace(/\b(rose wine|rose|rosado|rosato|pink)\b/, ' ');
  }
  if (/\b(orange wine|amber wine|skin[- ]contact white)\b/.test(q)) { out.type = 'orange'; q = q.replace(/\b(orange|amber) wine\b/, ' '); }

  // lexicon phrases, longest first, each span consumed once
  const seen = new Set<string>();
  const nameTerms: string[] = [];
  for (const { phrase, attr } of ph) {
    const re = new RegExp(`(^|[^a-z])${esc(phrase)}(?:e?s)?(?=[^a-z]|$)`);
    if (!re.test(q)) continue;
    q = q.replace(re, '$1 ');
    // a note word that is also a producer's name counts as a keyword too (not pairings: "for salmon" ≠ Billecart-Salmon)
    if (attr.kind !== 'pairing' && producers.has(phrase)) nameTerms.push(phrase);
    if (seen.has(attr.key)) continue;
    seen.add(attr.key);
    (attr.kind === 'pairing' ? out.pairings : out.notes).push(attr);
  }

  // remaining wine types — after notes so 'white peach' / 'red cherry' don't set the colour
  if (!out.type) for (const [re, t] of TYPE_WORDS) if (re.test(q)) { out.type = t; q = q.replace(re, ' '); break; }

  // structure words
  for (const [re, s, label] of STRUCT_WORDS) {
    if (!re.test(q)) continue;
    for (const [k, v] of Object.entries(s)) if (!(k in out.struct)) out.struct[k] = v;
    out.structLabels.push(label);
    q = q.replace(re, ' ');
  }

  // leftover keywords: grapes, regions, producers…
  out.terms = [...new Set([...nameTerms, ...q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))])].slice(0, 8);
  return out;
}
