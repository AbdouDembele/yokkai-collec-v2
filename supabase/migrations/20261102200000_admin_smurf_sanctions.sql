begin;

-- A random, first-party browser token is hashed by the trusted route before it
-- reaches Postgres. It is corroborating context only and expires with the same
-- short window as network observations.
create table public.anticheat_device_observations (
  device_identity text not null check(device_identity~'^v[1-9][0-9]*:[a-f0-9]{64}$'),
  user_id uuid not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  observation_count integer not null default 1 check(observation_count between 1 and 1000000),
  primary key(device_identity,user_id),
  check(last_seen_at>=first_seen_at)
);
alter table public.anticheat_device_observations enable row level security;
revoke all on public.anticheat_device_observations from public,anon,authenticated,service_role;
create index anticheat_device_observations_user_idx
  on public.anticheat_device_observations(user_id,last_seen_at desc);
create index anticheat_device_observations_retention_idx
  on public.anticheat_device_observations(last_seen_at);

create function public.record_anticheat_device_observation(
  p_user_id uuid,p_device_identity text
) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); changed_user uuid;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then
    raise exception 'ANTICHEAT_USER_REQUIRED';
  end if;
  if p_device_identity is null or p_device_identity!~'^v[1-9][0-9]*:[a-f0-9]{64}$' then
    raise exception 'INVALID_DEVICE_IDENTITY';
  end if;
  delete from public.anticheat_device_observations
    where last_seen_at<stamp-interval '7 days';
  insert into public.anticheat_device_observations(
    device_identity,user_id,first_seen_at,last_seen_at,observation_count
  ) values(p_device_identity,p_user_id,stamp,stamp,1)
  on conflict(device_identity,user_id) do update set
    last_seen_at=stamp,
    observation_count=least(public.anticheat_device_observations.observation_count+1,1000000)
  where public.anticheat_device_observations.last_seen_at<=stamp-interval '15 minutes'
  returning user_id into changed_user;
  return changed_user is not null;
end; $$;
revoke all on function public.record_anticheat_device_observation(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_anticheat_device_observation(uuid,text)
  to service_role;

create table public.anticheat_smurf_sanctions (
  id uuid primary key default gen_random_uuid(),
  smurf_user_id uuid not null,
  primary_user_id uuid not null,
  admin_user_id uuid,
  accepted_trade_ids uuid[] not null,
  source_auction_ids uuid[] not null default '{}',
  recovered_card_ids uuid[] not null default '{}',
  recovered_trade_karas integer not null default 0 check(recovered_trade_karas>=0),
  recovered_sale_karas integer not null default 0 check(recovered_sale_karas>=0),
  recovered_karas integer not null default 0 check(recovered_karas>=0),
  note text not null check(length(note) between 10 and 2000),
  evidence jsonb not null,
  history jsonb not null,
  recovery_snapshot jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  check(smurf_user_id<>primary_user_id),
  check(recovered_karas=recovered_trade_karas+recovered_sale_karas)
);
alter table public.anticheat_smurf_sanctions enable row level security;
revoke all on public.anticheat_smurf_sanctions from public,anon,authenticated,service_role;
create unique index anticheat_smurf_sanctions_once
  on public.anticheat_smurf_sanctions(smurf_user_id,primary_user_id);
create trigger anticheat_smurf_sanctions_immutable
  before update or delete on public.anticheat_smurf_sanctions
  for each row execute function public.prevent_anticheat_ledger_mutation();

alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check(action in (
  'card.create','card.update','card.delete','card.import','card.bulk_delete',
  'player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change','wall_content.delete',
  'private_message.moderate','wall_media.moderate','anticheat.smurf_sanction'
));

create function public.admin_list_smurf_sanction_candidates(p_smurf_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from auth.users where id=p_smurf_user_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode='P0001';
  end if;
  with counterparties as materialized (
    select case when t.from_user=p_smurf_user_id then t.to_user else t.from_user end user_id,
      count(*)::integer accepted_trades,max(t.updated_at) last_trade_at
    from public.trade_offers t
    where t.status='accepted'
      and (t.from_user=p_smurf_user_id or t.to_user=p_smurf_user_id)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',c.user_id,'pseudo',coalesce(p.pseudo,'Deleted player'),
    'acceptedTrades',c.accepted_trades,'lastTradeAt',c.last_trade_at,
    'sharedNetwork',exists(select 1 from public.anticheat_network_observations own
      join public.anticheat_network_observations other on other.network_identity=own.network_identity
      where own.user_id=p_smurf_user_id and other.user_id=c.user_id
        and own.last_seen_at>=clock_timestamp()-interval '7 days'
        and other.last_seen_at>=clock_timestamp()-interval '7 days'),
    'sharedDevice',exists(select 1 from public.anticheat_device_observations own
      join public.anticheat_device_observations other on other.device_identity=own.device_identity
      where own.user_id=p_smurf_user_id and other.user_id=c.user_id
        and own.last_seen_at>=clock_timestamp()-interval '7 days'
        and other.last_seen_at>=clock_timestamp()-interval '7 days')
  ) order by c.last_trade_at desc,c.user_id),'[]'::jsonb) into result
  from (select * from counterparties order by last_trade_at desc,user_id limit 50) c
  left join public.user_profiles p on p.user_id=c.user_id;
  return result;
