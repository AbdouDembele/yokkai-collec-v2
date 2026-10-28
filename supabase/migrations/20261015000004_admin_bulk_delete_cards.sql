-- Bulk catalogue deletion shares the exact single-card rules: the body of
-- admin_delete_card moves to an internal helper without any EXECUTE grant,
-- called by both the single and the bulk admin RPCs.
begin;

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check (action in (
  'card.create','card.update','card.delete','card.import','card.bulk_delete',
  'player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change'
));

-- Internal: no admin check, no audit. Only callable by the function owner,
-- i.e. from the SECURITY DEFINER admin RPCs below.
create or replace function public.admin_delete_card_core(p_card_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
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

  return jsonb_build_object(
    'snapshot', to_jsonb(target),
    'name', target.nom,
    'ownedCopiesRemoved', owned_count,
    'decisionChoicesRemoved', choice_count,
    'auctionsCancelled', cancelled_auction_count,
    'pendingTradesDeclined', declined_trade_count
  );
end;
$$;

revoke all on function public.admin_delete_card_core(uuid)
from public, anon, authenticated;

create or replace function public.admin_delete_card(p_card_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  result := public.admin_delete_card_core(p_card_id);

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
    result -> 'snapshot',
    jsonb_build_object(
      'owned_copies_removed', result -> 'ownedCopiesRemoved',
      'decision_choices_removed', result -> 'decisionChoicesRemoved',
      'auctions_cancelled', result -> 'auctionsCancelled',
      'pending_trades_declined', result -> 'pendingTradesDeclined'
    )
  );

  return result - 'snapshot';
end;
$$;

revoke all on function public.admin_delete_card(uuid)
from public, anon, authenticated;
grant execute on function public.admin_delete_card(uuid) to authenticated;

-- Shared guard for the bulk RPCs. Raises before anything is read or deleted.
create or replace function public.admin_bulk_card_ids(p_card_ids uuid[])
returns uuid[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- Keep in sync with MAX_BULK_DELETE_CARDS in app/admin/cards/bulk-delete.ts.
  max_cards constant integer := 500;
  ids uuid[];
  missing uuid[];
begin
  select coalesce(array_agg(distinct id order by id), '{}'::uuid[])
  into ids
  from unnest(coalesce(p_card_ids, '{}'::uuid[])) as id
  where id is not null;

  if cardinality(ids) = 0 then
    raise exception 'NO_CARDS_SELECTED' using errcode = 'P0001';
  end if;
  if cardinality(ids) > max_cards then
    raise exception 'BULK_LIMIT_EXCEEDED' using errcode = 'P0001',
      detail = format('max=%s requested=%s', max_cards, cardinality(ids));
  end if;

  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[])
  into missing
  from unnest(ids) as t(id)
  where not exists (select 1 from public.cards c where c.id = t.id);
  if cardinality(missing) > 0 then
    raise exception 'CARD_NOT_FOUND' using errcode = 'P0001',
      detail = array_to_string(missing, ',');
  end if;

  return ids;
end;
$$;

revoke all on function public.admin_bulk_card_ids(uuid[])
from public, anon, authenticated;

create or replace function public.admin_preview_delete_cards(p_card_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ids uuid[];
  instance_ids uuid[];
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  ids := public.admin_bulk_card_ids(p_card_ids);

  select coalesce(array_agg(id), '{}'::uuid[]) into instance_ids
  from public.user_cards where card_id = any(ids);

  return jsonb_build_object(
    'cards', cardinality(ids),
    'ownedCopies', cardinality(instance_ids),
    'activeAuctions', (
      select count(*) from public.auctions
      where status = 'active' and card_instance_id = any(instance_ids)
    ),
    'pendingTrades', (
      select count(*) from public.trade_offers
      where status = 'pending'
        and (offered_card_ids && instance_ids or requested_card_ids && instance_ids)
    ),
    'cardShares', (
      select count(*) from public.card_shares where card_id = any(ids)
    ),
    'wishlists', (
      select count(*) from public.wishlists where card_id = any(ids)
    ),
    'multiFranchiseCards', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.nom, 'franchises', f.names) order by c.nom)
      from public.cards c
      join lateral (
        select jsonb_agg(l.franchise order by l.position) names, count(*) total
        from public.card_franchises l where l.card_id = c.id
      ) f on f.total > 1
      where c.id = any(ids)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_preview_delete_cards(uuid[])
from public, anon, authenticated;
grant execute on function public.admin_preview_delete_cards(uuid[]) to authenticated;

-- One transaction: any failure (missing card, limit, constraint) rolls back
-- every deletion of the call.
create or replace function public.admin_delete_cards(p_card_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ids uuid[];
  target_id uuid;
  result jsonb;
  deleted jsonb := '[]'::jsonb;
  owned_count integer := 0;
  choice_count integer := 0;
  auction_count integer := 0;
  trade_count integer := 0;
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  ids := public.admin_bulk_card_ids(p_card_ids);

  -- Lock every target first, in a stable order, before the first deletion.
  perform c.id from public.cards c where c.id = any(ids) order by c.id for update;

  foreach target_id in array ids loop
    result := public.admin_delete_card_core(target_id);
    deleted := deleted || jsonb_build_array(result -> 'snapshot');
    owned_count := owned_count + (result ->> 'ownedCopiesRemoved')::integer;
    choice_count := choice_count + (result ->> 'decisionChoicesRemoved')::integer;
    auction_count := auction_count + (result ->> 'auctionsCancelled')::integer;
    trade_count := trade_count + (result ->> 'pendingTradesDeclined')::integer;
  end loop;

  insert into public.admin_audit_logs(admin_user_id, action, metadata)
  values (
    auth.uid(),
    'card.bulk_delete',
    jsonb_build_object(
      'card_count', cardinality(ids),
      'cards', deleted,
      'owned_copies_removed', owned_count,
      'decision_choices_removed', choice_count,
      'auctions_cancelled', auction_count,
      'pending_trades_declined', trade_count
    )
  );

  return jsonb_build_object(
    'cardsDeleted', cardinality(ids),
    'ownedCopiesRemoved', owned_count,
    'decisionChoicesRemoved', choice_count,
    'auctionsCancelled', auction_count,
    'pendingTradesDeclined', trade_count
  );
end;
$$;

revoke all on function public.admin_delete_cards(uuid[])
from public, anon, authenticated;
grant execute on function public.admin_delete_cards(uuid[]) to authenticated;

commit;
