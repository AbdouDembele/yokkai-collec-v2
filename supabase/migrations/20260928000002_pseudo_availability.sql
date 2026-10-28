begin;

create or replace function public.is_pseudo_available(p_pseudo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.user_profiles
    where lower(pseudo) = lower(btrim(p_pseudo))
  );
$$;

revoke all on function public.is_pseudo_available(text) from public;
grant execute on function public.is_pseudo_available(text) to anon, authenticated;

commit;
