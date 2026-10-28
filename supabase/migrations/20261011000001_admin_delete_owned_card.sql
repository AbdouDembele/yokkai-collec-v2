begin;

create or replace function public.admin_delete_card(p_card_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.cards%rowtype;
  target_instance_ids uuid[] := '{}'::uuid[];
  owned_count integer := 0;
  choice_count integer := 0;
  cancelled_auction_count integer := 0;
  declined_trade_count integer := 0;
  sale public.auctions%rowtype;
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  select * into target
  from public.cards
  where id = p_card_id
  for update;
  if not found then
    raise exception 'CARD_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform id
  from public.user_cards
  where card_id = p_card_id
  order by id
  for update;

  select coalesce(array_agg(id order by id), '{}'::uuid[]), count(*)
  into target_instance_ids, owned_count
  from public.user_cards
  where card_id = p_card_id;

  select count(*) into choice_count
  from public.decision_pack_choices
  where card_id = p_card_id;

  update public.trade_offers
  set status = 'declined', updated_at = clock_timestamp()
  where status = 'pending'
    and (
      offered_card_ids && target_instance_ids
      or requested_card_ids && target_instance_ids
    );
  get diagnostics declined_trade_count = row_count;

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
    cancelled_auction_count := cancelled_auction_count + 1;
  end loop;

  update public.user_profiles
  set banner_card_id = null
  where banner_card_id = p_card_id;

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
    where choices.card_id = p_card_id
  );

  delete from public.card_shares where card_id = p_card_id;
  delete from public.decision_pack_choices where card_id = p_card_id;

  update public.user_cards
  set is_locked = false
  where id = any(target_instance_ids);
  delete from public.user_cards where card_id = p_card_id;
  delete from public.cards where id = p_card_id;

  insert into public.admin_audit_logs(
    admin_user_id,
    action,
    card_id,
    card_snapshot,
    metadata
  ) values (
    auth.uid(),
    'card.delete',
    p_card_id,
    to_jsonb(target),
    jsonb_build_object(
      'owned_copies_removed', owned_count,
      'decision_choices_removed', choice_count,
      'auctions_cancelled', cancelled_auction_count,
      'pending_trades_declined', declined_trade_count
    )
  );

  return jsonb_build_object(
    'name', target.nom,
    'ownedCopiesRemoved', owned_count,
    'decisionChoicesRemoved', choice_count,
    'auctionsCancelled', cancelled_auction_count,
    'pendingTradesDeclined', declined_trade_count
  );
end;
$$;

revoke all on function public.admin_delete_card(uuid)
from public, anon, authenticated;
grant execute on function public.admin_delete_card(uuid) to authenticated;

commit;
