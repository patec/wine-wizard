// Fuzzy identity between a curated wine and an imported label, so imports never duplicate a curated bottle.
// Same country, same colour, same producer, and neither name has a word the other lacks — except place names,
// which may appear in one name when they are the other wine's region ("Château Margaux" ≡ "Château Margaux
// (Premier Grand Cru Classé)", Lynch-Bages ≡ "Pauillac (Grand Cru Classé)", but not "Pavillon Rouge").
const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const FILLER = new Set((
  'chateau domaine domaines bodega bodegas tenuta weingut winery wines wine estate estates vineyards vineyard cellars the ' +
  'de du des la le les di del della dei da do dos y e et and co cantina cantine casa quinta vina vinedos famille maison ' +
  'azienda agricola grand cru classe classes premier premiere 1er ac aoc doc docg igt vdp brut champagne vin vino vinho by ' +
  'red rouge rosso tinto white blanc bianco branco rose rosado rosato' // colour is compared separately
).split(' '));
const tokens = (...xs) => new Set(xs.flat().flatMap((s) => norm(s).split(' ')).filter((t) => t && !FILLER.has(t)));
const sub = (a, ...bs) => [...a].every((t) => bs.some((b) => b.has(t)));
const minus = (a, b) => new Set([...a].filter((t) => !b.has(t)));

// curated types → colour; X-Wines types → colour
const colour = (t) => ({ red: 'red', rose: 'rose', sparkling: 'sparkling', fortified: 'fortified',
  Red: 'red', 'Rosé': 'rose', Sparkling: 'sparkling', 'Dessert/Port': 'fortified' })[t] ?? 'white';

const country = (s) => ({ usa: 'united states' })[norm(s)] ?? norm(s);

export function sameWine(c, x) {
  if (country(c.country) !== country(x.country) || colour(c.type) !== colour(x.type)) return false;
  const cp = tokens(c.producer), xp = tokens(x.winery);
  const [short, long] = cp.size <= xp.size ? [cp, xp] : [xp, cp];
  if (!short.size || !sub(short, long)) return false;
  const producer = new Set([...cp, ...xp]);
  const cn = minus(tokens(c.name), producer), xn = minus(tokens(x.name), producer);
  return sub(cn, xn, tokens(x.region)) && sub(xn, cn, tokens(c.appellation, c.region));
}
