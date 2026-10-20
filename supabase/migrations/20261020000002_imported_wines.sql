-- Imported wines: a third source beside curated and member-added wines.
-- X-Wines labels (data/imports, CC0) arrive with grapes, place, body, pairings and community ratings; their
-- lexicon profiles are estimated from typicity (scripts/lib/profile.mjs), so they carry their own source and
-- the community stats that rank them.
alter table public.wines
  add column source text not null default 'member' check (source in ('curated', 'member', 'xwines')),
  add column source_id text,
  add column community_rating numeric(3,2) check (community_rating between 1 and 5),
  add column community_ratings integer check (community_ratings >= 0),
  add column seed_hash text;
update public.wines set source = 'curated' where is_curated;
create unique index wines_source_id_key on public.wines(source, source_id);
create index wines_community_idx on public.wines(community_ratings desc nulls last);

-- Members can't set or change provenance and community stats.
create or replace function public.wines_guard()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'INSERT' then
      new.flavor_vec := null; new.struct_vec := null; new.embedding := null; new.embedding_text := null;
      new.source := 'member'; new.source_id := null; new.seed_hash := null;
      new.community_rating := null; new.community_ratings := null;
    else
      new.flavor_vec := old.flavor_vec; new.struct_vec := old.struct_vec;
      new.embedding := old.embedding; new.embedding_text := old.embedding_text;
      new.is_curated := old.is_curated; new.created_by := old.created_by;
      new.source := old.source; new.source_id := old.source_id; new.seed_hash := old.seed_hash;
      new.community_rating := old.community_rating; new.community_ratings := old.community_ratings;
    end if;
  end if;
  new.search_tsv := to_tsvector('simple', extensions.unaccent(lower(
    coalesce(new.producer,'') || ' ' || coalesce(new.name,'') || ' ' || coalesce(new.appellation,'') || ' ' ||
    coalesce(new.region,'') || ' ' || coalesce(new.country,'') || ' ' || array_to_string(new.grapes, ' ') || ' ' ||
    replace(new.wine_type, 'rose', 'rose rosé pink'))));
  new.updated_at := now();
  return new;
end $$;

