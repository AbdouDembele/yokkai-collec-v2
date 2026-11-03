begin;

-- One bounded, read-only view of economic and recent connection links. Neither
-- a shared connection nor a browser token turns an account into a proven smurf.
create function public.admin_list_anticheat_related_accounts(
  p_subject_user_id uuid,p_query text default '',p_status text default '',
  p_limit integer default 30,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;stamp timestamptz:=now();
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin()then raise exception 'ADMIN_REQUIRED';end if;
  if p_subject_user_id is null or(not exists(select 1 from auth.users where id=p_subject_user_id)
    and not exists(select 1 from public.anticheat_deleted_accounts where user_id=p_subject_user_id))then raise exception 'PLAYER_NOT_FOUND';end if;
  p_query:=left(btrim(coalesce(p_query,'')),100);p_status:=coalesce(p_status,'');
  if p_status not in('','active','banned','deleted','archived')then raise exception 'INVALID_RELATED_ACCOUNT_FILTER';end if;
  p_limit:=least(greatest(coalesce(p_limit,30),1),50);p_offset:=greatest(coalesce(p_offset,0),0);
  with transfers as materialized(
    -- The private archive retains exact parties when live foreign keys have
    -- been nulled. Prefer that row and never count the same trade twice.
    select distinct on(kind,asset_id)*from(
      select e.kind,e.asset_id,e.from_user_id,e.to_user_id,e.offered_card_ids,e.requested_card_ids,
        e.offered_karas,e.requested_karas,e.occurred_at,0 priority
      from public.anticheat_deleted_account_transfers e where p_subject_user_id in(e.from_user_id,e.to_user_id)
      union all
      select 'trade',t.id,t.from_user,t.to_user,t.offered_card_ids,t.requested_card_ids,t.offered_karas,t.requested_karas,t.updated_at,1
      from public.trade_offers t where t.status='accepted'and p_subject_user_id in(t.from_user,t.to_user)
        and t.from_user is not null and t.to_user is not null
      union all
      select 'auction',a.id,a.seller_id,a.buyer_id,
        case when a.card_instance_id is null then '{}'::uuid[] else array[a.card_instance_id]end,'{}'::uuid[],
        0,a.current_price,least(a.ends_at,stamp),1
      from public.auctions a where a.status='sold'and p_subject_user_id in(a.seller_id,a.buyer_id)
        and a.seller_id is not null and a.buyer_id is not null
    )t order by kind,asset_id,priority
  ), economic as materialized(
    select case when from_user_id=p_subject_user_id then to_user_id else from_user_id end user_id,
      count(*)filter(where kind='trade')::integer accepted_trades,
      count(*)filter(where kind='auction')::integer sold_auctions,
      count(*)filter(where public.anticheat_deleted_transfer_available(kind,asset_id))::integer available_transfers,
      sum(case when to_user_id=p_subject_user_id then cardinality(offered_card_ids)else cardinality(requested_card_ids)end)::integer cards_to_subject,
      sum(case when from_user_id=p_subject_user_id then cardinality(offered_card_ids)else cardinality(requested_card_ids)end)::integer cards_from_subject,
      sum(case when to_user_id=p_subject_user_id then offered_karas else requested_karas end)::bigint karas_to_subject,
      sum(case when from_user_id=p_subject_user_id then offered_karas else requested_karas end)::bigint karas_from_subject,
      max(occurred_at)last_transfer_at
    from transfers group by 1
  ), network as materialized(
    select other.user_id,max(least(own.last_seen_at,other.last_seen_at))last_shared_at
    from public.anticheat_network_observations own join public.anticheat_network_observations other
      on other.network_identity=own.network_identity and other.user_id<>own.user_id
    where own.user_id=p_subject_user_id and own.last_seen_at>=stamp-interval '7 days'and other.last_seen_at>=stamp-interval '7 days'
    group by other.user_id
  ), browser as materialized(
    select other.user_id,max(least(own.last_seen_at,other.last_seen_at))last_shared_at
    from public.anticheat_device_observations own join public.anticheat_device_observations other
      on other.device_identity=own.device_identity and other.user_id<>own.user_id
    where own.user_id=p_subject_user_id and own.last_seen_at>=stamp-interval '7 days'and other.last_seen_at>=stamp-interval '7 days'
    group by other.user_id
  ), ids as(select user_id from economic union select user_id from network union select user_id from browser
    union select user_id from public.anticheat_deleted_accounts where p_status='archived'),
  records as materialized(
    select i.user_id,public.anticheat_account_display(i.user_id,p_subject_user_id)account_state,
      case when u.id is not null and not exists(select 1 from public.account_deletion_log where user_id=i.user_id)
        then p.pseudo when d.identity_expires_at>stamp then d.pseudo end pseudo,
      case when u.id is not null and not exists(select 1 from public.account_deletion_log where user_id=i.user_id)
        then to_jsonb(u)->>'email' when d.identity_expires_at>stamp then d.email end email,
      u.id is null removed,d.user_id is not null archived,
      coalesce(e.accepted_trades,0)accepted_trades,coalesce(e.sold_auctions,0)sold_auctions,
      coalesce(e.available_transfers,0)available_transfers,
      coalesce(e.cards_to_subject,0)cards_to_subject,coalesce(e.cards_from_subject,0)cards_from_subject,
      coalesce(e.karas_to_subject,0)karas_to_subject,coalesce(e.karas_from_subject,0)karas_from_subject,
      e.last_transfer_at,n.last_shared_at network_last_seen,b.last_shared_at browser_last_seen
    from ids i left join public.user_profiles p on p.user_id=i.user_id
      left join auth.users u on u.id=i.user_id left join public.anticheat_deleted_accounts d on d.user_id=i.user_id
      left join economic e on e.user_id=i.user_id left join network n on n.user_id=i.user_id left join browser b on b.user_id=i.user_id
    where i.user_id is not null and i.user_id<>p_subject_user_id
  ), filtered as materialized(
    select*from records where(p_query=''or coalesce(pseudo,'')ilike'%'||p_query||'%'or coalesce(email,'')ilike'%'||p_query||'%')
      and(p_status=''or(p_status in('deleted','archived')and(account_state->>'deleted')::boolean)
        or(p_status='banned'and(account_state->>'banned')::boolean and not(account_state->>'deleted')::boolean)
        or(p_status='active'and not(account_state->>'deleted')::boolean and not(account_state->>'banned')::boolean))
  ),page as(
    select*from filtered order by(accepted_trades+sold_auctions>0)desc,last_transfer_at desc nulls last,
      greatest(network_last_seen,browser_last_seen)desc nulls last,user_id limit p_limit offset p_offset
  )select jsonb_build_object('subject',public.anticheat_account_display(p_subject_user_id)||jsonb_build_object(
    'userId',p_subject_user_id,'removed',not exists(select 1 from auth.users where id=p_subject_user_id)),
    'accounts',coalesce((select jsonb_agg(
    jsonb_build_object('userId',user_id,'pseudo',pseudo,'email',email,'accountState',account_state,
      'removed',removed,'archived',archived,'acceptedTrades',accepted_trades,'soldAuctions',sold_auctions,'availableTransfers',available_transfers,
      'cardsToSubject',cards_to_subject,'cardsFromSubject',cards_from_subject,'karasToSubject',karas_to_subject,'karasFromSubject',karas_from_subject,
      'sharedNetwork',network_last_seen is not null,'sharedBrowser',browser_last_seen is not null)
    order by(accepted_trades+sold_auctions>0)desc,last_transfer_at desc nulls last,greatest(network_last_seen,browser_last_seen)desc nulls last,user_id)from page),'[]'),
    'total',(select count(*)from filtered),'relatedTotal',(select count(*)from records),'pageSize',p_limit,
    'counts',jsonb_build_object('active',(select count(*)from records where not(account_state->>'deleted')::boolean and not(account_state->>'banned')::boolean),
      'banned',(select count(*)from records where not(account_state->>'deleted')::boolean and(account_state->>'banned')::boolean),
      'deleted',(select count(*)from records where(account_state->>'deleted')::boolean)))into result;
  return result;
end;$$;
revoke all on function public.admin_list_anticheat_related_accounts(uuid,text,text,integer,integer)from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_related_accounts(uuid,text,text,integer,integer)to authenticated;
notify pgrst,'reload schema';
commit;
