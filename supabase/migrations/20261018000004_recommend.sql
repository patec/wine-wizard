-- Wine Wizard — recommendation, similarity and search
--
-- match = 0.62 · √max(0, cos(palate_flavor, wine_flavor))     how much of what you love is in the glass
--       + 0.23 · max(0, 1 − 1.8 · weighted_rms(struct_target − wine_struct))   does its shape suit you
--       + 0.15 · (style_affinity[type] + 1) / 2                 do you drink this kind of wine
--   × soft budget penalty when above your stated budget
-- cos is signed: notes you avoid push a wine away.

create or replace function public._struct_fit(p_target real[], p_mask real[], p_wine extensions.vector)
returns real language sql immutable set search_path = public, extensions as $$
  select coalesce(greatest(0, 1 - 1.8 * sqrt(sum(u.m * (u.t - u.v) ^ 2) / nullif(sum(u.m), 0)))::real, 0.7)
  from unnest(p_target, p_mask, p_wine::real[]) with ordinality as u(t, m, v, i)
  where u.m > 0
    and not (u.i = 3 and u.v < 0.15)   -- tannin preference only applies to wines that have tannin
$$;

-- Display calibration: a gentle concave curve so a strong fit reads as a strong number (monotonic).
create or replace function public._display_match(raw real)
returns real language sql immutable set search_path = public as $$ select round((100 * (1 - power(greatest(0, least(1, 1 - raw)), 1.6)))::numeric, 1)::real $$;

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
  ranked as (
    select s.*, ((0.62 * s.f + 0.23 * s.s + 0.15 * s.st) * s.budget)::real as raw
    from scored s
    order by raw desc
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
  order by r.raw desc
$$;
grant execute on function public.recommend_wines(int, int, text, int, int, text, boolean) to authenticated;

-- How well does one specific wine suit me? (wine detail page)
create or replace function public.wine_match(p_wine uuid)
returns jsonb language sql stable security invoker set search_path = public, extensions as $$
  with me as (select p.* from public.palates p where p.user_id = auth.uid() and p.flavor_vec is not null),
  w as (select * from public.wines where id = p_wine and flavor_vec is not null),
  s as (
    select sqrt(greatest(0, 1 - (w.flavor_vec <=> me.flavor_vec)))::real as f,
           public._struct_fit(me.struct_target, me.struct_mask, w.struct_vec) as st,
           ((coalesce((me.style_affinity ->> w.wine_type)::real, 0) + 1) / 2)::real as sty
    from w, me
  )
  select jsonb_build_object(
    'match', public._display_match((0.62 * f + 0.23 * st + 0.15 * sty)::real),
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
grant execute on function public.wine_match(uuid) to authenticated;

-- Wines that drink alike: 75% flavor cosine, 25% structural closeness.
create or replace function public.similar_wines(p_wine uuid, p_limit int default 6)
returns table (id uuid, slug text, name text, producer text, wine_type text, country text, region text,
               appellation text, grapes text[], price_usd int, similarity real, shared jsonb)
language sql stable security invoker set search_path = public, extensions as $$
  with t as (select * from public.wines where id = p_wine),
  ranked as (
    select w.*, (0.75 * (1 - (w.flavor_vec <=> t.flavor_vec)) + 0.25 * (1 - (w.struct_vec <-> t.struct_vec) / sqrt(10)))::real as sim
    from public.wines w, t
    where w.id <> t.id and w.flavor_vec is not null
    order by sim desc
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
  from ranked r order by r.sim desc
$$;
grant execute on function public.similar_wines(uuid, int) to anon, authenticated;

-- Hybrid search: semantic embedding + lexicon attributes + pairings + keywords + structure, optionally personalised.
create or replace function public.search_wines(
  p_embedding extensions.vector(384) default null,
  p_attr_keys text[] default '{}',
  p_pairing_keys text[] default '{}',
  p_terms text[] default '{}',
  p_struct jsonb default '{}'::jsonb,
  p_type text default null,
  p_min_price int default null,
  p_max_price int default null,
  p_limit int default 24
)
returns table (id uuid, slug text, name text, producer text, wine_type text, country text, region text,
               appellation text, grapes text[], price_usd int, description text, score real, matched jsonb)
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
         + case when s.nm > 0 then 0.10 else 0 end, 0))::real as score
    from scored s
  )
  select f.id, f.slug, f.name, f.producer, f.wine_type, f.country, f.region, f.appellation, f.grapes, f.price_usd, f.description,
    round((100 * coalesce(f.score, 0))::numeric, 1)::real,
    jsonb_build_object(
      'notes', coalesce((select jsonb_agg(attrs.label) from public.wine_attributes wa join attrs on attrs.id = wa.attribute_id where wa.wine_id = f.id and wa.intensity >= 0.2), '[]'::jsonb),
      'pairings', coalesce((select jsonb_agg(pairs.label) from public.wine_attributes wa join pairs on pairs.id = wa.attribute_id where wa.wine_id = f.id), '[]'::jsonb))
  from final f
  order by f.score desc nulls last
  limit least(greatest(p_limit, 1), 60)
$$;
grant execute on function public.search_wines(extensions.vector, text[], text[], text[], jsonb, text, int, int, int) to anon, authenticated;

-- Lexicon usage stats (lexicon page)
create or replace view public.attribute_stats with (security_invoker = true) as
  select a.id, a.key, count(wa.wine_id)::int as wine_count, coalesce(avg(wa.intensity), 0)::real as avg_intensity
  from public.attributes a left join public.wine_attributes wa on wa.attribute_id = a.id and wa.intensity > 0
  group by a.id, a.key;
grant select on public.attribute_stats to anon, authenticated;