-- Curated loader: unchanged apart from tagging the source.
create or replace function public.seed_wines(p jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; v_id uuid; n int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    insert into public.wines(slug, name, producer, wine_type, country, region, appellation, grapes, price_usd, abv,
                             elevage, serve, decant, drink_window, description, is_curated, created_by, source)
    values (r->>'s', r->>'n', r->>'p', r->>'t', r->>'c', r->>'r', r->>'a',
            array(select jsonb_array_elements_text(r->'g')), (r->>'pr')::int, (r->>'abv')::numeric,
            r->>'e', r->>'sv', r->>'d', r->>'w', r->>'ds', true, null, 'curated')
    on conflict (slug) do update set name = excluded.name, producer = excluded.producer, wine_type = excluded.wine_type,
      country = excluded.country, region = excluded.region, appellation = excluded.appellation, grapes = excluded.grapes,
      price_usd = excluded.price_usd, abv = excluded.abv, elevage = excluded.elevage, serve = excluded.serve,
      decant = excluded.decant, drink_window = excluded.drink_window, description = excluded.description
    returning id into v_id;

    insert into public.wine_attributes(wine_id, attribute_id, intensity)
    select v_id, split_part(e, ':', 1)::smallint, split_part(e, ':', 2)::real / 100
    from unnest(string_to_array(r->>'x', ',')) e
    on conflict (wine_id, attribute_id) do update set intensity = excluded.intensity;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Imported loader (compact JSON from scripts/build-seed.mjs). Rows whose seed_hash is unchanged are skipped, so
-- re-applying the seed is cheap. { u: slug, cr, cn } rows only copy community stats onto a curated wine that the
-- import also lists (the import itself is dropped as a duplicate at build time).
create or replace function public.seed_imported_wines(p jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; v_id uuid; v_slug text; n int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    if r ? 'u' then
      update public.wines set community_rating = (r->>'cr')::numeric, community_ratings = (r->>'cn')::int
      where slug = r->>'u' and source = 'curated'
        and (community_rating, community_ratings) is distinct from ((r->>'cr')::numeric, (r->>'cn')::int);
      continue;
    end if;
    continue when exists (select 1 from public.wines w where w.source = r->>'src' and w.source_id = r->>'sid' and w.seed_hash = r->>'h');

    v_slug := r->>'s';
    if exists (select 1 from public.wines w where w.slug = v_slug and (w.source, w.source_id) is distinct from (r->>'src', r->>'sid')) then
      v_slug := v_slug || '-' || (r->>'sid');
    end if;
    insert into public.wines(slug, name, producer, wine_type, country, region, grapes, abv, description, is_curated, created_by,
                             source, source_id, community_rating, community_ratings, seed_hash)
    values (v_slug, r->>'n', r->>'p', r->>'t', r->>'c', r->>'r', array(select jsonb_array_elements_text(r->'g')),
            (r->>'abv')::numeric, r->>'ds', false, null, r->>'src', r->>'sid', (r->>'cr')::numeric, (r->>'cn')::int, r->>'h')
    on conflict (source, source_id) do update set slug = excluded.slug, name = excluded.name, producer = excluded.producer,
      wine_type = excluded.wine_type, country = excluded.country, region = excluded.region, grapes = excluded.grapes,
      abv = excluded.abv, description = excluded.description, community_rating = excluded.community_rating,
      community_ratings = excluded.community_ratings, seed_hash = excluded.seed_hash
    returning id into v_id;

    delete from public.wine_attributes wa where wa.wine_id = v_id
      and wa.attribute_id <> all (select split_part(e, ':', 1)::smallint from unnest(string_to_array(r->>'x', ',')) e);
    insert into public.wine_attributes(wine_id, attribute_id, intensity)
    select v_id, split_part(e, ':', 1)::smallint, split_part(e, ':', 2)::real / 100
    from unnest(string_to_array(r->>'x', ',')) e
    on conflict (wine_id, attribute_id) do update set intensity = excluded.intensity
      where wine_attributes.intensity is distinct from excluded.intensity;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.seed_imported_wines(jsonb) from public, anon, authenticated;

-- Ranking with ~12k imported wines:
--  · Imported wines of the same type, lead grape and region share an estimated profile, so lists show at most two
--    of each such "lookalike" group (curated and member wines are always their own group).
--  · A wine's match is its palate fit × a confidence factor: 0.92–1.0 from its community rating (curated wines
--    without one count as well rated), × 0.97 when the profile is estimated rather than tasted, so among
--    near-equal fits the better-loved, better-known bottle comes first.
create or replace function public._quality(p_rating numeric, p_estimated boolean)
returns real language sql immutable as $$
  select ((0.92 + 0.08 * coalesce(greatest(0, least(1, (p_rating - 3.5) / 1.1)), 0.75)) * case when p_estimated then 0.97 else 1 end)::real
$$;

create or replace function public.recommend_wines(
  p_limit int default 24,
  p_offset int default 0,
  p_type text default null,
  p_max_price int default null,
  p_min_price int default null,
  p_country text default null,
  p_include_rated boolean default false
)
returns table (
  id uuid, slug text, name text, producer text, wine_type text, country text, region text, appellation text,
  grapes text[], price_usd int, abv numeric, description text,
  match real, flavor_match real, structure_match real, style_match real,
  reasons jsonb, cautions jsonb
)
language sql stable security invoker set search_path = public, extensions as $$
  with me as (
    select p.* from public.palates p where p.user_id = auth.uid() and p.flavor_vec is not null
  ),
  scored as (
    select w.*,
      case when w.source = 'xwines' then w.wine_type || '|' || coalesce(w.grapes[1], '') || '|' || w.region else w.id::text end as look,
      public._quality(w.community_rating, w.source = 'xwines') as quality,
      sqrt(greatest(0, 1 - (w.flavor_vec <=> me.flavor_vec)))::real as f,
      public._struct_fit(me.struct_target, me.struct_mask, w.struct_vec) as s,
      ((coalesce((me.style_affinity ->> w.wine_type)::real, 0) + 1) / 2)::real as st,
      case when me.budget_max is not null and w.price_usd > me.budget_max
           then greatest(0.75, 1 - 0.25 * (w.price_usd::real / me.budget_max - 1)) else 1 end as budget
    from public.wines w cross join me
    where w.flavor_vec is not null
      and (p_type is null or w.wine_type = p_type)
      and (p_max_price is null or w.price_usd <= p_max_price)
      and (p_min_price is null or w.price_usd >= p_min_price)
      and (p_country is null or w.country = p_country)
      and (p_include_rated or not exists (select 1 from public.ratings r where r.user_id = auth.uid() and r.wine_id = w.id))
  ),
  raw as (
    select s.*, ((0.62 * s.f + 0.23 * s.s + 0.15 * s.st) * s.budget * s.quality)::real as raw from scored s
  ),
  capped as (
    select r.*, row_number() over (partition by r.look order by r.raw desc) as rn from raw r
  ),
  ranked as (
    select c.* from capped c where c.rn <= 2
    order by c.raw desc, c.community_ratings desc nulls last
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select r.id, r.slug, r.name, r.producer, r.wine_type, r.country, r.region, r.appellation, r.grapes, r.price_usd, r.abv, r.description,
    public._display_match(r.raw), round((100 * r.f)::numeric, 1)::real, round((100 * r.s)::numeric, 1)::real, round((100 * r.st)::numeric, 1)::real,
    coalesce((
      select jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label) order by x.contrib desc)
      from (
        select a.key, a.label, wa.intensity * pw.weight * c.weight as contrib
        from public.wine_attributes wa
        join public.palate_weights pw on pw.attribute_id = wa.attribute_id and pw.user_id = auth.uid()
        join public.attributes a on a.id = wa.attribute_id
        join public.attribute_categories c on c.key = a.category
        where wa.wine_id = r.id and pw.weight > 0 and a.kind = 'aroma'
        order by contrib desc limit 3
      ) x), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label) order by x.contrib)
      from (
        select a.key, a.label, wa.intensity * pw.weight * c.weight as contrib
        from public.wine_attributes wa
        join public.palate_weights pw on pw.attribute_id = wa.attribute_id and pw.user_id = auth.uid()
        join public.attributes a on a.id = wa.attribute_id
        join public.attribute_categories c on c.key = a.category
        where wa.wine_id = r.id and pw.weight < 0
        order by contrib limit 2
      ) x where x.contrib < -0.1), '[]'::jsonb)
  from ranked r
  order by r.raw desc, r.community_ratings desc nulls last
