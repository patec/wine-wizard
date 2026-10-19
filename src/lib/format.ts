import type { WineType } from './types';

export const TYPE_LABEL: Record<WineType, string> = {
  red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', orange: 'Orange', dessert: 'Dessert', fortified: 'Fortified',
};
export const TYPES: WineType[] = ['red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified'];

export const GROUP_COLOR: Record<string, string> = {
  fruit: 'var(--g-fruit)', floral: 'var(--g-floral)', herbal: 'var(--g-herbal)', spice: 'var(--g-spice)',
  earth: 'var(--g-earth)', cellar: 'var(--g-cellar)', tertiary: 'var(--g-tertiary)', texture: 'var(--g-texture)', style: 'var(--g-style)',
};

export const price = (p: number | null | undefined) => (p == null ? '—' : `$${p.toLocaleString('en-US')}`);

export function origin(w: { appellation: string | null; region: string; country: string }) {
  const parts = [w.appellation, w.region, w.country].filter(Boolean) as string[];
  // avoid "Bordeaux, Bordeaux"
  return parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
}

export function scaleWord(labels: string[] | null | undefined, v: number) {
  if (!labels?.length) return '';
  return labels[Math.min(labels.length - 1, Math.max(0, Math.floor(v * labels.length)))];
}

export const STRUCT_ORDER = ['sweetness', 'acidity', 'tannin', 'alcohol', 'body', 'flavor_intensity', 'finish', 'oak_influence', 'effervescence', 'maturity'];
