begin;

do $$
declare
  target_id uuid := '70734b32-c6ac-4189-a115-0d998b31b586';
  target_instance_ids uuid[];
  matching_cards integer;
  linked_auctions integer;
  pending_trades integer;
begin
  select count(*)
  into matching_cards
  from public.cards
  where id = target_id
    and nom = 'HAE-IN CHA'
    and franchise = 'Solo Leveling'
    and rarete_base = 'SR'
    and source = 'anilist'
    and source_id = '138789';

  if matching_cards = 0 then
    return;
  end if;
  if matching_cards <> 1 then
    raise exception 'Expected exactly one HAE-IN CHA SR card, found %', matching_cards;
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into target_instance_ids
  from public.user_cards
  where card_id = target_id;

  select count(*)
  into linked_auctions
  from public.auctions
  where card_instance_id = any(target_instance_ids);

  if linked_auctions <> 0 then
    raise exception 'HAE-IN CHA SR still has % linked auction(s)', linked_auctions;
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
    raise exception 'HAE-IN CHA SR still has % pending trade(s)', pending_trades;
  end if;

  update public.user_profiles
  set banner_card_id = null
  where banner_card_id = target_id;

  update public.user_profiles
  set featured_card_ids = array(
    select instance_id
    from unnest(featured_card_ids) as instance_id
    where instance_id <> all(target_instance_ids)
  )
  where featured_card_ids && target_instance_ids;

  delete from public.card_shares where card_id = target_id;
  delete from public.decision_pack_choices where card_id = target_id;
  delete from public.user_cards where card_id = target_id;
  delete from public.cards where id = target_id;
end;
$$;

commit;
