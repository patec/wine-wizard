-- Aroma fingerprints: a 7-axis radar per wine (one axis per aroma group), overlaid with the viewer's palate.
--
-- Wine axis = L2 norm of the group's note intensities, divided by that group's catalog p95 and clamped to 1.
-- The percentile scale stops Fruit (8 categories) from dominating every shape.
-- Palate axis = the same score /palate's radar uses (mean of the group's top-5 weights, clamped 0..1),
-- so the outline on a card matches the shape on the profile page. Negative weights clamp to 0 by design.

create table if not exists public.aroma_group_scale (
  group_key   text primary key,
  group_label text not null,
  group_order smallint not null,
  p95         real not null check (p95 > 0),
  updated_at  timestamptz not null default now()
);
alter table public.aroma_group_scale enable row level security;
drop policy if exists "aroma scale is public" on public.aroma_group_scale;
create policy "aroma scale is public" on public.aroma_group_scale for select to anon, authenticated using (true);

-- Recompute the per-group p95. Run after bulk seeding or imports; cheap enough to run any time.
create or replace function public.refresh_aroma_group_scale()
returns int language sql security definer set search_path = public as $$
  with raw as (
    select wa.wine_id, c.group_key, sqrt(sum(wa.intensity * wa.intensity)) as norm
    from public.wine_attributes wa
    join public.attributes a on a.id = wa.attribute_id
    join public.attribute_categories c on c.key = a.category
    where c.kind = 'aroma' and wa.intensity > 0
    group by wa.wine_id, c.group_key
  ),
  groups as (
    select group_key, min(group_label) as group_label, min(group_order) as group_order
    from public.attribute_categories where kind = 'aroma' group by group_key
  ),
  scales as (
    select g.group_key, g.group_label, g.group_order,
           greatest(0.05, coalesce((select percentile_cont(0.95) within group (order by r.norm) from raw r where r.group_key = g.group_key), 1))::real as p95
    from groups g
  ),
  up as (
    insert into public.aroma_group_scale(group_key, group_label, group_order, p95, updated_at)
    select group_key, group_label, group_order, p95, now() from scales
    on conflict (group_key) do update set group_label = excluded.group_label, group_order = excluded.group_order,
      p95 = excluded.p95, updated_at = now()
    returning 1
  )
  select count(*)::int from up
$$;
revoke execute on function public.refresh_aroma_group_scale() from public, anon, authenticated;

select public.refresh_aroma_group_scale();

-- Fingerprints for a page of wines, plus the caller's palate outline (null when signed out or no palate yet).
create or replace function public.aroma_fingerprints(p_ids uuid[])
returns jsonb language sql stable security invoker set search_path = public as $$
  with axes as (
    select group_key, group_label, group_order, p95 from public.aroma_group_scale
  ),
  raw as (
    select wa.wine_id, c.group_key, sqrt(sum(wa.intensity * wa.intensity)) as norm
    from public.wine_attributes wa
    join public.attributes a on a.id = wa.attribute_id
    join public.attribute_categories c on c.key = a.category
    where c.kind = 'aroma' and wa.intensity > 0 and wa.wine_id = any(p_ids)
    group by wa.wine_id, c.group_key
  ),
  wine_axes as (
    select w.id as wine_id,
           array_agg(round(least(1, coalesce(r.norm, 0) / ax.p95)::numeric, 3) order by ax.group_order) as v
    from unnest(p_ids) as w(id)
    cross join axes ax
    left join raw r on r.wine_id = w.id and r.group_key = ax.group_key
    group by w.id
  ),
  pw as (
    select pw.weight, c.group_key
    from public.palate_weights pw
    join public.attributes a on a.id = pw.attribute_id
    join public.attribute_categories c on c.key = a.category
    where pw.user_id = auth.uid() and pw.weight <> 0 and c.kind = 'aroma'
  ),
  palate as (
    select array_agg(round(greatest(0, least(1, coalesce(
             (select avg(t.weight) from (select pw.weight from pw where pw.group_key = ax.group_key order by pw.weight desc limit 5) t), 0)))::numeric, 3)
           order by ax.group_order) as v
    from axes ax
    where exists (select 1 from pw)
  )
  select jsonb_build_object(
    'axes', coalesce((select jsonb_agg(jsonb_build_object('key', group_key, 'label', group_label) order by group_order) from axes), '[]'::jsonb),
    'wines', coalesce((select jsonb_object_agg(wine_id, v) from wine_axes), '{}'::jsonb),
    'palate', (select to_jsonb(v) from palate)
  )
$$;
grant execute on function public.aroma_fingerprints(uuid[]) to anon, authenticated;