$$;

-- How well does one specific wine suit me? (wine detail page) — same quality factor as recommend_wines.
create or replace function public.wine_match(p_wine uuid)
returns jsonb language sql stable security invoker set search_path = public, extensions as $$
  with me as (select p.* from public.palates p where p.user_id = auth.uid() and p.flavor_vec is not null),
  w as (select * from public.wines where id = p_wine and flavor_vec is not null),
  s as (
    select sqrt(greatest(0, 1 - (w.flavor_vec <=> me.flavor_vec)))::real as f,
           public._struct_fit(me.struct_target, me.struct_mask, w.struct_vec) as st,
           ((coalesce((me.style_affinity ->> w.wine_type)::real, 0) + 1) / 2)::real as sty,
           public._quality(w.community_rating, w.source = 'xwines') as q
    from w, me
  )
  select jsonb_build_object(
    'match', public._display_match(((0.62 * f + 0.23 * st + 0.15 * sty) * q)::real),
    'flavor', round((100 * f)::numeric, 1), 'structure', round((100 * st)::numeric, 1), 'style', round((100 * sty)::numeric, 1),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label)) from (
        select a.key, a.label from public.wine_attributes wa
        join public.palate_weights pw on pw.attribute_id = wa.attribute_id and pw.user_id = auth.uid()
        join public.attributes a on a.id = wa.attribute_id
        where wa.wine_id = p_wine and pw.weight > 0 and a.kind = 'aroma'
        order by wa.intensity * pw.weight desc limit 4) x), '[]'::jsonb),
    'cautions', coalesce((select jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label)) from (
        select a.key, a.label from public.wine_attributes wa
        join public.palate_weights pw on pw.attribute_id = wa.attribute_id and pw.user_id = auth.uid()
        join public.attributes a on a.id = wa.attribute_id
        where wa.wine_id = p_wine and pw.weight < 0 and wa.intensity * pw.weight < -0.1
        order by wa.intensity * pw.weight limit 3) x), '[]'::jsonb))
  from s
