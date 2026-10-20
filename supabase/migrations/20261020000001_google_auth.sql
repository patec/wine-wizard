-- Google sign-ins carry the person's name as full_name / name, not display_name.
-- Fall back to its first word so OAuth members are greeted like email sign-ups ("First name").
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.palates(user_id, display_name)
  values (new.id, nullif(left(coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1),
    ''), 80), ''))
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
