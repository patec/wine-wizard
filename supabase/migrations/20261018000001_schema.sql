-- Wine Wizard — core schema
-- Vectors: every lexicon attribute is a named dimension.
--   wines.flavor_vec  vector(384)  aroma + texture + style intensities × category weight (cosine)
--   wines.struct_vec  vector(16)   WSET structure scales 0..1 (weighted distance)
--   wines.embedding   vector(384)  gte-small embedding of a generated description (semantic search)
-- 384 / 16 leave headroom so the lexicon can grow without a column change.

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────── Lexicon ─────────────────────────
create table public.attribute_categories (
  key          text primary key,
  label        text not null,
  group_key    text not null,
  group_label  text not null,
  group_order  smallint not null,
  kind         text not null check (kind in ('aroma','texture','style','structure','pairing')),
  weight       real not null default 1 check (weight > 0),
  description  text,
  sort         smallint not null
);

create table public.attributes (
  id           smallint primary key,
  key          text not null unique,
  label        text not null,
  category     text not null references public.attribute_categories(key),
  kind         text not null check (kind in ('aroma','texture','style','structure','pairing')),
  synonyms     text[] not null default '{}',
  vec_index    smallint unique check (vec_index between 1 and 384),
  struct_index smallint unique check (struct_index between 1 and 16),
  weight       real not null default 1 check (weight > 0),
  scale_labels text[],
  sort         smallint not null
);
create index attributes_category_idx on public.attributes(category);

-- ───────────────────────── Wines ─────────────────────────
create table public.wines (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name           text not null check (char_length(name) between 1 and 200),
  producer       text not null check (char_length(producer) between 1 and 200),
  wine_type      text not null check (wine_type in ('red','white','rose','sparkling','orange','dessert','fortified')),
  country        text not null,
  region         text not null,
  appellation    text,
  grapes         text[] not null default '{}',
  vintage        smallint check (vintage between 1800 and 2100),
  price_usd      integer check (price_usd > 0 and price_usd < 100000),
  abv            numeric(4,1) check (abv between 0 and 25),
  elevage        text,
  serve          text,
  decant         text,
  drink_window   text,
  description    text check (char_length(description) <= 2000),
  is_curated     boolean not null default false,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  flavor_vec     extensions.vector(384),
  struct_vec     extensions.vector(16),
  embedding      extensions.vector(384),
  embedding_text text,
  search_tsv     tsvector,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index wines_type_idx on public.wines(wine_type);
create index wines_country_idx on public.wines(country);
create index wines_price_idx on public.wines(price_usd);
create index wines_search_idx on public.wines using gin(search_tsv);
create index wines_name_trgm_idx on public.wines using gin ((producer || ' ' || name) extensions.gin_trgm_ops);
create index wines_flavor_hnsw on public.wines using hnsw (flavor_vec extensions.vector_cosine_ops);
create index wines_embedding_hnsw on public.wines using hnsw (embedding extensions.vector_cosine_ops);
create index wines_created_by_idx on public.wines(created_by);

-- Intensity of each attribute in each wine. Structure attributes: 0..1 scale value.
create table public.wine_attributes (
  wine_id      uuid not null references public.wines(id) on delete cascade,
  attribute_id smallint not null references public.attributes(id),
  intensity    real not null check (intensity >= 0 and intensity <= 1),
  primary key (wine_id, attribute_id)
);
create index wine_attributes_attr_idx on public.wine_attributes(attribute_id);

-- ───────────────────────── People ─────────────────────────
create table public.palates (
  user_id            uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  display_name       text check (char_length(display_name) <= 80),
  quiz               jsonb,
  quiz_completed_at  timestamptz,
  style_prefs        jsonb not null default '{}'::jsonb,   -- quiz: wine_type -> -1..1
  struct_quiz        real[],                                -- quiz: struct_index-1 -> target (null = no opinion)
  budget_max         integer,
  -- computed by recompute_palate()
  flavor_vec         extensions.vector(384),
  struct_target      real[],
  struct_mask        real[],
  style_affinity     jsonb not null default '{}'::jsonb,
  rating_count       integer not null default 0,
  updated_at         timestamptz not null default now()
);

create table public.palate_weights (
  user_id        uuid not null references auth.users(id) on delete cascade,
  attribute_id   smallint not null references public.attributes(id),
  quiz_weight    real not null default 0 check (quiz_weight between -1 and 1),
  learned_weight real not null default 0 check (learned_weight between -1 and 1),
  weight         real not null default 0 check (weight between -1 and 1),
  primary key (user_id, attribute_id)
);
create index palate_weights_attr_idx on public.palate_weights(attribute_id);

create table public.ratings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  wine_id     uuid not null references public.wines(id) on delete cascade,
  rating      numeric(2,1) not null check (rating between 1 and 5 and (rating * 2) = floor(rating * 2)),
  notes       text check (char_length(notes) <= 4000),
  tasted_on   date default current_date,
  vintage     smallint check (vintage between 1800 and 2100),
  context     text check (context in ('tasting','onboarding','restaurant','home','gift')) default 'tasting',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, wine_id)
);
create index ratings_wine_idx on public.ratings(wine_id);

