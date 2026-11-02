begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local check_function_bodies=on;

-- Risk model v2 separates suspicious evidence from ordinary high-volume play.
-- The immutable ledger remains untouched; the admin score is recomputed over a
-- rolling window with a per-reason cap and honours the latest dismissal.
create function public.anticheat_reason_weight(p_reason text) returns integer
language sql immutable set search_path='' as $$
  select case p_reason
    when 'ONE_WAY_TRADE_SOURCE' then 3
    when 'ONE_WAY_TRADE_BENEFICIARY' then 12
    when 'TRADE_VALUE_IMBALANCE' then 6
    when 'LARGE_KARA_TRANSFER' then 5
    when 'EXTREME_AUCTION_BID' then 8
    when 'REFERRAL_REWARD_BURST' then 10
    when 'NEW_ACCOUNT_ECONOMIC_ACTIVITY' then 8
    when 'SHARED_NETWORK_IDENTITY' then 3
    when 'TRADE_SHARED_NETWORK_IDENTITY' then 20
    else 0
  end
$$;
revoke all on function public.anticheat_reason_weight(text)
  from public,anon,authenticated,service_role;

create function public.anticheat_reason_cap(p_reason text) returns integer
language sql immutable set search_path='' as $$
  select case p_reason
    when 'ONE_WAY_TRADE_SOURCE' then 6
    when 'ONE_WAY_TRADE_BENEFICIARY' then 24
    when 'TRADE_VALUE_IMBALANCE' then 18
    when 'LARGE_KARA_TRANSFER' then 15
    when 'EXTREME_AUCTION_BID' then 16
    when 'REFERRAL_REWARD_BURST' then 20
    when 'NEW_ACCOUNT_ECONOMIC_ACTIVITY' then 16
    when 'SHARED_NETWORK_IDENTITY' then 9
    when 'TRADE_SHARED_NETWORK_IDENTITY' then 60
    else 0
  end
$$;
revoke all on function public.anticheat_reason_cap(text)
  from public,anon,authenticated,service_role;

create function public.anticheat_score_window_start(
  p_user_id uuid,p_as_of timestamptz
) returns timestamptz
language sql stable set search_path='' as $$
  select greatest(
    p_as_of-interval '30 days',
    coalesce((
      select max(r.created_at)
      from public.anticheat_case_reviews r
      where r.case_user_id=p_user_id and r.decision='dismissed'
        and r.created_at<=p_as_of
    ),'-infinity'::timestamptz)
  )
