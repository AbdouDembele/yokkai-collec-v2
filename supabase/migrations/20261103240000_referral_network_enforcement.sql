begin;
set local lock_timeout='5s';

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net;

-- Keep only a keyed digest of a deleted email during the 14-day re-signup
-- window. The HMAC key and cooldown ledger are inaccessible through the API.
create table public.deleted_email_cooldown_key (
  singleton boolean primary key default true check(singleton),
  secret bytea not null check(octet_length(secret)=32)
);
insert into public.deleted_email_cooldown_key(singleton,secret)
values(true,extensions.gen_random_bytes(32));
alter table public.deleted_email_cooldown_key enable row level security;
revoke all on public.deleted_email_cooldown_key from public,anon,authenticated,service_role;

create table public.deleted_email_cooldowns (
  email_hmac bytea primary key check(octet_length(email_hmac)=32),
  deleted_at timestamptz not null,
  expires_at timestamptz not null,
  check(expires_at=deleted_at+interval '14 days')
);
alter table public.deleted_email_cooldowns enable row level security;
revoke all on public.deleted_email_cooldowns from public,anon,authenticated,service_role;
create index deleted_email_cooldowns_expiry_idx on public.deleted_email_cooldowns(expires_at);

create function public.capture_deleted_email_cooldown() returns trigger
language plpgsql security definer set search_path='' as $$
declare normalized_email text:=lower(btrim(coalesce(to_jsonb(old)->>'email',''))); stamp timestamptz:=clock_timestamp(); email_digest bytea;
begin
  -- Only the self-service deletion path starts a cooldown. Admin bans and
  -- operational cleanup must not consume a player's ability to sign up again.
  if normalized_email='' or not exists(
    select 1 from public.anticheat_deleted_accounts d
    where d.user_id=old.id and d.deletion_origin='self'
  ) then return old;end if;
  select extensions.hmac(convert_to('email-cooldown:'||normalized_email,'UTF8'),secret,'sha256')
    into email_digest from public.deleted_email_cooldown_key where singleton;
  if email_digest is null then raise exception 'EMAIL_COOLDOWN_KEY_MISSING';end if;
  insert into public.deleted_email_cooldowns(email_hmac,deleted_at,expires_at)
    values(email_digest,stamp,stamp+interval '14 days')
  on conflict(email_hmac) do update set deleted_at=excluded.deleted_at,expires_at=excluded.expires_at;
  return old;
end;$$;
revoke all on function public.capture_deleted_email_cooldown() from public,anon,authenticated,service_role;
create trigger auth_user_deleted_email_cooldown before delete on auth.users
  for each row execute function public.capture_deleted_email_cooldown();

-- Existing INSERT-only disposable-email guard also blocks deleted addresses.
create or replace function public.guard_disposable_signup()
returns trigger language plpgsql security definer set search_path='' as $$
declare labels text[]; rejected_domain text; normalized_email text:=lower(btrim(coalesce(to_jsonb(new)->>'email',''))); email_digest bytea;
begin
  if normalized_email<>'' then
    select extensions.hmac(convert_to('email-cooldown:'||normalized_email,'UTF8'),secret,'sha256')
      into email_digest from public.deleted_email_cooldown_key where singleton;
    delete from public.deleted_email_cooldowns where expires_at<=clock_timestamp();
    if exists(select 1 from public.deleted_email_cooldowns where email_hmac=email_digest and expires_at>clock_timestamp()) then
      raise exception 'EMAIL_REUSE_COOLDOWN_ACTIVE' using errcode='P0001';
    end if;
  end if;
  if public.is_disposable_email(to_jsonb(new)->>'email') then
    labels:=string_to_array(public.signup_email_domain(to_jsonb(new)->>'email'),'.');
    select r.domain into rejected_domain from public.signup_email_domain_rules r
      where not r.allowed and r.domain=any(array(select array_to_string(labels[i:cardinality(labels)],'.') from generate_subscripts(labels,1) i where i<cardinality(labels)))
      order by char_length(r.domain) desc limit 1;
    raise log 'signup_rejected_disposable_email domain=%', encode(convert_to(rejected_domain,'UTF8'),'escape');
    raise exception 'DISPOSABLE_EMAIL_NOT_ALLOWED' using errcode='P0001';
  end if;
  return new;
