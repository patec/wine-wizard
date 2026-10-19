-- Wine Wizard — personal palates
--
-- A palate is a signed weight per attribute (-1 avoid … +1 adore), blended from two sources:
--   quiz_weight     what you told us during onboarding
--   learned_weight  what your ratings reveal: Σ ((rating-3)/2 · intensity) normalised, plus tagged notes
-- Blend (Bayesian-style shrinkage): weight = (quiz·Q + learned·n) / (Q + n)
--   Q = 3 pseudo-ratings of prior strength once the quiz is done; n = Σ|rating-3|/2.
-- So the quiz drives early recommendations and your ratings take over as you taste.

-- Notes the taster personally perceived and loved / disliked in a bottle (lexicon keys).
-- (Arrays on the rating row; the earlier rating_tags table is unused.)
alter table public.ratings add column if not exists loved_notes text[] not null default '{}';
alter table public.ratings add column if not exists disliked_notes text[] not null default '{}';
comment on table public.rating_tags is 'Deprecated: superseded by ratings.loved_notes / ratings.disliked_notes';

create or replace function public.recompute_palate(p_user uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_quiz boolean := false;
  q real; n_eff real; v_count int;
  sq real[]; sp jsonb;
  fv real[]; nonzero boolean;
  st real[]; sm real[]; aff jsonb;
begin
  select quiz_completed_at is not null, struct_quiz, style_prefs into v_quiz, sq, sp
  from public.palates where user_id = p_user;
  if not found then
    insert into public.palates(user_id) values (p_user) on conflict do nothing;
    v_quiz := false; sp := '{}'::jsonb;
  end if;
  q := case when v_quiz then 3.0 else 0.0 end;

  select count(*), coalesce(sum(abs(rating - 3) / 2.0), 0) into v_count, n_eff
  from public.ratings where user_id = p_user;

  -- learned weights
  update public.palate_weights set learned_weight = 0 where user_id = p_user;

  insert into public.palate_weights(user_id, attribute_id, learned_weight)
  select p_user, x.attribute_id, greatest(-1, least(1, x.v))
  from (
    select coalesce(f.attribute_id, t.attribute_id) as attribute_id, coalesce(f.v, 0) + coalesce(t.v, 0) as v
    from (
      select wa.attribute_id, 1.6 * sum(((r.rating - 3) / 2.0) * wa.intensity) / (n_eff + 0.5) as v
      from public.ratings r
      join public.wine_attributes wa on wa.wine_id = r.wine_id
      join public.attributes a on a.id = wa.attribute_id
      where r.user_id = p_user and a.vec_index is not null and r.rating <> 3
      group by wa.attribute_id
    ) f
    full join (
      select a.id as attribute_id, 0.3 * sum(t.sentiment) as v
      from (
        select unnest(r.loved_notes) as k, 1 as sentiment from public.ratings r where r.user_id = p_user
        union all
        select unnest(r.disliked_notes), -1 from public.ratings r where r.user_id = p_user
      ) t join public.attributes a on a.key = t.k and a.vec_index is not null
      group by a.id
    ) t on t.attribute_id = f.attribute_id
  ) x
  where abs(x.v) > 0.01
  on conflict (user_id, attribute_id) do update set learned_weight = excluded.learned_weight;

  update public.palate_weights set weight = case
      when q + n_eff = 0 then 0
      else greatest(-1, least(1, (quiz_weight * q + learned_weight * n_eff) / (q + n_eff))) end
  where user_id = p_user;
  -- before the quiz is finished, quiz weights act on their own
  if not v_quiz then
    update public.palate_weights set weight = greatest(-1, least(1,
        case when n_eff > 0 then (quiz_weight + learned_weight * n_eff) / (1 + n_eff) else quiz_weight end))
    where user_id = p_user;
  end if;

  -- flavor vector (signed)
  select array_agg(coalesce(x.v, 0) order by i), bool_or(coalesce(x.v, 0) <> 0) into fv, nonzero
  from generate_series(1, 384) as i
  left join (
    select a.vec_index as idx, pw.weight * c.weight * a.weight as v
    from public.palate_weights pw
    join public.attributes a on a.id = pw.attribute_id
    join public.attribute_categories c on c.key = a.category
    where pw.user_id = p_user and a.vec_index is not null
  ) x on x.idx = i;

  -- structure target + confidence mask
  select array_agg(z.v order by z.i), array_agg(z.m order by z.i) into st, sm
  from (
    select i,
      coalesce(
        (coalesce(sq[i], 0) * (case when sq[i] is null then 0 else greatest(q, 1) end) + coalesce(lq.v, 0) * coalesce(lq.w, 0))
        / nullif((case when sq[i] is null then 0 else greatest(q, 1) end) + coalesce(lq.w, 0), 0),
        0.5) as v,
      case when sq[i] is not null then 1.0
           else least(1.0, coalesce(lq.w, 0) / 2.0) end as m
    from generate_series(1, 16) as i
    left join (
      select a.struct_index as idx, sum(r.s * wa.intensity) / sum(r.s) as v, sum(r.s) as w
      from (select wine_id, (rating - 3) / 2.0 as s from public.ratings where user_id = p_user and rating >= 3.5) r
      join public.wine_attributes wa on wa.wine_id = r.wine_id
      join public.attributes a on a.id = wa.attribute_id
      where a.struct_index is not null
        and not (a.struct_index = 3 and wa.intensity < 0.15)   -- learn tannin taste from tannic wines only
      group by a.struct_index
    ) lq on lq.idx = i
  ) z;

  -- style affinity per wine type (-1..1)
  select coalesce(jsonb_object_agg(t, round(v::numeric, 3)), '{}'::jsonb) into aff
  from (
    select t.t,
      coalesce(
        (coalesce((sp ->> t.t)::real, 0) * (case when sp ? t.t then 2 else 0 end) + coalesce(l.sum_s, 0))
        / nullif((case when sp ? t.t then 2 else 0 end) + coalesce(l.cnt, 0), 0), 0) as v
    from unnest(array['red','white','rose','sparkling','orange','dessert','fortified']) as t(t)
    left join (
      select w.wine_type, sum((r.rating - 3) / 2.0) as sum_s, count(*) as cnt
      from public.ratings r join public.wines w on w.id = r.wine_id
      where r.user_id = p_user group by w.wine_type
    ) l on l.wine_type = t.t
  ) s;

  update public.palates set
    flavor_vec = case when nonzero then fv::vector(384) end,
    struct_target = st,
    struct_mask = sm,
    style_affinity = aff,
    rating_count = v_count,
    updated_at = now()
  where user_id = p_user;
end $$;
revoke execute on function public.recompute_palate(uuid) from public, anon, authenticated;

-- Triggers: every rating or tag change re-learns the palate.
create or replace function public.ratings_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_palate(coalesce(new.user_id, old.user_id));
  return null;
end $$;
revoke execute on function public.ratings_changed() from public, anon, authenticated;
create trigger ratings_changed after insert or update or delete on public.ratings
for each row execute function public.ratings_changed();

-- New members get an empty palate.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.palates(user_id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''))
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ───────────── RPC: onboarding palate quiz ─────────────
-- p_quiz = {
--   styles:     { red: -1..1, white: …, rose, sparkling, orange, dessert, fortified },
--   families:   { <category key>: -1..1 },
--   notes_love: [attribute keys], notes_avoid: [attribute keys],
--   structure:  { sweetness|acidity|tannin|body|alcohol|oak_influence|effervescence|maturity|finish|flavor_intensity: 0..1 },
--   budget_max: int, wines_loved: [wine uuid]
-- }
create or replace function public.save_palate_quiz(p_quiz jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  sq real[];
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select array_agg((p_quiz -> 'structure' ->> a.key)::real order by i)
    into sq
  from generate_series(1, 16) i
  left join public.attributes a on a.struct_index = i;

  insert into public.palates(user_id) values (v_user) on conflict do nothing;
  update public.palates set
    quiz = p_quiz,
    quiz_completed_at = now(),
    style_prefs = coalesce(p_quiz -> 'styles', '{}'::jsonb),
    struct_quiz = sq,
    budget_max = nullif(p_quiz ->> 'budget_max', '')::int
  where user_id = v_user;

  update public.palate_weights set quiz_weight = 0 where user_id = v_user;

  -- family affinities spread across every attribute in the family
  insert into public.palate_weights(user_id, attribute_id, quiz_weight)
  select v_user, a.id, greatest(-1, least(1, 0.6 * (f.value)::real))
  from jsonb_each_text(coalesce(p_quiz -> 'families', '{}'::jsonb)) f
  join public.attributes a on a.category = f.key and a.vec_index is not null
  where (f.value)::real <> 0
  on conflict (user_id, attribute_id) do update set quiz_weight = excluded.quiz_weight;

  -- specific notes override the family default
  insert into public.palate_weights(user_id, attribute_id, quiz_weight)
  select v_user, a.id, 1.0
  from jsonb_array_elements_text(coalesce(p_quiz -> 'notes_love', '[]'::jsonb)) k
  join public.attributes a on a.key = k and a.vec_index is not null
  on conflict (user_id, attribute_id) do update set quiz_weight = excluded.quiz_weight;

  insert into public.palate_weights(user_id, attribute_id, quiz_weight)
  select v_user, a.id, -0.9
  from jsonb_array_elements_text(coalesce(p_quiz -> 'notes_avoid', '[]'::jsonb)) k
  join public.attributes a on a.key = k and a.vec_index is not null
  on conflict (user_id, attribute_id) do update set quiz_weight = excluded.quiz_weight;

  -- bottles they already love become ratings
  insert into public.ratings(user_id, wine_id, rating, context, tasted_on)
  select v_user, w.id, 4.5, 'onboarding', null
  from jsonb_array_elements_text(coalesce(p_quiz -> 'wines_loved', '[]'::jsonb)) k
  join public.wines w on w.id = k::uuid
  on conflict (user_id, wine_id) do nothing;

  perform public.recompute_palate(v_user);
end $$;
revoke execute on function public.save_palate_quiz(jsonb) from public, anon;
grant execute on function public.save_palate_quiz(jsonb) to authenticated;

-- ───────────── RPC: rate a bottle ─────────────
create or replace function public.rate_wine(
  p_wine uuid, p_rating numeric, p_notes text default null,
  p_loved text[] default '{}', p_disliked text[] default '{}',
  p_vintage smallint default null, p_tasted_on date default current_date, p_context text default 'tasting')
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.ratings(user_id, wine_id, rating, notes, vintage, tasted_on, context, loved_notes, disliked_notes)
  values (auth.uid(), p_wine, p_rating, nullif(trim(p_notes), ''), p_vintage, p_tasted_on, coalesce(p_context, 'tasting'),
          array(select a.key from public.attributes a where a.key = any(p_loved) and a.vec_index is not null),
          array(select a.key from public.attributes a where a.key = any(p_disliked) and a.vec_index is not null and not (a.key = any(p_loved))))
  on conflict (user_id, wine_id) do update set
    rating = excluded.rating, notes = excluded.notes, vintage = excluded.vintage,
    loved_notes = excluded.loved_notes, disliked_notes = excluded.disliked_notes,
    tasted_on = excluded.tasted_on, context = case when ratings.context = 'onboarding' then 'tasting' else excluded.context end,
    updated_at = now()
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function public.rate_wine(uuid, numeric, text, text[], text[], smallint, date, text) from public, anon;
grant execute on function public.rate_wine(uuid, numeric, text, text[], text[], smallint, date, text) to authenticated;

-- ───────────── RPC: palate summary for the profile page ─────────────
create or replace function public.my_palate_summary()
returns jsonb language sql stable security invoker set search_path = public as $$
  with me as (select * from public.palates where user_id = auth.uid()),
  w as (
    select pw.weight, pw.quiz_weight, pw.learned_weight, a.key, a.label, a.category, c.label as category_label,
           c.group_key, c.group_label, c.group_order
    from public.palate_weights pw
    join public.attributes a on a.id = pw.attribute_id
    join public.attribute_categories c on c.key = a.category
    where pw.user_id = auth.uid() and pw.weight <> 0
  ),
  groups as (
    select c.group_key, min(c.group_label) as group_label, min(c.group_order) as group_order
    from public.attribute_categories c where c.kind in ('aroma','texture','style') group by c.group_key
  ),
  group_scores as (
    select g.group_key, g.group_label, g.group_order,
      coalesce((select avg(t.weight) from (select w.weight from w where w.group_key = g.group_key order by w.weight desc limit 5) t), 0) as score
    from groups g
  ),
  struct as (
    select a.key, a.label, a.struct_index, me.struct_target[a.struct_index] as target, me.struct_mask[a.struct_index] as confidence
    from public.attributes a, me where a.struct_index is not null
  )
  select jsonb_build_object(
    'display_name', (select display_name from me),
    'quiz_completed', (select quiz_completed_at is not null from me),
    'rating_count', coalesce((select rating_count from me), 0),
    'budget_max', (select budget_max from me),
    'styles', coalesce((select style_affinity from me), '{}'::jsonb),
    'loved', coalesce((select jsonb_agg(to_jsonb(x) order by x.weight desc) from (select key, label, category_label, group_label, round(weight::numeric, 3) as weight from w where weight > 0.15 order by weight desc limit 18) x), '[]'::jsonb),
    'avoided', coalesce((select jsonb_agg(to_jsonb(x) order by x.weight) from (select key, label, category_label, group_label, round(weight::numeric, 3) as weight from w where weight < -0.15 order by weight limit 12) x), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('key', group_key, 'label', group_label, 'score', round(greatest(0, least(1, score))::numeric, 3)) order by group_order) from group_scores), '[]'::jsonb),
    'structure', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'target', round(coalesce(target, 0.5)::numeric, 3), 'confidence', round(coalesce(confidence, 0)::numeric, 3), 'word', public.scale_word(key, coalesce(target, 0.5)::real)) order by struct_index) from struct), '[]'::jsonb)
  )
$$;
grant execute on function public.my_palate_summary() to authenticated;
