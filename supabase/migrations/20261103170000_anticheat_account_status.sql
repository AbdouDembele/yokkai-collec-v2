begin;

-- Do not guess who deleted historical accounts. New self-service requests are
-- stamped only by the server after recent authentication and username checks.
alter table public.anticheat_deleted_accounts
  add column deletion_origin text not null default 'unknown' check(deletion_origin in('unknown','self')),
  add column banned_at_deletion boolean not null default false;

create function public.begin_self_requested_account_deletion(p_user_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare already_started boolean;
begin
  if p_user_id is null then raise exception 'INVALID_ACCOUNT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  select exists(select 1 from public.account_deletion_log where user_id=p_user_id) into already_started;
  perform public.begin_account_deletion(p_user_id);
  if not already_started then
    update public.anticheat_deleted_accounts set deletion_origin='self' where user_id=p_user_id;
  end if;
end; $$;
revoke all on function public.begin_self_requested_account_deletion(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_self_requested_account_deletion(uuid) to service_role;

-- Extend the private capture without changing identity retention or transfers.
do $$declare definition text;begin
  definition:=pg_get_functiondef('public.anticheat_capture_deleted_account(uuid,timestamptz)'::regprocedure);
  if position(E'\nend;' in definition)=0 then raise exception 'ACCOUNT_CAPTURE_PATCH_MISMATCH';end if;
  definition:=replace(definition,E'\nend;',
    E'\nupdate public.anticheat_deleted_accounts d set banned_at_deletion=d.banned_at_deletion or coalesce((select (to_jsonb(u)->>''banned_until'')::timestamptz>stamp from auth.users u where u.id=p_user_id),false) where d.user_id=p_user_id;\nend;');
  execute definition;
end;$$;

-- Proven past bans can be restored from the last administration action before
-- deletion. A later unban prevents a historical ban from being mislabelled.
update public.anticheat_deleted_accounts d set banned_at_deletion=true
where (select a.action from public.admin_audit_logs a
  where a.action in('player.ban','player.unban') and a.metadata->>'target_user_id'=d.user_id::text
    and a.created_at<=d.deleted_at order by a.created_at desc,a.id desc limit 1)='player.ban';

create function public.anticheat_account_display(p_user_id uuid,p_context_user_id uuid default null)
returns jsonb language sql stable set search_path='' as $$
  with identity as (
    select p_user_id id,
      (select pseudo from public.user_profiles where user_id=p_user_id) live_name,
      (select d.pseudo from public.anticheat_deleted_accounts d where d.user_id=p_user_id and d.identity_expires_at>now()) archived_name,
      not exists(select 1 from auth.users where id=p_user_id)
        or exists(select 1 from public.account_deletion_log where user_id=p_user_id) deleted,
      coalesce((select (to_jsonb(u)->>'banned_until')::timestamptz>now() from auth.users u where u.id=p_user_id),false) banned,
      (select d.deletion_origin from public.anticheat_deleted_accounts d where d.user_id=p_user_id) deletion_origin,
      coalesce((select d.banned_at_deletion from public.anticheat_deleted_accounts d where d.user_id=p_user_id),false) banned_at_deletion
  ), receipts as (
    select s.applied_at from public.anticheat_smurf_sanctions s where
      (p_context_user_id is null and p_user_id in(s.primary_user_id,s.smurf_user_id)) or
      (s.primary_user_id=p_context_user_id and s.smurf_user_id=p_user_id) or
      (s.smurf_user_id=p_context_user_id and s.primary_user_id=p_user_id)
    union all
    select s.applied_at from public.anticheat_deleted_account_sanctions s where
      (p_context_user_id is null and(s.primary_user_id=p_user_id or p_user_id=any(s.deleted_user_ids))) or
      (s.primary_user_id=p_context_user_id and p_user_id=any(s.deleted_user_ids)) or
      (s.primary_user_id=p_user_id and p_context_user_id=any(s.deleted_user_ids))
    union all
    select s.applied_at from public.anticheat_deleted_smurf_recoveries s where
      (p_context_user_id is null and s.primary_user_id=p_user_id) or
      exists(select 1 from public.anticheat_deleted_account_transfers e
        where e.kind='trade' and e.asset_id=any(s.source_trade_ids) and
          ((e.from_user_id=p_user_id and e.to_user_id=p_context_user_id) or
           (e.to_user_id=p_user_id and e.from_user_id=p_context_user_id)))
  ) select jsonb_build_object('pseudo',case when deleted then archived_name else live_name end,
    'deleted',deleted,'banned',banned,'bannedAtDeletion',banned_at_deletion,
    'deletionOrigin',coalesce(deletion_origin,'unknown'),
    'sanctionApplied',exists(select 1 from receipts),'sanctionAppliedAt',(select max(applied_at)from receipts))
  from identity
$$;
revoke all on function public.anticheat_account_display(uuid,uuid) from public,anon,authenticated,service_role;

create function public.anticheat_transfer_sanctioned(p_kind text,p_id uuid)
returns boolean language sql stable set search_path='' as $$
  select not public.anticheat_deleted_transfer_available(p_kind,p_id)
$$;
revoke all on function public.anticheat_transfer_sanctioned(text,uuid) from public,anon,authenticated,service_role;

-- Enrich the existing bounded readers, retaining their admin/ban guards,
-- filters, pagination and exact grants. No new public admin RPC is introduced.
do $$declare definition text;begin
  definition:=pg_get_functiondef('public.admin_list_deleted_accounts(text,uuid,boolean,integer,integer)'::regprocedure);
  if position('''availableTransfers'',available_count' in definition)=0 then raise exception 'DELETED_READER_PATCH_MISMATCH';end if;
  definition:=replace(definition,'''availableTransfers'',available_count',
    '''availableTransfers'',available_count,''accountState'',public.anticheat_account_display(user_id,p_primary_user_id)');
  execute definition;

  definition:=pg_get_functiondef('public.admin_list_anticheat_cases(text,text,integer,integer)'::regprocedure);
  if position('''userId'',c.user_id,''pseudo'',c.pseudo' in definition)=0 then raise exception 'CASE_READER_PATCH_MISMATCH';end if;
  definition:=replace(definition,'''userId'',c.user_id,''pseudo'',c.pseudo',
    '''accountState'',public.anticheat_account_display(c.user_id),''userId'',c.user_id,''pseudo'',c.pseudo');
  execute definition;

  definition:=pg_get_functiondef('public.admin_list_anticheat_connections(uuid[])'::regprocedure);
  if position('''userId'',l.other_id,''pseudo'',p.pseudo' in definition)=0 then raise exception 'CONNECTION_READER_PATCH_MISMATCH';end if;
  definition:=replace(definition,'''userId'',l.other_id,''pseudo'',p.pseudo',
    '''accountState'',public.anticheat_account_display(l.other_id,u.user_id),''userId'',l.other_id,''pseudo'',coalesce(p.pseudo,public.anticheat_account_display(l.other_id,u.user_id)->>''pseudo'')');
  execute definition;

  definition:=pg_get_functiondef('public.admin_list_anticheat_events(uuid,text,integer,integer)'::regprocedure);
  if position('''pseudo'',e.actor_pseudo' in definition)=0 or position('''pseudo'',e.counterparty_pseudo' in definition)=0 then raise exception 'EVENT_READER_PATCH_MISMATCH';end if;
  definition:=replace(definition,'''pseudo'',e.actor_pseudo',
    '''pseudo'',e.actor_pseudo,''accountState'',public.anticheat_account_display(e.actor_user_id)');
  definition:=replace(definition,'''pseudo'',e.counterparty_pseudo',
    '''pseudo'',e.counterparty_pseudo,''accountState'',public.anticheat_account_display(e.counterparty_user_id)');
  definition:=replace(definition,'''amount'',e.amount,''cardCount'',e.card_count',
    '''sanctionApplied'',public.anticheat_transfer_sanctioned(case when e.event_type like ''trade_%'' then ''trade'' else ''auction'' end,e.subject_id),''amount'',e.amount,''cardCount'',e.card_count');
  execute definition;
end;$$;

-- Names and statuses in the expanded trade use the immutable event parties
-- when account deletion has nulled the trade's foreign keys.
create or replace function public.anticheat_event_asset_detail(p_event_id bigint)
returns jsonb language plpgsql stable set search_path='' as $$
declare event public.anticheat_events%rowtype;detail jsonb;source text;from_state jsonb;to_state jsonb;
begin
  select * into event from public.anticheat_events where id=p_event_id;
  if not found then return null;end if;
  if event.metadata?'assetSnapshot' then detail:=event.metadata->'assetSnapshot';source:='captured';
  else detail:=public.anticheat_build_event_assets(event.event_type,event.subject_id,event.metadata,event.amount);source:='retained';end if;
  if not coalesce((detail->>'available')::boolean,false)then source:='unavailable';end if;
  from_state:=public.anticheat_account_display(coalesce((detail->>'fromUser')::uuid,event.actor_user_id));
  to_state:=public.anticheat_account_display(coalesce((detail->>'toUser')::uuid,event.counterparty_user_id));
  return detail||jsonb_build_object('source',source,
    'fromName',(select pseudo from public.user_profiles where user_id=(detail->>'fromUser')::uuid),
    'toName',(select pseudo from public.user_profiles where user_id=(detail->>'toUser')::uuid),
    'fromState',from_state,'toState',to_state);
end;$$;
revoke all on function public.anticheat_event_asset_detail(bigint) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