end;$$;

create function public.purge_deleted_email_cooldowns()
returns integer language plpgsql set search_path='' as $$
declare affected integer;
begin
  delete from public.deleted_email_cooldowns where expires_at<=clock_timestamp();
  get diagnostics affected=row_count;return affected;
end;$$;
revoke all on function public.purge_deleted_email_cooldowns() from public,anon,authenticated,service_role;
select public.purge_deleted_email_cooldowns();

-- A shared connection is actionable here only when the referrer and at least
-- four distinct email-verified, rewarded referrals share it within seven days.
alter table public.anticheat_events drop constraint anticheat_events_event_type_check;
alter table public.anticheat_events add constraint anticheat_events_event_type_check check(event_type in(
  'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
  'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded',
  'network_identity_shared','trade_shared_network_identity','referral_network_review','referral_network_enforcement'
));

-- A shared IP alone creates a review signal. It is never sufficient for an
-- automatic ban or clawback; the enforcement path also requires a shared
-- first-party device token across the entire rewarded referral cohort.
create table public.anticheat_referral_network_reviews (
  referrer_id uuid not null,
  network_identity text not null check(network_identity~'^v[1-9][0-9]*:[a-f0-9]{64}$'),
  first_flagged_at timestamptz not null default clock_timestamp(),
  last_flagged_at timestamptz not null default clock_timestamp(),
  primary key(referrer_id,network_identity)
);
alter table public.anticheat_referral_network_reviews enable row level security;
revoke all on public.anticheat_referral_network_reviews from public,anon,authenticated,service_role;
create table public.anticheat_referral_reward_holds (
  referral_id uuid primary key references public.referrals(id) on delete cascade,
  referrer_id uuid not null,
  network_identity text not null check(network_identity~'^v[1-9][0-9]*:[a-f0-9]{64}$'),
  held_at timestamptz not null default clock_timestamp(),
  release_after timestamptz not null
);
alter table public.anticheat_referral_reward_holds enable row level security;
revoke all on public.anticheat_referral_reward_holds from public,anon,authenticated,service_role;
create index anticheat_referral_reward_holds_release_idx on public.anticheat_referral_reward_holds(release_after);

-- Keep future bonuses pending while a network-only cluster is reviewed. If the
-- stronger device signal arrives, enforcement cancels these pending rewards;
-- otherwise the scheduled release pays them after seven quiet days.
create or replace function public.complete_referral_after_verification(
  p_referred_id uuid,p_verified_at timestamptz
) returns void language plpgsql security definer set search_path='' as $$
declare referral public.referrals%rowtype; held_network text; held_until timestamptz;
begin
  if p_referred_id is null or p_verified_at is null then return;end if;
  select * into referral from public.referrals where referred_id=p_referred_id for update;
  if not found or referral.rewarded_at is not null then return;end if;
  update public.referrals set verified_at=coalesce(verified_at,p_verified_at) where id=referral.id
    returning * into referral;
  select review.network_identity,review.last_flagged_at+interval '7 days'
    into held_network,held_until
    from public.anticheat_network_observations parent
    join public.anticheat_network_observations child on child.network_identity=parent.network_identity
      and child.user_id=referral.referred_id and child.last_seen_at>=clock_timestamp()-interval '7 days'
    join public.anticheat_referral_network_reviews review on review.referrer_id=referral.referrer_id
      and review.network_identity=parent.network_identity
      and review.last_flagged_at>=clock_timestamp()-interval '7 days'
    where parent.user_id=referral.referrer_id and parent.last_seen_at>=clock_timestamp()-interval '7 days'
    order by review.last_flagged_at desc limit 1;
  if held_network is not null then
    insert into public.anticheat_referral_reward_holds(referral_id,referrer_id,network_identity,held_at,release_after)
      values(referral.id,referral.referrer_id,held_network,clock_timestamp(),held_until)
      on conflict(referral_id) do update set network_identity=excluded.network_identity,release_after=excluded.release_after;
    return;
  end if;
  if exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=referral.id) then return;end if;
  update public.user_profiles set bonus_regular_packs=bonus_regular_packs+referral.reward_packs
    where user_id=referral.referrer_id;
  if not found then return;end if;
  update public.user_profiles set bonus_regular_packs=bonus_regular_packs+referral.reward_packs
    where user_id=referral.referred_id;
  update public.referrals set rewarded_at=clock_timestamp() where id=referral.id and rewarded_at is null;
  delete from public.anticheat_referral_reward_holds where referral_id=referral.id;
