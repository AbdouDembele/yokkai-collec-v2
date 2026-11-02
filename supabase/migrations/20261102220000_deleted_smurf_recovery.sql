begin;

-- A deleted identity is never recreated. Keep only the exact economic evidence
-- and the administrator's explicitly documented historical decision.
create table public.anticheat_deleted_smurf_recoveries (
  id uuid primary key default gen_random_uuid(),
  primary_user_id uuid not null,
  admin_user_id uuid,
  source_trade_ids uuid[] not null,
  source_auction_ids uuid[] not null default '{}',
  recovered_card_ids uuid[] not null default '{}',
  recovered_karas integer not null check(recovered_karas>=0),
  note text not null check(length(note) between 10 and 2000),
  evidence_reference text not null check(length(evidence_reference) between 10 and 2000),
  history jsonb not null,
  recovery_snapshot jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  check(cardinality(source_trade_ids) between 1 and 100)
);
create table public.anticheat_deleted_smurf_recovery_items (
  kind text not null check(kind in ('trade','auction')),
  item_id uuid not null,
  recovery_id uuid not null references public.anticheat_deleted_smurf_recoveries(id) on delete restrict,
  primary key(kind,item_id)
);
create index anticheat_deleted_smurf_recoveries_primary_idx
  on public.anticheat_deleted_smurf_recoveries(primary_user_id,applied_at desc);
create index anticheat_deleted_smurf_recovery_items_receipt_idx
  on public.anticheat_deleted_smurf_recovery_items(recovery_id);
alter table public.anticheat_deleted_smurf_recoveries enable row level security;
alter table public.anticheat_deleted_smurf_recovery_items enable row level security;
revoke all on public.anticheat_deleted_smurf_recoveries,
  public.anticheat_deleted_smurf_recovery_items from public,anon,authenticated,service_role;
create trigger anticheat_deleted_smurf_recoveries_immutable
  before update or delete on public.anticheat_deleted_smurf_recoveries
  for each row execute function public.prevent_anticheat_ledger_mutation();
create trigger anticheat_deleted_smurf_recovery_items_immutable
  before update or delete on public.anticheat_deleted_smurf_recovery_items
  for each row execute function public.prevent_anticheat_ledger_mutation();

alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check(action in (
  'card.create','card.update','card.delete','card.import','card.bulk_delete',
  'player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change','wall_content.delete',
  'private_message.moderate','wall_media.moderate','anticheat.smurf_sanction','anticheat.deleted_smurf_recovery'
));

-- Invoker helper, callable only by its owner through the guarded admin RPCs.
-- NULL means the deletion pipeline detached the other participant. It does not
-- identify that participant or, by itself, prove that this was a fraudulent gift.
create function public.anticheat_deleted_smurf_trade_scope(p_primary_user_id uuid)
returns table(
  trade_id uuid,accepted_at timestamptz,primary_is_sender boolean,
  incoming_card_ids uuid[],outgoing_card_ids uuid[],incoming_karas integer,outgoing_karas integer
) language sql stable set search_path='' as $$
  select t.id,t.updated_at,coalesce(t.from_user=p_primary_user_id,false),
    case when t.from_user=p_primary_user_id then t.requested_card_ids else t.offered_card_ids end,
    case when t.from_user=p_primary_user_id then t.offered_card_ids else t.requested_card_ids end,
    case when t.from_user=p_primary_user_id then t.requested_karas else t.offered_karas end,
    case when t.from_user=p_primary_user_id then t.offered_karas else t.requested_karas end
  from public.trade_offers t
  where t.status='accepted'
    and ((t.from_user=p_primary_user_id and t.to_user is null)
      or (t.to_user=p_primary_user_id and t.from_user is null))
    and not exists(select 1 from public.anticheat_deleted_smurf_recovery_items i
      where i.kind='trade' and i.item_id=t.id)
    and not exists(select 1 from public.anticheat_smurf_sanctions s where t.id=any(s.accepted_trade_ids))
