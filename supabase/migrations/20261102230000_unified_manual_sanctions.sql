begin;

-- Read names from current instances or preserved catalogue snapshots, never
-- infer a card's identity from its UUID. Owner-only helpers have no API grant.
create function public.anticheat_sanction_card_labels(p_trade_ids uuid[],p_card_ids uuid[])
returns jsonb language sql stable set search_path='' as $$
  with labels as (
    select uc.id::text id,c.nom name,uc.rarity::text rarity,c.franchise,0 priority
    from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.id=any(p_card_ids)
    union all
    select v->>'instanceId',v->>'name',v->>'rarity',v->>'anime',1
    from public.trade_offers t cross join lateral jsonb_array_elements(
      coalesce(t.offered_cards_snapshot,'[]')||coalesce(t.requested_cards_snapshot,'[]')) v
    where t.id=any(p_trade_ids) and v->>'instanceId'=any(p_card_ids::text[])
  ), chosen as (select distinct on(id) id,name,rarity,franchise from labels where name is not null order by id,priority,name)
  select coalesce(jsonb_object_agg(id,jsonb_build_object('name',name,'rarity',rarity,'franchise',franchise)),'{}') from chosen
$$;
revoke all on function public.anticheat_sanction_card_labels(uuid[],uuid[]) from public,anon,authenticated,service_role;

create function public.anticheat_stamp_sanction_card_names()
returns trigger language plpgsql set search_path='' as $$
declare trades uuid[]; copies uuid[];
begin
  if tg_table_name='anticheat_smurf_sanctions' then trades:=new.accepted_trade_ids;
  else trades:=new.source_trade_ids; end if;
  select coalesce(array_agg(distinct c),'{}'::uuid[]) into copies from public.trade_offers t
    cross join lateral unnest(t.offered_card_ids||t.requested_card_ids) c where t.id=any(trades);
  new.history:=new.history||jsonb_build_object('cardLabels',public.anticheat_sanction_card_labels(trades,copies));
  return new;
end; $$;
revoke all on function public.anticheat_stamp_sanction_card_names() from public,anon,authenticated,service_role;
create trigger anticheat_smurf_sanction_names before insert on public.anticheat_smurf_sanctions
  for each row execute function public.anticheat_stamp_sanction_card_names();
create trigger anticheat_deleted_smurf_recovery_names before insert on public.anticheat_deleted_smurf_recoveries
  for each row execute function public.anticheat_stamp_sanction_card_names();

