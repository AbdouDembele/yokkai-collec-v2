begin;

do $$
declare
  target_card_ids uuid[];
  target_instance_ids uuid[];
  linked_auctions integer;
  pending_trades integer;
begin
  select coalesce(array_agg(id), '{}'::uuid[])
  into target_card_ids
  from public.cards
  where franchise = 'NieR:Automata Ver1.1a';

  if cardinality(target_card_ids) = 0 then
    return;
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into target_instance_ids
  from public.user_cards
  where card_id = any(target_card_ids);

  select count(*)
  into linked_auctions
  from public.auctions
  where card_instance_id = any(target_instance_ids);

  if linked_auctions <> 0 then
    raise exception 'NieR:Automata Ver1.1a cards still have % linked auction(s)', linked_auctions;
  end if;

  select count(*)
  into pending_trades
  from public.trade_offers
  where status = 'pending'
    and (
      offered_card_ids && target_instance_ids
      or requested_card_ids && target_instance_ids
    );

  if pending_trades <> 0 then
    raise exception 'NieR:Automata Ver1.1a cards still have % pending trade(s)', pending_trades;
  end if;

  update public.user_profiles
  set banner_card_id = null
  where banner_card_id = any(target_card_ids);

  update public.user_profiles
  set featured_card_ids = array(
    select instance_id
    from unnest(featured_card_ids) as instance_id
    where instance_id <> all(target_instance_ids)
  )
  where featured_card_ids && target_instance_ids;

  delete from public.card_shares
  where card_id = any(target_card_ids);

  delete from public.decision_pack_choices
  where card_id = any(target_card_ids);

  delete from public.user_cards
  where card_id = any(target_card_ids);

  delete from public.cards
  where id = any(target_card_ids);
end;
$$;

commit;
