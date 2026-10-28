begin;

do $$
declare
  target_card_ids uuid[];
  target_instance_ids uuid[];
  pending_trades integer;
  sale public.auctions%rowtype;
begin
  select coalesce(array_agg(id), '{}'::uuid[])
  into target_card_ids
  from public.cards
  where franchise = 'Kirby: Right Back at Ya!';

  if cardinality(target_card_ids) = 0 then
    return;
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into target_instance_ids
  from public.user_cards
  where card_id = any(target_card_ids);

  select count(*)
  into pending_trades
  from public.trade_offers
  where status = 'pending'
    and (
      offered_card_ids && target_instance_ids
      or requested_card_ids && target_instance_ids
    );

  if pending_trades <> 0 then
    raise exception 'Kirby: Right Back at Ya! cards still have % pending trade(s)', pending_trades;
  end if;

  for sale in
    select *
    from public.auctions
    where status = 'active'
      and card_instance_id = any(target_instance_ids)
    order by id
    for update
  loop
    if sale.buyer_id is not null then
      perform public.credit_karas(sale.buyer_id, sale.current_price);
    end if;

    delete from public.auctions
    where id = sale.id;
  end loop;

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

  update public.user_cards
  set is_locked = false
  where id = any(target_instance_ids);

  delete from public.user_cards
  where card_id = any(target_card_ids);

  delete from public.cards
  where id = any(target_card_ids);
end;
$$;

commit;