end;$$;
revoke all on function public.complete_referral_after_verification(uuid,timestamptz) from public,anon,authenticated,service_role;

-- Provision with a freshly rotated Discord webhook through an operator-only
-- SQL session. Never put the webhook URL in migrations, app code or browser env.
create table public.anticheat_discord_config (
  id boolean primary key default true check(id),
  webhook_url text not null check(webhook_url~'^https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+$')
);
alter table public.anticheat_discord_config enable row level security;
revoke all on public.anticheat_discord_config from public,anon,authenticated,service_role;

create table public.anticheat_discord_outbox (
  event_id bigint primary key references public.anticheat_events(id) on delete restrict,
  payload jsonb not null,
  queued_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  request_id bigint,
  last_attempt_at timestamptz,
  attempts integer not null default 0 check(attempts>=0)
);
alter table public.anticheat_discord_outbox enable row level security;
revoke all on public.anticheat_discord_outbox from public,anon,authenticated,service_role;
create index anticheat_discord_outbox_pending_idx on public.anticheat_discord_outbox(queued_at)
  where dispatched_at is null;

create function public.queue_anticheat_discord_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_row public.anticheat_events%rowtype; actor_name text; counterparty_name text;
  all_reasons text[]; related_names text[]; total_risk integer; alert_payload jsonb;
begin
  -- Risk-free routine activity is not sent. Each suspicious economic or
  -- identity event is deduplicated by immutable event id.
  if new.risk_points<=0 then return new;end if;
  select * into event_row from public.anticheat_events where id=new.event_id;
  if not found then return new;end if;
  select coalesce(p.pseudo,'Joueur') into actor_name from public.user_profiles p where p.user_id=event_row.actor_user_id;
  select coalesce(p.pseudo,'Joueur') into counterparty_name from public.user_profiles p where p.user_id=event_row.counterparty_user_id;
  select coalesce(array_agg(distinct reason.code order by reason.code),'{}'::text[]),coalesce(sum(s.risk_points),0)::integer
    into all_reasons,total_risk
    from public.anticheat_event_subjects s cross join lateral unnest(s.reason_codes) as reason(code)
    where s.event_id=new.event_id;
  select coalesce(array_agg(distinct p.pseudo order by p.pseudo) filter(where p.pseudo is not null),'{}'::text[])
    into related_names from public.anticheat_event_subjects s
    join public.user_profiles p on p.user_id=s.user_id
    where s.event_id=new.event_id and s.user_id is distinct from event_row.actor_user_id;
  alert_payload:=jsonb_build_object('allowed_mentions',jsonb_build_object('parse','{}'::text[]),'embeds',jsonb_build_array(jsonb_build_object(
    'title','Yokkai · signal anti-triche',
    'description',format('%s%s',event_row.event_type,case when actor_name is null then '' else format(' · %s%s',actor_name,case when counterparty_name is null then '' else ' → '||counterparty_name end) end),
    'color',15158332,
    'fields',jsonb_build_array(
      jsonb_build_object('name','Risque','value',total_risk::text,'inline',true),
      jsonb_build_object('name','Motifs','value',left(coalesce(array_to_string(all_reasons,', '),'Signal à examiner'),900),'inline',false)
    ) || case when cardinality(related_names)>0 then jsonb_build_array(
      jsonb_build_object('name','Comptes concernés','value',left(array_to_string(related_names,', '),900),'inline',false)
    ) else '[]'::jsonb end || jsonb_build_array(
      jsonb_build_object('name','Détails','value',format('%s carte(s) · %s Karas · événement #%s%s',event_row.card_count,event_row.amount,event_row.id,
        case when event_row.metadata ? 'referralCount' then format(' · %s filleuls concernés',event_row.metadata->>'referralCount') else '' end),'inline',false)
    ),'timestamp',event_row.occurred_at
  )));
  insert into public.anticheat_discord_outbox(event_id,payload)
    values(new.event_id,alert_payload) on conflict(event_id) do update set payload=excluded.payload
      where public.anticheat_discord_outbox.dispatched_at is null;
  return new;