-- This is the explicit manual-review path. Existing corroboration-only RPCs
-- keep their strict contract. A network match is context, not a prerequisite
-- for an administrator's separately documented decision.
create function public.admin_preview_sanction(
  p_subject_user_id uuid,p_mode text,p_primary_user_id uuid default null,p_trade_ids uuid[] default '{}'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; primary_id uuid; trades uuid[]; received uuid[]; owned uuid[];
  all_cards uuid[]; sales uuid[]; sale_amount integer; labels jsonb; eligible boolean; history jsonb; candidates jsonb;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_mode='active' then
    primary_id:=p_primary_user_id;
    result:=public.admin_preview_smurf_sanction(p_subject_user_id,primary_id);
    select coalesce(array_agg(v::uuid),'{}') into trades from jsonb_array_elements_text(result->'tradeIds') v;
    select coalesce(array_agg(distinct c),'{}') into received from public.trade_offers t
      cross join lateral unnest(case when t.from_user=p_subject_user_id then t.offered_card_ids else t.requested_card_ids end)c where t.id=any(trades);
    -- Recovered auction proceeds are globally single-use across both paths.
    select coalesce(array_agg(a.id order by a.created_at,a.id),'{}'),coalesce(sum(a.current_price),0)::integer into sales,sale_amount
    from public.auctions a where a.id in(select v::uuid from jsonb_array_elements_text(result#>'{recovery,auctionIds}')v)
      and not exists(select 1 from public.anticheat_deleted_smurf_recovery_items i where i.kind='auction' and i.item_id=a.id)
      and not exists(select 1 from public.anticheat_smurf_sanctions s where a.id=any(s.source_auction_ids));
    result:=jsonb_set(result,'{recovery}',(result->'recovery')||jsonb_build_object('auctionIds',sales,'saleCount',cardinality(sales),
      'saleKaras',sale_amount,'karas',(result#>>'{recovery,tradeKaras}')::integer+sale_amount));
    eligible:=not (result->>'alreadyApplied')::boolean and cardinality(trades)>0
      and not exists(select 1 from public.admin_users where user_id in(p_subject_user_id,primary_id))
      and not exists(select 1 from public.anticheat_deleted_smurf_recovery_items i where i.kind='trade' and i.item_id=any(trades));
  elsif p_mode='deleted' then
    primary_id:=p_subject_user_id;
    result:=public.admin_preview_deleted_smurf_recovery(primary_id,p_trade_ids);
    trades:=coalesce(p_trade_ids,'{}');
    select coalesce(array_agg(distinct c),'{}') into received from public.anticheat_deleted_smurf_trade_scope(primary_id)t
      cross join lateral unnest(t.incoming_card_ids)c where t.trade_id=any(trades);
    eligible:=(result->>'selectionValid')::boolean and not exists(select 1 from public.admin_users where user_id=primary_id);
  else raise exception 'INVALID_SANCTION_MODE'; end if;
  select coalesce(array_agg(id order by id),'{}') into owned from public.user_cards where user_id=primary_id and id=any(received);
  select coalesce(array_agg(distinct c),'{}') into all_cards from public.trade_offers t
    cross join lateral unnest(t.offered_card_ids||t.requested_card_ids)c where t.id=any(trades);
  labels:=public.anticheat_sanction_card_labels(trades,all_cards);
  history:=(result->'history')||jsonb_build_object('cardLabels',labels);
  if p_mode='active' then
    history:=jsonb_set(history,'{sales}',coalesce((select jsonb_agg(v) from jsonb_array_elements(history->'sales')v where (v->>'id')::uuid=any(sales)),'[]'));
  end if;
  result:=jsonb_set(result,'{history}',history);
  if p_mode='deleted' then
    select coalesce(jsonb_agg(candidate||jsonb_build_object(
      'incomingNames',(select coalesce(jsonb_agg(coalesce(v->>'name','')),'[]') from jsonb_array_elements(
        coalesce(case when t.from_user=primary_id then t.requested_cards_snapshot else t.offered_cards_snapshot end,
        public.trade_card_json(case when t.from_user=primary_id then t.requested_card_ids else t.offered_card_ids end)))v),
      'outgoingNames',(select coalesce(jsonb_agg(coalesce(v->>'name','')),'[]') from jsonb_array_elements(
        coalesce(case when t.from_user=primary_id then t.offered_cards_snapshot else t.requested_cards_snapshot end,
        public.trade_card_json(case when t.from_user=primary_id then t.offered_card_ids else t.requested_card_ids end)))v)
      ) order by ord),'[]') into candidates
    from jsonb_array_elements(result->'candidates') with ordinality item(candidate,ord)
    join public.trade_offers t on t.id=(candidate->>'id')::uuid;
    result:=jsonb_set(result,'{candidates}',candidates);
  end if;
  result:=jsonb_set(result,'{recovery}',(result->'recovery')||jsonb_build_object(
    'cards',cardinality(owned),'cardIds',owned,'cardsNoLongerOnPrimary',cardinality(received)-cardinality(owned),
    'activeAuctions',(select count(*) from public.auctions where status='active' and card_instance_id=any(owned)),
    'pendingTrades',(select count(*) from public.trade_offers where status='pending' and (offered_card_ids&&owned or requested_card_ids&&owned))));
  result:=result||jsonb_build_object('mode',p_mode,'cardLabels',labels,'eligible',eligible
    and (result#>>'{primary,karasBalance}')::integer>=(result#>>'{recovery,karas}')::integer
    and (p_mode='active' or cardinality(owned)>0 or (result#>>'{recovery,karas}')::integer>0));
  result:=result||jsonb_build_object('previewToken',md5(jsonb_build_object('recovery',result->'recovery','history',result->'history')::text));
  return result;
end; $$;

create function public.admin_apply_sanction(
  p_subject_user_id uuid,p_mode text,p_primary_user_id uuid,p_trade_ids uuid[],
  p_note text,p_evidence_reference text,p_confirmation uuid,p_preview_token text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare before_preview jsonb; preview jsonb; result jsonb; preparation jsonb;
  primary_id uuid; cards uuid[]; trades uuid[]; sales uuid[]; sale record;
  trade_amount integer; sale_amount integer; total integer; receipt_id uuid:=gen_random_uuid();
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_subject_user_id is null or p_confirmation is distinct from p_subject_user_id then raise exception 'SANCTION_CONFIRMATION_REQUIRED'; end if;
  p_note:=btrim(coalesce(p_note,''));
  if length(p_note) not between 10 and 2000 then raise exception 'INVALID_SANCTION_NOTE'; end if;
  p_evidence_reference:=btrim(coalesce(p_evidence_reference,''));
  if length(p_evidence_reference)>2000 then raise exception 'INVALID_SANCTION_EVIDENCE'; end if;
  primary_id:=case when p_mode='deleted' then p_subject_user_id else p_primary_user_id end;
  perform pg_advisory_xact_lock(hashtextextended('deleted-smurf-recovery:'||primary_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||u::text,0))
    from (select distinct unnest(array[p_subject_user_id,primary_id])u order by u)s;
  before_preview:=public.admin_preview_sanction(p_subject_user_id,p_mode,p_primary_user_id,p_trade_ids);
  if p_preview_token is distinct from before_preview->>'previewToken' then raise exception 'SANCTION_PREVIEW_CHANGED'; end if;
  if not coalesce((before_preview->>'eligible')::boolean,false) then raise exception 'MANUAL_SANCTION_NOT_ELIGIBLE'; end if;
  select coalesce(array_agg(v::uuid),'{}') into cards from jsonb_array_elements_text(before_preview#>'{recovery,cardIds}')v;
  if p_mode='active' then
    select coalesce(array_agg(v::uuid),'{}') into trades from jsonb_array_elements_text(before_preview->'tradeIds')v;
  else trades:=p_trade_ids; end if;
  select coalesce(array_agg(v::uuid),'{}') into sales from jsonb_array_elements_text(before_preview#>'{recovery,auctionIds}')v;
  -- Match economic mutation lock order: auctions/offers, profiles, then cards.
  perform 1 from public.auctions where id=any(sales) or (status='active' and card_instance_id=any(cards)) order by id for update;
  perform 1 from public.trade_offers where id=any(trades) or (status='pending' and (offered_card_ids&&cards or requested_card_ids&&cards
    or from_user=p_subject_user_id or to_user=p_subject_user_id)) order by id for update;
  perform 1 from auth.users where id in(p_subject_user_id,primary_id) order by id for update;
  perform 1 from public.user_profiles where user_id in(p_subject_user_id,primary_id)
    or user_id in(select buyer_id from public.auctions where status='active' and card_instance_id=any(cards)) order by user_id for update;
  perform 1 from public.user_cards where id=any(cards) order by id for update;
  preview:=public.admin_preview_sanction(p_subject_user_id,p_mode,p_primary_user_id,p_trade_ids);
  if not coalesce((preview->>'eligible')::boolean,false) or preview->'recovery'<>before_preview->'recovery' then raise exception 'RECOVERY_ASSETS_CHANGED'; end if;
  preparation:=jsonb_build_object('unlockedCardIds',coalesce((select jsonb_agg(id) from public.user_cards where id=any(cards) and is_locked),'[]'),
    'cancelledAuctions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'buyerId',buyer_id,'refund',case when buyer_id is null then 0 else current_price end)) from public.auctions where status='active' and card_instance_id=any(cards)),'[]'),
    'cancelledTradeIds',coalesce((select jsonb_agg(id) from public.trade_offers where status='pending' and (offered_card_ids&&cards or requested_card_ids&&cards)),'[]'));
  for sale in select * from public.auctions where status='active' and card_instance_id=any(cards) order by id loop
    if sale.buyer_id is not null then perform public.credit_karas(sale.buyer_id,sale.current_price); end if;
    -- Keep every bid as historical evidence; expired auctions hold no funds.
    update public.auctions set status='expired',buyer_id=null,current_price=starting_price where id=sale.id;
  end loop;
  update public.trade_offers set status='cancelled',updated_at=clock_timestamp()
    where status='pending' and (offered_card_ids&&cards or requested_card_ids&&cards);
  update public.user_cards set is_locked=false where id=any(cards) and is_locked;
  if p_mode='deleted' then
    result:=public.admin_apply_deleted_smurf_recovery(primary_id,trades,p_note,
      case when length(p_evidence_reference)>=10 then p_evidence_reference else p_note end,p_confirmation);
    insert into public.admin_audit_logs(admin_user_id,action,metadata) values(auth.uid(),'anticheat.deleted_smurf_recovery',
      jsonb_build_object('phase','manual_preparation','receipt_id',result->'receiptId','primary_user_id',primary_id,'preparation',preparation,'note',p_note));
    return result;
  end if;
  trade_amount:=(preview#>>'{recovery,tradeKaras}')::integer;
  sale_amount:=(preview#>>'{recovery,saleKaras}')::integer;
  total:=trade_amount+sale_amount;
  update public.user_cards set user_id=p_subject_user_id,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp()
    where id=any(cards) and user_id=primary_id;
  if (select count(*) from public.user_cards where id=any(cards) and user_id=p_subject_user_id)<>cardinality(cards) then raise exception 'RECOVERY_ASSETS_CHANGED'; end if;
  update public.user_profiles set karas_balance=karas_balance-total where user_id=primary_id and karas_balance>=total;
  if not found then raise exception 'RECOVERY_ASSETS_CHANGED'; end if;
  update public.user_profiles set karas_balance=karas_balance+total where user_id=p_subject_user_id;
  update public.trade_offers set status='cancelled',updated_at=clock_timestamp() where status='pending' and (from_user=p_subject_user_id or to_user=p_subject_user_id);
  perform public.admin_set_user_ban(p_subject_user_id,true);
  insert into public.anticheat_smurf_sanctions(id,smurf_user_id,primary_user_id,admin_user_id,accepted_trade_ids,source_auction_ids,
    recovered_card_ids,recovered_trade_karas,recovered_sale_karas,recovered_karas,note,evidence,history,recovery_snapshot)
    values(receipt_id,p_subject_user_id,primary_id,auth.uid(),trades,sales,cards,trade_amount,sale_amount,total,p_note,
      (preview->'evidence')||jsonb_build_object('manualDecision',true,'evidenceReference',p_evidence_reference),
      (preview->'history')||jsonb_build_object('preparation',preparation),preview->'recovery');
  insert into public.admin_audit_logs(admin_user_id,action,metadata) values(auth.uid(),'anticheat.smurf_sanction',
    jsonb_build_object('receipt_id',receipt_id,'smurf_user_id',p_subject_user_id,'primary_user_id',primary_id,'manualDecision',true,
      'recovered_card_ids',cards,'recovered_karas',total,'preparation',preparation,'note',p_note));
  update public.anticheat_cases set status='reviewed',reviewed_at=clock_timestamp(),reviewed_by=auth.uid(),updated_at=clock_timestamp() where user_id=p_subject_user_id;
  return jsonb_build_object('receiptId',receipt_id,'banned',true,'cardsRecovered',cardinality(cards),'karasRecovered',total);
end; $$;
revoke all on function public.admin_preview_sanction(uuid,text,uuid,uuid[]),
  public.admin_apply_sanction(uuid,text,uuid,uuid[],text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_sanction(uuid,text,uuid,uuid[]),
  public.admin_apply_sanction(uuid,text,uuid,uuid[],text,text,uuid,text) to authenticated;
create function public.admin_list_anticheat_connections(p_user_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; stamp timestamptz:=clock_timestamp();
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if cardinality(p_user_ids)>30 or array_position(p_user_ids,null) is not null then raise exception 'INVALID_CONNECTION_USERS'; end if;
  with users as (select distinct unnest(p_user_ids) user_id), links as materialized (
    select own.user_id,other.user_id other_id,max(least(own.last_seen_at,other.last_seen_at)) last_shared_at
    from public.anticheat_network_observations own join public.anticheat_network_observations other
      on other.network_identity=own.network_identity and other.user_id<>own.user_id
    where own.user_id=any(p_user_ids) and own.last_seen_at>=stamp-interval '7 days' and other.last_seen_at>=stamp-interval '7 days'
    group by own.user_id,other.user_id
  ) select coalesce(jsonb_object_agg(u.user_id::text,jsonb_build_object('count',(select count(*) from links l where l.user_id=u.user_id),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('userId',l.other_id,'pseudo',p.pseudo,'deleted',p.user_id is null,
      'lastSharedAt',l.last_shared_at,'sharedBrowser',exists(select 1 from public.anticheat_device_observations own
        join public.anticheat_device_observations other on other.device_identity=own.device_identity
        where own.user_id=u.user_id and other.user_id=l.other_id and own.last_seen_at>=stamp-interval '7 days' and other.last_seen_at>=stamp-interval '7 days'),
      'acceptedTrades',(select count(*) from public.trade_offers t where t.status='accepted' and
        ((t.from_user=u.user_id and t.to_user=l.other_id)or(t.to_user=u.user_id and t.from_user=l.other_id))))order by l.last_shared_at desc,l.other_id)
      from (select * from links where user_id=u.user_id order by last_shared_at desc,other_id limit 30)l
      left join public.user_profiles p on p.user_id=l.other_id),'[]'))),'{}') into result from users u;
  return result;
end; $$;
revoke all on function public.admin_list_anticheat_connections(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_connections(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