end; $$;

create function public.admin_preview_smurf_sanction(
  p_smurf_user_id uuid,p_primary_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb; shared_network boolean; shared_device boolean;
  trade_ids uuid[]; transferred_ids uuid[]; recoverable_ids uuid[]; sale_ids uuid[];
  accepted_trades integer; blocked_cards integer; missing_cards integer;
  trade_karas integer; sale_karas integer; kara_total integer;
  primary_balance integer; already_applied boolean;
  smurf_admin boolean; primary_admin boolean; smurf_banned boolean;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_smurf_user_id is null or p_primary_user_id is null or p_smurf_user_id=p_primary_user_id then
    raise exception 'INVALID_SMURF_PAIR' using errcode='P0001';
  end if;
  if not exists(select 1 from auth.users where id=p_smurf_user_id)
    or not exists(select 1 from auth.users where id=p_primary_user_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode='P0001';
  end if;

  select exists(select 1 from public.admin_users where user_id=p_smurf_user_id),
    exists(select 1 from public.admin_users where user_id=p_primary_user_id),
    coalesce((select u.banned_until>clock_timestamp() from auth.users u where u.id=p_smurf_user_id),false),
    coalesce((select p.karas_balance from public.user_profiles p where p.user_id=p_primary_user_id),0),
    exists(select 1 from public.anticheat_smurf_sanctions s
      where s.smurf_user_id=p_smurf_user_id and s.primary_user_id=p_primary_user_id)
  into smurf_admin,primary_admin,smurf_banned,primary_balance,already_applied;

  select exists(select 1 from public.anticheat_network_observations own
      join public.anticheat_network_observations other on other.network_identity=own.network_identity
      where own.user_id=p_smurf_user_id and other.user_id=p_primary_user_id
        and own.last_seen_at>=clock_timestamp()-interval '7 days'
        and other.last_seen_at>=clock_timestamp()-interval '7 days'),
    exists(select 1 from public.anticheat_device_observations own
      join public.anticheat_device_observations other on other.device_identity=own.device_identity
      where own.user_id=p_smurf_user_id and other.user_id=p_primary_user_id
        and own.last_seen_at>=clock_timestamp()-interval '7 days'
        and other.last_seen_at>=clock_timestamp()-interval '7 days')
  into shared_network,shared_device;

  with trades as materialized (
    select t.* from public.trade_offers t where t.status='accepted'
      and ((t.from_user=p_smurf_user_id and t.to_user=p_primary_user_id)
        or (t.from_user=p_primary_user_id and t.to_user=p_smurf_user_id))
  ), card_flows as materialized (
    select distinct unnest(case when t.from_user=p_smurf_user_id
      then t.offered_card_ids else t.requested_card_ids end) card_id from trades t
  )
  select coalesce((select array_agg(t.id order by t.updated_at,t.id) from trades t),'{}'::uuid[]),
    (select count(*)::integer from trades),
    coalesce((select array_agg(c.card_id order by c.card_id) from card_flows c),'{}'::uuid[]),
    greatest(coalesce((select sum(case when t.from_user=p_smurf_user_id
      then t.offered_karas-t.requested_karas else t.requested_karas-t.offered_karas end) from trades t),0),0)::integer
  into trade_ids,accepted_trades,transferred_ids,trade_karas;

  with source_transfers as materialized (
    select card_id,min(t.updated_at) received_at
    from public.trade_offers t
    cross join lateral unnest(case when t.from_user=p_smurf_user_id
      then t.offered_card_ids else t.requested_card_ids end) card_id
    where t.status='accepted'
      and ((t.from_user=p_smurf_user_id and t.to_user=p_primary_user_id)
        or (t.from_user=p_primary_user_id and t.to_user=p_smurf_user_id))
    group by card_id
  )
  select coalesce(array_agg(a.id order by a.created_at,a.id),'{}'::uuid[]),
    coalesce(sum(a.current_price),0)::integer
  into sale_ids,sale_karas
  from public.auctions a
  join source_transfers source on source.card_id=a.card_instance_id
  where a.status='sold' and a.seller_id=p_primary_user_id
    and a.created_at>=source.received_at;
  kara_total:=trade_karas+sale_karas;

  select coalesce(array_agg(uc.id order by uc.id) filter(where not uc.is_locked
      and not exists(select 1 from public.auctions a where a.card_instance_id=uc.id and a.status='active')
      and not exists(select 1 from public.trade_offers pending where pending.status='pending'
        and (uc.id=any(pending.offered_card_ids) or uc.id=any(pending.requested_card_ids)))),'{}'::uuid[]),
    count(*) filter(where uc.is_locked
      or exists(select 1 from public.auctions a where a.card_instance_id=uc.id and a.status='active')
      or exists(select 1 from public.trade_offers pending where pending.status='pending'
        and (uc.id=any(pending.offered_card_ids) or uc.id=any(pending.requested_card_ids))))::integer
  into recoverable_ids,blocked_cards
  from public.user_cards uc where uc.id=any(transferred_ids) and uc.user_id=p_primary_user_id;
  missing_cards:=cardinality(transferred_ids)-cardinality(recoverable_ids)-blocked_cards;

  result:=jsonb_build_object(
    'smurf',jsonb_build_object('userId',p_smurf_user_id,'pseudo',coalesce((select pseudo from public.user_profiles where user_id=p_smurf_user_id),'Deleted player'),'banned',smurf_banned),
    'primary',jsonb_build_object('userId',p_primary_user_id,'pseudo',coalesce((select pseudo from public.user_profiles where user_id=p_primary_user_id),'Deleted player'),'karasBalance',primary_balance),
    'evidence',jsonb_build_object('sharedNetwork',shared_network,'sharedDevice',shared_device,'acceptedTrades',accepted_trades),
    'recovery',jsonb_build_object(
      'cards',cardinality(recoverable_ids),'cardIds',recoverable_ids,
      'blockedCards',blocked_cards,'cardsNoLongerOnPrimary',missing_cards,
      'tradeKaras',trade_karas,'saleKaras',sale_karas,
      'saleCount',cardinality(sale_ids),'auctionIds',sale_ids,'karas',kara_total
    ),
    'history',jsonb_build_object(
      'trades',coalesce((select jsonb_agg(jsonb_build_object(
        'id',t.id,'acceptedAt',t.updated_at,'fromUser',t.from_user,'toUser',t.to_user,
        'offeredCards',t.offered_card_ids,'requestedCards',t.requested_card_ids,
        'offeredKaras',t.offered_karas,'requestedKaras',t.requested_karas
      ) order by t.updated_at,t.id) from public.trade_offers t where t.id=any(trade_ids)),'[]'::jsonb),
      'sales',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'cardInstanceId',a.card_instance_id,'sellerId',a.seller_id,
        'buyerId',a.buyer_id,'createdAt',a.created_at,'endsAt',a.ends_at,
        'karas',a.current_price
      ) order by a.created_at,a.id) from public.auctions a where a.id=any(sale_ids)),'[]'::jsonb)
    ),
    'receipt',(select jsonb_build_object('id',s.id,'appliedAt',s.applied_at,
      'note',s.note,'history',s.history,'recovery',s.recovery_snapshot)
      from public.anticheat_smurf_sanctions s
      where s.smurf_user_id=p_smurf_user_id and s.primary_user_id=p_primary_user_id),
    'alreadyApplied',already_applied,
    'eligible',shared_network and shared_device and accepted_trades>0
      and not smurf_admin and not primary_admin and not smurf_banned
      and not already_applied and blocked_cards=0
      and primary_balance>=kara_total
      and (cardinality(recoverable_ids)>0 or kara_total>0),
    'tradeIds',trade_ids
  );
  return result;
