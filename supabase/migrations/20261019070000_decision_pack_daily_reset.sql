begin;

-- One shared civil-day window. Construct both boundaries in Paris separately:
-- DST days last 23 or 25 hours, but the reset is always at 20:00 Europe/Paris.
create function public.decision_pack_daily_window(p_at timestamptz)
returns table(period_start timestamptz,next_reset_at timestamptz)
language sql stable strict security invoker set search_path = '' as $$
  with local_stamp as (
    select p_at at time zone 'Europe/Paris' as stamp
  ), reset_day as (
    select stamp::date-case when stamp::time<time '20:00' then 1 else 0 end as day
    from local_stamp
  )
  select (day+time '20:00') at time zone 'Europe/Paris',
    (day+1+time '20:00') at time zone 'Europe/Paris'
  from reset_day;
$$;
revoke all on function public.decision_pack_daily_window(timestamptz) from public,anon,authenticated;
grant execute on function public.decision_pack_daily_window(timestamptz) to service_role;

-- Consumption is existing history, not a balance that can be reset by switching
-- tier. Packs opened before deployment in the current window also count.
create index decision_packs_user_created_at_idx on public.decision_packs(user_id,created_at);

-- Preserve Regular Pack progress exactly. Decision interval columns remain
-- deprecated compatibility metadata for older clients/exports, not recharge
-- timers: tier changes must never move the shared reset or erase consumption.
create or replace function public.billing_sync_pack_timing(p_user uuid,p_cutoff timestamptz default null) returns void
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
    regular_pack_interval_seconds=regular_seconds,
    decision_pack_interval_seconds=decision_seconds
    where user_id=p_user;
end;
$$;

create or replace function public.get_decision_pack_status()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player uuid:=auth.uid(); stamp timestamptz; pending_id uuid; step integer;
  window_start timestamptz; reset_at timestamptz; quota integer; used bigint; remaining integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  -- The profile lock serializes status, opening and Pro transitions.
  perform public.billing_sync_pack_timing(player);
  select decision_pack_interval_seconds into step from public.user_profiles where user_id=player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  stamp:=clock_timestamp();
  select period_start,next_reset_at into window_start,reset_at from public.decision_pack_daily_window(stamp);
  quota:=case when public.billing_has_game_pro(player) then 2 else 1 end;
  select count(*) into used from public.decision_packs
    where user_id=player and created_at>=window_start and created_at<reset_at;
  remaining:=greatest(0,quota-used)::integer;
  select id into pending_id from public.decision_packs where user_id=player and status='pending';
  return jsonb_build_object('available',remaining>0 and pending_id is null,
    'nextPackAt',extract(epoch from reset_at)*1000,'serverNow',extract(epoch from stamp)*1000,
    'pending',case when pending_id is null then '[]'::jsonb else public.decision_pack_cards(pending_id) end,
    'remaining',remaining,'maximum',quota,'resetAt',extract(epoch from reset_at)*1000,
    'resetTimeZone','Europe/Paris',
    -- Legacy metadata only; resetAt and remaining are authoritative.
    'refillSeconds',step);
end;
$$;

create or replace function public.open_decision_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); server_now timestamptz;
  window_start timestamptz; reset_at timestamptz; quota integer; used bigint;
  pending_id uuid; pack_id uuid; pool_sizes bigint[];
  rarities public.card_rarity[]:=array['SR','SSR','LR']::public.card_rarity[];
  rates jsonb:=public.decision_pack_drop_rates();
  rarity_index integer; selected_card public.cards%rowtype; shiny boolean; roll double precision;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  perform 1 from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  select id into pending_id from public.decision_packs where user_id=player_id and status='pending' for update;
  -- Resuming a choice (even from a previous day) never spends another pack.
  if pending_id is not null then return public.decision_pack_cards(pending_id); end if;
  server_now:=clock_timestamp();
  select period_start,next_reset_at into window_start,reset_at from public.decision_pack_daily_window(server_now);
  quota:=case when public.billing_has_game_pro(player_id) then 2 else 1 end;
  select count(*) into used from public.decision_packs
    where user_id=player_id and created_at>=window_start and created_at<reset_at;
  if used>=quota then raise exception 'DECISION_PACK_NOT_READY'; end if;
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
  update public.user_profiles set next_decision_pack_at=reset_at where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$$;

revoke all on function public.billing_sync_pack_timing(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_sync_pack_timing(uuid,timestamptz) to service_role;
revoke all on function public.get_decision_pack_status(),public.open_decision_pack() from public,anon;
grant execute on function public.get_decision_pack_status(),public.open_decision_pack() to authenticated;

notify pgrst, 'reload schema';
commit;