$$;
revoke all on function public.anticheat_deleted_smurf_trade_scope(uuid)
  from public,anon,authenticated,service_role;

create function public.admin_preview_deleted_smurf_recovery(
  p_primary_user_id uuid,p_trade_ids uuid[] default '{}'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  selected_count integer; valid_selection boolean; is_admin boolean; balance integer;
  received_ids uuid[]; card_ids uuid[]; auction_ids uuid[];
  blocked_cards integer; missing_cards integer; trade_karas integer; sale_karas integer; total_karas integer;
  candidate_rows jsonb; trade_history jsonb; sale_history jsonb; recent_receipts jsonb; candidate_count integer;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_primary_user_id is null
    or not exists(select 1 from auth.users where id=p_primary_user_id)
    or not exists(select 1 from public.user_profiles where user_id=p_primary_user_id)
    or exists(select 1 from public.account_deletion_log where user_id=p_primary_user_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode='P0001';
  end if;
  p_trade_ids:=coalesce(p_trade_ids,'{}');
  if cardinality(p_trade_ids)>100 or array_position(p_trade_ids,null) is not null
    or cardinality(p_trade_ids)<>(select count(distinct id) from unnest(p_trade_ids) id) then
    raise exception 'INVALID_RECOVERY_TRADES' using errcode='P0001';
  end if;
  select exists(select 1 from public.admin_users where user_id=p_primary_user_id),karas_balance
    into is_admin,balance from public.user_profiles where user_id=p_primary_user_id;

  select count(*)::integer into candidate_count
    from public.anticheat_deleted_smurf_trade_scope(p_primary_user_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.trade_id,'acceptedAt',t.accepted_at,'incomingCards',cardinality(t.incoming_card_ids),
    'outgoingCards',cardinality(t.outgoing_card_ids),'incomingKaras',t.incoming_karas,'outgoingKaras',t.outgoing_karas
  ) order by t.accepted_at desc,t.trade_id),'[]'::jsonb) into candidate_rows
  from (select * from public.anticheat_deleted_smurf_trade_scope(p_primary_user_id)
    order by accepted_at desc,trade_id limit 100) t;

  with selected as materialized (
    select * from public.anticheat_deleted_smurf_trade_scope(p_primary_user_id) where trade_id=any(p_trade_ids)
  )
  select count(*)::integer,
    greatest(coalesce(sum(incoming_karas::bigint-outgoing_karas),0),0)::integer,
    coalesce((select array_agg(distinct id order by id) from selected s cross join lateral unnest(s.incoming_card_ids) id),'{}'::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'id',trade_id,'acceptedAt',accepted_at,'primaryIsSender',primary_is_sender,
      'incomingCardIds',incoming_card_ids,'outgoingCardIds',outgoing_card_ids,
      'incomingKaras',incoming_karas,'outgoingKaras',outgoing_karas,
      'deletedUserId',(select case when e.actor_user_id=p_primary_user_id then e.counterparty_user_id else e.actor_user_id end
        from public.anticheat_events e where e.event_type='trade_accepted' and e.subject_id=trade_id
          and e.actor_user_id is not null and e.counterparty_user_id is not null
          and (e.actor_user_id=p_primary_user_id or e.counterparty_user_id=p_primary_user_id)
        order by e.occurred_at,e.id limit 1)
    ) order by accepted_at,trade_id),'[]'::jsonb)
  into selected_count,trade_karas,received_ids,trade_history from selected;
  valid_selection:=cardinality(p_trade_ids)>0 and selected_count=cardinality(p_trade_ids);

  with transfers as materialized (
    select id,min(t.accepted_at) received_at
    from public.anticheat_deleted_smurf_trade_scope(p_primary_user_id) t
    cross join lateral unnest(t.incoming_card_ids) id
    where t.trade_id=any(p_trade_ids) group by id
  ), sales as materialized (
    select a.* from public.auctions a join transfers t on t.id=a.card_instance_id
    where a.seller_id=p_primary_user_id and a.status='sold' and a.created_at>=t.received_at
      and not exists(select 1 from public.anticheat_deleted_smurf_recovery_items i where i.kind='auction' and i.item_id=a.id)
      and not exists(select 1 from public.anticheat_smurf_sanctions s where a.id=any(s.source_auction_ids))
  )
  select coalesce(array_agg(id order by created_at,id),'{}'::uuid[]),coalesce(sum(current_price),0)::integer,
    coalesce(jsonb_agg(jsonb_build_object('id',id,'cardInstanceId',card_instance_id,
      'createdAt',created_at,'endsAt',ends_at,'karas',current_price) order by created_at,id),'[]'::jsonb)
  into auction_ids,sale_karas,sale_history from sales;
  total_karas:=trade_karas+sale_karas;

  with owned as materialized (
    select uc.id,uc.is_locked
      or exists(select 1 from public.auctions a where a.status='active' and a.card_instance_id=uc.id)
      or exists(select 1 from public.trade_offers t where t.status='pending'
        and (uc.id=any(t.offered_card_ids) or uc.id=any(t.requested_card_ids))) blocked
    from public.user_cards uc where uc.user_id=p_primary_user_id and uc.id=any(received_ids)
  )
  select coalesce(array_agg(id order by id) filter(where not blocked),'{}'::uuid[]),
    count(*) filter(where blocked)::integer into card_ids,blocked_cards from owned;
  missing_cards:=cardinality(received_ids)-cardinality(card_ids)-blocked_cards;

  select coalesce(jsonb_agg(value order by stamp desc),'[]'::jsonb) into recent_receipts from (
    select r.applied_at stamp,jsonb_build_object('id',r.id,'appliedAt',r.applied_at,'note',r.note,
      'evidenceReference',r.evidence_reference,'history',r.history,'recovery',r.recovery_snapshot) value
    from public.anticheat_deleted_smurf_recoveries r where r.primary_user_id=p_primary_user_id
    order by r.applied_at desc,r.id desc limit 10
  ) receipts;
  return jsonb_build_object(
    'primary',jsonb_build_object('userId',p_primary_user_id,'pseudo',(select pseudo from public.user_profiles where user_id=p_primary_user_id),'karasBalance',balance),
    'candidates',candidate_rows,'candidateCount',candidate_count,'selectedTradeIds',p_trade_ids,
    'selectionValid',valid_selection,
    'eligible',valid_selection and not is_admin and blocked_cards=0 and balance>=total_karas
      and (cardinality(card_ids)>0 or total_karas>0),
    'recovery',jsonb_build_object('cardIds',card_ids,'cards',cardinality(card_ids),'blockedCards',blocked_cards,
      'cardsNoLongerOnPrimary',missing_cards,'tradeKaras',trade_karas,'saleKaras',sale_karas,
      'saleCount',cardinality(auction_ids),'auctionIds',auction_ids,'karas',total_karas),
    'history',jsonb_build_object('trades',trade_history,'sales',sale_history),
    'receipts',recent_receipts
  );
