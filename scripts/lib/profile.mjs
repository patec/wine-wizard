// Estimates a lexicon profile (structure, notes, pairings) for an imported X-Wines label from its grapes,
// place, style words, stated body/acidity/ABV and community rating. See data/typicity.mjs.
import { GRAPES, GRAPE_ALIASES, TYPE_DEFAULTS, STYLES, PLACES, PAIRINGS } from '../../data/typicity.mjs';
import { flatAttributes } from '../../data/lexicon.mjs';

const ATTRS = new Map(flatAttributes().map((a) => [a.key, a]));
const TYPES = { Red: 'red', White: 'white', 'Rosé': 'rose', Sparkling: 'sparkling', Dessert: 'dessert', 'Dessert/Port': 'fortified' };
const BODY = { 'Very light-bodied': 0.15, 'Light-bodied': 0.3, 'Medium-bodied': 0.5, 'Full-bodied': 0.72, 'Very full-bodied': 0.88 };
const ACIDITY = { Low: 0.35, Medium: 0.55, High: 0.75 };
const SWEETNESS = { red: 0.03, white: 0.06, rose: 0.08, sparkling: 0.1, orange: 0.03, dessert: 0.8, fortified: 0.8 };
const MAX_NOTES = 18;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const parseNotes = (s) => Object.fromEntries((s ?? '').split(/\s+/).filter(Boolean).map((t) => { const [k, v] = t.split(':'); return [k, v / 10]; }));
const parseStruct = (s) => { const [acidity, tannin, body, alcohol, oak_influence] = s.split(' ').map((d) => d / 10); return { acidity, tannin, body, alcohol, oak_influence }; };
// probabilistic OR: two sources agreeing on a note make it stronger, never above 1
const merge = (notes, add, w = 1) => { for (const [k, v] of Object.entries(add)) notes[k] = 1 - (1 - (notes[k] ?? 0)) * (1 - v * w); };

const grapeKey = (g) => { const k = GRAPE_ALIASES[g] ?? g; return GRAPES[k] ? k : null; };

