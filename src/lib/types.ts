export type WineType = 'red' | 'white' | 'rose' | 'sparkling' | 'orange' | 'dessert' | 'fortified';

export interface Wine {
  id: string;
  slug: string;
  name: string;
  producer: string;
  wine_type: WineType;
  country: string;
  region: string;
  appellation: string | null;
  grapes: string[];
  vintage?: number | null;
  price_usd: number | null;
  abv?: number | null;
  elevage?: string | null;
  serve?: string | null;
  decant?: string | null;
  drink_window?: string | null;
  description?: string | null;
  is_curated?: boolean;
  created_by?: string | null;
  source?: 'curated' | 'member' | 'xwines';
  community_rating?: number | null;
  community_ratings?: number | null;
}

export interface NoteRef { key: string; label: string }

export interface Recommendation extends Wine {
  match: number;
  flavor_match: number;
  structure_match: number;
  style_match: number;
  reasons: NoteRef[];
  cautions: NoteRef[];
}

export interface Attribute {
  id: number;
  key: string;
  label: string;
  category: string;
  kind: 'aroma' | 'texture' | 'style' | 'structure' | 'pairing';
  synonyms: string[];
  scale_labels: string[] | null;
  sort: number;
}

export interface Category {
  key: string;
  label: string;
  group_key: string;
  group_label: string;
  group_order: number;
  kind: Attribute['kind'];
  weight: number;
  description: string | null;
  sort: number;
}

export interface WineAttribute { intensity: number; attributes: Attribute }

export interface PalateSummary {
  display_name: string | null;
  quiz_completed: boolean;
  rating_count: number;
  budget_max: number | null;
  styles: Partial<Record<WineType, number>>;
  loved: (NoteRef & { weight: number; category_label: string; group_label: string })[];
  avoided: (NoteRef & { weight: number; category_label: string; group_label: string })[];
  groups: { key: string; label: string; score: number }[];
  structure: { key: string; label: string; target: number; confidence: number; word: string | null }[];
}
