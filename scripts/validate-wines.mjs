// Validates seed wine files against the lexicon.
// usage: node scripts/validate-wines.mjs data/wines/*.json
import fs from 'node:fs';
import { flatAttributes, WINE_TYPES } from '../data/lexicon.mjs';

const attrs = flatAttributes();
const byKey = new Map(attrs.map((a) => [a.key, a]));
const STRUCT = attrs.filter((a) => a.kind === 'structure').map((a) => a.key);
const REQUIRED = ['slug', 'name', 'producer', 'type', 'country', 'region', 'grapes', 'price', 'abv', 'description', 'structure', 'notes', 'pairings'];

let errors = 0, total = 0;
const slugs = new Set();
const files = process.argv.slice(2);
for (const f of files) {
  let wines;
  try { wines = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`${f}: invalid JSON: ${e.message}`); errors++; continue; }
  if (!Array.isArray(wines)) { console.error(`${f}: top level must be an array`); errors++; continue; }
  for (const [i, w] of wines.entries()) {
    total++;
    const where = `${f}[${i}] ${w.slug ?? '?'}`;
    const err = (m) => { console.error(`${where}: ${m}`); errors++; };
    for (const k of REQUIRED) if (w[k] === undefined || w[k] === null || w[k] === '') err(`missing ${k}`);
    if (slugs.has(w.slug)) err('duplicate slug'); slugs.add(w.slug);
    if (w.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(w.slug)) err('slug must be kebab-case ascii');
    if (!WINE_TYPES.includes(w.type)) err(`bad type ${w.type}`);
    if (!Array.isArray(w.grapes) || !w.grapes.length) err('grapes must be non-empty array');
    if (typeof w.price !== 'number' || w.price <= 0) err('price must be positive number');
    if (typeof w.abv !== 'number' || w.abv < 5 || w.abv > 23) err('abv out of range');
    const s = w.structure || {};
    for (const k of STRUCT) {
      if (typeof s[k] !== 'number') err(`structure.${k} missing`);
      else if (s[k] < 0 || s[k] > 1) err(`structure.${k} out of 0..1`);
    }
    for (const k of Object.keys(s)) if (!STRUCT.includes(k)) err(`unknown structure key ${k}`);
    const notes = w.notes || {};
    const n = Object.keys(notes).length;
    if (n < 12) err(`only ${n} notes (need >= 12)`);
    if (n > 40) err(`${n} notes (max 40)`);
    for (const [k, v] of Object.entries(notes)) {
      const a = byKey.get(k);
      if (!a) err(`unknown note key ${k}`);
      else if (!['aroma', 'texture', 'style'].includes(a.kind)) err(`note ${k} is kind ${a.kind}; put it in ${a.kind === 'pairing' ? 'pairings' : 'structure'}`);
      if (typeof v !== 'number' || v <= 0 || v > 1) err(`note ${k} must be in (0,1]`);
    }
    if (!Array.isArray(w.pairings) || w.pairings.length < 2) err('need >= 2 pairings');
    for (const p of w.pairings || []) {
      const a = byKey.get(p);
      if (!a || a.kind !== 'pairing') err(`unknown pairing ${p}`);
    }
  }
}
console.log(`${total} wines checked, ${errors} errors`);
process.exit(errors ? 1 : 0);
