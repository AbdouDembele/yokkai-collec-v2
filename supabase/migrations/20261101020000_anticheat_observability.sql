begin;

-- Observation-only anti-cheat ledger. No player or service role can read or
-- mutate these tables directly. Administrator access is limited to the two
-- DTO functions at the end of this migration.
create table public.anticheat_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  event_type text not null check (event_type in (
    'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
    'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded'
  )),
  actor_user_id uuid,
  counterparty_user_id uuid,
  subject_id uuid,
  amount integer not null default 0 check (amount>=0),
  card_count integer not null default 0 check (card_count>=0),
  metadata jsonb not null default '{}'::jsonb,
  check (actor_user_id is not null or counterparty_user_id is not null)
);

create table public.anticheat_event_subjects (
  event_id bigint not null references public.anticheat_events(id) on delete restrict,
  user_id uuid not null,
  risk_points integer not null default 0 check (risk_points between 0 and 100),
  reason_codes text[] not null default '{}',
  primary key (event_id,user_id)
);

create table public.anticheat_cases (
  user_id uuid primary key,
  risk_score integer not null default 0 check (risk_score>=0),
  event_count integer not null default 0 check (event_count>=0),
  reason_codes text[] not null default '{}',
  first_flagged_at timestamptz not null,
  last_flagged_at timestamptz not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.anticheat_events enable row level security;
alter table public.anticheat_event_subjects enable row level security;
alter table public.anticheat_cases enable row level security;
revoke all on public.anticheat_events,public.anticheat_event_subjects,public.anticheat_cases
  from public,anon,authenticated,service_role;
revoke all on sequence public.anticheat_events_id_seq
  from public,anon,authenticated,service_role;

create index anticheat_events_occurred_idx on public.anticheat_events(occurred_at desc,id desc);
create index anticheat_events_actor_idx on public.anticheat_events(actor_user_id,occurred_at desc);
create index anticheat_events_counterparty_idx on public.anticheat_events(counterparty_user_id,occurred_at desc);
create index anticheat_events_type_idx on public.anticheat_events(event_type,occurred_at desc);
create index anticheat_event_subjects_user_idx on public.anticheat_event_subjects(user_id,event_id desc);
create index anticheat_cases_priority_idx on public.anticheat_cases(status,risk_score desc,last_flagged_at desc);

create function public.prevent_anticheat_ledger_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'ANTICHEAT_LEDGER_IMMUTABLE';
end; $$;
revoke all on function public.prevent_anticheat_ledger_mutation()
  from public,anon,authenticated,service_role;
create trigger anticheat_events_immutable before update or delete on public.anticheat_events
  for each row execute function public.prevent_anticheat_ledger_mutation();
create trigger anticheat_event_subjects_immutable before update or delete on public.anticheat_event_subjects
  for each row execute function public.prevent_anticheat_ledger_mutation();

create function public.record_anticheat_event(
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
  event_id bigint;
  actor_points integer:=0;
  counterparty_points integer:=0;
  actor_reasons text[]:='{}';
  counterparty_reasons text[]:='{}';
  actor_recent boolean:=false;
  counterparty_recent boolean:=false;
  pair_events integer:=0;
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
    select 1
    from public.anticheat_events
    where event_type='account_registered'
      and actor_user_id=p_actor_user_id
      and occurred_at between stamp-interval '72 hours' and stamp
  ) into actor_recent;
  select exists(
    select 1
    from public.anticheat_events
    where event_type='account_registered'
      and actor_user_id=p_counterparty_user_id
      and occurred_at between stamp-interval '72 hours' and stamp
  ) into counterparty_recent;

  insert into public.anticheat_events(
    event_type,actor_user_id,counterparty_user_id,subject_id,amount,card_count,metadata,occurred_at
  ) values(
    p_event_type,p_actor_user_id,p_counterparty_user_id,p_subject_id,
    greatest(coalesce(p_amount,0),0),greatest(coalesce(p_card_count,0),0),
    coalesce(p_metadata,'{}'::jsonb),stamp
  ) returning id into event_id;

  if p_event_type='trade_accepted' then
    select count(*)::integer into pair_events from public.anticheat_events e
      where e.id<>event_id and e.event_type='trade_accepted'
        and e.occurred_at>=stamp-interval '24 hours'
        and ((e.actor_user_id=p_actor_user_id and e.counterparty_user_id=p_counterparty_user_id)
          or (e.actor_user_id=p_counterparty_user_id and e.counterparty_user_id=p_actor_user_id));

    if offered_total>0 and requested_total=0 then
      actor_points:=actor_points+18;
      counterparty_points:=counterparty_points+30;
      actor_reasons:=array_append(actor_reasons,'ONE_WAY_TRADE_SOURCE');
      counterparty_reasons:=array_append(counterparty_reasons,'ONE_WAY_TRADE_BENEFICIARY');
    elsif requested_total>0 and offered_total=0 then
      actor_points:=actor_points+30;
      counterparty_points:=counterparty_points+18;
      actor_reasons:=array_append(actor_reasons,'ONE_WAY_TRADE_BENEFICIARY');
      counterparty_reasons:=array_append(counterparty_reasons,'ONE_WAY_TRADE_SOURCE');
    end if;
    if abs(offered_value-requested_value)>=45
      and greatest(offered_value,requested_value)>=4*greatest(1,least(offered_value,requested_value)) then
      actor_points:=actor_points+12;
      counterparty_points:=counterparty_points+12;
      actor_reasons:=array_append(actor_reasons,'TRADE_VALUE_IMBALANCE');
      counterparty_reasons:=array_append(counterparty_reasons,'TRADE_VALUE_IMBALANCE');
    end if;
    if greatest(
      coalesce((p_metadata->>'offeredKaras')::integer,0),
      coalesce((p_metadata->>'requestedKaras')::integer,0)
    )>=5000 then
      actor_points:=actor_points+15;
      counterparty_points:=counterparty_points+15;
      actor_reasons:=array_append(actor_reasons,'LARGE_KARA_TRANSFER');
      counterparty_reasons:=array_append(counterparty_reasons,'LARGE_KARA_TRANSFER');
    end if;
    if pair_events>=3 then
      actor_points:=actor_points+10;
      counterparty_points:=counterparty_points+10;
      actor_reasons:=array_append(actor_reasons,'REPEATED_TRADE_PAIR');
      counterparty_reasons:=array_append(counterparty_reasons,'REPEATED_TRADE_PAIR');
    end if;
  elsif p_event_type='auction_bid' then
    select count(*)::integer into pair_events from public.anticheat_events e
      where e.id<>event_id and e.event_type='auction_bid'
        and e.occurred_at>=stamp-interval '24 hours'
        and e.actor_user_id=p_actor_user_id and e.counterparty_user_id=p_counterparty_user_id;
    if p_amount>=5000 and p_amount>=greatest(100,starting_price*10) then
      actor_points:=actor_points+15;
      counterparty_points:=counterparty_points+5;
      actor_reasons:=array_append(actor_reasons,'EXTREME_AUCTION_BID');
      counterparty_reasons:=array_append(counterparty_reasons,'EXTREME_AUCTION_BID_COUNTERPARTY');
    end if;
    if pair_events>=8 then
      actor_points:=actor_points+10;
      counterparty_points:=counterparty_points+10;
      actor_reasons:=array_append(actor_reasons,'REPEATED_AUCTION_PAIR');
      counterparty_reasons:=array_append(counterparty_reasons,'REPEATED_AUCTION_PAIR');
    end if;
  elsif p_event_type='auction_sold' then
    select count(*)::integer into pair_events from public.anticheat_events e
      where e.id<>event_id and e.event_type='auction_sold'
        and e.occurred_at>=stamp-interval '7 days'
        and e.actor_user_id=p_actor_user_id and e.counterparty_user_id=p_counterparty_user_id;
    if pair_events>=3 then
      actor_points:=actor_points+15;
      counterparty_points:=counterparty_points+15;
      actor_reasons:=array_append(actor_reasons,'REPEATED_AUCTION_SETTLEMENT_PAIR');
      counterparty_reasons:=array_append(counterparty_reasons,'REPEATED_AUCTION_SETTLEMENT_PAIR');
    end if;
  elsif p_event_type='referral_rewarded' then
    select count(*)::integer into burst_events from public.anticheat_events e
      where e.id<>event_id and e.event_type='referral_rewarded'
        and e.actor_user_id=p_actor_user_id and e.occurred_at>=stamp-interval '24 hours';
    if burst_events>=2 then
      actor_points:=actor_points+20;
      actor_reasons:=array_append(actor_reasons,'REFERRAL_REWARD_BURST');
    end if;
  end if;

  if p_event_type in ('trade_accepted','auction_bid','auction_sold') and actor_recent then
    actor_points:=actor_points+10;
    actor_reasons:=array_append(actor_reasons,'NEW_ACCOUNT_ECONOMIC_ACTIVITY');
  end if;
  if p_event_type in ('trade_accepted','auction_sold') and counterparty_recent then
    counterparty_points:=counterparty_points+10;
    counterparty_reasons:=array_append(counterparty_reasons,'NEW_ACCOUNT_ECONOMIC_ACTIVITY');
  end if;

  if p_actor_user_id is not null then
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      values(event_id,p_actor_user_id,least(actor_points,100),actor_reasons);
  end if;
  if p_counterparty_user_id is not null and p_counterparty_user_id is distinct from p_actor_user_id then
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      values(event_id,p_counterparty_user_id,least(counterparty_points,100),counterparty_reasons);
  end if;

  insert into public.anticheat_cases(
    user_id,risk_score,event_count,reason_codes,first_flagged_at,last_flagged_at,status,updated_at
  ) select s.user_id,s.risk_points,1,s.reason_codes,stamp,stamp,'open',stamp
    from public.anticheat_event_subjects s where s.event_id=event_id and s.risk_points>0
  on conflict(user_id) do update set
    risk_score=public.anticheat_cases.risk_score+excluded.risk_score,
    event_count=public.anticheat_cases.event_count+1,
    reason_codes=(select coalesce(array_agg(distinct reason order by reason),'{}'::text[])
      from unnest(public.anticheat_cases.reason_codes||excluded.reason_codes) reason),
    last_flagged_at=excluded.last_flagged_at,
    status=case when public.anticheat_cases.status='dismissed' then 'open' else public.anticheat_cases.status end,
    updated_at=stamp;
  return event_id;
end; $$;
revoke all on function public.record_anticheat_event(text,uuid,uuid,uuid,integer,integer,jsonb,timestamptz)
  from public,anon,authenticated,service_role;

create function public.capture_trade_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  offered_value integer:=0;
  requested_value integer:=0;
  offered_cards integer:=cardinality(new.offered_card_ids);
  requested_cards integer:=cardinality(new.requested_card_ids);
  event_name text;
begin
  if tg_op='INSERT' then event_name:='trade_created';
  elsif old.status is not distinct from new.status then return new;
  elsif new.status='accepted' then event_name:='trade_accepted';
  elsif new.status='declined' then event_name:='trade_declined';
  elsif new.status='cancelled' then event_name:='trade_cancelled';
  else return new;
  end if;
  select coalesce(sum(case rarity::text when 'C' then 1 when 'R' then 2 when 'SR' then 4 when 'SSR' then 8 when 'LR' then 15 else 0 end),0)::integer
    into offered_value from public.user_cards where id=any(new.offered_card_ids);
  select coalesce(sum(case rarity::text when 'C' then 1 when 'R' then 2 when 'SR' then 4 when 'SSR' then 8 when 'LR' then 15 else 0 end),0)::integer
    into requested_value from public.user_cards where id=any(new.requested_card_ids);
  perform public.record_anticheat_event(
    event_name,new.from_user,new.to_user,new.id,
    greatest(new.offered_karas,new.requested_karas),offered_cards+requested_cards,
    jsonb_build_object(
      'offeredCards',offered_cards,'requestedCards',requested_cards,
      'offeredKaras',new.offered_karas,'requestedKaras',new.requested_karas,
      'offeredTotal',offered_cards+new.offered_karas,
      'requestedTotal',requested_cards+new.requested_karas,
      'offeredValue',offered_value+new.offered_karas,
      'requestedValue',requested_value+new.requested_karas,
      'parentOffer',new.parent_offer_id is not null
    )
  );
  return new;
end; $$;
revoke all on function public.capture_trade_anticheat_event()
  from public,anon,authenticated,service_role;
create trigger capture_trade_anticheat_event
  after insert or update on public.trade_offers
  for each row execute function public.capture_trade_anticheat_event();

create function public.capture_auction_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_name text;
begin
  if tg_op='INSERT' then event_name:='auction_created';
  elsif old.status is not distinct from new.status then return new;
  elsif new.status='sold' then event_name:='auction_sold';
  elsif new.status='expired' then event_name:='auction_expired';
  else return new;
  end if;
  perform public.record_anticheat_event(
    event_name,new.seller_id,new.buyer_id,new.id,new.current_price,1,
    jsonb_build_object('startingPrice',new.starting_price,'durationMinutes',new.duration_minutes)
  );
  return new;
end; $$;
revoke all on function public.capture_auction_anticheat_event()
  from public,anon,authenticated,service_role;
create trigger capture_auction_anticheat_event
  after insert or update on public.auctions
  for each row execute function public.capture_auction_anticheat_event();

create function public.capture_bid_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare sale public.auctions%rowtype;
begin
  select * into sale from public.auctions where id=new.auction_id;
  perform public.record_anticheat_event(
    'auction_bid',new.bidder_id,sale.seller_id,new.auction_id,new.amount,1,
    jsonb_build_object('startingPrice',sale.starting_price)
  );
  return new;
end; $$;
revoke all on function public.capture_bid_anticheat_event()
  from public,anon,authenticated,service_role;
create trigger capture_bid_anticheat_event after insert on public.bids
  for each row execute function public.capture_bid_anticheat_event();

create function public.capture_referral_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.record_anticheat_event(
    'referral_rewarded',new.referrer_id,new.referred_id,new.id,0,0,
    jsonb_build_object('rewardPacks',new.reward_packs)
  );
  return new;
end; $$;
revoke all on function public.capture_referral_anticheat_event()
  from public,anon,authenticated,service_role;
create trigger capture_referral_anticheat_event
  after update of rewarded_at on public.referrals
  for each row when (old.rewarded_at is null and new.rewarded_at is not null)
  execute function public.capture_referral_anticheat_event();

create function public.capture_registration_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.record_anticheat_event(
    'account_registered',new.id,null,new.id,0,0,
    jsonb_build_object('provider',coalesce(new.raw_app_meta_data->>'provider','email'))
  );
  return new;
end; $$;
revoke all on function public.capture_registration_anticheat_event()
  from public,anon,authenticated,service_role;
create trigger capture_registration_anticheat_event after insert on auth.users
  for each row execute function public.capture_registration_anticheat_event();

-- Seed a bounded recent history so the dashboard is useful immediately. The
-- same scoring function processes rows chronologically, preserving its pair
-- and burst windows. This block is idempotent at migration level.
do $$
declare
  item record;
  offered_value integer;
  requested_value integer;
begin
  for item in
    select * from public.trade_offers
    where status='accepted' and updated_at>=clock_timestamp()-interval '90 days'
    order by updated_at,id
  loop
    select coalesce(sum(case rarity::text when 'C' then 1 when 'R' then 2 when 'SR' then 4 when 'SSR' then 8 when 'LR' then 15 else 0 end),0)::integer
      into offered_value from public.user_cards where id=any(item.offered_card_ids);
    select coalesce(sum(case rarity::text when 'C' then 1 when 'R' then 2 when 'SR' then 4 when 'SSR' then 8 when 'LR' then 15 else 0 end),0)::integer
      into requested_value from public.user_cards where id=any(item.requested_card_ids);
    perform public.record_anticheat_event(
      'trade_accepted',item.from_user,item.to_user,item.id,
      greatest(item.offered_karas,item.requested_karas),
      cardinality(item.offered_card_ids)+cardinality(item.requested_card_ids),
      jsonb_build_object(
        'offeredCards',cardinality(item.offered_card_ids),
        'requestedCards',cardinality(item.requested_card_ids),
        'offeredKaras',item.offered_karas,'requestedKaras',item.requested_karas,
        'offeredTotal',cardinality(item.offered_card_ids)+item.offered_karas,
        'requestedTotal',cardinality(item.requested_card_ids)+item.requested_karas,
        'offeredValue',offered_value+item.offered_karas,
        'requestedValue',requested_value+item.requested_karas,
        'parentOffer',item.parent_offer_id is not null,'historical',true
      ),item.updated_at
    );
  end loop;

  for item in
    select b.*,a.seller_id,a.starting_price from public.bids b
    join public.auctions a on a.id=b.auction_id
    where b.created_at>=clock_timestamp()-interval '30 days'
    order by b.created_at,b.id
  loop
    perform public.record_anticheat_event(
      'auction_bid',item.bidder_id,item.seller_id,item.auction_id,item.amount,1,
      jsonb_build_object('startingPrice',item.starting_price,'historical',true),item.created_at
    );
  end loop;

  for item in
    select * from public.auctions
    where status='sold' and buyer_id is not null
      and ends_at>=clock_timestamp()-interval '90 days'
    order by ends_at,id
  loop
    perform public.record_anticheat_event(
      'auction_sold',item.seller_id,item.buyer_id,item.id,item.current_price,1,
      jsonb_build_object('startingPrice',item.starting_price,'durationMinutes',item.duration_minutes,'historical',true),
      item.ends_at
    );
  end loop;

  for item in
    select * from public.referrals
    where rewarded_at>=clock_timestamp()-interval '90 days'
    order by rewarded_at,id
  loop
    perform public.record_anticheat_event(
      'referral_rewarded',item.referrer_id,item.referred_id,item.id,0,0,
      jsonb_build_object('rewardPacks',item.reward_packs,'historical',true),item.rewarded_at
    );
  end loop;
end;
$$;

create function public.admin_list_anticheat_cases(
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
    select c.*,coalesce(p.pseudo,'Deleted player') pseudo,u.email,
      case when c.risk_score>=90 then 'critical' when c.risk_score>=50 then 'high'
        when c.risk_score>=25 then 'elevated' else 'watch' end severity
    from public.anticheat_cases c
    left join public.user_profiles p on p.user_id=c.user_id
    left join auth.users u on u.id=c.user_id
    where (p_query='' or coalesce(p.pseudo,'') ilike '%'||p_query||'%'
      or coalesce(u.email,'') ilike '%'||p_query||'%')
  ), filtered as materialized (
    select * from source where p_severity='' or severity=p_severity
  ), page as materialized (
    select * from filtered order by risk_score desc,last_flagged_at desc,user_id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'cases',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',c.user_id,'pseudo',c.pseudo,'email',c.email,'score',c.risk_score,
      'severity',c.severity,'status',c.status,'eventCount',c.event_count,
      'reasonCodes',c.reason_codes,'firstFlaggedAt',c.first_flagged_at,'lastFlaggedAt',c.last_flagged_at,
      'linkedAccounts',(select count(distinct case when e.actor_user_id=c.user_id then e.counterparty_user_id else e.actor_user_id end)
        from public.anticheat_events e where (e.actor_user_id=c.user_id or e.counterparty_user_id=c.user_id)
          and e.actor_user_id is not null and e.counterparty_user_id is not null)
    ) order by c.risk_score desc,c.last_flagged_at desc,c.user_id) from page c),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'open',(select count(*) from public.anticheat_cases where status='open'),
      'critical',(select count(*) from public.anticheat_cases where risk_score>=90),
      'events24h',(select count(*) from public.anticheat_events where occurred_at>=clock_timestamp()-interval '24 hours'),
      'flagged24h',(select count(*) from public.anticheat_event_subjects s join public.anticheat_events e on e.id=s.event_id
        where s.risk_points>0 and e.occurred_at>=clock_timestamp()-interval '24 hours')
    )
  ) into result;
  return result;
