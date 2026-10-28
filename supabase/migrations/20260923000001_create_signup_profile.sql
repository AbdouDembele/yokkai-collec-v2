begin;

-- Sign-up will pass options.data.pseudo to Supabase Auth.
-- A trigger creates the profile even when email confirmation is required.
create function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, pseudo)
  values (new.id, btrim(new.raw_user_meta_data ->> 'pseudo'));
  return new;
end;
$$;

revoke all on function public.handle_new_user_profile()
  from public, anon, authenticated;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

commit;
