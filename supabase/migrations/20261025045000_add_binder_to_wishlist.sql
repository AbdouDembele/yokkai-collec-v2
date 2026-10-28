begin;

-- Adds every card of a binder that the player does not own yet to their
-- wishlist, in one call. p_binder is a stable binder key (series:/source:)
-- or, while stable binders are disabled, the legacy license name.
-- Returns the number of cards actually added.
create function public.add_binder_to_wishlist(p_binder text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  safe_binder text := btrim(coalesce(p_binder, ''));
  added integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if safe_binder = '' then raise exception 'BINDER_KEY_REQUIRED' using errcode = 'P0001'; end if;

  insert into public.wishlists(user_id, card_id)
  select distinct player_id, binder_cards.card_id
  from (
    select l.card_id from public.catalogue_binder_links l
    where safe_binder ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$'
      and l.binder_key = safe_binder
    union
    select links.card_id from public.card_franchises links
    where safe_binder !~ '^(series|source):' and links.franchise = safe_binder
  ) binder_cards
  where not exists (
    select 1 from public.user_cards uc
    where uc.user_id = player_id and uc.card_id = binder_cards.card_id
  )
  on conflict (user_id, card_id) do nothing;

  get diagnostics added = row_count;
  return added;
end;
$$;

revoke all on function public.add_binder_to_wishlist(text) from public, anon;
grant execute on function public.add_binder_to_wishlist(text) to authenticated;

notify pgrst, 'reload schema';
commit;