export function profileImport(x) {
  const text = `${x.name} ${x.winery} ${x.region}`;
  const ctx = { ...x, text };
  let type = TYPES[x.type] ?? 'red';
  if (type === 'dessert' && x.abv >= 15) type = 'fortified';

  // ── grapes: weighted blend of typicity ──
  const known = x.grapes.map(grapeKey).filter(Boolean);
  const varietal = x.elaborate?.startsWith('Varietal');
  const weights = known.map((_, i) => (i === 0 ? 1 : varietal ? 0.25 / i : 0.75 ** i));
  const total = weights.reduce((a, b) => a + b, 0);
  const sources = known.length ? known.map((k, i) => [GRAPES[k], weights[i] / total]) : [[TYPE_DEFAULTS[type] ?? TYPE_DEFAULTS.red, 1]];

  const s = { acidity: 0, tannin: 0, body: 0, alcohol: 0, oak_influence: 0 };
  const notes = {};
  for (const [[st, n], w] of sources) {
    const ps = parseStruct(st);
    for (const k of Object.keys(s)) s[k] += ps[k] * w;
    for (const [k, v] of Object.entries(parseNotes(n))) notes[k] = (notes[k] ?? 0) + v * w;
  }
  // a blend partner contributes its signature but shouldn't dilute the lead grape's
  const top = Math.max(...Object.values(notes));
  for (const k of Object.keys(notes)) notes[k] = notes[k] / top * 0.9;

  // ── structure from facts where X-Wines has them ──
  const structure = {
    sweetness: SWEETNESS[type],
    acidity: 0.75 * s.acidity + 0.25 * (ACIDITY[x.acidity] ?? s.acidity),
    tannin: ['red', 'fortified'].includes(type) ? s.tannin : type === 'rose' ? 0.08 : 0,
    alcohol: clamp((x.abv - 9) / 7),
    body: BODY[x.body] !== undefined ? 0.4 * s.body + 0.6 * BODY[x.body] : s.body,
    flavor_intensity: 0.55,
    finish: 0.55,
    oak_influence: s.oak_influence,
    effervescence: type === 'sparkling' ? 0.88 : 0,
    maturity: 0.2,
  };
  if (type !== 'red' && type !== 'fortified') for (const k of Object.keys(notes)) if (/tannin$/.test(k)) delete notes[k];
  if (known[0] === 'Riesling' && x.country === 'Germany' && !/trocken|dry|gg|grosses/i.test(text)) structure.sweetness = 0.3;

  // ── place ──
  const nudge = (d = {}) => { for (const [k, v] of Object.entries(d)) structure[k] = clamp(structure[k] + v); };
  const drops = [];
  for (const p of PLACES) {
    if (!p.re.test(p.country ? x.country : x.region)) continue;
    nudge(p.s);
    merge(notes, parseNotes(p.n), 0.8);
    if (p.drop) drops.push(p.drop);
  }

  // ── style words ──
  const used = new Set();
  let label = null;
  for (const st of STYLES) {
    if (st.group && used.has(st.group)) continue;
    if (!st.re.test(text) || (st.when && !st.when(ctx))) continue;
    if (st.group) used.add(st.group);
    if (st.type) type = st.type;
    if (st.label) label ??= st.label;
    if (st.g) for (const k of Object.keys(notes)) notes[k] *= st.g;
    Object.assign(structure, st.s);
    merge(notes, parseNotes(st.n));
    if (st.drop) drops.push(st.drop);
  }
  if (type === 'fortified' && !used.has('base')) merge(notes, parseNotes(TYPE_DEFAULTS.fortified[1]) );
  if (type === 'dessert' && !used.has('base')) { structure.sweetness = Math.max(structure.sweetness, 0.75); merge(notes, parseNotes(TYPE_DEFAULTS.dessert[1])); }

  // ── community rating → intensity, length, polish ──
  const q = x.rating ? clamp((x.rating - 3.5) / 1.1) : 0.4;
  structure.flavor_intensity = clamp(0.45 + 0.4 * q + 0.1 * structure.body);
  structure.finish = clamp(0.4 + 0.5 * q);
  if (q > 0.55) merge(notes, { complex: 0.6 * q, concentrated: 0.4 * q });
  if (q < 0.25) { merge(notes, { approachable: 0.5, drink_now: 0.4 }); delete notes.age_worthy; delete notes.structured; }
  if (q < 0.2 && type === 'red' && PLACES[1].re.test(x.country)) structure.sweetness = Math.max(structure.sweetness, 0.1);

  for (const re of drops) for (const k of Object.keys(notes)) if (re.test(k)) delete notes[k];
  for (const [k, v] of Object.entries(structure)) structure[k] = r2(clamp(v));

  // ── keep the strongest notes ──
  const kept = Object.entries(notes)
    .filter(([k, v]) => ATTRS.has(k) && v >= 0.12)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_NOTES);
  const peak = kept[0]?.[1] ?? 1;
  const finalNotes = Object.fromEntries(kept.map(([k, v]) => [k, r2(clamp((v / peak) * 0.92, 0.05))]));

  // ── pairings ──
  const pairings = new Set(x.harmonize.map((h) => PAIRINGS[h]).filter(Boolean));
  if (type === 'fortified' && !/flor|walnut/.test(Object.keys(finalNotes).join(' '))) { pairings.add('blue_cheese'); pairings.add('chocolate_dessert'); }
  if (finalNotes.botrytized) { pairings.add('foie_gras'); pairings.add('blue_cheese'); }
  if (finalNotes.flor) { pairings.add('aperitif'); pairings.add('charcuterie'); }
  if (type === 'sparkling') { pairings.add('aperitif'); pairings.add('fried_food'); }
  if (type === 'red' && ['Zinfandel', 'Primitivo', 'Syrah', 'Malbec', 'Petite Sirah', 'Pinotage'].includes(known[0]) && structure.body >= 0.6) pairings.add('bbq');
  if (!pairings.size) pairings.add(type === 'red' ? 'beef' : 'aperitif');

  return { type, structure, notes: finalNotes, pairings: [...pairings], description: describe(x, type, label, structure, finalNotes, known) };
}

const BODY_WORDS = ['Light-bodied', 'Light-to-medium-bodied', 'Medium-bodied', 'Medium-to-full-bodied', 'Full-bodied'];
const TYPE_WORDS = { red: 'red', white: 'white', rose: 'rosé', sparkling: 'sparkling wine', dessert: 'dessert wine', fortified: 'fortified wine', orange: 'orange wine' };

function describe(x, type, label, s, notes, known) {
  const kind = (k) => ATTRS.get(k).kind;
  const aromas = Object.keys(notes).filter((k) => kind(k) === 'aroma').slice(0, 3).map((k) => ATTRS.get(k).label.toLowerCase());
  const feel = Object.keys(notes).filter((k) => kind(k) !== 'aroma' && !ATTRS.get(k).category.match(/winemaking|maturity/)).slice(0, 2).map((k) => ATTRS.get(k).label.toLowerCase());
  const body = BODY_WORDS[Math.min(4, Math.floor(s.body * 5))];
  const grape = known.length === 1 || x.elaborate?.startsWith('Varietal') ? x.grapes[0].replace(/\/.*/, '') : null;
  const what = label ?? (grape ? (['red', 'white'].includes(type) ? grape : `${grape} ${TYPE_WORDS[type]}`) : `${TYPE_WORDS[type]} blend`);
  const lead = `${body} ${what}`;
  const list = aromas.length > 1 ? `${aromas.slice(0, -1).join(', ')} and ${aromas.at(-1)}` : aromas[0];
  return `${lead} from ${x.region}, ${x.country}: ${list}${feel.length ? `, ${feel.join(' and ')}` : ''}.`;
}