end; $$;
revoke all on function public.admin_list_anticheat_cases(text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_cases(text,text,integer,integer) to authenticated;

create function public.admin_list_anticheat_events(
  p_user_id uuid default null,p_event_type text default '',p_limit integer default 50,p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  p_event_type:=lower(btrim(coalesce(p_event_type,'')));
  if p_event_type not in (
    '','account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
    'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded'
  ) then raise exception 'INVALID_ANTICHEAT_EVENT'; end if;
  p_limit:=least(greatest(coalesce(p_limit,50),1),100);
  p_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as materialized (
    select e.*,coalesce(ap.pseudo,'Deleted player') actor_pseudo,
      coalesce(cp.pseudo,'Deleted player') counterparty_pseudo
    from public.anticheat_events e
    left join public.user_profiles ap on ap.user_id=e.actor_user_id
    left join public.user_profiles cp on cp.user_id=e.counterparty_user_id
    where (p_event_type='' or e.event_type=p_event_type)
      and (p_user_id is null or exists(select 1 from public.anticheat_event_subjects s
        where s.event_id=e.id and s.user_id=p_user_id))
  ), page as materialized (
    select * from filtered order by occurred_at desc,id desc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'occurredAt',e.occurred_at,'type',e.event_type,'subjectId',e.subject_id,
      'amount',e.amount,'cardCount',e.card_count,'metadata',e.metadata,
      'actor',case when e.actor_user_id is null then null else jsonb_build_object('id',e.actor_user_id,'pseudo',e.actor_pseudo) end,
      'counterparty',case when e.counterparty_user_id is null then null else jsonb_build_object('id',e.counterparty_user_id,'pseudo',e.counterparty_pseudo) end,
      'subjects',coalesce((select jsonb_agg(jsonb_build_object(
        'userId',s.user_id,'pseudo',coalesce(sp.pseudo,'Deleted player'),
        'riskPoints',s.risk_points,'reasonCodes',s.reason_codes
      ) order by s.risk_points desc,s.user_id) from public.anticheat_event_subjects s
        left join public.user_profiles sp on sp.user_id=s.user_id where s.event_id=e.id),'[]'::jsonb)
    ) order by e.occurred_at desc,e.id desc) from page e),'[]'::jsonb),
    'total',(select count(*) from filtered)
  ) into result;
  return result;
end; $$;
revoke all on function public.admin_list_anticheat_events(uuid,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_events(uuid,text,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;