-- Notes the taster personally perceived and loved (+1) or disliked (-1) in a bottle.
create table public.rating_tags (
  rating_id    uuid not null references public.ratings(id) on delete cascade,
  attribute_id smallint not null references public.attributes(id),
  sentiment    smallint not null check (sentiment in (-1, 1)),
  primary key (rating_id, attribute_id)
);
create index rating_tags_attr_idx on public.rating_tags(attribute_id);

create table public.saved_wines (
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  wine_id    uuid not null references public.wines(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, wine_id)
);
create index saved_wines_wine_idx on public.saved_wines(wine_id);

-- ───────────────────────── RLS ─────────────────────────
alter table public.attribute_categories enable row level security;
alter table public.attributes          enable row level security;
alter table public.wines               enable row level security;
alter table public.wine_attributes     enable row level security;
alter table public.palates             enable row level security;
alter table public.palate_weights      enable row level security;
alter table public.ratings             enable row level security;
alter table public.rating_tags         enable row level security;
alter table public.saved_wines         enable row level security;

create policy "lexicon is public" on public.attribute_categories for select to anon, authenticated using (true);
create policy "attributes are public" on public.attributes for select to anon, authenticated using (true);

create policy "wines are public" on public.wines for select to anon, authenticated using (true);
create policy "members add wines" on public.wines for insert to authenticated
  with check (created_by = (select auth.uid()) and is_curated = false);
create policy "authors edit own wines" on public.wines for update to authenticated
  using (created_by = (select auth.uid()) and is_curated = false)
  with check (created_by = (select auth.uid()) and is_curated = false);
create policy "authors delete own wines" on public.wines for delete to authenticated
  using (created_by = (select auth.uid()) and is_curated = false);

create policy "wine attributes are public" on public.wine_attributes for select to anon, authenticated using (true);
create policy "authors insert own wine attributes" on public.wine_attributes for insert to authenticated
  with check (exists (select 1 from public.wines w where w.id = wine_id and w.created_by = (select auth.uid()) and not w.is_curated));
create policy "authors update own wine attributes" on public.wine_attributes for update to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id and w.created_by = (select auth.uid()) and not w.is_curated))
  with check (exists (select 1 from public.wines w where w.id = wine_id and w.created_by = (select auth.uid()) and not w.is_curated));
create policy "authors remove own wine attributes" on public.wine_attributes for delete to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id and w.created_by = (select auth.uid()) and not w.is_curated));

create policy "own palate" on public.palates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own palate weights" on public.palate_weights for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own ratings" on public.ratings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rating tags" on public.rating_tags for all to authenticated
  using (exists (select 1 from public.ratings r where r.id = rating_id and r.user_id = (select auth.uid())))
  with check (exists (select 1 from public.ratings r where r.id = rating_id and r.user_id = (select auth.uid())));
create policy "own saved wines" on public.saved_wines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Computed columns (vectors, search text) are protected by the guard trigger in the next migration.