$$;
revoke all on function public.anticheat_score_window_start(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create function public.anticheat_effective_risk_snapshot(
  p_user_id uuid,p_as_of timestamptz
) returns table(risk_score integer,event_count integer,reason_codes text[])
language sql stable set search_path='' as $$
  with reason_rows as materialized (
    select s.event_id,reason.code,
      public.anticheat_reason_weight(reason.code) weight,
      public.anticheat_reason_cap(reason.code) cap
    from public.anticheat_event_subjects s
    join public.anticheat_events e on e.id=s.event_id
    cross join lateral unnest(s.reason_codes) reason(code)
    where s.user_id=p_user_id
      and e.occurred_at>=public.anticheat_score_window_start(p_user_id,p_as_of)
      and e.occurred_at<=p_as_of
      and public.anticheat_reason_weight(reason.code)>0
  ), per_reason as (
    select code,count(*)::integer*weight points,max(cap) cap
    from reason_rows group by code,weight
  )
  select
    coalesce((select sum(least(points,cap)) from per_reason),0)::integer,
    coalesce((select count(distinct event_id) from reason_rows),0)::integer,
    coalesce((select array_agg(distinct code order by code) from reason_rows),'{}'::text[])
$$;
revoke all on function public.anticheat_effective_risk_snapshot(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create function public.anticheat_effective_risk_score(
  p_user_id uuid,p_as_of timestamptz
) returns integer
language sql stable set search_path='' as $$
  select snapshot.risk_score
  from public.anticheat_effective_risk_snapshot(p_user_id,p_as_of) snapshot
$$;
revoke all on function public.anticheat_effective_risk_score(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create function public.anticheat_effective_event_count(
  p_user_id uuid,p_as_of timestamptz
) returns integer
language sql stable set search_path='' as $$
  select snapshot.event_count
  from public.anticheat_effective_risk_snapshot(p_user_id,p_as_of) snapshot
$$;
revoke all on function public.anticheat_effective_event_count(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create function public.anticheat_effective_reason_codes(
  p_user_id uuid,p_as_of timestamptz
) returns text[]
language sql stable set search_path='' as $$
  select snapshot.reason_codes
  from public.anticheat_effective_risk_snapshot(p_user_id,p_as_of) snapshot
$$;
revoke all on function public.anticheat_effective_reason_codes(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.record_anticheat_event(
  p_event_type text,
  p_actor_user_id uuid,
  p_counterparty_user_id uuid,
  p_subject_id uuid,
  p_amount integer default 0,
  p_card_count integer default 0,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null
) returns bigint
language plpgsql volatile security definer set search_path='' as $$
declare
  recorded_event_id bigint;
  actor_points integer:=0;
  counterparty_points integer:=0;
  actor_reasons text[]:='{}';
  counterparty_reasons text[]:='{}';
  actor_recent boolean:=false;
  counterparty_recent boolean:=false;
  burst_events integer:=0;
  offered_total integer:=coalesce((p_metadata->>'offeredTotal')::integer,0);
  requested_total integer:=coalesce((p_metadata->>'requestedTotal')::integer,0);
  offered_value integer:=coalesce((p_metadata->>'offeredValue')::integer,0);
  requested_value integer:=coalesce((p_metadata->>'requestedValue')::integer,0);
  starting_price integer:=coalesce((p_metadata->>'startingPrice')::integer,0);
  stamp timestamptz:=coalesce(p_occurred_at,clock_timestamp());
begin
  if p_event_type is null or p_event_type not in (
    'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
    'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded'
  ) then raise exception 'INVALID_ANTICHEAT_EVENT'; end if;
  if p_actor_user_id is null and p_counterparty_user_id is null then
    raise exception 'ANTICHEAT_EVENT_SUBJECT_REQUIRED';
  end if;

  select exists(
    select 1 from public.anticheat_events
    where event_type='account_registered' and actor_user_id=p_actor_user_id
      and occurred_at between stamp-interval '72 hours' and stamp
  ) into actor_recent;
  select exists(
    select 1 from public.anticheat_events
    where event_type='account_registered' and actor_user_id=p_counterparty_user_id
      and occurred_at between stamp-interval '72 hours' and stamp
  ) into counterparty_recent;

  insert into public.anticheat_events(
    event_type,actor_user_id,counterparty_user_id,subject_id,amount,card_count,metadata,occurred_at
  ) values(
    p_event_type,p_actor_user_id,p_counterparty_user_id,p_subject_id,
    greatest(coalesce(p_amount,0),0),greatest(coalesce(p_card_count,0),0),
    coalesce(p_metadata,'{}'::jsonb),stamp
  ) returning id into recorded_event_id;

  if p_event_type='trade_accepted' then
    if offered_total>0 and requested_total=0 then
      actor_points:=actor_points+3;
      counterparty_points:=counterparty_points+12;
      actor_reasons:=array_append(actor_reasons,'ONE_WAY_TRADE_SOURCE');
      counterparty_reasons:=array_append(counterparty_reasons,'ONE_WAY_TRADE_BENEFICIARY');
    elsif requested_total>0 and offered_total=0 then
      actor_points:=actor_points+12;
      counterparty_points:=counterparty_points+3;
      actor_reasons:=array_append(actor_reasons,'ONE_WAY_TRADE_BENEFICIARY');
      counterparty_reasons:=array_append(counterparty_reasons,'ONE_WAY_TRADE_SOURCE');
    end if;
    if abs(offered_value-requested_value)>=45
      and greatest(offered_value,requested_value)>=4*greatest(1,least(offered_value,requested_value)) then
      actor_points:=actor_points+6;
      counterparty_points:=counterparty_points+6;
      actor_reasons:=array_append(actor_reasons,'TRADE_VALUE_IMBALANCE');
      counterparty_reasons:=array_append(counterparty_reasons,'TRADE_VALUE_IMBALANCE');
    end if;
    if greatest(
      coalesce((p_metadata->>'offeredKaras')::integer,0),
      coalesce((p_metadata->>'requestedKaras')::integer,0)
    )>=5000 then
      actor_points:=actor_points+5;
      counterparty_points:=counterparty_points+5;
      actor_reasons:=array_append(actor_reasons,'LARGE_KARA_TRANSFER');
      counterparty_reasons:=array_append(counterparty_reasons,'LARGE_KARA_TRANSFER');
    end if;
  elsif p_event_type='auction_bid' then
    if p_amount>=5000 and p_amount>=greatest(100,starting_price*10) then
      actor_points:=actor_points+8;
      actor_reasons:=array_append(actor_reasons,'EXTREME_AUCTION_BID');
    end if;
  elsif p_event_type='referral_rewarded' then
    select count(*)::integer into burst_events from public.anticheat_events e
      where e.id<>recorded_event_id and e.event_type='referral_rewarded'
        and e.actor_user_id=p_actor_user_id
        and e.occurred_at between stamp-interval '24 hours' and stamp;
    if burst_events>=2 then
      actor_points:=actor_points+10;
      actor_reasons:=array_append(actor_reasons,'REFERRAL_REWARD_BURST');
    end if;
  end if;

  if p_event_type in ('trade_accepted','auction_bid','auction_sold') and actor_recent then
    actor_points:=actor_points+8;
    actor_reasons:=array_append(actor_reasons,'NEW_ACCOUNT_ECONOMIC_ACTIVITY');
  end if;
  if p_event_type in ('trade_accepted','auction_sold') and counterparty_recent then
    counterparty_points:=counterparty_points+8;
    counterparty_reasons:=array_append(counterparty_reasons,'NEW_ACCOUNT_ECONOMIC_ACTIVITY');
  end if;

  if p_actor_user_id is not null then
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      values(recorded_event_id,p_actor_user_id,least(actor_points,100),actor_reasons);
  end if;
  if p_counterparty_user_id is not null and p_counterparty_user_id is distinct from p_actor_user_id then
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      values(recorded_event_id,p_counterparty_user_id,least(counterparty_points,100),counterparty_reasons);
  end if;

  insert into public.anticheat_cases(
    user_id,risk_score,event_count,reason_codes,first_flagged_at,last_flagged_at,status,updated_at
  ) select s.user_id,s.risk_points,1,s.reason_codes,stamp,stamp,'open',stamp
    from public.anticheat_event_subjects s
    where s.event_id=recorded_event_id and s.risk_points>0
  on conflict(user_id) do update set
    risk_score=public.anticheat_cases.risk_score+excluded.risk_score,
    event_count=public.anticheat_cases.event_count+1,
    reason_codes=(select coalesce(array_agg(distinct reason order by reason),'{}'::text[])
      from unnest(public.anticheat_cases.reason_codes||excluded.reason_codes) reason),
    last_flagged_at=excluded.last_flagged_at,
    status=case when public.anticheat_cases.status='dismissed' then 'open' else public.anticheat_cases.status end,
    updated_at=stamp;
  return recorded_event_id;
end; $$;
revoke all on function public.record_anticheat_event(text,uuid,uuid,uuid,integer,integer,jsonb,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.record_anticheat_network_observation(
  p_user_id uuid,p_network_identity text
) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare
  stamp timestamptz:=clock_timestamp();
  changed_user uuid;
  linked_user uuid;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then
    raise exception 'ANTICHEAT_USER_REQUIRED';
  end if;
  if p_network_identity is null
    or p_network_identity!~'^v[1-9][0-9]*:[a-f0-9]{64}$' then
    raise exception 'INVALID_NETWORK_IDENTITY';
  end if;

  delete from public.anticheat_network_observations
    where last_seen_at<stamp-interval '7 days';
  insert into public.anticheat_network_observations(
    network_identity,user_id,first_seen_at,last_seen_at,observation_count
  ) values(p_network_identity,p_user_id,stamp,stamp,1)
  on conflict(network_identity,user_id) do update set
    last_seen_at=stamp,
    observation_count=least(public.anticheat_network_observations.observation_count+1,1000000)
  where public.anticheat_network_observations.last_seen_at<=stamp-interval '15 minutes'
  returning user_id into changed_user;
  if changed_user is null then return false; end if;

  for linked_user in
    select distinct o.user_id from public.anticheat_network_observations o
    where o.network_identity=p_network_identity and o.user_id<>p_user_id
      and o.last_seen_at>=stamp-interval '7 days'
  loop
    perform public.record_anticheat_context_signal(
      'network_identity_shared',p_user_id,linked_user,null,3,
      'SHARED_NETWORK_IDENTITY',jsonb_build_object('retentionDays',7)
    );
  end loop;
  return true;
end; $$;
revoke all on function public.record_anticheat_network_observation(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_anticheat_network_observation(uuid,text)
  to service_role;

create or replace function public.capture_trade_network_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status is not distinct from new.status or new.status<>'accepted' then return new; end if;
  if exists(
    select 1 from public.anticheat_network_observations source
    join public.anticheat_network_observations recipient
      on recipient.network_identity=source.network_identity
    where source.user_id=new.from_user and recipient.user_id=new.to_user
      and source.last_seen_at>=clock_timestamp()-interval '7 days'
      and recipient.last_seen_at>=clock_timestamp()-interval '7 days'
  ) then
    perform public.record_anticheat_context_signal(
      'trade_shared_network_identity',new.from_user,new.to_user,new.id,20,
      'TRADE_SHARED_NETWORK_IDENTITY',jsonb_build_object('retentionDays',7)
    );
  end if;
  return new;
end; $$;
revoke all on function public.capture_trade_network_anticheat_event()
  from public,anon,authenticated,service_role;

create or replace function public.admin_list_anticheat_cases(
  p_query text default '',p_severity text default '',p_limit integer default 50,p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb;
  score_as_of timestamptz:=statement_timestamp();
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  p_query:=left(btrim(coalesce(p_query,'')),100);
  p_severity:=lower(btrim(coalesce(p_severity,'')));
  if p_severity not in ('','watch','elevated','high','critical') then raise exception 'INVALID_SEVERITY'; end if;
  p_limit:=least(greatest(coalesce(p_limit,50),1),100);
  p_offset:=greatest(coalesce(p_offset,0),0);
  with source as materialized (
    select c.*,
      active.risk_score effective_risk_score,
      active.event_count effective_event_count,
      active.reason_codes effective_reason_codes,
      coalesce(p.pseudo,'Deleted player') pseudo,to_jsonb(u)->>'email' email,
      case when active.risk_score>=80 then 'critical'
        when active.risk_score>=40 then 'high'
        when active.risk_score>=20 then 'elevated' else 'watch' end severity
    from public.anticheat_cases c
    cross join lateral (
      select snapshot.risk_score,snapshot.event_count,snapshot.reason_codes
      from public.anticheat_effective_risk_snapshot(c.user_id,score_as_of) snapshot
    ) active
    left join public.user_profiles p on p.user_id=c.user_id
    left join auth.users u on u.id=c.user_id
    where (p_query='' or coalesce(p.pseudo,'') ilike '%'||p_query||'%'
      or coalesce(to_jsonb(u)->>'email','') ilike '%'||p_query||'%')
  ), filtered as materialized (
    select * from source
    where (effective_risk_score>0 or status<>'open')
      and (p_severity='' or severity=p_severity)
  ), page as materialized (
    select * from filtered
    order by (status='open') desc,effective_risk_score desc,last_flagged_at desc,user_id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'cases',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',c.user_id,'pseudo',c.pseudo,'email',c.email,'score',c.effective_risk_score,
      'severity',c.severity,'status',c.status,'eventCount',c.effective_event_count,
      'reasonCodes',c.effective_reason_codes,'firstFlaggedAt',c.first_flagged_at,'lastFlaggedAt',c.last_flagged_at,
      'economicLinkedAccounts',(select count(distinct case when e.actor_user_id=c.user_id then e.counterparty_user_id else e.actor_user_id end)
        from public.anticheat_events e where (e.actor_user_id=c.user_id or e.counterparty_user_id=c.user_id)
          and e.actor_user_id is not null and e.counterparty_user_id is not null
          and e.event_type not in ('network_identity_shared','trade_shared_network_identity')),
      'networkLinkedAccounts',(select count(distinct other.user_id)
        from public.anticheat_network_observations own
        join public.anticheat_network_observations other on other.network_identity=own.network_identity
        where own.user_id=c.user_id and other.user_id<>c.user_id
          and own.last_seen_at>=score_as_of-interval '7 days'
          and other.last_seen_at>=score_as_of-interval '7 days'),
      'latestReview',(select jsonb_build_object(
        'decision',r.decision,'note',r.note,'createdAt',r.created_at,
        'adminPseudo',coalesce(rp.pseudo,'Deleted admin'))
        from public.anticheat_case_reviews r
        left join public.user_profiles rp on rp.user_id=r.admin_user_id
        where r.case_user_id=c.user_id order by r.created_at desc,r.id desc limit 1)
    ) order by (c.status='open') desc,c.effective_risk_score desc,c.last_flagged_at desc,c.user_id)
      from page c),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'open',(select count(*) from source where effective_risk_score>0 and status='open'),
      'critical',(select count(*) from source where effective_risk_score>=80 and status='open'),
      'events24h',(select count(*) from public.anticheat_events
        where occurred_at>=score_as_of-interval '24 hours' and occurred_at<=score_as_of),
      'flagged24h',(select count(*) from public.anticheat_event_subjects s
        join public.anticheat_events e on e.id=s.event_id
        where e.occurred_at>=score_as_of-interval '24 hours' and e.occurred_at<=score_as_of
          and exists(select 1 from unnest(s.reason_codes) reason(code)
            where public.anticheat_reason_weight(reason.code)>0))
    )
  ) into result;
  return result;
end; $$;
revoke all on function public.admin_list_anticheat_cases(text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_cases(text,text,integer,integer)
  to authenticated;

notify pgrst,'reload schema';
commit;