end;$$;
revoke all on function public.queue_anticheat_discord_alert() from public,anon,authenticated,service_role;
create trigger queue_anticheat_discord_alert after insert on public.anticheat_event_subjects
  for each row execute function public.queue_anticheat_discord_alert();

create function public.dispatch_anticheat_discord_alerts()
returns integer language plpgsql security definer set search_path='' as $$
declare config public.anticheat_discord_config%rowtype; item record; pg_request_id bigint;
  response_status integer; response_timeout boolean; response_error text; sent integer:=0;
begin
  select * into config from public.anticheat_discord_config where id;
  if not found then return 0;end if;
  for item in select event_id,payload,request_id,attempts,last_attempt_at from public.anticheat_discord_outbox
    where dispatched_at is null and attempts<12
      and (request_id is not null or last_attempt_at is null or last_attempt_at<=clock_timestamp()-interval '1 minute')
    order by queued_at,event_id limit 25 for update skip locked
  loop
    begin
      if item.request_id is not null then
        select r.status_code,r.timed_out,r.error_msg into response_status,response_timeout,response_error
          from net._http_response r where r.id=item.request_id;
        if not found then
          if item.last_attempt_at<=clock_timestamp()-interval '5 minutes' then
            update public.anticheat_discord_outbox set request_id=null,last_attempt_at=clock_timestamp()
              where event_id=item.event_id;
          end if;
          continue;
        end if;
        if response_status between 200 and 299 and not coalesce(response_timeout,false) and response_error is null then
          update public.anticheat_discord_outbox set dispatched_at=clock_timestamp(),request_id=null
            where event_id=item.event_id;
          sent:=sent+1;
        else
          update public.anticheat_discord_outbox set request_id=null,last_attempt_at=clock_timestamp()
            where event_id=item.event_id;
          raise warning 'ANTICHEAT_DISCORD_HTTP_FAILED event_id=% status=% timeout=%',
            item.event_id,response_status,response_timeout;
        end if;
        continue;
      end if;
      execute 'select net.http_post(url := $1,body := $2,headers := $3,timeout_milliseconds := 5000)'
        into pg_request_id using config.webhook_url,item.payload,jsonb_build_object('Content-Type','application/json');
      update public.anticheat_discord_outbox set request_id=pg_request_id,last_attempt_at=clock_timestamp(),attempts=attempts+1
        where event_id=item.event_id;
      sent:=sent+1;
    exception when others then
      update public.anticheat_discord_outbox set request_id=null,last_attempt_at=clock_timestamp(),attempts=attempts+1
        where event_id=item.event_id;
      raise warning 'ANTICHEAT_DISCORD_DISPATCH_FAILED event_id=% sqlstate=%',item.event_id,sqlstate;
    end;
  end loop;
  return sent;
end;$$;
revoke all on function public.dispatch_anticheat_discord_alerts() from public,anon,authenticated,service_role;
select cron.schedule('dispatch-anticheat-discord-alerts','* * * * *','select public.dispatch_anticheat_discord_alerts();');

create table public.anticheat_referral_enforcements (
  referral_id uuid primary key,
  referrer_id uuid not null,
  referred_id uuid not null,
  referred_banned boolean not null,
  referral_packs_removed integer not null check(referral_packs_removed>=0),
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_referral_enforcements enable row level security;
revoke all on public.anticheat_referral_enforcements from public,anon,authenticated,service_role;
create index anticheat_referral_enforcements_referrer_idx on public.anticheat_referral_enforcements(referrer_id,applied_at desc);

create function public.release_quiet_referral_reward_holds()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; released integer:=0;
begin
  for item in select h.referral_id,h.referrer_id,h.network_identity
    from public.anticheat_referral_reward_holds h
    where h.release_after<=clock_timestamp()
    order by h.release_after,h.referral_id limit 100 for update skip locked
  loop
    if exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=item.referral_id) then
      delete from public.anticheat_referral_reward_holds where referral_id=item.referral_id;
      continue;
    end if;
    delete from public.anticheat_referral_network_reviews r
      where r.referrer_id=item.referrer_id and r.network_identity=item.network_identity
        and r.last_flagged_at<=clock_timestamp()-interval '7 days';
    perform public.complete_referral_after_verification(
      (select referral.referred_id from public.referrals referral where referral.id=item.referral_id),
      (select referral.verified_at from public.referrals referral where referral.id=item.referral_id)
    );
    if not exists(select 1 from public.anticheat_referral_reward_holds where referral_id=item.referral_id) then
      released:=released+1;
    end if;
  end loop;
  return released;
