-- Wine Wizard — wine vector construction
-- wine_attributes rows are the source of truth; vectors are derived and kept in sync by triggers.

-- Guarded columns may only be written by our security-definer functions (running as the table owner).
create or replace function public.wines_guard()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'INSERT' then
      new.flavor_vec := null; new.struct_vec := null; new.embedding := null; new.embedding_text := null;
    else
      new.flavor_vec := old.flavor_vec; new.struct_vec := old.struct_vec;
      new.embedding := old.embedding; new.embedding_text := old.embedding_text;
      new.is_curated := old.is_curated; new.created_by := old.created_by;
    end if;
  end if;
  new.search_tsv := to_tsvector('simple', extensions.unaccent(lower(
    coalesce(new.producer,'') || ' ' || coalesce(new.name,'') || ' ' || coalesce(new.appellation,'') || ' ' ||
    coalesce(new.region,'') || ' ' || coalesce(new.country,'') || ' ' || array_to_string(new.grapes, ' ') || ' ' ||
    replace(new.wine_type, 'rose', 'rose rosé pink'))));
  new.updated_at := now();
  return new;
end $$;

create trigger wines_guard before insert or update on public.wines
for each row execute function public.wines_guard();

-- Structure value → WSET-style word, e.g. acidity 0.72 → 'medium+'
create or replace function public.scale_word(p_key text, p_value real)
returns text language sql stable set search_path = public as $$
  select lower(a.scale_labels[least(array_length(a.scale_labels,1),
           greatest(1, floor(p_value * array_length(a.scale_labels,1))::int + 1))])
  from public.attributes a where a.key = p_key and a.scale_labels is not null
$$;

-- Text that gets embedded for semantic search.
create or replace function public.wine_embedding_text(p_wine uuid)
returns text language sql stable set search_path = public as $$
  with w as (select * from public.wines where id = p_wine),
  notes as (
    select string_agg(lower(a.label), ', ' order by wa.intensity desc) filter (where a.kind = 'aroma') as aromas,
           string_agg(lower(a.label), ', ' order by wa.intensity desc) filter (where a.kind in ('texture','style') and wa.intensity >= 0.35) as character,
           string_agg(lower(a.label), ', ' order by a.sort) filter (where a.kind = 'pairing') as pairings
    from public.wine_attributes wa join public.attributes a on a.id = wa.attribute_id
    where wa.wine_id = p_wine and (a.kind <> 'aroma' or wa.intensity >= 0.25)
  ),
  struct as (
    select string_agg(case when a.key in ('sweetness','effervescence') then public.scale_word(a.key, wa.intensity)
                           else public.scale_word(a.key, wa.intensity) || ' ' || lower(a.label) end, ', ' order by a.struct_index) as s
    from public.wine_attributes wa join public.attributes a on a.id = wa.attribute_id
    where wa.wine_id = p_wine and a.kind = 'structure'
      and (a.key in ('sweetness','acidity','tannin','body','alcohol','oak_influence') or (a.key = 'effervescence' and wa.intensity >= 0.3))
      and not (a.key = 'tannin' and wa.intensity < 0.15)
  )
  select concat_ws('. ',
    case when position(lower(w.producer) in lower(w.name)) > 0 then w.name else w.producer || ' ' || w.name end,
    initcap(replace(w.wine_type, 'rose', 'rosé')) || ' wine from ' || concat_ws(', ', w.appellation, w.region, w.country),
    'Grapes: ' || array_to_string(w.grapes, ', '),
    'Structure: ' || struct.s,
    'Aromas and flavors: ' || notes.aromas,
    'Character: ' || notes.character,
    'Pairs with ' || notes.pairings,
    w.description)
  from w, notes, struct
$$;

-- Rebuild a wine's flavor & structure vectors from its attribute rows.
create or replace function public.build_wine_vectors(p_wine uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  fv real[]; sv real[]; nonzero boolean; txt text;
begin
  select array_agg(coalesce(x.v, 0) order by i), bool_or(coalesce(x.v, 0) > 0)
    into fv, nonzero
  from generate_series(1, 384) as i
  left join (
    select a.vec_index as idx, wa.intensity * c.weight * a.weight as v
    from public.wine_attributes wa
    join public.attributes a on a.id = wa.attribute_id
    join public.attribute_categories c on c.key = a.category
    where wa.wine_id = p_wine and a.vec_index is not null
  ) x on x.idx = i;

  select array_agg(coalesce(x.v, 0) order by i) into sv
  from generate_series(1, 16) as i
  left join (
    select a.struct_index as idx, wa.intensity as v
    from public.wine_attributes wa join public.attributes a on a.id = wa.attribute_id
    where wa.wine_id = p_wine and a.struct_index is not null
  ) x on x.idx = i;

  txt := public.wine_embedding_text(p_wine);

  update public.wines w set
    flavor_vec = case when nonzero then fv::vector(384) end,
    struct_vec = sv::vector(16),
    embedding = case when w.embedding_text is distinct from txt then null else w.embedding end,
    embedding_text = txt
  where w.id = p_wine;
end $$;
revoke execute on function public.build_wine_vectors(uuid) from public, anon, authenticated;

create or replace function public.wine_attributes_ins() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; begin
  for r in select distinct wine_id from new_rows loop perform public.build_wine_vectors(r.wine_id); end loop; return null; end $$;
create or replace function public.wine_attributes_upd() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; begin
  for r in select distinct wine_id from new_rows union select distinct wine_id from old_rows loop perform public.build_wine_vectors(r.wine_id); end loop; return null; end $$;
create or replace function public.wine_attributes_del() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; begin
  for r in select distinct o.wine_id from old_rows o join public.wines w on w.id = o.wine_id loop perform public.build_wine_vectors(r.wine_id); end loop; return null; end $$;
revoke execute on function public.wine_attributes_ins() from public, anon, authenticated;
revoke execute on function public.wine_attributes_upd() from public, anon, authenticated;
revoke execute on function public.wine_attributes_del() from public, anon, authenticated;

create trigger wine_attributes_ins after insert on public.wine_attributes
  referencing new table as new_rows for each statement execute function public.wine_attributes_ins();
create trigger wine_attributes_upd after update on public.wine_attributes
  referencing new table as new_rows old table as old_rows for each statement execute function public.wine_attributes_upd();
create trigger wine_attributes_del after delete on public.wine_attributes
  referencing old table as old_rows for each statement execute function public.wine_attributes_del();

-- Rebuild embedding text when descriptive fields change (attributes unchanged).
create or replace function public.wines_text_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.name, new.producer, new.description, new.region, new.appellation, new.country, new.grapes, new.wine_type)
     is distinct from (old.name, old.producer, old.description, old.region, old.appellation, old.country, old.grapes, old.wine_type) then
    perform public.build_wine_vectors(new.id);
  end if;
  return null;
end $$;
revoke execute on function public.wines_text_changed() from public, anon, authenticated;
create trigger wines_text_changed after update on public.wines
for each row when (pg_trigger_depth() < 1) execute function public.wines_text_changed();

-- Called by the embed-wines edge function (service role) to store embeddings.
create or replace function public.set_wine_embedding(p_wine uuid, p_text text, p_embedding extensions.vector(384))
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  update public.wines set embedding = p_embedding where id = p_wine and embedding_text = p_text;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.set_wine_embedding(uuid, text, extensions.vector) from public, anon, authenticated;
grant execute on function public.set_wine_embedding(uuid, text, extensions.vector) to service_role;