end; $$;

create function public.admin_apply_smurf_sanction(
  p_smurf_user_id uuid,p_primary_user_id uuid,p_note text,p_confirmation uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  preview jsonb; card_ids uuid[]; trade_ids uuid[]; sale_ids uuid[];
  trade_karas integer; sale_karas integer; kara_amount integer;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_confirmation is distinct from p_smurf_user_id then
    raise exception 'SMURF_CONFIRMATION_REQUIRED' using errcode='P0001';
  end if;
  p_note:=btrim(coalesce(p_note,''));
  if length(p_note) not between 10 and 2000 then raise exception 'INVALID_SANCTION_NOTE'; end if;

  perform 1 from auth.users where id in(p_smurf_user_id,p_primary_user_id) order by id for update;
  perform 1 from public.user_profiles where user_id in(p_smurf_user_id,p_primary_user_id) order by user_id for update;
  preview:=public.admin_preview_smurf_sanction(p_smurf_user_id,p_primary_user_id);
  if not coalesce((preview->>'eligible')::boolean,false) then
    raise exception 'SMURF_SANCTION_NOT_ELIGIBLE' using errcode='P0001';
  end if;
  select coalesce(array_agg(item.value::uuid order by item.value::uuid),'{}'::uuid[])
    into card_ids
    from jsonb_array_elements_text(preview#>'{recovery,cardIds}') as item(value);
  select coalesce(array_agg(item.value::uuid order by item.value::uuid),'{}'::uuid[])
    into trade_ids
    from jsonb_array_elements_text(preview->'tradeIds') as item(value);
  select coalesce(array_agg(item.value::uuid order by item.value::uuid),'{}'::uuid[])
    into sale_ids
    from jsonb_array_elements_text(preview#>'{recovery,auctionIds}') as item(value);
  trade_karas:=coalesce((preview#>>'{recovery,tradeKaras}')::integer,0);
  sale_karas:=coalesce((preview#>>'{recovery,saleKaras}')::integer,0);
  kara_amount:=coalesce((preview#>>'{recovery,karas}')::integer,0);

  perform 1 from public.auctions where id=any(sale_ids) order by id for update;
  if (select count(*) from public.auctions where id=any(sale_ids)
      and status='sold' and seller_id=p_primary_user_id)<>cardinality(sale_ids) then
    raise exception 'SMURF_SANCTION_ASSETS_CHANGED' using errcode='P0001';
  end if;
  perform 1 from public.user_cards where id=any(card_ids) order by id for update;
  if (select count(*) from public.user_cards where id=any(card_ids) and user_id=p_primary_user_id
      and not is_locked)<>cardinality(card_ids) then
    raise exception 'SMURF_SANCTION_ASSETS_CHANGED' using errcode='P0001';
  end if;
  update public.user_cards set user_id=p_smurf_user_id,folder_id=null,is_first_owner=false,
    date_obtention=clock_timestamp() where id=any(card_ids);
  update public.user_profiles set karas_balance=karas_balance-kara_amount
    where user_id=p_primary_user_id and karas_balance>=kara_amount;
  if not found then raise exception 'SMURF_SANCTION_ASSETS_CHANGED' using errcode='P0001'; end if;
  update public.user_profiles set karas_balance=karas_balance+kara_amount where user_id=p_smurf_user_id;

  update public.trade_offers set status='cancelled',updated_at=clock_timestamp()
    where status='pending'
      and (from_user=p_smurf_user_id or to_user=p_smurf_user_id);
  perform public.admin_set_user_ban(p_smurf_user_id,true);
  insert into public.anticheat_smurf_sanctions(
    smurf_user_id,primary_user_id,admin_user_id,accepted_trade_ids,source_auction_ids,
    recovered_card_ids,recovered_trade_karas,recovered_sale_karas,recovered_karas,
    note,evidence,history,recovery_snapshot
  ) values(
    p_smurf_user_id,p_primary_user_id,auth.uid(),trade_ids,sale_ids,
    card_ids,trade_karas,sale_karas,kara_amount,p_note,
    (preview->'evidence')||jsonb_build_object(
      'cardsNoLongerOnPrimary',preview#>'{recovery,cardsNoLongerOnPrimary}'
    ),preview->'history',preview->'recovery'
  );
  insert into public.admin_audit_logs(admin_user_id,action,metadata) values(
    auth.uid(),'anticheat.smurf_sanction',jsonb_build_object(
      'smurf_user_id',p_smurf_user_id,'primary_user_id',p_primary_user_id,
      'accepted_trade_ids',trade_ids,'source_auction_ids',sale_ids,
      'recovered_card_ids',card_ids,'recovered_trade_karas',trade_karas,
      'recovered_sale_karas',sale_karas,'recovered_karas',kara_amount,'note',p_note
    )
  );
  update public.anticheat_cases set status='reviewed',reviewed_at=clock_timestamp(),
    reviewed_by=auth.uid(),updated_at=clock_timestamp() where user_id=p_smurf_user_id;
  return jsonb_build_object('smurfUserId',p_smurf_user_id,'primaryUserId',p_primary_user_id,
    'cardsRecovered',cardinality(card_ids),'tradeKarasRecovered',trade_karas,
    'saleKarasRecovered',sale_karas,'karasRecovered',kara_amount,'banned',true);
end; $$;

revoke all on function public.admin_list_smurf_sanction_candidates(uuid),
  public.admin_preview_smurf_sanction(uuid,uuid),
  public.admin_apply_smurf_sanction(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_smurf_sanction_candidates(uuid),
  public.admin_preview_smurf_sanction(uuid,uuid),
  public.admin_apply_smurf_sanction(uuid,uuid,text,uuid)
  to authenticated;

notify pgrst,'reload schema';
commit;