$$;

-- Drinks alike: the 400 nearest by flavour (HNSW index), re-ranked with structure, at most two per lookalike group.
create or replace function public.similar_wines(p_wine uuid, p_limit int default 6)
returns table (id uuid, slug text, name text, producer text, wine_type text, country text, region text,
               appellation text, grapes text[], price_usd int, similarity real, shared jsonb)
language sql stable security invoker set search_path = public, extensions set hnsw.ef_search = 400 as $$
  with t as (select * from public.wines where id = p_wine),
  near as (
    select w.* from public.wines w
    where w.id <> p_wine and w.flavor_vec is not null
    order by w.flavor_vec <=> (select t.flavor_vec from t)
    limit 400
  ),
  scored as (
    select n.*, (0.75 * (1 - (n.flavor_vec <=> t.flavor_vec)) + 0.25 * (1 - (n.struct_vec <-> t.struct_vec) / sqrt(10)))::real as sim,
      row_number() over (
        partition by case when n.source = 'xwines' then n.wine_type || '|' || coalesce(n.grapes[1], '') || '|' || n.region else n.id::text end
        order by (0.75 * (1 - (n.flavor_vec <=> t.flavor_vec)) + 0.25 * (1 - (n.struct_vec <-> t.struct_vec) / sqrt(10))) desc) as rn
    from near n, t
  ),
  ranked as (
    select * from scored where rn <= 2
    order by sim desc, community_ratings desc nulls last
    limit least(greatest(p_limit, 1), 24)
  )
  select r.id, r.slug, r.name, r.producer, r.wine_type, r.country, r.region, r.appellation, r.grapes, r.price_usd,
    round((100 * r.sim)::numeric, 1)::real,
    coalesce((select jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label)) from (
      select a.key, a.label from public.wine_attributes x1
      join public.wine_attributes x2 on x2.attribute_id = x1.attribute_id and x2.wine_id = r.id
      join public.attributes a on a.id = x1.attribute_id
      where x1.wine_id = p_wine and a.kind = 'aroma'
      order by least(x1.intensity, x2.intensity) desc limit 3) x), '[]'::jsonb)
  from ranked r order by r.sim desc, r.community_ratings desc nulls last
$$;

-- Search: unchanged scoring × a light popularity factor (0.95–1.0 by number of community ratings; curated wines
-- count as well known), so among equally good matches the bottle people actually drink comes first.
create or replace function public.search_wines(
  p_embedding extensions.vector default null,
  p_attr_keys text[] default '{}',
  p_pairing_keys text[] default '{}',
  p_terms text[] default '{}',
  p_struct jsonb default '{}'::jsonb,
  p_type text default null,
  p_min_price int default null,
  p_max_price int default null,
  p_limit int default 24
)
returns table (id uuid, slug text, name text, producer text, wine_type text, country text, region text, appellation text,
               grapes text[], price_usd int, description text, score real, matched jsonb)
