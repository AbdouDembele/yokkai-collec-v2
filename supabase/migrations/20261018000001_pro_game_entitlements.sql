begin;

-- Deployment-controlled scope: a Sandbox payment can never activate a live scope.
create table public.billing_entitlement_config (
  singleton boolean primary key default true check (singleton),
  scope text check (scope ~ '^(test|live):acct_[A-Za-z0-9]+:price_[A-Za-z0-9]+$'),
  enabled boolean not null default false,
  check (not enabled or scope is not null)
);
insert into public.billing_entitlement_config(singleton) values(true);
alter table public.billing_entitlement_config enable row level security;
revoke all on public.billing_entitlement_config from public, anon, authenticated;
grant select, update on public.billing_entitlement_config to service_role;

create function public.billing_has_game_pro(p_user uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from public.billing_entitlement_config c
    join public.billing_accounts a on a.scope=c.scope and a.user_id=p_user
    where c.singleton and c.enabled and a.active and a.status='active'
      and not a.risk_hold and a.period_end>clock_timestamp()
      and a.verified_at>clock_timestamp()-interval '15 minutes'
      and a.verified_at<=clock_timestamp()
      and not exists(select 1 from public.account_deletion_log where user_id=p_user)
  );
$$;
revoke all on function public.billing_has_game_pro(uuid) from public,anon,authenticated;
grant execute on function public.billing_has_game_pro(uuid) to service_role;

alter table public.user_profiles
  add column regular_pack_interval_seconds integer not null default 600 check (regular_pack_interval_seconds in (300,600)),
  add column decision_pack_interval_seconds integer not null default 86400 check (decision_pack_interval_seconds in (43200,86400));
revoke all (regular_pack_interval_seconds,decision_pack_interval_seconds) on public.user_profiles from anon,authenticated;

