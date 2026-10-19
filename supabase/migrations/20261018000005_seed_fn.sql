-- Loader for curated wines (compact JSON produced by scripts/build-seed.mjs).
-- x = "attrId:intensity×100,…" covering structure, notes and pairings.
create or replace function public.seed_wines(p jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; v_id uuid; n int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    insert into public.wines(slug, name, producer, wine_type, country, region, appellation, grapes, price_usd, abv,
                             elevage, serve, decant, drink_window, description, is_curated, created_by)
    values (r->>'s', r->>'n', r->>'p', r->>'t', r->>'c', r->>'r', r->>'a',
            array(select jsonb_array_elements_text(r->'g')), (r->>'pr')::int, (r->>'abv')::numeric,
            r->>'e', r->>'sv', r->>'d', r->>'w', r->>'ds', true, null)
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
revoke execute on function public.seed_wines(jsonb) from public, anon, authenticated;
