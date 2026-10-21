// Picks the X-Wines labels we import and writes data/imports/xwines.json.
// X-Wines (CC0, https://github.com/rogerioxavier/X-Wines): 100,646 wines and 21M community ratings collected in 2022.
// Selection: the TOP most-rated wines overall, plus every dessert/port wine with at least DESSERT_MIN ratings.
// usage: node scripts/xwines-select.mjs [--cache <dir>]   (downloads ~320 MB into the cache on first run; needs `unzip`)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const TOP = 12000;
const DESSERT_MIN = 100;
const FILES = {
  'wines.zip': '1my7LdDN2eNT7l7hJERH42EQ_TZikfrWu', // XWines_Full_100K_wines.zip
  'ratings.zip': '1tI-3XOoD4w_hYMGgj6OXU3EUI8xMQgj2', // XWines_Full_21M_ratings.zip
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = process.argv.indexOf('--cache');
const cache = arg > 0 ? path.resolve(process.argv[arg + 1]) : path.join(os.tmpdir(), 'xwines');
fs.mkdirSync(cache, { recursive: true });

for (const [name, id] of Object.entries(FILES)) {
  const dest = path.join(cache, name);
  if (fs.existsSync(dest)) continue;
  console.log(`downloading ${name}…`);
  const res = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Streams the single CSV inside a zip, line by line.
async function* zipLines(zip) {
  const child = spawn('unzip', ['-p', path.join(cache, zip)]);
  yield* readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
}

// Minimal RFC 4180 parser (quoted fields hold commas, e.g. "['Beef', 'Lamb']").
function parseCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
// "['Merlot', 'Malbec']" → ['Merlot', 'Malbec']
const pyList = (s) => [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"([^"]*)"/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);

console.log('counting ratings…');
const stats = new Map(); // WineID → [count, sum]
let first = true;
for await (const line of zipLines('ratings.zip')) {
  if (first) { first = false; continue; }
  const c = line.split(','); // RatingID,UserID,WineID,Vintage,Rating,Date — no quoted fields
  const s = stats.get(c[2]);
  if (s) { s[0]++; s[1] += +c[4]; } else stats.set(c[2], [1, +c[4]]);
}

const wines = [];
let header = null;
for await (const line of zipLines('wines.zip')) {
  const c = parseCsv(line);
  if (!header) { header = c; continue; }
  const r = Object.fromEntries(header.map((h, i) => [h, c[i]]));
  const [n, sum] = stats.get(r.WineID) ?? [0, 0];
  const abv = +r.ABV;
  if (!(abv >= 5 && abv <= 23)) continue; // a few rows carry 0.5 % or 45 %
  wines.push({
    id: +r.WineID, name: r.WineName.trim(), winery: r.WineryName.trim(), type: r.Type, elaborate: r.Elaborate,
    grapes: pyList(r.Grapes), harmonize: pyList(r.Harmonize), abv, body: r.Body, acidity: r.Acidity,
    country: r.Country, region: r.RegionName, ratings: n, rating: n ? Math.round((sum / n) * 100) / 100 : null,
  });
}

wines.sort((a, b) => b.ratings - a.ratings || a.id - b.id);
const sweet = (w) => w.type.startsWith('Dessert');
const picked = [...wines.slice(0, TOP), ...wines.slice(TOP).filter((w) => sweet(w) && w.ratings >= DESSERT_MIN)];
picked.sort((a, b) => a.id - b.id); // stable order keeps diffs small when the selection changes

const out = path.join(root, 'data', 'imports', 'xwines.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '[\n' + picked.map((w) => JSON.stringify(w)).join(',\n') + '\n]\n');
console.log(`${wines.length} wines read; wrote ${picked.length} (${picked.filter(sweet).length} dessert/port) → ${path.relative(root, out)}`);