language sql stable security invoker set search_path = public, extensions as $$
  with
  attrs as (select a.id, a.key, a.label from public.attributes a where a.key = any(p_attr_keys) and a.kind in ('aroma','texture','style')),
  pairs as (select a.id, a.key, a.label from public.attributes a where a.key = any(p_pairing_keys) and a.kind = 'pairing'),
  terms as (
    select distinct t from (select regexp_replace(lower(extensions.unaccent(x)), '[^a-z0-9]', '', 'g') as t from unnest(p_terms) x) y
    where length(t) >= 3
  ),
  st as (select a.struct_index, (e.value)::real as target from jsonb_each_text(p_struct) e join public.attributes a on a.key = e.key and a.struct_index is not null),
  me as (select p.flavor_vec from public.palates p where p.user_id = auth.uid() and p.flavor_vec is not null),
  n as (select (select count(*) from attrs) as na, (select count(*) from pairs) as np, (select count(*) from terms) as nt,
               (select count(*) from st) as ns, (select count(*) from me) as nm),
  scored as (
    select w.*,
      case when p_embedding is null or w.embedding is null then null
           else greatest(0, least(1, ((1 - (w.embedding <=> p_embedding)) - 0.72) / 0.18)) end as sem,
      (select coalesce(sum(wa.intensity), 0) / greatest(n.na, 1) from public.wine_attributes wa join attrs on attrs.id = wa.attribute_id where wa.wine_id = w.id) as attr,
      (select count(*)::real / greatest(n.np, 1) from public.wine_attributes wa join pairs on pairs.id = wa.attribute_id where wa.wine_id = w.id) as pair,
      (select count(*)::real / greatest(n.nt, 1) from terms where w.search_tsv @@ to_tsquery('simple', terms.t || ':*')) as kw,
      (select coalesce(1 - avg(abs(st.target - (w.struct_vec::real[])[st.struct_index])), 0) from st) as sfit,
      (select sqrt(greatest(0, 1 - (w.flavor_vec <=> me.flavor_vec))) from me) as pers,
      n.*
    from public.wines w, n
    where w.flavor_vec is not null
      and (p_type is null or w.wine_type = p_type)
      and (p_max_price is null or w.price_usd <= p_max_price)
      and (p_min_price is null or w.price_usd >= p_min_price)
  ),
  final as (
    select s.*,
      ((coalesce(0.35 * s.sem, 0)
        + case when s.na > 0 then 0.35 * least(1, s.attr * 1.4) else 0 end
        + case when s.np > 0 then 0.15 * s.pair else 0 end
        + case when s.nt > 0 then 0.30 * s.kw else 0 end
        + case when s.ns > 0 then 0.15 * s.sfit else 0 end
        + case when s.nm > 0 then 0.10 * coalesce(s.pers, 0) else 0 end)
       / nullif((case when s.sem is not null then 0.35 else 0 end)
         + case when s.na > 0 then 0.35 else 0 end + case when s.np > 0 then 0.15 else 0 end
         + case when s.nt > 0 then 0.30 else 0 end + case when s.ns > 0 then 0.15 else 0 end
         + case when s.nm > 0 then 0.10 else 0 end, 0)
       * (0.95 + 0.05 * coalesce(least(1, ln(1 + s.community_ratings) / ln(20001)), case when s.source = 'curated' then 0.8 else 0.5 end)))::real as score
    from scored s
  )
  select f.id, f.slug, f.name, f.producer, f.wine_type, f.country, f.region, f.appellation, f.grapes, f.price_usd, f.description,
    round((100 * coalesce(f.score, 0))::numeric, 1)::real,
    jsonb_build_object(
      'notes', coalesce((select jsonb_agg(attrs.label) from public.wine_attributes wa join attrs on attrs.id = wa.attribute_id where wa.wine_id = f.id and wa.intensity >= 0.2), '[]'::jsonb),
      'pairings', coalesce((select jsonb_agg(pairs.label) from public.wine_attributes wa join pairs on pairs.id = wa.attribute_id where wa.wine_id = f.id), '[]'::jsonb))
  from final f
  order by f.score desc nulls last, f.community_ratings desc nulls last
  limit least(greatest(p_limit, 1), 60)
$$;

-- Countries with wines, for filters (a plain select would be capped at the API's row limit).
create or replace function public.wine_countries()
returns table (country text, wines bigint) language sql stable security invoker set search_path = public as $$
  select w.country, count(*) from public.wines w group by w.country order by w.country
$$;
grant execute on function public.wine_countries() to anon, authenticated;
