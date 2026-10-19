import type { SupabaseClient } from '@supabase/supabase-js';
import type { Attribute, Category, Wine } from './types';
import type { WheelNote } from '@/components/Charts';

export const CARD_FIELDS = 'id,slug,name,producer,wine_type,country,region,appellation,grapes,price_usd';

export interface WineWithAttrs extends Wine {
  wine_attributes: { intensity: number; attributes: Attribute }[];
}

export async function getCategories(sb: SupabaseClient): Promise<Map<string, Category>> {
  const { data } = await sb.from('attribute_categories').select('*').order('sort');
  return new Map((data ?? []).map((c: Category) => [c.key, c]));
}

export async function getWine(sb: SupabaseClient, slug: string): Promise<WineWithAttrs | null> {
  const { data } = await sb
    .from('wines')
    .select('*, wine_attributes(intensity, attributes(id,key,label,category,kind,synonyms,scale_labels,sort))')
    .eq('slug', slug)
    .maybeSingle();
  return (data as WineWithAttrs) ?? null;
}

export function wheelNotes(w: WineWithAttrs, cats: Map<string, Category>): WheelNote[] {
  return w.wine_attributes
    .filter((wa) => wa.attributes.kind === 'aroma' && wa.intensity > 0)
    .map((wa) => {
      const c = cats.get(wa.attributes.category);
      return { key: wa.attributes.key, label: wa.attributes.label, group: c?.group_key ?? 'fruit', groupLabel: c?.group_label ?? '', intensity: wa.intensity };
    });
}