end; $$;

create function public.admin_apply_deleted_smurf_recovery(
  p_primary_user_id uuid,p_trade_ids uuid[],p_note text,p_evidence_reference text,p_confirmation uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  preview jsonb; refreshed jsonb; card_ids uuid[]; auction_ids uuid[];
  receipt_id uuid:=gen_random_uuid(); amount integer; affected integer;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_confirmation is distinct from p_primary_user_id or p_primary_user_id is null then
    raise exception 'RECOVERY_CONFIRMATION_REQUIRED' using errcode='P0001';
  end if;
  p_note:=btrim(coalesce(p_note,''));
  p_evidence_reference:=btrim(coalesce(p_evidence_reference,''));
  if length(p_note) not between 10 and 2000 or length(p_evidence_reference) not between 10 and 2000 then
    raise exception 'HISTORICAL_EVIDENCE_REQUIRED' using errcode='P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deleted-smurf-recovery:'||p_primary_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_primary_user_id::text,0));
  perform 1 from public.trade_offers where id=any(p_trade_ids) order by id for update;
  perform 1 from public.user_profiles where user_id=p_primary_user_id for update;
  preview:=public.admin_preview_deleted_smurf_recovery(p_primary_user_id,p_trade_ids);
  if not coalesce((preview->>'eligible')::boolean,false) then
    raise exception 'DELETED_SMURF_RECOVERY_NOT_ELIGIBLE' using errcode='P0001';
  end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into auction_ids
    from jsonb_array_elements_text(preview#>'{recovery,auctionIds}') item(value);
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into card_ids
    from jsonb_array_elements_text(preview#>'{recovery,cardIds}') item(value);
  perform 1 from public.auctions where id=any(auction_ids) order by id for update;
  perform 1 from public.user_cards where id=any(card_ids) order by id for update;
  refreshed:=public.admin_preview_deleted_smurf_recovery(p_primary_user_id,p_trade_ids);
  if not coalesce((refreshed->>'eligible')::boolean,false) or refreshed->'recovery'<>preview->'recovery' then
    raise exception 'RECOVERY_ASSETS_CHANGED' using errcode='P0001';
  end if;
  amount:=(preview#>>'{recovery,karas}')::integer;

  insert into public.anticheat_deleted_smurf_recoveries(
    id,primary_user_id,admin_user_id,source_trade_ids,source_auction_ids,recovered_card_ids,
    recovered_karas,note,evidence_reference,history,recovery_snapshot
  ) values(receipt_id,p_primary_user_id,auth.uid(),p_trade_ids,auction_ids,card_ids,
    amount,p_note,p_evidence_reference,preview->'history',preview->'recovery');
  insert into public.anticheat_deleted_smurf_recovery_items(kind,item_id,recovery_id)
    select 'trade',id,receipt_id from unnest(p_trade_ids) id;
  insert into public.anticheat_deleted_smurf_recovery_items(kind,item_id,recovery_id)
    select 'auction',id,receipt_id from unnest(auction_ids) id;

  -- The source identity no longer exists: confiscate the traced assets rather
  -- than recreate an Auth identity, profile or destination balance.
  delete from public.user_cards where id=any(card_ids) and user_id=p_primary_user_id;
  get diagnostics affected=row_count;
  if affected<>cardinality(card_ids) then raise exception 'RECOVERY_ASSETS_CHANGED'; end if;
  update public.user_profiles set karas_balance=karas_balance-amount
    where user_id=p_primary_user_id and karas_balance>=amount;
  if not found then raise exception 'RECOVERY_ASSETS_CHANGED'; end if;
  insert into public.admin_audit_logs(admin_user_id,action,metadata) values(
    auth.uid(),'anticheat.deleted_smurf_recovery',jsonb_build_object(
      'recovery_id',receipt_id,'primary_user_id',p_primary_user_id,'source_trade_ids',p_trade_ids,
      'source_auction_ids',auction_ids,'recovered_card_ids',card_ids,'recovered_karas',amount,
      'note',p_note,'evidence_reference',p_evidence_reference
    )
  );
  return jsonb_build_object('receiptId',receipt_id,'cardsRecovered',cardinality(card_ids),'karasRecovered',amount);
end; $$;

revoke all on function public.admin_preview_deleted_smurf_recovery(uuid,uuid[]),
  public.admin_apply_deleted_smurf_recovery(uuid,uuid[],text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_deleted_smurf_recovery(uuid,uuid[]),
  public.admin_apply_deleted_smurf_recovery(uuid,uuid[],text,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
