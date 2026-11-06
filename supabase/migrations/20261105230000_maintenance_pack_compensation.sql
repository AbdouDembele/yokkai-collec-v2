begin;
-- Inventory is independent of timed reserves, with no expiry. The operator
-- credits a fixed cohort once; this migration alone grants nothing.
create table public.maintenance_pack_grants (
  user_id uuid primary key,
  campaign text not null check(campaign='maintenance-2026-11-05'),
  regular_remaining integer not null default 25 check(regular_remaining between 0 and 25),
  decision_remaining integer not null default 1 check(decision_remaining between 0 and 1),
  granted_at timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz
);
alter table public.maintenance_pack_grants enable row level security;
revoke all on public.maintenance_pack_grants from public,anon,authenticated,service_role;
grant select,insert,update on public.maintenance_pack_grants to service_role;
alter table public.decision_packs add column is_compensation boolean not null default false;
revoke all(is_compensation) on public.decision_packs from anon,authenticated;
alter table public.regular_pack_openings drop constraint regular_pack_openings_source_check;
alter table public.regular_pack_openings add constraint regular_pack_openings_source_check
 check(source in ('referral_reward','legacy_bonus','timed','maintenance_compensation'));
create or replace function public.open_regular_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz;
  step integer; bonus integer; reserve_maximum integer;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; copy_ids uuid[]:='{}'; card_ids uuid[]:='{}'; shinies boolean[]:='{}';
  result jsonb:='[]'::jsonb; boosted boolean; source_name text;
  reward_lot public.referral_pack_reward_lots%rowtype; legacy_bonus integer:=0;
  opening_id uuid:=gen_random_uuid();
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  select next_regular_pack_at,regular_pack_interval_seconds,bonus_regular_packs
    into deadline,step,bonus
    from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  reserve_maximum:=case when public.billing_has_game_pro(player_id) then 10 else 5 end;
  server_now:=clock_timestamp();
  if bonus=0 and deadline>server_now then raise exception 'PACK_NOT_READY'; end if;

  if bonus>0 and exists(select 1 from public.maintenance_pack_grants where user_id=player_id and regular_remaining>0) then
    update public.maintenance_pack_grants set regular_remaining=regular_remaining-1 where user_id=player_id;
    source_name:='maintenance_compensation';
  elsif bonus>0 then
    select remaining_packs into legacy_bonus from public.legacy_regular_pack_bonus_balances
      where user_id=player_id for update;
    if coalesce(legacy_bonus,0)>0 then
      update public.legacy_regular_pack_bonus_balances
        set remaining_packs=remaining_packs-1 where user_id=player_id;
      source_name:='legacy_bonus';
    else
      select * into reward_lot from public.referral_pack_reward_lots
        where beneficiary_id=player_id and remaining_packs>0
        order by granted_at,id limit 1 for update;
      if found then
        update public.referral_pack_reward_lots
          set remaining_packs=remaining_packs-1 where id=reward_lot.id;
        source_name:='referral_reward';
      else
        source_name:='legacy_bonus';
      end if;
    end if;
  else
    source_name:='timed';
  end if;

  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  boosted:=coalesce((select regular_packs_opened from public.user_achievement_stats where user_id=player_id),0)<10;
  for position in 1..5 loop
    roll:=random();
    if not boosted then
      rarity_index:=case when roll<.694 then 1 when roll<.894 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    else
      rarity_index:=case when roll<.639 then 1 when roll<.839 then 2 when roll<.989 then 3 when roll<.999 then 4 else 5 end;
    end if;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.01;
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
  insert into public.regular_pack_openings
    (id,opened_by,source,referral_reward_lot_id,referral_id,source_referrer_id,source_referred_id,beneficiary_role,opened_at)
  values (opening_id,player_id,source_name,
    case when source_name='referral_reward' then reward_lot.id end,
    case when source_name='referral_reward' then reward_lot.referral_id end,
    case when source_name='referral_reward' then reward_lot.referrer_id end,
    case when source_name='referral_reward' then reward_lot.referred_id end,
    case when source_name='referral_reward' then reward_lot.beneficiary_role end,server_now);
  insert into public.regular_pack_opening_cards
    (card_instance_id,pack_opening_id,card_id,original_owner_id,recorded_at)
  select drawn.id,opening_id,drawn.card_id,player_id,server_now
    from unnest(copy_ids,card_ids) as drawn(id,card_id);
  update public.user_profiles set
    bonus_regular_packs=case when bonus>0 then bonus-1 else 0 end,
    next_regular_pack_at=case when bonus>0 then deadline
      else greatest(deadline,server_now-make_interval(secs=>(reserve_maximum-1)*step))+make_interval(secs=>step) end
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;
revoke all on function public.open_regular_pack() from public, anon, service_role;
grant execute on function public.open_regular_pack() to authenticated;


create or replace function public.get_decision_pack_status()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player uuid:=auth.uid(); stamp timestamptz; pending_id uuid; step integer;
  window_start timestamptz; reset_at timestamptz; quota integer; used bigint; remaining integer; bonus integer;
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
    where user_id=player and created_at>=window_start and created_at<reset_at and not is_compensation;
  select coalesce((select decision_remaining from public.maintenance_pack_grants where user_id=player),0) into bonus;
  remaining:=greatest(0,quota-used)::integer+bonus;
  select id into pending_id from public.decision_packs where user_id=player and status='pending';
  return jsonb_build_object('available',remaining>0 and pending_id is null,
    'nextPackAt',extract(epoch from reset_at)*1000,'serverNow',extract(epoch from stamp)*1000,
    'pending',case when pending_id is null then '[]'::jsonb else public.decision_pack_cards(pending_id) end,
    'remaining',remaining,'maximum',quota+bonus,'bonus',bonus,'resetAt',extract(epoch from reset_at)*1000,
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
  pending_id uuid; pack_id uuid; pool_sizes bigint[]; bonus integer;
  rarities public.card_rarity[]:=array['SR','SSR','LR']::public.card_rarity[];
  rates jsonb:=public.decision_pack_drop_rates();
  rarity_index integer; selected_card public.cards%rowtype; shiny boolean; roll double precision;
begin
  perform public.assert_player_not_banned();
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
    where user_id=player_id and created_at>=window_start and created_at<reset_at and not is_compensation;
  select coalesce((select decision_remaining from public.maintenance_pack_grants where user_id=player_id),0) into bonus;
  if used>=quota and bonus=0 then raise exception 'DECISION_PACK_NOT_READY'; end if;
  select array[count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),count(*) filter(where rarete_base='LR')]
    into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  insert into public.decision_packs(user_id,created_at,is_compensation) values(player_id,server_now,bonus>0) returning id into pack_id;
  if bonus>0 then
    update public.maintenance_pack_grants set decision_remaining=decision_remaining-1 where user_id=player_id;
  end if;
  for position in 1..5 loop
    roll:=random(); rarity_index:=case when roll<(rates->0->>'percent')::double precision/100 then 1 when roll<((rates->0->>'percent')::double precision+(rates->1->>'percent')::double precision)/100 then 2 else 3 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.01;
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack_id,selected_card.id,selected_card.rarete_base,shiny,position);
  end loop;
  update public.user_profiles set next_decision_pack_at=reset_at where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$$;


notify pgrst,'reload schema';
commit;