-- Preserve earned reserve/progress on a tier transition. Expiration is evaluated
-- at its actual cutoff, not at the next browser visit. The profile lock serializes
-- pack draws with the paid webhook and concurrent status requests.
create function public.billing_sync_pack_timing(p_user uuid,p_cutoff timestamptz default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  profile public.user_profiles;
  paid boolean;
  stamp timestamptz;
  cutoff timestamptz;
  regular_seconds integer;
  decision_seconds integer;
begin
  select * into profile from public.user_profiles where user_id=p_user for update;
  if not found then return; end if;
  stamp:=clock_timestamp();
  paid:=public.billing_has_game_pro(p_user);
  regular_seconds:=case when paid then 300 else 600 end;
  decision_seconds:=case when paid then 43200 else 86400 end;
  if profile.regular_pack_interval_seconds=regular_seconds
    and profile.decision_pack_interval_seconds=decision_seconds then return; end if;
  cutoff:=stamp;
  if not paid and profile.regular_pack_interval_seconds=300 then
    if p_cutoff is not null then cutoff:=least(stamp,p_cutoff);
    else
      select least(stamp,coalesce(a.period_end,stamp),coalesce(a.verified_at+interval '15 minutes',stamp))
        into cutoff from public.billing_accounts a where a.user_id=p_user;
    end if;
    cutoff:=coalesce(cutoff,stamp);
  end if;
  update public.user_profiles set
    next_regular_pack_at=cutoff+
      (greatest(profile.next_regular_pack_at,cutoff-make_interval(secs=>4*profile.regular_pack_interval_seconds))-cutoff)
      *(regular_seconds::double precision/profile.regular_pack_interval_seconds),
    next_decision_pack_at=case when profile.next_decision_pack_at<=cutoff then profile.next_decision_pack_at
      else profile.next_decision_pack_at+make_interval(secs=>decision_seconds-profile.decision_pack_interval_seconds) end,
    regular_pack_interval_seconds=regular_seconds,
    decision_pack_interval_seconds=decision_seconds
    where user_id=p_user;
end;
$$;
revoke all on function public.billing_sync_pack_timing(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_sync_pack_timing(uuid,timestamptz) to service_role;

create function public.billing_sync_paid_perks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    perform public.billing_sync_pack_timing(new.user_id,
      least(clock_timestamp(),old.period_end,new.period_end,
        old.verified_at+interval '15 minutes',new.verified_at+interval '15 minutes'));
  else perform public.billing_sync_pack_timing(new.user_id); end if;
  return null;
end;
$$;
revoke all on function public.billing_sync_paid_perks() from public,anon,authenticated;
create trigger billing_sync_paid_perks
  after insert or update of active,status,period_end,risk_hold,verified_at,scope on public.billing_accounts
  for each row execute function public.billing_sync_paid_perks();

-- Operator-only setup, after the account/price/environment preflight. No browser
-- flag, JWT metadata, Checkout redirect or customer-provided identifier is used.
create function public.billing_set_entitlement_scope(p_scope text,p_enabled boolean) returns void
language plpgsql security invoker set search_path = '' as $$
declare player uuid;
begin
  if p_scope is null or p_scope !~ '^(test|live):acct_[A-Za-z0-9]+:price_[A-Za-z0-9]+$' or p_enabled is null
    then raise exception 'BILLING_CONFIGURATION'; end if;
  update public.billing_entitlement_config set scope=p_scope,enabled=p_enabled where singleton;
  for player in select user_id from public.billing_accounts order by user_id loop
    perform public.billing_sync_pack_timing(player);
  end loop;
end;
$$;
revoke all on function public.billing_set_entitlement_scope(text,boolean) from public,anon,authenticated;
grant execute on function public.billing_set_entitlement_scope(text,boolean) to service_role;

create or replace function public.get_regular_pack_status()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid:=auth.uid(); deadline timestamptz; stamp timestamptz;
  step integer; available integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player);
  select next_regular_pack_at,regular_pack_interval_seconds into deadline,step
    from public.user_profiles where user_id=player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  stamp:=clock_timestamp();
  available:=least(5,greatest(0,1+floor(extract(epoch from(stamp-deadline))/step)))::integer;
  return jsonb_build_object('available',available,'maximum',5,
    'nextPackAt',case when available=5 then null else extract(epoch from(deadline+make_interval(secs=>available*step)))*1000 end,
    'serverNow',extract(epoch from stamp)*1000,'refillSeconds',step);
end;
$$;
revoke all on function public.get_regular_pack_status() from public,anon,authenticated;
grant execute on function public.get_regular_pack_status() to authenticated;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz; step integer;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; copy_ids uuid[]:='{}'; card_ids uuid[]:='{}'; shinies boolean[]:='{}';
  result jsonb:='[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  select next_regular_pack_at,regular_pack_interval_seconds into deadline,step
    from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  server_now:=clock_timestamp();
  if deadline>server_now then raise exception 'PACK_NOT_READY'; end if;
  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  for position in 1..5 loop
    roll:=random();
    rarity_index:=case when roll<.724 then 1 when roll<.924 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.001;
    copy_id:=gen_random_uuid();
    copy_ids:=array_append(copy_ids,copy_id); card_ids:=array_append(card_ids,selected_card.id); shinies:=array_append(shinies,shiny);
    result:=result||jsonb_build_array(jsonb_build_object(
      'id',selected_card.id,'name',selected_card.nom,'category',selected_card.categorie,
      'liveFranchise',true,'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'catalogueImage',selected_card.image_url,'customImageUrl',null,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  insert into public.user_cards(id,user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    select drawn.id,player_id,drawn.card_id,server_now,c.rarete_base,drawn.shiny,false,c.rarete_base='LR'
    from unnest(copy_ids,card_ids,shinies) as drawn(id,card_id,shiny) join public.cards c on c.id=drawn.card_id;
  update public.user_profiles set next_regular_pack_at=greatest(deadline,server_now-make_interval(secs=>4*step))+make_interval(secs=>step)
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;

create or replace function public.get_decision_pack_status()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid:=auth.uid(); deadline timestamptz; stamp timestamptz; pending_id uuid; step integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player);
  select next_decision_pack_at,decision_pack_interval_seconds into deadline,step from public.user_profiles where user_id=player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  stamp:=clock_timestamp();
  select id into pending_id from public.decision_packs where user_id=player and status='pending';
  return jsonb_build_object('available',deadline<=stamp and pending_id is null,
    'nextPackAt',extract(epoch from deadline)*1000,'serverNow',extract(epoch from stamp)*1000,
    'pending',case when pending_id is null then '[]'::jsonb else public.decision_pack_cards(pending_id) end,
    'refillSeconds',step);
end;
$$;

create or replace function public.open_decision_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz; step integer;
  pending_id uuid; pack_id uuid; pool_sizes bigint[];
  rarities public.card_rarity[]:=array['SR','SSR','LR']::public.card_rarity[];
  rates jsonb:=public.decision_pack_drop_rates();
  rarity_index integer; selected_card public.cards%rowtype; shiny boolean; roll double precision;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  select next_decision_pack_at,decision_pack_interval_seconds into deadline,step
    from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  select id into pending_id from public.decision_packs where user_id=player_id and status='pending' for update;
  if pending_id is not null then return public.decision_pack_cards(pending_id); end if;
  server_now:=clock_timestamp();
  if deadline>server_now then raise exception 'DECISION_PACK_NOT_READY'; end if;
  select array[count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),count(*) filter(where rarete_base='LR')]
    into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  insert into public.decision_packs(user_id,created_at) values(player_id,server_now) returning id into pack_id;
  for position in 1..5 loop
    roll:=random(); rarity_index:=case when roll<(rates->0->>'percent')::double precision/100 then 1 when roll<((rates->0->>'percent')::double precision+(rates->1->>'percent')::double precision)/100 then 2 else 3 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.001;
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack_id,selected_card.id,selected_card.rarete_base,shiny,position);
  end loop;
  update public.user_profiles set next_decision_pack_at=server_now+make_interval(secs=>step) where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$$;

create or replace function public.create_auction(p_card_instance_id uuid,p_starting_price integer default 10,p_duration_minutes integer default 60)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare player uuid:=auth.uid(); auction_id uuid; card_locked boolean; cap integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.settle_expired_auctions();
  if p_starting_price<10 then raise exception 'INVALID_AUCTION_PRICE'; end if;
  if p_duration_minutes not in (15,30,60,240,720,1440) then raise exception 'INVALID_AUCTION_DURATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pro-auction-limit:'||player::text,0));
  select is_locked into card_locked from public.user_cards where id=p_card_instance_id and user_id=player for update;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  if card_locked then raise exception 'CARD_LOCKED'; end if;
  if exists(select 1 from public.auctions where card_instance_id=p_card_instance_id and status='active') then raise exception 'CARD_FROZEN'; end if;
  cap:=case when public.billing_has_game_pro(player) then 6 else 3 end;
  if (select count(*) from public.auctions where seller_id=player and status='active' and ends_at>clock_timestamp())>=cap
    then raise exception 'AUCTION_LIMIT_REACHED'; end if;
  update public.user_cards set custom_image_url=null where id=p_card_instance_id;
  insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,current_price)
    values(p_card_instance_id,player,p_starting_price,p_duration_minutes,clock_timestamp()+make_interval(mins=>p_duration_minutes),p_starting_price)
    returning id into auction_id;
  return auction_id;
exception when unique_violation then raise exception 'CARD_FROZEN';
end;
$$;

notify pgrst, 'reload schema';
commit;
