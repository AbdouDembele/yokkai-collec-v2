begin;

create function public.list_admin_card_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(category order by category), '[]'::jsonb)
    from (
      select distinct categorie as category
      from public.cards
      where btrim(categorie) <> ''
    ) categories
  );
end;
$$;

revoke all on function public.list_admin_card_categories() from public, anon;
grant execute on function public.list_admin_card_categories() to authenticated;

commit;
