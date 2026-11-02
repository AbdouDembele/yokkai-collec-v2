begin;

-- Cloudflare supplies a versioned HMAC, never a raw address. Observations are
-- deliberately short-lived and are not readable through the public API.
alter table public.anticheat_events
  drop constraint anticheat_events_event_type_check;
alter table public.anticheat_events
  add constraint anticheat_events_event_type_check check (event_type in (
    'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
    'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded',
    'network_identity_shared','trade_shared_network_identity'
  ));

create table public.anticheat_network_observations (
  network_identity text not null check(network_identity~'^v[1-9][0-9]*:[a-f0-9]{64}$'),
  user_id uuid not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  observation_count integer not null default 1 check(observation_count between 1 and 1000000),
  primary key(network_identity,user_id),
  check(last_seen_at>=first_seen_at)
);
alter table public.anticheat_network_observations enable row level security;
revoke all on public.anticheat_network_observations from public,anon,authenticated,service_role;
create index anticheat_network_observations_user_idx
  on public.anticheat_network_observations(user_id,last_seen_at desc);
create index anticheat_network_observations_retention_idx
  on public.anticheat_network_observations(last_seen_at);

create table public.anticheat_case_reviews (
  id bigint generated always as identity primary key,
  case_user_id uuid not null,
  admin_user_id uuid,
  decision text not null check(decision in ('open','reviewed','dismissed')),
  note text not null check(length(note) between 5 and 2000),
  risk_score_snapshot integer not null check(risk_score_snapshot>=0),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_case_reviews enable row level security;
revoke all on public.anticheat_case_reviews from public,anon,authenticated,service_role;
revoke all on sequence public.anticheat_case_reviews_id_seq
  from public,anon,authenticated,service_role;
create index anticheat_case_reviews_case_idx
  on public.anticheat_case_reviews(case_user_id,created_at desc,id desc);
create trigger anticheat_case_reviews_immutable
  before update or delete on public.anticheat_case_reviews
  for each row execute function public.prevent_anticheat_ledger_mutation();

alter table public.anticheat_cases
  add column risk_score_baseline integer not null default 0 check(risk_score_baseline>=0),
  add column event_count_baseline integer not null default 0 check(event_count_baseline>=0);

create function public.reopen_anticheat_case_on_new_signal() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.risk_score>old.risk_score and old.status<>'open' and new.status=old.status then
    new.status:='open';
    new.reviewed_at:=null;
    new.reviewed_by:=null;
  end if;
  return new;
end; $$;
revoke all on function public.reopen_anticheat_case_on_new_signal()
  from public,anon,authenticated,service_role;
create trigger reopen_anticheat_case_on_new_signal
  before update on public.anticheat_cases
  for each row execute function public.reopen_anticheat_case_on_new_signal();

create unique index anticheat_events_network_pair_unique
  on public.anticheat_events(
    least(actor_user_id::text,counterparty_user_id::text),
    greatest(actor_user_id::text,counterparty_user_id::text)
  ) where event_type='network_identity_shared';
create unique index anticheat_events_network_trade_unique
  on public.anticheat_events(subject_id)
  where event_type='trade_shared_network_identity';

create function public.record_anticheat_context_signal(
  p_event_type text,
  p_actor_user_id uuid,
  p_counterparty_user_id uuid,
  p_subject_id uuid,
  p_risk_points integer,
  p_reason_code text,
  p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql volatile security definer set search_path='' as $$
declare
  recorded_event_id bigint;
  stamp timestamptz:=clock_timestamp();
begin
  if p_event_type not in ('network_identity_shared','trade_shared_network_identity')
    or p_actor_user_id is null or p_counterparty_user_id is null
    or p_actor_user_id=p_counterparty_user_id
    or p_risk_points not between 1 and 100
    or p_reason_code not in ('SHARED_NETWORK_IDENTITY','TRADE_SHARED_NETWORK_IDENTITY') then
    raise exception 'INVALID_ANTICHEAT_CONTEXT_SIGNAL';
  end if;

  insert into public.anticheat_events(
    event_type,actor_user_id,counterparty_user_id,subject_id,metadata,occurred_at
  ) values(
    p_event_type,p_actor_user_id,p_counterparty_user_id,p_subject_id,
    coalesce(p_metadata,'{}'::jsonb),stamp
  ) on conflict do nothing returning id into recorded_event_id;
  if recorded_event_id is null then return null; end if;

  insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
  values
    (recorded_event_id,p_actor_user_id,p_risk_points,array[p_reason_code]),
    (recorded_event_id,p_counterparty_user_id,p_risk_points,array[p_reason_code]);

  insert into public.anticheat_cases(
    user_id,risk_score,event_count,reason_codes,first_flagged_at,last_flagged_at,status,updated_at
  ) values
    (p_actor_user_id,p_risk_points,1,array[p_reason_code],stamp,stamp,'open',stamp),
    (p_counterparty_user_id,p_risk_points,1,array[p_reason_code],stamp,stamp,'open',stamp)
  on conflict(user_id) do update set
    risk_score=public.anticheat_cases.risk_score+excluded.risk_score,
    event_count=public.anticheat_cases.event_count+1,
    reason_codes=(select coalesce(array_agg(distinct reason order by reason),'{}'::text[])
      from unnest(public.anticheat_cases.reason_codes||excluded.reason_codes) reason),
    last_flagged_at=excluded.last_flagged_at,
    status='open',reviewed_at=null,reviewed_by=null,updated_at=stamp;
  return recorded_event_id;
end; $$;
revoke all on function public.record_anticheat_context_signal(text,uuid,uuid,uuid,integer,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.record_anticheat_network_observation(
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
      'network_identity_shared',p_user_id,linked_user,null,5,
      'SHARED_NETWORK_IDENTITY',jsonb_build_object('retentionDays',7)
    );
  end loop;
  return true;
end; $$;
revoke all on function public.record_anticheat_network_observation(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_anticheat_network_observation(uuid,text)
  to service_role;

create function public.capture_trade_network_anticheat_event() returns trigger
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
      'trade_shared_network_identity',new.from_user,new.to_user,new.id,25,
      'TRADE_SHARED_NETWORK_IDENTITY',jsonb_build_object('retentionDays',7)
    );
  end if;
  return new;
end; $$;
revoke all on function public.capture_trade_network_anticheat_event()
  from public,anon,authenticated,service_role;
create trigger capture_trade_network_anticheat_event
  after update of status on public.trade_offers
  for each row execute function public.capture_trade_network_anticheat_event();

create function public.admin_review_anticheat_case(
  p_user_id uuid,p_status text,p_note text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  target public.anticheat_cases%rowtype;
  normalized_note text:=btrim(coalesce(p_note,''));
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  p_status:=lower(btrim(coalesce(p_status,'')));
  if p_status not in ('open','reviewed','dismissed') then raise exception 'INVALID_CASE_STATUS'; end if;
  if length(normalized_note) not between 5 and 2000 then raise exception 'INVALID_CASE_NOTE'; end if;
  select * into target from public.anticheat_cases where user_id=p_user_id for update;
  if not found then raise exception 'ANTICHEAT_CASE_NOT_FOUND'; end if;

  insert into public.anticheat_case_reviews(
    case_user_id,admin_user_id,decision,note,risk_score_snapshot
  ) values(p_user_id,auth.uid(),p_status,normalized_note,target.risk_score);
  update public.anticheat_cases set
    status=p_status,
    risk_score_baseline=case when p_status='dismissed' then risk_score else risk_score_baseline end,
    event_count_baseline=case when p_status='dismissed' then event_count else event_count_baseline end,
    reviewed_at=case when p_status='open' then null else clock_timestamp() end,
    reviewed_by=case when p_status='open' then null else auth.uid() end,
    updated_at=clock_timestamp()
  where user_id=p_user_id;
  return jsonb_build_object('userId',p_user_id,'status',p_status);
end; $$;
revoke all on function public.admin_review_anticheat_case(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_review_anticheat_case(uuid,text,text)
  to authenticated;

create or replace function public.admin_list_anticheat_cases(
  p_query text default '',p_severity text default '',p_limit integer default 50,p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  p_query:=left(btrim(coalesce(p_query,'')),100);
  p_severity:=lower(btrim(coalesce(p_severity,'')));
  if p_severity not in ('','watch','elevated','high','critical') then raise exception 'INVALID_SEVERITY'; end if;
  p_limit:=least(greatest(coalesce(p_limit,50),1),100);
  p_offset:=greatest(coalesce(p_offset,0),0);
  with source as materialized (
    select c.*,
      greatest(c.risk_score-c.risk_score_baseline,0) effective_risk_score,
      greatest(c.event_count-c.event_count_baseline,0) effective_event_count,
      coalesce(p.pseudo,'Deleted player') pseudo,to_jsonb(u)->>'email' email,
      case when greatest(c.risk_score-c.risk_score_baseline,0)>=90 then 'critical'
        when greatest(c.risk_score-c.risk_score_baseline,0)>=50 then 'high'
        when greatest(c.risk_score-c.risk_score_baseline,0)>=25 then 'elevated' else 'watch' end severity
    from public.anticheat_cases c
    left join public.user_profiles p on p.user_id=c.user_id
    left join auth.users u on u.id=c.user_id
    where (p_query='' or coalesce(p.pseudo,'') ilike '%'||p_query||'%'
      or coalesce(to_jsonb(u)->>'email','') ilike '%'||p_query||'%')
  ), filtered as materialized (
    select * from source where p_severity='' or severity=p_severity
  ), page as materialized (
    select * from filtered order by (status='open') desc,effective_risk_score desc,last_flagged_at desc,user_id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'cases',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',c.user_id,'pseudo',c.pseudo,'email',c.email,'score',c.effective_risk_score,
      'severity',c.severity,'status',c.status,'eventCount',c.effective_event_count,
      'reasonCodes',c.reason_codes,'firstFlaggedAt',c.first_flagged_at,'lastFlaggedAt',c.last_flagged_at,
      'economicLinkedAccounts',(select count(distinct case when e.actor_user_id=c.user_id then e.counterparty_user_id else e.actor_user_id end)
        from public.anticheat_events e where (e.actor_user_id=c.user_id or e.counterparty_user_id=c.user_id)
          and e.actor_user_id is not null and e.counterparty_user_id is not null
          and e.event_type not in ('network_identity_shared','trade_shared_network_identity')),
      'networkLinkedAccounts',(select count(distinct other.user_id)
        from public.anticheat_network_observations own
        join public.anticheat_network_observations other on other.network_identity=own.network_identity
        where own.user_id=c.user_id and other.user_id<>c.user_id
          and own.last_seen_at>=clock_timestamp()-interval '7 days'
          and other.last_seen_at>=clock_timestamp()-interval '7 days'),
      'latestReview',(select jsonb_build_object(
        'decision',r.decision,'note',r.note,'createdAt',r.created_at,
        'adminPseudo',coalesce(rp.pseudo,'Deleted admin'))
        from public.anticheat_case_reviews r
        left join public.user_profiles rp on rp.user_id=r.admin_user_id
        where r.case_user_id=c.user_id order by r.created_at desc,r.id desc limit 1)
    ) order by (c.status='open') desc,c.effective_risk_score desc,c.last_flagged_at desc,c.user_id) from page c),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'open',(select count(*) from public.anticheat_cases where status='open'),
      'critical',(select count(*) from public.anticheat_cases
        where risk_score-risk_score_baseline>=90 and status='open'),
      'events24h',(select count(*) from public.anticheat_events where occurred_at>=clock_timestamp()-interval '24 hours'),
      'flagged24h',(select count(*) from public.anticheat_event_subjects s join public.anticheat_events e on e.id=s.event_id
        where s.risk_points>0 and e.occurred_at>=clock_timestamp()-interval '24 hours')
    )
  ) into result;
  return result;
end; $$;

notify pgrst,'reload schema';
commit;