end;$$;
revoke all on function public.release_quiet_referral_reward_holds() from public,anon,authenticated,service_role;
select cron.schedule('release-quiet-referral-reward-holds','*/15 * * * *','select public.release_quiet_referral_reward_holds();');

alter table public.account_sanctions drop constraint account_sanctions_sanction_type_check;
alter table public.account_sanctions add constraint account_sanctions_sanction_type_check check(sanction_type in(
  'AFFILIATE_ABUSE_SANCTION','AFFILIATE_ABUSE_WARNING_WITH_PENALTY','AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE_NETWORK_WARNING'
));
do $$declare constraint_name text;begin
  select c.conname into constraint_name from pg_constraint c
  where c.conrelid='public.account_sanctions'::regclass and c.contype='c'
    and pg_get_constraintdef(c.oid) like '%sanction_type%'
    and pg_get_constraintdef(c.oid) like '%card_action%'
    and pg_get_constraintdef(c.oid) like '%kara_action%'
  limit 1;
  if constraint_name is null then raise exception 'ACCOUNT_SANCTION_RELATION_CHECK_MISSING';end if;
  execute format('alter table public.account_sanctions drop constraint %I',constraint_name);
end;$$;
alter table public.account_sanctions add constraint account_sanctions_type_relation_check check(
  (sanction_type='AFFILIATE_ABUSE_SANCTION' and card_action='PROVEN_ASSET_REMOVAL' and kara_action='ADMIN_DISCIPLINARY_PENALTY')
  or (sanction_type='AFFILIATE_ABUSE_WARNING_WITH_PENALTY' and card_action='NONE' and kara_action='ADMIN_DISCIPLINARY_PENALTY')
  or (sanction_type in('AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE_NETWORK_WARNING') and card_action='NONE' and kara_action='NONE')
);

create function public.enforce_referral_network_cohort() returns trigger
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); referrer uuid; network_hash text; network_hashes text[];
  suspicious_users uuid[]; suspicious_referrals uuid[]; device_users uuid[]; device_referrals uuid[];
  new_referral record; affected_referrals uuid[]:='{}'; affected_users uuid[]:='{}'; removed_packs integer:=0;
  event_id bigint; inserted_referral uuid; ban_applied boolean; review_inserted boolean;
