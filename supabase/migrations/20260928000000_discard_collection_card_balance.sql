begin;

-- Delete an owned collection card and return the balance produced by the same
-- transaction, so the UI never has to infer whether the credit was committed.
create function public.discard_collection_card(p_card_instance_id uuid)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  reward integer;
  balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select public.card_destruction_value(cards.rarete_base) into reward
    from public.user_cards owned
    join public.cards cards on cards.id = owned.card_id
    where owned.id = p_card_instance_id and owned.user_id = player_id
    for update of owned;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode = 'P0001'; end if;
  delete from public.user_cards where id = p_card_instance_id and user_id = player_id;
  balance := public.credit_karas(player_id, reward);
  return balance;
end;
$$;

revoke all on function public.discard_collection_card(uuid) from public, anon;
grant execute on function public.discard_collection_card(uuid) to authenticated;

commit;
