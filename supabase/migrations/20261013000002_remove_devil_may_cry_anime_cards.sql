begin;

do $$
declare
  target_card_ids uuid[] := '{}'::uuid[];
  target_instance_ids uuid[] := '{}'::uuid[];
  sale public.auctions%rowtype;
begin
  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into target_card_ids
  from public.cards
  where lower(btrim(franchise)) = lower('Devil May Cry')
    and upper(btrim(categorie)) = 'ANIME/MANGA';

  if cardinality(target_card_ids) = 0 then
    return;
  end if;

  perform id
  from public.user_cards
  where card_id = any(target_card_ids)
  order by id
  for update;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into target_instance_ids
  from public.user_cards
  where card_id = any(target_card_ids);

  update public.trade_offers
  set status = 'declined', updated_at = clock_timestamp()
  where status = 'pending'
    and (
      offered_card_ids && target_instance_ids
      or requested_card_ids && target_instance_ids
    );

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

    delete from public.auctions where id = sale.id;
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

  update public.decision_packs packs
  set kept_choice_id = null
  where kept_choice_id in (
    select choices.id
    from public.decision_pack_choices choices
    where choices.card_id = any(target_card_ids)
  );

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