begin
  if tg_table_name='anticheat_network_observations' then
    network_hashes:=array[new.network_identity];
  else
    select coalesce(array_agg(distinct n.network_identity),'{}'::text[]) into network_hashes
      from public.anticheat_network_observations n where n.user_id=new.user_id and n.last_seen_at>=stamp-interval '7 days';
  end if;
  foreach network_hash in array network_hashes loop
    for referrer in
      select distinct r.referrer_id from public.referrals r
      join public.anticheat_network_observations parent on parent.user_id=r.referrer_id
        and parent.network_identity=network_hash and parent.last_seen_at>=stamp-interval '7 days'
      join public.anticheat_network_observations child on child.user_id=r.referred_id
        and child.network_identity=network_hash and child.last_seen_at>=stamp-interval '7 days'
      where r.rewarded_at is not null and (new.user_id=parent.user_id or new.user_id=child.user_id)
      order by r.referrer_id
    loop
      perform pg_advisory_xact_lock(hashtextextended('referral-network:'||referrer::text||':'||network_hash,0));
      select array_agg(distinct r.referred_id order by r.referred_id),array_agg(distinct r.id order by r.id)
      into suspicious_users,suspicious_referrals from public.referrals r
      join public.anticheat_network_observations parent on parent.user_id=r.referrer_id
        and parent.network_identity=network_hash and parent.last_seen_at>=stamp-interval '7 days'
      join public.anticheat_network_observations child on child.user_id=r.referred_id
        and child.network_identity=network_hash and child.last_seen_at>=stamp-interval '7 days'
      join auth.users u on u.id=r.referred_id
      where r.referrer_id=referrer and u.email_confirmed_at is not null
        and (r.rewarded_at is not null or exists(select 1 from public.anticheat_referral_reward_holds h where h.referral_id=r.id));
      if coalesce(cardinality(suspicious_users),0)<4 then continue;end if;

      select array_agg(distinct r.referred_id order by r.referred_id),array_agg(distinct r.id order by r.id)
      into device_users,device_referrals from public.referrals r
      join public.anticheat_network_observations parent_net on parent_net.user_id=r.referrer_id
        and parent_net.network_identity=network_hash and parent_net.last_seen_at>=stamp-interval '7 days'
      join public.anticheat_network_observations child_net on child_net.user_id=r.referred_id
        and child_net.network_identity=network_hash and child_net.last_seen_at>=stamp-interval '7 days'
      join public.anticheat_device_observations parent_device on parent_device.user_id=r.referrer_id
        and parent_device.last_seen_at>=stamp-interval '7 days'
      join public.anticheat_device_observations child_device on child_device.user_id=r.referred_id
        and child_device.device_identity=parent_device.device_identity
        and child_device.last_seen_at>=stamp-interval '7 days'
      join auth.users u on u.id=r.referred_id
      where r.referrer_id=referrer and u.email_confirmed_at is not null
        and (r.rewarded_at is not null or exists(select 1 from public.anticheat_referral_reward_holds h where h.referral_id=r.id));

      if coalesce(cardinality(device_users),0)<4 then
        insert into public.anticheat_referral_network_reviews(referrer_id,network_identity,first_flagged_at,last_flagged_at)
          values(referrer,network_hash,stamp,stamp)
          on conflict(referrer_id,network_identity) do update set
            first_flagged_at=case when public.anticheat_referral_network_reviews.last_flagged_at<=excluded.last_flagged_at-interval '7 days'
              then excluded.first_flagged_at else public.anticheat_referral_network_reviews.first_flagged_at end,
            last_flagged_at=excluded.last_flagged_at;
        insert into public.anticheat_referral_reward_holds(referral_id,referrer_id,network_identity,held_at,release_after)
          select r.id,referrer,network_hash,stamp,stamp+interval '7 days'
          from public.referrals r where r.referrer_id=referrer and r.verified_at is not null and r.rewarded_at is null
            and exists(select 1 from public.anticheat_network_observations child
              where child.user_id=r.referred_id and child.network_identity=network_hash and child.last_seen_at>=stamp-interval '7 days')
          on conflict(referral_id) do update set network_identity=excluded.network_identity,release_after=excluded.release_after;
        insert into public.anticheat_events(event_type,actor_user_id,occurred_at,metadata)
          values('referral_network_review',referrer,stamp,jsonb_build_object('referralCount',cardinality(suspicious_users)))
          returning id into event_id;
        insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
          values(event_id,referrer,8,array['REFERRAL_NETWORK_REVIEW']);
        insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
          select event_id,linked_user,8,array['REFERRAL_NETWORK_REVIEW'] from unnest(suspicious_users) as linked(linked_user)
          on conflict do nothing;
        continue;
      end if;
      suspicious_users:=device_users;suspicious_referrals:=device_referrals;

      for new_referral in select r.id,r.referred_id,r.reward_packs,r.rewarded_at from public.referrals r
        where r.id=any(suspicious_referrals)
          and not exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=r.id)
        order by r.id for update
      loop
        update auth.users set banned_until='infinity'::timestamptz,updated_at=stamp where id=new_referral.referred_id;
        ban_applied:=found;
        if ban_applied then
          delete from auth.sessions where user_id=new_referral.referred_id;
          affected_users:=array_append(affected_users,new_referral.referred_id);
        end if;
        insert into public.anticheat_referral_enforcements(referral_id,referrer_id,referred_id,referred_banned,referral_packs_removed,applied_at)
          values(new_referral.id,referrer,new_referral.referred_id,ban_applied,0,stamp)
          on conflict(referral_id) do nothing returning referral_id into inserted_referral;
        if inserted_referral is not null then affected_referrals:=array_append(affected_referrals,new_referral.id);end if;
        inserted_referral:=null;
      end loop;
      delete from public.anticheat_referral_reward_holds where referral_id=any(suspicious_referrals);
      if cardinality(affected_referrals)=0 then continue;end if;

    -- Referral bonuses are the only source of bonus_regular_packs. Remove at
    -- most the remaining balance; spent packs/cards are never guessed or seized.
    select least(coalesce(p.bonus_regular_packs,0),coalesce((select sum(r.reward_packs)
      from public.referrals r where r.id=any(affected_referrals) and r.rewarded_at is not null),0))::integer
      into removed_packs from public.user_profiles p where p.user_id=referrer;
    removed_packs:=coalesce(removed_packs,0);
    if removed_packs>0 then
      update public.user_profiles set bonus_regular_packs=bonus_regular_packs-removed_packs where user_id=referrer;
    end if;
    with allocations as (
      select e.referral_id,r.reward_packs,
        sum(r.reward_packs) over(order by r.id rows between unbounded preceding and current row) as cumulative_packs
      from public.anticheat_referral_enforcements e join public.referrals r on r.id=e.referral_id
      where e.referral_id=any(affected_referrals) and r.rewarded_at is not null
    )
    update public.anticheat_referral_enforcements e set referral_packs_removed=
      least(a.reward_packs,greatest(0,removed_packs-(a.cumulative_packs-a.reward_packs)))
    from allocations a where a.referral_id=e.referral_id;

      if exists(select 1 from auth.users where id=referrer)
      and not exists(select 1 from public.account_deletion_log where user_id=referrer) then
      insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
        cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
      values('referral-network-warning:'||referrer::text,referrer,'AFFILIATE_ABUSE_NETWORK_WARNING','AFFILIATE_ABUSE','NONE','NONE',
        0,0,coalesce((select karas_balance from public.user_profiles where user_id=referrer),0),
        coalesce((select karas_balance from public.user_profiles where user_id=referrer),0),stamp,stamp,'APPLIED',
        jsonb_build_object('enforcement','shared-network-four-rewarded-referrals','referredCount',cardinality(affected_users),'unusedReferralPacksRemoved',removed_packs))
      on conflict(operation_id) do nothing;
    end if;

      insert into public.anticheat_events(event_type,actor_user_id,occurred_at,metadata)
        values('referral_network_enforcement',referrer,stamp,jsonb_build_object('referredCount',cardinality(affected_users),'unusedReferralPacksRemoved',removed_packs))
        returning id into event_id;
      insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
        values(event_id,referrer,60,array['REFERRAL_NETWORK_ENFORCEMENT']) on conflict do nothing;
      insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
        select event_id,user_id,100,array['REFERRAL_NETWORK_ENFORCEMENT'] from unnest(affected_users) user_id
        on conflict do nothing;
      affected_referrals:='{}';affected_users:='{}';
    end loop;
  end loop;
  return new;
end;$$;
revoke all on function public.enforce_referral_network_cohort() from public,anon,authenticated,service_role;
create trigger enforce_referral_network_cohort after insert or update of last_seen_at on public.anticheat_network_observations
  for each row execute function public.enforce_referral_network_cohort();
create trigger enforce_referral_device_cohort after insert or update of last_seen_at on public.anticheat_device_observations
  for each row execute function public.enforce_referral_network_cohort();

-- Keep the existing admin event filter available for the new immutable record.
select cron.schedule('purge-deleted-email-cooldowns','*/15 * * * *','select public.purge_deleted_email_cooldowns();');

do $$declare definition text;begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_events(uuid,text,integer,integer)'::regprocedure);
  if position('''network_identity_shared'',''trade_shared_network_identity''' in definition)=0 then raise exception 'ANTICHEAT_EVENT_FILTER_PATCH_MISMATCH';end if;
  definition:=replace(definition,'''network_identity_shared'',''trade_shared_network_identity''',
    '''network_identity_shared'',''trade_shared_network_identity'',''referral_network_review'',''referral_network_enforcement''');
  execute definition;
end;$$;

notify pgrst,'reload schema';
commit;
